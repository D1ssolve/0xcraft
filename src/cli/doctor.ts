/**
 * Doctor — health diagnostics for 0xcraft.
 *
 * `--harness opencode` (default): legacy checks — node/bun present,
 * config loadable, agents/skills prompts present, MCP commands on PATH,
 * 0xcraft registered in opencode.json.
 *
 * `--harness codex`: validates a generated Codex plugin tree (.codex/)
 * under projectRoot. Checks bun on PATH, .codex/config.toml exists with
 * [features].hooks=true and [features].child_agents_md=true, each
 * enabled hook script exists with a valid bun/node shebang, each
 * enabled agent file exists, and skills dir exists when skills are
 * enabled.
 *
 * `--harness claude-code`: validates a Claude Code plugin tree under
 * the configured plugin dir. Checks bun on PATH and hook shim scripts
 * exist with valid shebangs.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { builtinAgents } from "../core/agents/builtin-agents";
import { builtinSkills } from "../core/skills/skill-types";
import { builtinMcpServers } from "../core/mcp/mcp-registry";
import { builtinHooks } from "../core/hooks";
import { loadConfig } from "../core/config/config-loader";
import { defaultBunOnPathChecker, type BunOnPathChecker, type PlatformId } from "./_shared";
import {
  assertMatrixComplete,
  CLAUDE_CODE_MATRIX,
  CODEX_MATRIX,
  OPENCODE_MATRIX,
  type CapabilityFeature,
  type CapabilityStatus,
  type PlatformCapabilityMatrix,
} from "../adapters/_shared/capability-matrix";
// (Diagnostic type not directly referenced — checks pipeline already converts.)

export type DoctorPlatformOption = PlatformId | "all";

let matricesAsserted = false;
/** Sanity gate — asserts all three matrices are complete on first call. */
function ensureMatricesComplete(): void {
  if (matricesAsserted) return;
  assertMatrixComplete(OPENCODE_MATRIX, "OPENCODE_MATRIX");
  assertMatrixComplete(CLAUDE_CODE_MATRIX, "CLAUDE_CODE_MATRIX");
  assertMatrixComplete(CODEX_MATRIX, "CODEX_MATRIX");
  matricesAsserted = true;
}

/** Capability matrix summary per harness — emitted as part of doctor output. */
export interface CapabilitySummary {
  platform: PlatformId;
  counts: Record<CapabilityStatus, number>;
}

function summarizeMatrix(
  platform: PlatformId,
  matrix: PlatformCapabilityMatrix,
): CapabilitySummary {
  const counts: Record<CapabilityStatus, number> = {
    full: 0,
    shim: 0,
    "shell-cmd": 0,
    "drop-warn": 0,
    experimental: 0,
  };
  for (const key of Object.keys(matrix) as CapabilityFeature[]) {
    counts[matrix[key].status]++;
  }
  return { platform, counts };
}

const MATRIX_BY_HARNESS: Record<PlatformId, PlatformCapabilityMatrix> = {
  opencode: OPENCODE_MATRIX,
  "claude-code": CLAUDE_CODE_MATRIX,
  codex: CODEX_MATRIX,
};

export interface DoctorCheck {
  category: string;
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  /** Stable diagnostic code (set for harness-specific checks). */
  code?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  /** Capability matrix summary for the harness(es) inspected. */
  capabilitySummaries?: CapabilitySummary[];
  /** Per-harness sub-results when `--harness all` was used. */
  perHarness?: Record<PlatformId, DoctorResult>;
}

export interface RunDoctorDependencies {
  bunOnPathChecker?: BunOnPathChecker;
}

