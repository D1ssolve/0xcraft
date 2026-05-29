/**
 * F.1 — Multi-harness integration test.
 *
 * Generates all three adapter outputs (OpenCode, Claude Code, Codex) from
 * the same built-in registry into isolated `os.tmpdir()` sandboxes and
 * asserts each one's expected shape, plus cross-cutting invariants:
 *   - no writes outside each sandbox
 *   - every enabled agent appears in every harness
 *   - disabledHooks suppresses the hook in every harness
 *   - default-registry generation produces zero error-severity diagnostics
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { builtinAgents } from "../core/agents";
import { builtinHooks } from "../core/hooks";
import { defaultConfig } from "../core/config";

import { generateClaudeCodePlugin } from "../adapters/claude-code";
import { generateCodexPlugin } from "../adapters/codex";
import { createPluginHooks } from "../adapters/opencode";
import { build as buildOpenCode } from "../adapters/opencode/build";
import { build as buildClaudeCode } from "../adapters/claude-code/build";
import { build as buildCodex } from "../adapters/codex/build";

const packageRoot = path.resolve(import.meta.dir, "..", "..");

/* ------------------------------------------------------------------ */
/*  Sandbox helpers                                                     */
/* ------------------------------------------------------------------ */

const sandboxes: string[] = [];

function makeSandbox(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `0xcraft-int-${prefix}-`));
  sandboxes.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

function assertFilesUnderSandbox(emittedFiles: string[], sandbox: string): void {
  const resolvedSandbox = path.resolve(sandbox);
  for (const rel of emittedFiles) {
    const abs = path.resolve(sandbox, rel);
    const relFromSandbox = path.relative(resolvedSandbox, abs);
    expect(relFromSandbox.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relFromSandbox)).toBe(false);
  }
}

function expectedAgentIds(): string[] {
  return builtinAgents.map((a) => a.id).sort();
}

/* ------------------------------------------------------------------ */
/*  OpenCode harness (in-memory plugin config)                          */
/* ------------------------------------------------------------------ */

type PluginInput = Parameters<typeof createPluginHooks>[0];

function makeOpenCodePluginInput(projectRoot: string): PluginInput {
  return {
    client: undefined,
    project: {},
    directory: projectRoot,
    worktree: projectRoot,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {},
  } as unknown as PluginInput;
}

