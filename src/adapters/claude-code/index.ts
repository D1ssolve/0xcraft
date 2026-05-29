import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFrontmatter } from "../_shared/frontmatter";
import { resolvePackageRoot as sharedResolvePackageRoot } from "../_shared/package-root";
import { builtinAgents, type AgentSpec } from "../../core/agents";
import { loadConfig, mergeConfig, type ZeroxCraftConfig, type PartialZeroxCraftConfig } from "../../core/config";
import { builtinHooks, type HookSpec } from "../../core/hooks";
import { builtinMcpServers, type McpServerSpec } from "../../core/mcp";
import { builtinSkills, type SkillDefinition } from "../../core/skills";
import { createClaudeCodeFilesystemWriter, type ClaudeCodeFilesystemWriter } from "./filesystem";
import { createInMemoryClaudeCodeWriter, type InMemoryFile } from "./in-memory-writer";
import {
  generateClaudeCodeAgents,
  type GenerateClaudeCodeAgentsOptions,
  type GenerateClaudeCodeAgentsResult,
} from "./emitters/agents";
import {
  generateClaudeCodeHooks,
  type GenerateClaudeCodeHooksOptions,
  type GenerateClaudeCodeHooksResult,
} from "./emitters/hooks";
import {
  generateClaudeCodeManifest,
  type GenerateClaudeCodeManifestOptions,
  type GenerateClaudeCodeManifestResult,
} from "./emitters/manifest";
import {
  generateClaudeCodeMcp,
  type ClaudeCodeMcpGeneratorOptions,
  type ClaudeCodeMcpGeneratorResult,
} from "./emitters/mcp";
import {
  generateClaudeCodeSettings,
  type GenerateClaudeCodeSettingsOptions,
  type GenerateClaudeCodeSettingsResult,
} from "./emitters/settings";
import {
  generateClaudeCodeSkills,
  type ClaudeCodeSkillsGeneratorOptions,
  type ClaudeCodeSkillsGeneratorResult,
} from "./emitters/skills";
import {
  claudeCodeAgentFrontmatterSchema,
  claudeCodeHooksJsonSchema,
  claudeCodeManifestSchema,
  claudeCodeMcpJsonSchema,
  claudeCodeSettingsJsonSchema,
  claudeCodeSkillFrontmatterSchema,
} from "./types/claude-code-types";
import {
  runClaudePluginValidate,
  type ClaudePluginValidateResult,
  type ClaudeProcessRunner,
  type ClaudeValidationDiagnostic,
} from "./validate";
import { DiagnosticCollector } from "../_shared/diagnostic-collector";
import {
  routeClaudeCodeHooks,
  emitClaudeCodeHookMatrixSweep,
} from "./mappers/hooks";

export type ClaudeCodeGeneratorDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeGeneratorDiagnostic {
  severity: ClaudeCodeGeneratorDiagnosticSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClaudeCodeSelectedAssets {
  agents?: boolean;
  skills?: boolean;
  hooks?: boolean;
  mcpServers?: boolean;
  settings?: boolean;
}

export interface ClaudeCodePluginResultMetadata {
  generated: true;
  sourceOwned: false;
  defaultOutput: boolean;
  ownership: "ephemeral-generated-artifact";
}

export interface ClaudeCodeLocalValidationResult {
  ok: boolean;
  diagnostics: ClaudeCodeGeneratorDiagnostic[];
}

export interface GenerateClaudeCodePluginResult {
  ok: boolean;
  outputPath: string;
  emittedFiles: string[];
  diagnostics: ClaudeCodeGeneratorDiagnostic[];
  localValidation: ClaudeCodeLocalValidationResult;
  externalValidation?: ClaudePluginValidateResult;
  metadata: ClaudeCodePluginResultMetadata;
}

type ManifestGeneratorOptions = GenerateClaudeCodeManifestOptions & { writer: ClaudeCodeFilesystemWriter };

export interface ClaudeCodePluginGeneratorDependencies {
  generateAgents?: (options: GenerateClaudeCodeAgentsOptions) => GenerateClaudeCodeAgentsResult;
  generateSkills?: (options: ClaudeCodeSkillsGeneratorOptions) => ClaudeCodeSkillsGeneratorResult;
  generateHooks?: (options: GenerateClaudeCodeHooksOptions) => GenerateClaudeCodeHooksResult;
  generateMcp?: (options: ClaudeCodeMcpGeneratorOptions) => ClaudeCodeMcpGeneratorResult;
  generateSettings?: (options: GenerateClaudeCodeSettingsOptions) => GenerateClaudeCodeSettingsResult;
  generateManifest?: (options: ManifestGeneratorOptions) => GenerateClaudeCodeManifestResult;
}

export interface GenerateClaudeCodePluginOptions {
  packageRoot?: string;
  projectRoot?: string;
  outputPath?: string;
  force?: boolean;
  config?: PartialZeroxCraftConfig;
  settings?: Record<string, unknown>;
  selectedAssets?: ClaudeCodeSelectedAssets;
  validateExternal?: boolean;
  strictExternalValidation?: boolean;
  externalValidationRunner?: ClaudeProcessRunner;
  homeDir?: string;
  builtInAgents?: AgentSpec[];
  customAgents?: AgentSpec[];
  builtInSkills?: SkillDefinition[];
  customSkills?: SkillDefinition[];
  builtInHooks?: HookSpec[];
  builtInMcpServers?: McpServerSpec[];
  dependencies?: ClaudeCodePluginGeneratorDependencies;
}

const DEFAULT_SELECTED_ASSETS = {
  agents: true,
  skills: true,
  hooks: true,
  mcpServers: true,
  settings: true,
} satisfies Required<ClaudeCodeSelectedAssets>;

export async function generateClaudeCodePlugin(options: GenerateClaudeCodePluginOptions = {}): Promise<GenerateClaudeCodePluginResult> {
  // T-12.x: single source of orchestration.
  //
  // `generateClaudeCodePlugin` is the on-disk wrapper around
  // `buildClaudeCodeFiles`. The builder runs every generator against an
  // in-memory writer and returns the captured files + diagnostics; this
  // function then preflights the output directory, persists each file
  // through `createClaudeCodeFilesystemWriter`, runs optional external
  // validation, and assembles the legacy result shape.
  //
  // This removes the prior duplicate orchestration path that called all
  // generators a second time against the on-disk writer, and matches
  // the cleaner Codex pattern (`buildCodexFiles` ↔ `generateCodexPlugin`).
  const packageRoot = options.packageRoot
    ? path.resolve(options.packageRoot)
    : sharedResolvePackageRoot({ startDir: path.dirname(fileURLToPath(import.meta.url)) });
  const outputPath = path.resolve(options.outputPath ?? path.join(packageRoot, "dist", "claude-code-plugin", "0xcraft"));

  const built = await buildClaudeCodeFiles({
    packageRoot: options.packageRoot,
    projectRoot: options.projectRoot,
    force: options.force,
    config: options.config,
    settings: options.settings,
    selectedAssets: options.selectedAssets,
    homeDir: options.homeDir,
    builtInAgents: options.builtInAgents,
    customAgents: options.customAgents,
    builtInSkills: options.builtInSkills,
    customSkills: options.customSkills,
    builtInHooks: options.builtInHooks,
    builtInMcpServers: options.builtInMcpServers,
    dependencies: options.dependencies,
  });

  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [...built.diagnostics];
  const writer = createClaudeCodeFilesystemWriter({ outputRoot: outputPath, force: options.force });

  // Persist every captured file. `writer.writeFile` enforces sandbox
  // containment, runs the preflight (empty-dir / force) check, and
  // best-effort chmods POSIX modes (e.g. hook shim scripts). Any write
  // failure (preflight rejection, EACCES, sandbox escape) is fatal and
  // propagated — matching the prior on-disk orchestration's behaviour.
  for (const file of built.files) {
    writer.writeFile(file.path, file.content, file.mode);
  }

  const localValidation = built.localValidation;

  let externalValidation: ClaudePluginValidateResult | undefined;
  if (options.validateExternal === true) {
    externalValidation = await runClaudePluginValidate({
      pluginDir: outputPath,
      strict: options.strictExternalValidation,
      failOnMissingClaude: true,
      runner: options.externalValidationRunner,
    });
    diagnostics.push(...externalValidation.diagnostics.map(fromValidationDiagnostic));
  }

  return {
    ok: localValidation.ok && !hasError(diagnostics) && (externalValidation?.ok ?? true),
    outputPath,
    emittedFiles: uniqueSorted(built.emittedFiles),
    diagnostics,
    localValidation,
    externalValidation,
    metadata: {
      generated: true,
      sourceOwned: false,
      defaultOutput: options.outputPath === undefined,
      ownership: "ephemeral-generated-artifact",
    },
  };
}

function resolveConfig(
  projectRoot: string,
  options: GenerateClaudeCodePluginOptions,
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
): ZeroxCraftConfig {
  if (options.config) {
    return mergeConfig(options.config);
  }

  const { config, diagnostics: loaderDiagnostics } = loadConfig({
    harness: "claude-code",
    projectRoot,
    homeDir: options.homeDir,
  });
  for (const diag of loaderDiagnostics) {
    if (diag.severity === "error" || diag.severity === "warn") {
      diagnostics.push({
        severity: diag.severity === "error" ? "error" : "warning",
        code: diag.code,
        message: diag.message,
      });
    }
  }
  // Strict Zod inside loadConfig already validated the shape; no
  // separate validateConfig pass needed (T-12.8).
  return config;
}

function selectSkills(skills: SkillDefinition[], config: ZeroxCraftConfig): SkillDefinition[] {
  if (config.enabled.skills.length === 0) {
    return skills;
  }
  const enabled = new Set(config.enabled.skills);
  return skills.filter((skill) => enabled.has(skill.id));
}

function readPackageMetadata(packageRoot: string, diagnostics: ClaudeCodeGeneratorDiagnostic[]): GenerateClaudeCodeManifestOptions["packageMetadata"] {
  const fallback = { name: "0xcraft" };
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    diagnostics.push({
      severity: "warning",
      code: "claude-code.package_json.missing",
      message: "package.json was not found; using fallback Claude Code plugin metadata.",
      details: { packageRoot },
    });
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
    return {
      name: stringValue(parsed.name) ?? fallback.name,
      displayName: stringValue(parsed.displayName),
      version: stringValue(parsed.version),
      description: stringValue(parsed.description),
      author: typeof parsed.author === "string" ? parsed.author : undefined,
      homepage: stringValue(parsed.homepage),
      repository: readRepository(parsed.repository),
      license: stringValue(parsed.license),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((value): value is string => typeof value === "string") : undefined,
    };
  } catch {
    diagnostics.push({
      severity: "warning",
      code: "claude-code.package_json.invalid",
      message: "package.json could not be parsed; using fallback Claude Code plugin metadata.",
      details: { packageRoot },
    });
    return fallback;
  }
}