export interface RunDoctorOptions {
  harness?: DoctorPlatformOption;
  projectRoot?: string;
  /** Override default Claude Code plugin dir. Used by `--harness claude-code`. */
  pluginDir?: string;
  /** Upgrade `warn` checks to `fail` before exit-code computation. */
  strict?: boolean;
  dependencies?: RunDoctorDependencies;
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorResult> {
  ensureMatricesComplete();
  const harness: DoctorPlatformOption = options.harness ?? "opencode";
  const projectRoot = options.projectRoot ?? process.cwd();
  const deps = options.dependencies ?? {};

  if (harness === "all") {
    const perHarness: Record<PlatformId, DoctorResult> = {
      opencode: await runDoctor({ ...options, harness: "opencode" }),
      "claude-code": await runDoctor({ ...options, harness: "claude-code" }),
      codex: await runDoctor({ ...options, harness: "codex" }),
    };
    const checks: DoctorCheck[] = [];
    const summaries: CapabilitySummary[] = [];
    let ok = true;
    for (const id of ["opencode", "claude-code", "codex"] as PlatformId[]) {
      const sub = perHarness[id]!;
      ok = ok && sub.ok;
      for (const c of sub.checks) checks.push({ ...c, name: `[${id}] ${c.name}` });
      if (sub.capabilitySummaries) summaries.push(...sub.capabilitySummaries);
    }
    return applyStrict(
      { ok, checks, capabilitySummaries: summaries, perHarness },
      options.strict === true,
    );
  }

  let result: DoctorResult;
  if (harness === "opencode") {
    result = runOpenCodeDoctor();
  } else if (harness === "codex") {
    result = await runCodexDoctor(projectRoot, deps);
  } else {
    result = runClaudeCodeDoctor(projectRoot, options.pluginDir, deps);
  }

  result.capabilitySummaries = [summarizeMatrix(harness, MATRIX_BY_HARNESS[harness]!)];
  return applyStrict(result, options.strict === true);
}

/**
 * Upgrade every `warn` check to `fail` when `--strict` is in effect.
 * Recomputes `ok` from the resulting check list.
 */
function applyStrict(result: DoctorResult, strict: boolean): DoctorResult {
  if (!strict) return result;
  const upgraded: DoctorCheck[] = result.checks.map((c) =>
    c.status === "warn" ? { ...c, status: "fail" as const } : c,
  );
  const ok = !upgraded.some((c) => c.status === "fail");
  const next: DoctorResult = { ...result, ok, checks: upgraded };
  if (result.perHarness) {
    const perHarness: Record<PlatformId, DoctorResult> = {
      opencode: applyStrict(result.perHarness.opencode!, true),
      "claude-code": applyStrict(result.perHarness["claude-code"]!, true),
      codex: applyStrict(result.perHarness.codex!, true),
    };
    next.perHarness = perHarness;
  }
  return next;
}

/**
 * Compute spec §10 exit code from a doctor result:
 *   0 = no failures, no warnings
 *   1 = any failure
 *   2 = warnings only
 *
 * Info-only checks (ok) count as 0.
 */
export function doctorExitCode(result: DoctorResult): 0 | 1 | 2 {
  if (result.checks.some((c) => c.status === "fail")) return 1;
  if (result.checks.some((c) => c.status === "warn")) return 2;
  return 0;
}

/* ---------------------------------------------------------------- */
/*  OpenCode doctor (legacy)                                          */
/* ---------------------------------------------------------------- */

function runOpenCodeDoctor(): DoctorResult {
  const checks: DoctorCheck[] = [];
  const pkgRoot = findPkgRoot();

  checks.push(...checkSystem());
  checks.push(...checkConfig());
  checks.push(...checkAgents(pkgRoot));
  checks.push(...checkSkills(pkgRoot));
  checks.push(...checkMcps());
  checks.push(...checkOpenCodeRegistration());

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

function findPkgRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(current, "package.json"), "utf-8"));
      if (pkg.name === "0xcraft") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(import.meta.dirname, "../..");
}

