/**
 * Codex adapter orchestrator (Task D.6 / ADR §5).
 *
 * Two entrypoints:
 *
 *   - `buildCodexFiles(options)` — pure, in-memory. Returns
 *     `{ files, diagnostics }`. No filesystem writes. Used by `build()`
 *     (`./build.ts`) and any consumer that wants an in-memory artifact.
 *   - `generateCodexPlugin(options)` — thin on-disk wrapper around
 *     `buildCodexFiles`. Persists files via `createCodexFilesystemWriter`
 *     (sandboxed, honours `force`). The CLI no longer calls this
 *     directly — `install` and `codex generate` go through `build()` +
 *     `writeArtifact()`. It is retained for snapshot/integration tests
 *     and external programmatic consumers.
 *
 * Outputs (under `outputPath`):
 *   .codex/config.toml
 *   .codex/agents/<id>.toml
 *   <codexSkillsDir or .agents/skills>/<id>/SKILL.md
 *
 * Note: hook script emission is intentionally omitted in T-05; real
 * `.codex/hooks/*` emission lands in T-14.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { builtinAgents, type AgentSpec } from "../../core/agents";
import { builtinSkills, type SkillDefinition } from "../../core/skills";
import { builtinHooks, type HookSpec } from "../../core/hooks";
import { builtinMcpServers, type McpServerSpec, type McpServerConfigEntry } from "../../core/mcp";
import {
  loadConfig,
  mergeConfig,
  type ZeroxCraftConfig,
  type PartialZeroxCraftConfig,
} from "../../core/config";

import { DiagnosticCollector, type Diagnostic } from "../_shared/diagnostic-collector";
import { resolvePackageRoot } from "../_shared/package-root";

import { emitCodexConfig } from "./emitters/config";
import { emitCodexAgent } from "./emitters/agents";
import { emitCodexHooks } from "./emitters/hooks";
import { mapHooksToCodex } from "./mappers/hooks";
import { emitCodexSkill } from "./emitters/skills";
import { emitCodexPluginBundle } from "./emitters/manifest";
import { emitCodexMarketplace } from "./emitters/marketplace";
import { mapCodexPluginManifest } from "./mappers/plugin";
import { readCodexPackageMetadata } from "./_internal/package-metadata";
import { createCodexFilesystemWriter } from "./filesystem";

export interface GenerateCodexPluginOptions {
  /** Source root (contains `agents/`, `skills/`). Auto-resolved if omitted. */
  packageRoot?: string;
  /** Project root (`.codex/` is written under this). Defaults to `outputPath` or `cwd()`. */
  projectRoot?: string;
  /** Output root. Alias for `projectRoot` for API parity with the Claude Code adapter. */
  outputPath?: string;
  /** Allow overwriting existing files. */
  force?: boolean;
  /** Optional partial config override; skips `loadConfig` lookup when provided. */
  config?: PartialZeroxCraftConfig;
  /** Forwarded to `loadConfig`. */
  homeDir?: string;
  builtInAgents?: AgentSpec[];
  customAgents?: AgentSpec[];
  builtInSkills?: SkillDefinition[];
  customSkills?: SkillDefinition[];
  builtInHooks?: HookSpec[];
  builtInMcpServers?: McpServerSpec[];
}

export interface GenerateCodexPluginResult {
  ok: boolean;
  outputPath: string;
  emittedFiles: string[];
  diagnostics: Diagnostic[];
}

/** In-memory build result — used by `build()` and consumers needing no disk. */
export interface CodexBuiltFile {
  path: string;
  content: string;
  mode?: number;
}