function readRepository(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function generateManifestWithWriter(options: ManifestGeneratorOptions): GenerateClaudeCodeManifestResult {
  return generateClaudeCodeManifest(options);
}

function validateGeneratedPlugin(outputPath: string, emittedFiles: string[]): ClaudeCodeLocalValidationResult {
  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [];
  validateJsonFile(outputPath, ".claude-plugin/plugin.json", claudeCodeManifestSchema, diagnostics, true);
  validateJsonFile(outputPath, ".mcp.json", claudeCodeMcpJsonSchema, diagnostics, false);
  validateJsonFile(outputPath, "hooks/hooks.json", claudeCodeHooksJsonSchema, diagnostics, false);
  validateJsonFile(outputPath, "settings.json", claudeCodeSettingsJsonSchema, diagnostics, false);

  for (const file of emittedFiles) {
    if (file.startsWith("agents/") && file.endsWith(".md")) {
      validateMarkdownFrontmatter(outputPath, file, claudeCodeAgentFrontmatterSchema, diagnostics);
    }
    if (file.startsWith("skills/") && file.endsWith("/SKILL.md")) {
      validateMarkdownFrontmatter(outputPath, file, claudeCodeSkillFrontmatterSchema, diagnostics);
    }
  }

  return { ok: !hasError(diagnostics), diagnostics };
}

function validateJsonFile(
  outputPath: string,
  relativeFile: string,
  schema: { parse(value: unknown): unknown },
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
  required: boolean,
): void {
  const filePath = path.join(outputPath, relativeFile);
  if (!fs.existsSync(filePath)) {
    if (required) {
      diagnostics.push({
        severity: "error",
        code: "claude-code.local_validation.missing_file",
        message: `Generated Claude Code plugin is missing required file ${relativeFile}.`,
        details: { file: relativeFile },
      });
    }
    return;
  }

  try {
    schema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    diagnostics.push({
      severity: "error",
      code: "claude-code.local_validation.invalid_json_artifact",
      message: `Generated Claude Code artifact ${relativeFile} failed local schema validation.`,
      details: { file: relativeFile },
    });
  }
}

function validateMarkdownFrontmatter(
  outputPath: string,
  relativeFile: string,
  schema: { parse(value: unknown): unknown },
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
): void {
  try {
    schema.parse(parseFrontmatter(fs.readFileSync(path.join(outputPath, relativeFile), "utf8")).meta);
  } catch {
    diagnostics.push({
      severity: "error",
      code: "claude-code.local_validation.invalid_markdown_frontmatter",
      message: `Generated Claude Code markdown artifact ${relativeFile} failed frontmatter validation.`,
      details: { file: relativeFile },
    });
  }
}

function fromValidationDiagnostic(diagnostic: ClaudeValidationDiagnostic): ClaudeCodeGeneratorDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  };
}