function checkSystem(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  try {
    const nodeVersion = process.version;
    checks.push({ category: "System", name: "Node.js", status: "ok", message: `Node.js ${nodeVersion}` });
  } catch {
    checks.push({ category: "System", name: "Node.js", status: "fail", message: "Node.js not found" });
  }
  try {
    const bunVersion = execSync("bun --version", { encoding: "utf-8" }).trim();
    checks.push({ category: "System", name: "Bun", status: "ok", message: `Bun ${bunVersion}` });
  } catch {
    checks.push({
      category: "System",
      name: "Bun",
      status: "warn",
      message: "Bun not found (optional, recommended for development)",
    });
  }
  checks.push({
    category: "System",
    name: "Platform",
    status: "ok",
    message: `${os.type()} ${os.release()} (${os.arch()})`,
  });
  return checks;
}

function checkConfig(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  try {
    const { config: _config, sources, diagnostics } = loadConfig({ harness: "opencode" });
    if (sources.length === 0) {
      // Default-config baseline: no user overrides present is informational,
      // not a warning. Doctor must exit 0 under default config (spec §13 / T-11.4).
      checks.push({ category: "Config", name: "Config files", status: "ok", message: "No config files found — using defaults" });
    } else {
      checks.push({ category: "Config", name: "Config files", status: "ok", message: `Found: ${sources.join(", ")}` });
    }
    // Strict Zod inside loadConfig is the single validation gate (T-12.8).
    // Surface any validation diagnostics here.
    const validationDiags = diagnostics.filter((d) => d.code === "config.validation.failed");
    if (validationDiags.length === 0) {
      checks.push({ category: "Config", name: "Config validation", status: "ok", message: "Config is valid" });
    } else {
      for (const d of validationDiags) {
        checks.push({ category: "Config", name: "Config validation", status: "fail", message: d.message });
      }
    }
  } catch (err) {
    checks.push({
      category: "Config",
      name: "Config loading",
      status: "fail",
      message: `Error loading config: ${(err as Error).message}`,
    });
  }
  return checks;
}

function checkAgents(pkgRoot: string): DoctorCheck[] {
  return builtinAgents.map((agent) => {
    const agentPath = path.join(pkgRoot, agent.promptFile);
    return fs.existsSync(agentPath)
      ? { category: "Agents", name: agent.id, status: "ok", message: `Prompt file found: ${agent.promptFile}` }
      : { category: "Agents", name: agent.id, status: "fail", message: `Prompt file missing: ${agent.promptFile}` };
  });
}

function checkSkills(pkgRoot: string): DoctorCheck[] {
  return builtinSkills.map((skill) => {
    const skillPath = path.join(pkgRoot, skill.skillFile);
    return fs.existsSync(skillPath)
      ? { category: "Skills", name: skill.id, status: "ok", message: `SKILL.md found: ${skill.skillFile}` }
      : { category: "Skills", name: skill.id, status: "fail", message: `SKILL.md missing: ${skill.skillFile}` };
  });
}

function checkMcps(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const mcp of builtinMcpServers) {
    if (mcp.transport === "stdio" && mcp.command) {
      const cmd = mcp.command[0];
      try {
        execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8" });
        checks.push({ category: "MCPs", name: mcp.id, status: "ok", message: `${cmd} found on PATH` });
      } catch {
        checks.push({
          category: "MCPs",
          name: mcp.id,
          status: "warn",
          message: `${cmd} not found on PATH (MCP may fail to start)`,
        });
      }
    } else if ((mcp.transport === "http" || mcp.transport === "sse") && mcp.url) {
      checks.push({ category: "MCPs", name: mcp.id, status: "ok", message: `Remote: ${mcp.url}` });
    }
  }
  return checks;
}

function checkOpenCodeRegistration(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const home = os.homedir();
  const configPath = path.join(home, ".config", "opencode", "opencode.json");
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      const plugins = config.plugin ?? [];
      const registered = plugins.includes("0xcraft") || plugins.some((p: string) => p.includes("0xcraft"));
      if (registered) {
        checks.push({
          category: "OpenCode",
          name: "Plugin registration",
          status: "ok",
          message: "0xcraft is registered in opencode.json",
        });
      } else {
        checks.push({
          category: "OpenCode",
          name: "Plugin registration",
          status: "warn",
          message: "0xcraft is not registered in opencode.json — run `0xcraft install`",
        });
      }
    } else {
      checks.push({
        category: "OpenCode",
        name: "Plugin registration",
        status: "warn",
        message: "opencode.json not found — run `0xcraft install`",
      });
    }
  } catch {
    checks.push({
      category: "OpenCode",
      name: "Plugin registration",
      status: "warn",
      message: "Could not read opencode.json",
    });
  }
  return checks;
}