export interface BuildCodexFilesResult {
  ok: boolean;
  files: CodexBuiltFile[];
  diagnostics: Diagnostic[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Filter skills by config.enabled.skills (whitelist if non-empty) + config.disabled.skills. */
function selectSkills(skills: SkillDefinition[], config: ZeroxCraftConfig): SkillDefinition[] {
  const disabled = new Set(config.disabled.skills);
  const enabledList = config.enabled.skills;
  const useWhitelist = enabledList.length > 0;
  const whitelist = new Set(enabledList);
  return skills.filter((s) => {
    if (disabled.has(s.id)) return false;
    if (useWhitelist && !whitelist.has(s.id)) return false;
    return true;
  });
}

/** Filter hooks by config.disabled.hooks. */
function selectHooks(hooks: HookSpec[], config: ZeroxCraftConfig): HookSpec[] {
  const disabled = new Set(config.disabled.hooks);
  return hooks.filter((h) => !disabled.has(h.id));
}

/**
 * Merge built-in MCP servers with `config.mcpServers` user entries.
 * User entries override matching built-in names. `config.mcpServers` is
 * already canonical `McpServerSpec` so no conversion is needed.
 */
function selectMcpServers(
  builtIns: McpServerSpec[],
  userEntries: Record<string, McpServerConfigEntry>,
): McpServerSpec[] {
  const byName = new Map<string, McpServerSpec>();
  for (const s of builtIns) {
    if (s.enabledByDefault) byName.set(s.id, s);
  }
  for (const [name, entry] of Object.entries(userEntries)) {
    const promoted = {
      ...entry,
      id: name,
      description: entry.description ?? `User-configured MCP server '${name}'`,
      enabledByDefault: entry.enabledByDefault ?? true,
    } as McpServerSpec;
    byName.set(name, promoted);
  }
  return [...byName.values()];
}

/* ------------------------------------------------------------------ */
/*  In-memory builder (T-12.10)                                         */
/* ------------------------------------------------------------------ */

/**
 * Build the full Codex artifact in memory. No disk writes.
 *
 * Determinism: file order is the emission order below (config → agents
 * by registry order → skills by registry order). Callers wanting POSIX-
 * sorted order (e.g. `build()` per ADR §6) must sort externally.
 */
export async function buildCodexFiles(
  options: GenerateCodexPluginOptions = {},
): Promise<BuildCodexFilesResult> {
  const diagnostics = new DiagnosticCollector();

  // 1. Resolve package root (source of agents/, skills/).
  const packageRoot = options.packageRoot
    ? path.resolve(options.packageRoot)
    : resolvePackageRoot({ startDir: path.dirname(fileURLToPath(import.meta.url)) });

  // 2. Resolve project root (for hook-script breadcrumbs etc.).
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  // 3. Resolve final config.
  let config: ZeroxCraftConfig;
  if (options.config !== undefined) {
    config = mergeConfig(options.config);
  } else {
    const loaded = loadConfig({
      harness: "codex",
      projectRoot,
      homeDir: options.homeDir,
    });
    for (const d of loaded.diagnostics) diagnostics.add(d);
    config = mergeConfig(loaded.config);
  }

  // 4. Resolve registries.
  const agents: AgentSpec[] = [
    ...(options.builtInAgents ?? builtinAgents),
    ...(options.customAgents ?? []),
  ];

  const allSkills: SkillDefinition[] = [
    ...(options.builtInSkills ?? builtinSkills),
    ...(options.customSkills ?? []),
  ];
  const skills = selectSkills(allSkills, config);

  const hooks = selectHooks(options.builtInHooks ?? builtinHooks, config);

  const mcpServers = selectMcpServers(
    options.builtInMcpServers ?? builtinMcpServers,
    config.mcpServers,
  );

  const files: CodexBuiltFile[] = [];

  // 5. .codex/config.toml
  const codexHookRuntime = config.platforms.codex?.hookRuntime;
  const configResult = emitCodexConfig({
    config,
    mcpServers,
    hooks,
    codexHookRuntime,
  });
  for (const d of configResult.diagnostics) diagnostics.add(d);
  files.push({ path: ".codex/config.toml", content: configResult.toml });

  // 6. .codex/agents/<id>.toml
  for (const agent of agents) {
    const r = emitCodexAgent({
      agent,
      packageRoot,
      config,
      perAgentMcpServers: agent.mcpServers,
    });
    for (const d of r.diagnostics) diagnostics.add(d);
    files.push({ path: r.filename, content: r.toml });
  }

  // 7. Hooks — `.codex/hooks.json` + `.codex/hooks/<id>.sh`.
  const hookMapping = mapHooksToCodex({
    hooks,
    collector: diagnostics,
    disabledHooks: config.disabled.hooks,
  });
  const hookEmission = emitCodexHooks({
    entries: hookMapping.entries,
    projectRoot,
  });
  for (const d of hookEmission.diagnostics) diagnostics.add(d);
  for (const file of hookEmission.files) files.push(file);

  // 8. <codexSkillsDir>/<id>/SKILL.md
  const skillFiles: CodexBuiltFile[] = [];
  for (const skill of skills) {
    const r = emitCodexSkill({ skill, packageRoot, config });
    if (r === null) continue;
    for (const d of r.diagnostics) diagnostics.add(d);
    const file = { path: r.filename, content: r.content };
    files.push(file);
    skillFiles.push(file);
  }

  // 9. `.codex-plugin/` bundle (opt-in via platforms.codex.emitPlugin).
  const codexPlatform = config.platforms.codex;
  if (codexPlatform?.emitPlugin === true) {
    const packageMetadata = readCodexPackageMetadata(packageRoot, diagnostics);
    const manifest = mapCodexPluginManifest({
      packageMetadata,
      skills,
      mcpServers,
      hookEntries: hookMapping.entries,
      emitApps: codexPlatform.emitApps === true,
    });
    const sourceSkillsDir = (codexPlatform.skillsDir ?? ".agents/skills").replace(/\\/g, "/");
    const bundle = emitCodexPluginBundle({
      manifest,
      skillFiles,
      hookFiles: hookEmission.files,
      sourceSkillsDir,
    });
    for (const file of bundle.files) files.push(file);

    // 10. Marketplace stub (opt-in, requires emitPlugin).
    if (codexPlatform.emitMarketplace === true) {
      const market = emitCodexMarketplace({
        packageName: packageMetadata.name,
        packageVersion: packageMetadata.version,
      });
      for (const file of market.files) files.push(file);
    }
  } else if (codexPlatform?.emitMarketplace === true) {
    // Defensive: marketplace without plugin is a misconfiguration. CLI
    // already gates this via ERR_MARKETPLACE_REQUIRES_PLUGIN (T-25); at
    // the build layer we surface it as a warn so library callers see it
    // too, but do not emit the file.
    diagnostics.warn(
      "codex.plugin.marketplace_requires_plugin",
      "platforms.codex.emitMarketplace=true requires emitPlugin=true; marketplace.json was NOT emitted.",
    );
  }

  const collected = diagnostics.getAll();
  return {
    ok: !collected.some((d) => d.severity === "error"),
    files,
    diagnostics: collected,
  };
}

/* ------------------------------------------------------------------ */
/*  Public on-disk entry (back-compat wrapper)                          */
/* ------------------------------------------------------------------ */

export async function generateCodexPlugin(
  options: GenerateCodexPluginOptions = {},
): Promise<GenerateCodexPluginResult> {
  // Build everything in memory first.
  const built = await buildCodexFiles(options);

  // Resolve output root identically to legacy behaviour.
  const outputPath = path.resolve(
    options.outputPath ?? options.projectRoot ?? process.cwd(),
  );

  const writer = createCodexFilesystemWriter({
    outputRoot: outputPath,
    force: options.force,
  });

  // Collect diagnostics (build-time + write-time).
  const writeDiagnostics: Diagnostic[] = [];
  const emittedFiles: string[] = [];

  for (const file of built.files) {
    try {
      writer.writeFile(file.path, file.content, file.mode);
      emittedFiles.push(file.path);
    } catch (err) {
      writeDiagnostics.push({
        severity: "error",
        code: "codex.generate.write_failed",
        message: `Failed to write ${file.path}: ${(err as Error).message}`,
        details: { file: file.path },
      });
    }
  }

  const allDiagnostics = [...built.diagnostics, ...writeDiagnostics];
  const ok = !allDiagnostics.some((d) => d.severity === "error");

  return {
    ok,
    outputPath,
    emittedFiles,
    diagnostics: allDiagnostics,
  };
}

/* ------------------------------------------------------------------ */
/*  Batch 4 — canonical build() entry (ADR §6)                         */
/* ------------------------------------------------------------------ */
export { build, type CodexArtifact } from "./build";