function collectResult(
  result: { emittedFiles: string[]; diagnostics?: unknown[] },
  emittedFiles: string[],
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
): void {
  emittedFiles.push(...result.emittedFiles);
  diagnostics.push(...(result.diagnostics ?? []).map(normalizeDiagnostic));
}

/**
 * Drain a `DiagnosticCollector` into the legacy
 * `ClaudeCodeGeneratorDiagnostic[]` shape. Severity mapping:
 *   - `error`  → `error`
 *   - `warn`   → `warning`
 *   - `info`   → `warning` (legacy shape has no info bucket; downgrade
 *     would lose visibility, so we surface info-level matrix breadcrumbs
 *     such as `hook.experimental` as warnings here. `build.ts` consumes
 *     the legacy array then re-promotes back into a fresh collector, so
 *     downstream `Diagnostic.severity` remains a best-effort approximation.
 *     Future work: introduce `info` into the legacy union.)
 */
function drainCollectorIntoLegacy(
  collector: DiagnosticCollector,
  legacy: ClaudeCodeGeneratorDiagnostic[],
): void {
  for (const d of collector.sorted()) {
    legacy.push({
      severity: d.severity === "error" ? "error" : "warning",
      code: d.code,
      message: d.message,
      ...(d.details ? { details: d.details } : {}),
    });
  }
}

function normalizeDiagnostic(diagnostic: unknown): ClaudeCodeGeneratorDiagnostic {
  if (diagnostic && typeof diagnostic === "object") {
    const record = diagnostic as Record<string, unknown>;
    return {
      severity: record.severity === "error" ? "error" : "warning",
      code: typeof record.code === "string" ? record.code : "claude-code.diagnostic",
      message: typeof record.message === "string" ? record.message : "Claude Code generator diagnostic.",
      details: sanitizeDetails(record),
    };
  }

  return {
    severity: "warning",
    code: "claude-code.diagnostic",
    message: "Claude Code generator diagnostic.",
  };
}