/* ---------------------------------------------------------------- */
/*  Codex doctor                                                      */
/* ---------------------------------------------------------------- */

async function runCodexDoctor(projectRoot: string, deps: RunDoctorDependencies): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Load 0xcraft config first so we know whether bun is the chosen hook
  // runtime; if the user opted into the "node" runtime, a missing bun on
  // PATH is informational, not a failure.
  const { config: cfg, diagnostics: configDiags } = loadConfig({
    harness: "codex",
    projectRoot,
  });
  for (const diag of configDiags) {
    if (diag.severity === "error") {
      checks.push({
        category: "Config",
        name: diag.code,
        status: "fail",
        code: diag.code,
        message: diag.message,
      });
    } else if (diag.severity === "warn") {
      checks.push({
        category: "Config",
        name: diag.code,
        status: "warn",
        code: diag.code,
        message: diag.message,
      });
    }
  }

  const codexHookRuntime = cfg.platforms.codex?.hookRuntime ?? "bun";
  const bunCheck = (deps.bunOnPathChecker ?? defaultBunOnPathChecker)();
  if (bunCheck) {
    if (codexHookRuntime === "bun") {
      checks.push({
        category: "System",
        name: "bun on PATH",
        status: "fail",
        message: bunCheck.message,
        code: bunCheck.code,
      });
    } else {
      checks.push({
        category: "System",
        name: "bun on PATH",
        status: "ok",
        message: `bun not on PATH (skipped — platforms.codex.hookRuntime="${codexHookRuntime}")`,
      });
    }
  } else {
    checks.push({ category: "System", name: "bun on PATH", status: "ok", message: "bun is on PATH" });
  }

  const codexDir = path.join(projectRoot, ".codex");
  const configPath = path.join(codexDir, "config.toml");

  if (!fs.existsSync(configPath)) {
    checks.push({
      category: "Codex",
      name: "config.toml",
      status: "fail",
      code: "codex.config.missing",
      message: `.codex/config.toml not found at ${configPath}`,
    });
    return { ok: false, checks };
  }
  checks.push({
    category: "Codex",
    name: "config.toml",
    status: "ok",
    message: ".codex/config.toml present",
  });

  const tomlContent = fs.readFileSync(configPath, "utf-8");
  const featuresIssues = await checkCodexFeaturesBlock(tomlContent);
  checks.push(...featuresIssues);

  // Resolve enabled hooks/agents/skills from loaded config.
  const disabledHookIds = new Set(cfg.disabled.hooks);
  const enabledHooks = builtinHooks.filter((h) => !disabledHookIds.has(h.id));

  for (const hook of enabledHooks) {
    // Batch 6: ALL Codex hook cells are drop-warn in CODEX_MATRIX, so
    // `.codex/hooks/<id>.mjs` files are intentionally NOT emitted by
    // `generateCodexPlugin`. This is a structural matrix fact, not a
    // user-config problem — emit as info so default-config doctor exits 0
    // (T-11.3 / spec §13). User-configured hooks targeting drop-warn cells
    // emit `hook.unsupported` warns elsewhere (those stay warn).
    const hookFile = path.join(codexDir, "hooks", `${hook.id}.mjs`);
    if (!fs.existsSync(hookFile)) {
      checks.push({
        category: "Codex",
        name: `hook ${hook.id}`,
        status: "ok",
        code: "codex.hook.dropped",
        message: `Hook "${hook.id}" dropped — Codex matrix marks all hook cells drop-warn (Batch 6).`,
      });
      continue;
    }
    const shebang = readFirstLine(hookFile, 1024);
    if (!isValidShebang(shebang)) {
      checks.push({
        category: "Codex",
        name: `hook ${hook.id}`,
        status: "fail",
        code: "codex.hook.bad_shebang",
        message: `Hook script .codex/hooks/${hook.id}.mjs has invalid shebang: ${shebang}`,
      });
    } else {
      checks.push({
        category: "Codex",
        name: `hook ${hook.id}`,
        status: "ok",
        message: `.codex/hooks/${hook.id}.mjs present`,
      });
    }
  }

  for (const agent of builtinAgents) {
    const agentFile = path.join(codexDir, "agents", `${agent.id}.toml`);
    if (!fs.existsSync(agentFile)) {
      checks.push({
        category: "Codex",
        name: `agent ${agent.id}`,
        status: "fail",
        code: "codex.agent.missing",
        message: `Agent file missing: .codex/agents/${agent.id}.toml`,
      });
    } else {
      checks.push({
        category: "Codex",
        name: `agent ${agent.id}`,
        status: "ok",
        message: `.codex/agents/${agent.id}.toml present`,
      });
    }
  }

  // Skills dir — only if at least one skill is enabled. Skills are enabled
  // by default unless the user disables them via enabled.skills whitelist.
  const disabledSkills = new Set(cfg.disabled.skills);
  const enabledWhitelist = cfg.enabled.skills;
  const skillsEnabled = builtinSkills.some((s) => {
    if (disabledSkills.has(s.id)) return false;
    if (enabledWhitelist.length > 0 && !enabledWhitelist.includes(s.id)) return false;
    return true;
  });
  if (skillsEnabled) {
    const skillsDirRel = cfg.platforms.codex?.skillsDir ?? ".agents/skills";
    const skillsDir = path.resolve(projectRoot, skillsDirRel);
    if (!fs.existsSync(skillsDir)) {
      checks.push({
        category: "Codex",
        name: "skills dir",
        status: "fail",
        code: "codex.skills_dir.missing",
        message: `Skills dir missing: ${skillsDirRel}`,
      });
    } else {
      checks.push({
        category: "Codex",
        name: "skills dir",
        status: "ok",
        message: `Skills dir present: ${skillsDirRel}`,
      });
    }
  }

  // T-24: filesystem-plugin bundle checks (.codex-plugin/) — only when
  // `platforms.codex.emitPlugin === true`. The bundle is opt-in; doctor
  // is silent otherwise.
  const emitPlugin = cfg.platforms.codex?.emitPlugin === true;
  const emitMarketplace = cfg.platforms.codex?.emitMarketplace === true;

  if (emitPlugin) {
    const bundleDir = path.join(projectRoot, ".codex-plugin");
    const pluginJson = path.join(bundleDir, "plugin.json");
    if (!fs.existsSync(pluginJson)) {
      checks.push({
        category: "Codex",
        name: ".codex-plugin/plugin.json",
        status: "fail",
        code: "codex.plugin.bundle.missing",
        message: ".codex-plugin/plugin.json not found (platforms.codex.emitPlugin=true); run `codex generate --plugin`.",
      });
    } else {
      checks.push({
        category: "Codex",
        name: ".codex-plugin/plugin.json",
        status: "ok",
        message: ".codex-plugin/plugin.json present",
      });
    }
  }

  if (emitMarketplace && !emitPlugin) {
    // Mirrors the build-time `codex.plugin.marketplace_requires_plugin`
    // warn — surfaces as a doctor failure so misconfigured projects
    // fail strict mode loudly.
    checks.push({
      category: "Codex",
      name: "marketplace requires plugin",
      status: "fail",
      code: "codex.plugin.marketplace_requires_plugin",
      message:
        "platforms.codex.emitMarketplace=true requires emitPlugin=true; marketplace stub will not be generated.",
    });
  }

  if (emitMarketplace && emitPlugin) {
    const marketplacePath = path.join(projectRoot, ".agents", "plugins", "marketplace.json");
    if (!fs.existsSync(marketplacePath)) {
      checks.push({
        category: "Codex",
        name: ".agents/plugins/marketplace.json",
        status: "fail",
        code: "codex.plugin.marketplace.missing",
        message:
          ".agents/plugins/marketplace.json not found (platforms.codex.emitMarketplace=true); run `codex generate --plugin --marketplace`.",
      });
    } else {
      checks.push({
        category: "Codex",
        name: ".agents/plugins/marketplace.json",
        status: "ok",
        message: ".agents/plugins/marketplace.json present",
      });
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

async function checkCodexFeaturesBlock(toml: string): Promise<DoctorCheck[]> {
  // Parse the TOML via smol-toml (dev dependency, dynamically imported so
  // production bundles that don't ship smol-toml still build cleanly).
  let parsed: Record<string, unknown> | null = null;
  try {
    const mod = (await import("smol-toml")) as { parse: (input: string) => Record<string, unknown> };
    parsed = mod.parse(toml);
  } catch (err) {
    return [
      {
        category: "Codex",
        name: "config.toml parse",
        status: "fail",
        code: "codex.config.parse_failed",
        message: `Failed to parse .codex/config.toml: ${(err as Error).message}`,
      },
    ];
  }

  const features = parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
    ? (parsed.features as Record<string, unknown>)
    : null;

  if (!features) {
    return [
      {
        category: "Codex",
        name: "[features] block",
        status: "fail",
        code: "codex.features.missing",
        message: "[features] block missing from .codex/config.toml",
      },
    ];
  }

  const checks: DoctorCheck[] = [];
  if (features.hooks === true) {
    checks.push({ category: "Codex", name: "[features].hooks", status: "ok", message: "hooks = true" });
  } else {
    checks.push({
      category: "Codex",
      name: "[features].hooks",
      status: "fail",
      code: "codex.features.hooks_missing",
      message: "[features].hooks = true missing from .codex/config.toml",
    });
  }
  if (features.child_agents_md === true) {
    checks.push({
      category: "Codex",
      name: "[features].child_agents_md",
      status: "ok",
      message: "child_agents_md = true",
    });
  } else {
    checks.push({
      category: "Codex",
      name: "[features].child_agents_md",
      status: "fail",
      code: "codex.features.child_agents_md_missing",
      message: "[features].child_agents_md = true missing from .codex/config.toml",
    });
  }
  return checks;
}

function readFirstLine(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    const text = buf.slice(0, bytesRead).toString("utf-8");
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    fs.closeSync(fd);
  }
}

function isValidShebang(line: string): boolean {
  return /^#!\/usr\/bin\/env\s+(bun|node)\b/.test(line);
}

/* ---------------------------------------------------------------- */
/*  Claude Code doctor                                                */
/* ---------------------------------------------------------------- */

function runClaudeCodeDoctor(
  projectRoot: string,
  pluginDirOverride: string | undefined,
  deps: RunDoctorDependencies,
): DoctorResult {
  const checks: DoctorCheck[] = [];

  // Load 0xcraft config first so we can surface config diagnostics and
  // gate the bun-on-PATH check on codexHookRuntime.
  const { config: cfg, diagnostics: configDiags } = loadConfig({
    harness: "claude-code",
    projectRoot,
  });
  for (const diag of configDiags) {
    if (diag.severity === "error") {
      checks.push({
        category: "Config",
        name: diag.code,
        status: "fail",
        code: diag.code,
        message: diag.message,
      });
    } else if (diag.severity === "warn") {
      checks.push({
        category: "Config",
        name: diag.code,
        status: "warn",
        code: diag.code,
        message: diag.message,
      });
    }
  }

  const codexHookRuntime = cfg.platforms.codex?.hookRuntime ?? "bun";
  const bunCheck = (deps.bunOnPathChecker ?? defaultBunOnPathChecker)();
  if (bunCheck) {
    if (codexHookRuntime === "bun") {
      checks.push({
        category: "System",
        name: "bun on PATH",
        status: "fail",
        message: bunCheck.message,
        code: bunCheck.code,
      });
    } else {
      checks.push({
        category: "System",
        name: "bun on PATH",
        status: "ok",
        message: `bun not on PATH (skipped — platforms.codex.hookRuntime="${codexHookRuntime}")`,
      });
    }
  } else {
    checks.push({ category: "System", name: "bun on PATH", status: "ok", message: "bun is on PATH" });
  }

  const pluginDir = pluginDirOverride
    ? path.resolve(pluginDirOverride)
    : path.resolve(projectRoot, "dist", "claude-code-plugin", "0xcraft");

  const hooksDir = path.join(pluginDir, "hooks");
  if (!fs.existsSync(hooksDir)) {
    // Pre-generate baseline: hooks dir absent is informational, not a
    // warning. Doctor must exit 0 under default config (spec §13 / T-11.4).
    // Once the user runs `0xcraft claude-code generate`, subsequent hook
    // checks will materialize and surface real failures.
    checks.push({
      category: "ClaudeCode",
      name: "hooks dir",
      status: "ok",
      code: "claude_code.hooks_dir.missing",
      message: `Hooks dir not generated at ${hooksDir} — run \`0xcraft claude-code generate\` to materialize hooks`,
    });
    const ok = !checks.some((c) => c.status === "fail");
    return { ok, checks };
  }

  // Load config to know which hooks should be present.
  const disabledHookIds = new Set(cfg.disabled.hooks);
  const enabledHooks = builtinHooks.filter((h) => !disabledHookIds.has(h.id));

  for (const hook of enabledHooks) {
    const scriptFile = path.join(hooksDir, `${hook.id}.mjs`);
    if (!fs.existsSync(scriptFile)) {
      checks.push({
        category: "ClaudeCode",
        name: `hook ${hook.id}`,
        status: "fail",
        code: "claude_code.hook.missing",
        message: `Hook script missing: hooks/${hook.id}.mjs`,
      });
      continue;
    }
    const shebang = readFirstLine(scriptFile, 1024);
    if (!isValidShebang(shebang)) {
      checks.push({
        category: "ClaudeCode",
        name: `hook ${hook.id}`,
        status: "fail",
        code: "claude_code.hook.bad_shebang",
        message: `Hook script hooks/${hook.id}.mjs has invalid shebang: ${shebang}`,
      });
    } else {
      checks.push({
        category: "ClaudeCode",
        name: `hook ${hook.id}`,
        status: "ok",
        message: `hooks/${hook.id}.mjs present`,
      });
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

/* ---------------------------------------------------------------- */
/*  Pretty printer                                                    */
/* ---------------------------------------------------------------- */

export function printDoctorResults(
  result: DoctorResult,
  context?: { harness?: DoctorPlatformOption; projectRoot?: string },
): void {
  const harness = context?.harness ?? "opencode";
  const root = context?.projectRoot ?? process.cwd();
  console.log(`[0xcraft] doctor — checking ${harness} at ${root}`);
  const categories = [...new Set(result.checks.map((c) => c.category))];
  for (const category of categories) {
    console.log(`\n  ${category}`);
    const categoryChecks = result.checks.filter((c) => c.category === category);
    for (const check of categoryChecks) {
      const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
      console.log(`    ${icon} ${check.name}: ${check.message}`);
    }
  }
  if (result.capabilitySummaries && result.capabilitySummaries.length > 0) {
    console.log("\n  Capability Matrix");
    for (const summary of result.capabilitySummaries) {
      const c = summary.counts;
      console.log(
        `    [${summary.platform}] full=${c.full} shim=${c.shim} shell-cmd=${c["shell-cmd"]} drop-warn=${c["drop-warn"]} experimental=${c.experimental}`,
      );
    }
  }
  console.log("");
  if (result.ok) {
    console.log("  All checks passed ✓");
  } else {
    console.log("  Some checks failed ✗ — see above for details");
  }
}