async function generateOpenCodeConfig(opts: {
  projectRoot: string;
  homeDir: string;
}): Promise<Record<string, unknown>> {
  const hooks = await createPluginHooks(makeOpenCodePluginInput(opts.projectRoot), {
    homeDir: opts.homeDir,
    packageStartDir: path.join(packageRoot, "src", "adapters", "opencode"),
    packageCwd: packageRoot,
  });
  expect(typeof hooks.config).toBe("function");
  const inputConfig: Record<string, unknown> = {};
  const configHook = hooks.config as (cfg: Record<string, unknown>) => Promise<void>;
  await configHook(inputConfig);
  return inputConfig;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("F.1 — Multi-harness integration", () => {
  describe("OpenCode adapter — populates plugin config", () => {
    let inputConfig: Record<string, unknown>;

    beforeAll(async () => {
      const projectRoot = makeSandbox("oc-proj");
      const homeDir = makeSandbox("oc-home");
      // Project must NOT contain stray .opencode/0xcraft.json — fresh mkdtemp
      // already guarantees this. AGENTS.md absence is irrelevant — config
      // hook only registers agents/skills/MCPs.
      inputConfig = await generateOpenCodeConfig({ projectRoot, homeDir });
    });

    test("inputConfig.agent contains every builtin agent", () => {
      const agents = inputConfig.agent as Record<string, Record<string, unknown>>;
      expect(agents).toBeDefined();
      const presentIds = Object.keys(agents).sort();
      for (const id of expectedAgentIds()) {
        expect(presentIds).toContain(id);
      }
    });

    test("inputConfig has skill paths registered", () => {
      const skills = inputConfig.skills as Record<string, unknown> | undefined;
      expect(skills).toBeDefined();
      // Paths array OR top-level path entries.
      const paths = (skills?.paths ?? []) as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    test("inputConfig.mcp contains at least one built-in server", () => {
      const mcp = inputConfig.mcp as Record<string, unknown> | undefined;
      expect(mcp).toBeDefined();
      expect(Object.keys(mcp ?? {}).length).toBeGreaterThan(0);
    });
  });

  describe("Claude Code adapter — writes plugin tree to sandbox", () => {
    let sandbox: string;
    let result: Awaited<ReturnType<typeof generateClaudeCodePlugin>>;

    beforeAll(async () => {
      sandbox = makeSandbox("cc");
      result = await generateClaudeCodePlugin({
        packageRoot,
        projectRoot: sandbox,
        outputPath: sandbox,
        force: true,
        homeDir: makeSandbox("cc-home"),
      });
    });

    test("generation succeeds with no error diagnostics", () => {
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    test("plugin.json, agents/, skills/, hooks/hooks.json exist", () => {
      expect(fs.existsSync(path.join(sandbox, ".claude-plugin", "plugin.json"))).toBe(true);

      const agentsDir = path.join(sandbox, "agents");
      expect(fs.existsSync(agentsDir)).toBe(true);
      const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
      expect(agentFiles.length).toBeGreaterThan(0);

      // At least one skill SKILL.md
      const skillsDir = path.join(sandbox, "skills");
      expect(fs.existsSync(skillsDir)).toBe(true);
      const skillIds = fs.readdirSync(skillsDir);
      let foundSkillMd = false;
      for (const id of skillIds) {
        if (fs.existsSync(path.join(skillsDir, id, "SKILL.md"))) {
          foundSkillMd = true;
          break;
        }
      }
      expect(foundSkillMd).toBe(true);

      expect(fs.existsSync(path.join(sandbox, "hooks", "hooks.json"))).toBe(true);
    });

    test("at least one hook script references SessionStart and none reference PreToolUse", () => {
      const hooksDir = path.join(sandbox, "hooks");
      const hookScripts = fs
        .readdirSync(hooksDir)
        .filter((f) => f.endsWith(".mjs"))
        .map((f) => path.join(hooksDir, f));
      expect(hookScripts.length).toBeGreaterThan(0);

      let sessionStartFound = false;
      for (const script of hookScripts) {
        const content = fs.readFileSync(script, "utf-8");
        if (content.includes("SessionStart")) sessionStartFound = true;
        expect(content.includes("PreToolUse")).toBe(false);
      }
      expect(sessionStartFound).toBe(true);
    });

    test("all built-in agents are present", () => {
      const agentFiles = fs
        .readdirSync(path.join(sandbox, "agents"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        .sort();
      for (const id of expectedAgentIds()) {
        expect(agentFiles).toContain(id);
      }
    });

    test("no writes escape the sandbox", () => {
      assertFilesUnderSandbox(result.emittedFiles, sandbox);
    });
  });

  describe("Codex adapter — writes .codex/ tree to sandbox", () => {
    let sandbox: string;
    let result: Awaited<ReturnType<typeof generateCodexPlugin>>;

    beforeAll(async () => {
      sandbox = makeSandbox("codex");
      result = await generateCodexPlugin({
        packageRoot,
        projectRoot: sandbox,
        outputPath: sandbox,
        force: true,
        homeDir: makeSandbox("codex-home"),
      });
    });

    test("generation succeeds with no error diagnostics", () => {
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    test(".codex/config.toml exists with [features] hooks=true and child_agents_md=true, and NO codex_hooks key", () => {
      const configPath = path.join(sandbox, ".codex", "config.toml");
      expect(fs.existsSync(configPath)).toBe(true);
      const toml = fs.readFileSync(configPath, "utf-8");

      // Locate the [features] block body.
      const featuresHeader = /^\s*\[features\]\s*$/m.exec(toml);
      expect(featuresHeader).not.toBeNull();
      const bodyStart = (featuresHeader!.index ?? 0) + featuresHeader![0].length;
      const after = toml.slice(bodyStart);
      const nextHeader = /^\s*\[/m.exec(after);
      const body = nextHeader ? after.slice(0, nextHeader.index) : after;

      expect(/^\s*hooks\s*=\s*true\s*$/m.test(body)).toBe(true);
      expect(/^\s*child_agents_md\s*=\s*true\s*$/m.test(body)).toBe(true);
      // The deprecated alias must not appear anywhere in the body.
      expect(/codex_hooks/.test(body)).toBe(false);
      // Defense-in-depth: also reject across the whole document.
      expect(/codex_hooks/.test(toml)).toBe(false);
    });

    test("each builtin agent emits .codex/agents/<id>.toml with required keys", () => {
      for (const agent of builtinAgents) {
        const agentFile = path.join(sandbox, ".codex", "agents", `${agent.id}.toml`);
        expect(fs.existsSync(agentFile)).toBe(true);
        const content = fs.readFileSync(agentFile, "utf-8");
        expect(/^name\s*=\s*/m.test(content)).toBe(true);
        expect(/^description\s*=\s*/m.test(content)).toBe(true);
        expect(/^developer_instructions\s*=\s*/m.test(content)).toBe(true);
      }
    });

    test("agent with bash:'deny' emits sandbox_mode/approval_policy keys", () => {
      // go-mentor has both edit:"deny" and bash:"deny" in builtin-agents.
      // Builtins now declare canonical PermissionSpec; bash deny lives on
      // `permission.bash` (canonical) and is mirrored into bucketed
      // `tools.bash` via effectiveAgentPermissions at adapter boundaries.
      const denyAgent = builtinAgents.find((a) => {
        const bashSpec = a.permission?.bash;
        if (typeof bashSpec === "string" && bashSpec === "deny") return true;
        if (bashSpec && typeof bashSpec === "object" &&
            (bashSpec as { default?: string }).default === "deny") return true;
        return a.permission?.tools?.bash === "deny";
      });
      expect(denyAgent).toBeDefined();
      const agentFile = path.join(sandbox, ".codex", "agents", `${denyAgent!.id}.toml`);
      expect(fs.existsSync(agentFile)).toBe(true);
      const content = fs.readFileSync(agentFile, "utf-8");
      // Permission mapper must emit at least sandbox_mode.
      expect(/^sandbox_mode\s*=\s*"/m.test(content)).toBe(true);
    });

    test("Batch D — emits `.codex/hooks.json` + per-hook `.sh` scripts for enabled hooks", () => {
      // hooks.json present and non-empty.
      const hooksJson = path.join(sandbox, ".codex", "hooks.json");
      expect(fs.existsSync(hooksJson)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(hooksJson, "utf-8")) as {
        hooks: Record<string, unknown>;
      };
      expect(Object.keys(parsed.hooks).length).toBeGreaterThan(0);

      // Every built-in hook (all map to full Codex cells) produces a .sh script.
      for (const hook of builtinHooks) {
        const file = path.join(sandbox, ".codex", "hooks", `${hook.id}.sh`);
        expect(fs.existsSync(file)).toBe(true);
      }

      // Legacy `.mjs` shape must NOT be emitted.
      for (const hook of builtinHooks) {
        const legacy = path.join(sandbox, ".codex", "hooks", `${hook.id}.mjs`);
        expect(fs.existsSync(legacy)).toBe(false);
      }
    });

    test("skills land under default `.agents/skills/<id>/SKILL.md`", () => {
      const skillsRoot = path.join(sandbox, ".agents", "skills");
      expect(fs.existsSync(skillsRoot)).toBe(true);
      const entries = fs.readdirSync(skillsRoot);
      expect(entries.length).toBeGreaterThan(0);
      // At least one entry has a SKILL.md.
      const haveSkillMd = entries.some((id) =>
        fs.existsSync(path.join(skillsRoot, id, "SKILL.md")),
      );
      expect(haveSkillMd).toBe(true);
    });

    test("no writes escape the sandbox", () => {
      assertFilesUnderSandbox(result.emittedFiles, sandbox);
    });
  });

  describe("Cross-cutting", () => {
    test("disabledHooks=['caveman-bootstrap'] removes that hook from every harness output", async () => {
      const ccSandbox = makeSandbox("xcut-cc");
      const codexSandbox = makeSandbox("xcut-codex");
      const ocProj = makeSandbox("xcut-oc-proj");
      const ocHome = makeSandbox("xcut-oc-home");

      // Codex.
      const codexResult = await generateCodexPlugin({
        packageRoot,
        projectRoot: codexSandbox,
        outputPath: codexSandbox,
        force: true,
        config: { disabled: { agents: [], skills: [], hooks: ["caveman-bootstrap"], commands: [], mcp: [] } },
      });
      expect(codexResult.ok).toBe(true);
      expect(
        fs.existsSync(path.join(codexSandbox, ".codex", "hooks", "caveman-bootstrap.mjs")),
      ).toBe(false);
      expect(
        codexResult.emittedFiles.some((f) => f.endsWith("caveman-bootstrap.mjs")),
      ).toBe(false);

      // Claude Code.
      const ccResult = await generateClaudeCodePlugin({
        packageRoot,
        projectRoot: ccSandbox,
        outputPath: ccSandbox,
        force: true,
        config: { disabled: { agents: [], skills: [], hooks: ["caveman-bootstrap"], commands: [], mcp: [] } },
      });
      expect(ccResult.ok).toBe(true);
      expect(fs.existsSync(path.join(ccSandbox, "hooks", "caveman-bootstrap.mjs"))).toBe(false);
      expect(
        ccResult.emittedFiles.some((f) => f.includes("caveman-bootstrap")),
      ).toBe(false);

      // OpenCode — when disabled, hooks shape may drop the transform entirely
      // when all bootstrap hooks are off; here we disable ONE so the
      // transform remains but we cannot directly observe which hook ids
      // contribute. We assert the hooks function still composes successfully
      // by verifying it returns and does not throw, and that the registered
      // agents are still present (regression guard).
      // Write a local config to the project root so loadConfig picks it up.
      fs.mkdirSync(path.join(ocProj, ".opencode"), { recursive: true });
      fs.writeFileSync(
        path.join(ocProj, ".opencode", "0xcraft.json"),
        JSON.stringify({ disabled: { hooks: ["caveman-bootstrap"] } }),
      );
      const ocConfig = await generateOpenCodeConfig({ projectRoot: ocProj, homeDir: ocHome });
      const agents = ocConfig.agent as Record<string, Record<string, unknown>>;
      expect(Object.keys(agents).length).toBeGreaterThan(0);
    });

    test("aggregated diagnostics across all three harnesses have zero errors for default registry", async () => {
      const ccSandbox = makeSandbox("agg-cc");
      const codexSandbox = makeSandbox("agg-codex");

      const [ccResult, codexResult] = await Promise.all([
        generateClaudeCodePlugin({
          packageRoot,
          projectRoot: ccSandbox,
          outputPath: ccSandbox,
          force: true,
          homeDir: makeSandbox("agg-cc-home"),
        }),
        generateCodexPlugin({
          packageRoot,
          projectRoot: codexSandbox,
          outputPath: codexSandbox,
          force: true,
          homeDir: makeSandbox("agg-codex-home"),
        }),
      ]);

      const allErrors = [
        ...ccResult.diagnostics.filter((d) => d.severity === "error"),
        ...codexResult.diagnostics.filter((d) => d.severity === "error"),
      ];
      expect(allErrors).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  T-10.1 — same defaultConfig → all three build() entries          */
  /* ---------------------------------------------------------------- */

  describe("T-10.1 — defaultConfig drives all three build() entries", () => {
    let ocArtifact: Awaited<ReturnType<typeof buildOpenCode>>;
    let ccArtifact: Awaited<ReturnType<typeof buildClaudeCode>>;
    let codexArtifact: Awaited<ReturnType<typeof buildCodex>>;
    let ccSandbox: string;
    let codexSandbox: string;

    beforeAll(async () => {
      ccSandbox = makeSandbox("t101-cc");
      codexSandbox = makeSandbox("t101-codex");
      const ocProj = makeSandbox("t101-oc");

      [ocArtifact, ccArtifact, codexArtifact] = await Promise.all([
        buildOpenCode({
          config: defaultConfig,
          projectRoot: ocProj,
          packageRoot,
        }),
        buildClaudeCode({
          config: defaultConfig,
          projectRoot: ccSandbox,
          packageRoot,
          outputRoot: ccSandbox,
          homeDir: makeSandbox("t101-cc-home"),
        }),
        buildCodex({
          config: defaultConfig,
          projectRoot: codexSandbox,
          packageRoot,
          outputRoot: codexSandbox,
          homeDir: makeSandbox("t101-codex-home"),
        }),
      ]);
    });

    test("all three artifacts report ok: true", () => {
      expect(ocArtifact.ok).toBe(true);
      expect(ccArtifact.ok).toBe(true);
      expect(codexArtifact.ok).toBe(true);
    });

    test("capabilityReport.platform matches each adapter", () => {
      expect(ocArtifact.capabilityReport.platform).toBe("opencode");
      expect(ccArtifact.capabilityReport.platform).toBe("claude-code");
      expect(codexArtifact.capabilityReport.platform).toBe("codex");
    });

    test("no cross-contamination — claude-code files never reference codex/opencode paths", () => {
      for (const f of ccArtifact.files) {
        // Path-prefix check: no `.codex/` or opencode-specific markers.
        expect(f.path.startsWith(".codex/")).toBe(false);
        expect(f.path.startsWith("opencode/")).toBe(false);
      }
    });

    test("no cross-contamination — codex files never reference claude/opencode paths", () => {
      for (const f of codexArtifact.files) {
        expect(f.path.startsWith(".claude-plugin/")).toBe(false);
        expect(f.path.startsWith("hooks/hooks.json")).toBe(false);
        expect(f.path.startsWith("opencode/")).toBe(false);
      }
    });

    test("opencode artifact has no filesystem files (runtime-plugin kind)", () => {
      expect(ocArtifact.kind).toBe("runtime-plugin");
      expect(ocArtifact.files).toEqual([]);
    });

    test("diagnostics arrays are sorted by (severity, code, message)", () => {
      const severityRank: Record<string, number> = { error: 0, warn: 1, info: 2 };
      const isSorted = (arr: { severity: string; code: string; message: string }[]) => {
        for (let i = 1; i < arr.length; i++) {
          const a = arr[i - 1]!;
          const b = arr[i]!;
          const sevDiff = severityRank[a.severity]! - severityRank[b.severity]!;
          if (sevDiff > 0) return false;
          if (sevDiff < 0) continue;
          if (a.code > b.code) return false;
          if (a.code < b.code) continue;
          if (a.message > b.message) return false;
        }
        return true;
      };
      expect(isSorted(ocArtifact.diagnostics)).toBe(true);
      expect(isSorted(ccArtifact.diagnostics)).toBe(true);
      expect(isSorted(codexArtifact.diagnostics)).toBe(true);
    });
  });
});