function sanitizeDetails(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (["severity", "code", "message"].includes(key)) continue;
    if (/token|secret|password|authorization|header|env/iu.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      details[key] = value;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function emptyResult(): { emittedFiles: string[]; diagnostics: [] } {
  return { emittedFiles: [], diagnostics: [] };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function hasError(diagnostics: Array<{ severity: string }>): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/* ------------------------------------------------------------------ */
/*  Batch 4 — canonical build() entry (ADR §6)                         */
/*                                                                     */
/*  Re-export `build` from `./build` so consumers can call the         */
/*  canonical adapter entry. `generateClaudeCodePlugin` above is the   */
/*  on-disk wrapper that composes `buildClaudeCodeFiles` (single       */
/*  source of orchestration) and persists the captured files.         */
/* ------------------------------------------------------------------ */
export { build, type ClaudeCodeArtifact } from "./build";

/* ------------------------------------------------------------------ */
/*  T-12.9 — in-memory builder                                          */
/*                                                                     */
/*  `buildClaudeCodeFiles` runs the same generator orchestration as    */
/*  `generateClaudeCodePlugin` but against an in-memory writer.        */
/*  Returns the captured files + diagnostics WITHOUT any disk          */
/*  round-trip. `build.ts` consumes this to assemble `PlatformArtifact` */
/*  purely in memory. Determinism: same input → byte-identical `files`. */
/* ------------------------------------------------------------------ */

export interface BuildClaudeCodeFilesOptions {
  packageRoot?: string;
  projectRoot?: string;
  force?: boolean;
  config?: PartialZeroxCraftConfig;
  settings?: Record<string, unknown>;
  selectedAssets?: ClaudeCodeSelectedAssets;
  homeDir?: string;
  builtInAgents?: AgentSpec[];
  customAgents?: AgentSpec[];
  builtInSkills?: SkillDefinition[];
  customSkills?: SkillDefinition[];
  builtInHooks?: HookSpec[];
  builtInMcpServers?: McpServerSpec[];
  dependencies?: ClaudeCodePluginGeneratorDependencies;
}

export interface BuildClaudeCodeFilesResult {
  ok: boolean;
  files: InMemoryFile[];
  emittedFiles: string[];
  diagnostics: ClaudeCodeGeneratorDiagnostic[];
  localValidation: ClaudeCodeLocalValidationResult;
}

export async function buildClaudeCodeFiles(
  options: BuildClaudeCodeFilesOptions = {},
): Promise<BuildClaudeCodeFilesResult> {
  const packageRoot = options.packageRoot
    ? path.resolve(options.packageRoot)
    : sharedResolvePackageRoot({ startDir: path.dirname(fileURLToPath(import.meta.url)) });
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const selectedAssets = { ...DEFAULT_SELECTED_ASSETS, ...(options.selectedAssets ?? {}) };
  const dependencies = options.dependencies ?? {};
  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [];
  const emittedFiles: string[] = [];
  const config = resolveConfig(projectRoot, options, diagnostics);
  const writer = createInMemoryClaudeCodeWriter();

  const agentsResult = selectedAssets.agents
    ? (dependencies.generateAgents ?? generateClaudeCodeAgents)({
      packageRoot,
      writer,
      builtInAgents: options.builtInAgents ?? builtinAgents,
      customAgents: options.customAgents,
      config,
    })
    : emptyResult();
  collectResult(agentsResult, emittedFiles, diagnostics);

  const skillsResult = selectedAssets.skills
    ? (dependencies.generateSkills ?? generateClaudeCodeSkills)({
      skills: selectSkills([...(options.builtInSkills ?? builtinSkills), ...(options.customSkills ?? [])], config),
      disabledSkillIds: config.disabled.skills,
      packageRoot,
      writer,
    })
    : { emittedFiles: [], diagnostics: [], skills: [], mcpServers: [] } satisfies ClaudeCodeSkillsGeneratorResult;
  collectResult(skillsResult, emittedFiles, diagnostics);

  const hooksResult = selectedAssets.hooks
    ? (() => {
        const collector = new DiagnosticCollector();
        emitClaudeCodeHookMatrixSweep(collector);
        const inputHooks = options.builtInHooks ?? builtinHooks;
        const routed = routeClaudeCodeHooks({
          hooks: inputHooks,
          collector,
          disabledHooks: config.disabled.hooks,
        });
        drainCollectorIntoLegacy(collector, diagnostics);
        return (dependencies.generateHooks ?? generateClaudeCodeHooks)({
          writer,
          hooks: routed.emittableHooks as HookSpec[],
          disabledHooks: config.disabled.hooks,
          projectRoot,
          runtime: config.platforms["claude-code"]?.hookRuntime,
          config,
        });
      })()
    : { emittedFiles: [], diagnostics: [], scriptFiles: [] } satisfies GenerateClaudeCodeHooksResult;
  collectResult(hooksResult, emittedFiles, diagnostics);

  for (const scriptFile of hooksResult.scriptFiles ?? []) {
    try {
      const emitted = writer.writeFile(scriptFile.path, scriptFile.content, scriptFile.mode);
      emittedFiles.push(...emitted);
    } catch (err) {
      diagnostics.push({
        severity: "error",
        code: "claude-code.hook_script.write_failed",
        message: `Failed to write hook shim ${scriptFile.path}: ${(err as Error).message}`,
        details: { path: scriptFile.path },
      });
    }
  }

  const mcpResult = selectedAssets.mcpServers
    ? (dependencies.generateMcp ?? generateClaudeCodeMcp)({
      writer,
      builtinServers: (options.builtInMcpServers ?? builtinMcpServers).map((s) => ({
        name: s.id,
        type: s.transport === "stdio" ? "local" : "remote",
        ...(s.transport === "stdio" ? { command: s.command } : { url: s.url, headers: s.headers }),
        ...(s.env ? { env: s.env } : {}),
        enabledByDefault: s.enabledByDefault,
      })),
      userServers: Object.fromEntries(
        Object.entries(config.mcpServers).map(([name, spec]) => {
          const base = spec.transport === "stdio"
            ? { type: "local" as const, command: [...spec.command] }
            : { type: "remote" as const, url: spec.url, ...(spec.headers ? { headers: { ...spec.headers } } : {}) };
          return [name, { ...base, ...(spec.env ? { env: { ...spec.env } } : {}) }];
        }),
      ),
      skillServers: [],
    })
    : emptyResult();
  collectResult(mcpResult, emittedFiles, diagnostics);

  const settingsResult = selectedAssets.settings
    ? (dependencies.generateSettings ?? generateClaudeCodeSettings)({ writer, settings: options.settings })
    : { emittedFiles: [] } satisfies GenerateClaudeCodeSettingsResult;
  collectResult(settingsResult, emittedFiles, diagnostics);

  const manifestResult = (dependencies.generateManifest ?? generateManifestWithWriter)({
    // outputRoot is unused by the manifest generator (it delegates to
    // the writer), but the type requires a string. Pass virtual placeholder.
    outputRoot: "<in-memory>",
    force: options.force,
    writer,
    packageMetadata: readPackageMetadata(packageRoot, diagnostics),
    emittedComponents: {
      agents: agentsResult.emittedFiles.length > 0,
      skills: skillsResult.emittedFiles.length > 0,
      hooks: hooksResult.emittedFiles.length > 0,
      mcpServers: mcpResult.emittedFiles.length > 0,
    },
  });
  collectResult(manifestResult, emittedFiles, diagnostics);

  const uniqueEmitted = uniqueSorted(emittedFiles);
  const localValidation = validateGeneratedPluginInMemory(writer.snapshot(), uniqueEmitted);
  diagnostics.push(...localValidation.diagnostics);

  return {
    ok: localValidation.ok && !hasError(diagnostics),
    files: writer.snapshot(),
    emittedFiles: uniqueEmitted,
    diagnostics,
    localValidation,
  };
}

/* ------------------------------------------------------------------ */
/*  In-memory local validation                                          */
/* ------------------------------------------------------------------ */

function validateGeneratedPluginInMemory(
  files: InMemoryFile[],
  emittedFiles: string[],
): ClaudeCodeLocalValidationResult {
  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  validateJsonInMemory(byPath, ".claude-plugin/plugin.json", claudeCodeManifestSchema, diagnostics, true);
  validateJsonInMemory(byPath, ".mcp.json", claudeCodeMcpJsonSchema, diagnostics, false);
  validateJsonInMemory(byPath, "hooks/hooks.json", claudeCodeHooksJsonSchema, diagnostics, false);
  validateJsonInMemory(byPath, "settings.json", claudeCodeSettingsJsonSchema, diagnostics, false);

  for (const file of emittedFiles) {
    if (file.startsWith("agents/") && file.endsWith(".md")) {
      validateMarkdownFrontmatterInMemory(byPath, file, claudeCodeAgentFrontmatterSchema, diagnostics);
    }
    if (file.startsWith("skills/") && file.endsWith("/SKILL.md")) {
      validateMarkdownFrontmatterInMemory(byPath, file, claudeCodeSkillFrontmatterSchema, diagnostics);
    }
  }

  return { ok: !hasError(diagnostics), diagnostics };
}

function validateJsonInMemory(
  byPath: Map<string, string>,
  relativeFile: string,
  schema: { parse(value: unknown): unknown },
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
  required: boolean,
): void {
  const content = byPath.get(relativeFile);
  if (content === undefined) {
    if (required) {
      diagnostics.push({
        severity: "error",
        code: "claude-code.local_validation.missing_file",
        message: `Generated Claude Code plugin is missing required file ${relativeFile}.`,
        details: { file: relativeFile },
      });
    }
    return;
  }
  try {
    schema.parse(JSON.parse(content));
  } catch {
    diagnostics.push({
      severity: "error",
      code: "claude-code.local_validation.invalid_json_artifact",
      message: `Generated Claude Code artifact ${relativeFile} failed local schema validation.`,
      details: { file: relativeFile },
    });
  }
}

function validateMarkdownFrontmatterInMemory(
  byPath: Map<string, string>,
  relativeFile: string,
  schema: { parse(value: unknown): unknown },
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
): void {
  const content = byPath.get(relativeFile);
  if (content === undefined) return;
  try {
    schema.parse(parseFrontmatter(content).meta);
  } catch {
    diagnostics.push({
      severity: "error",
      code: "claude-code.local_validation.invalid_markdown_frontmatter",
      message: `Generated Claude Code markdown artifact ${relativeFile} failed frontmatter validation.`,
      details: { file: relativeFile },
    });
  }
}
