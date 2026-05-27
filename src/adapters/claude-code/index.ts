import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { builtinAgents, type AgentDefinition } from "../../core/agents";
import { loadConfig, mergeConfig, validateConfig, type ZeroxCraftConfig } from "../../core/config";
import { builtinHooks, type HookDefinition } from "../../core/hooks";
import { builtinMcpServers, type McpRegistryEntry } from "../../core/mcp";
import { builtinSkills, type SkillDefinition } from "../../core/skills";
import { createClaudeCodeFilesystemWriter, type ClaudeCodeFilesystemWriter } from "./filesystem";
import {
  generateClaudeCodeAgents,
  type GenerateClaudeCodeAgentsOptions,
  type GenerateClaudeCodeAgentsResult,
} from "./generators/agents";
import {
  generateClaudeCodeHooks,
  type GenerateClaudeCodeHooksOptions,
  type GenerateClaudeCodeHooksResult,
} from "./generators/hooks";
import {
  generateClaudeCodeManifest,
  type GenerateClaudeCodeManifestOptions,
  type GenerateClaudeCodeManifestResult,
} from "./generators/manifest";
import {
  generateClaudeCodeMcp,
  type ClaudeCodeMcpGeneratorOptions,
  type ClaudeCodeMcpGeneratorResult,
} from "./generators/mcp";
import {
  generateClaudeCodeSettings,
  type GenerateClaudeCodeSettingsOptions,
  type GenerateClaudeCodeSettingsResult,
} from "./generators/settings";
import {
  generateClaudeCodeSkills,
  type ClaudeCodeSkillsGeneratorOptions,
  type ClaudeCodeSkillsGeneratorResult,
} from "./generators/skills";
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
  type ClaudeCodeValidationInfo,
  type ClaudePluginValidateResult,
  type ClaudeProcessRunner,
  type ClaudeValidationDiagnostic,
} from "./validate";

export type ClaudeCodeGeneratorDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeGeneratorDiagnostic {
  severity: ClaudeCodeGeneratorDiagnosticSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClaudeCodeCapabilityTarget {
  version?: string;
  capabilities?: {
    pluginDir?: "supported" | "unsupported" | "unknown";
    reloadPlugins?: "supported" | "unsupported" | "unknown";
    pluginValidate?: "supported" | "unsupported" | "unknown";
  };
  supportsDisplayName?: boolean;
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
  compatibilityWarnings: ClaudeCodeGeneratorDiagnostic[];
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
  config?: Partial<ZeroxCraftConfig>;
  settings?: Record<string, unknown>;
  selectedAssets?: ClaudeCodeSelectedAssets;
  compatibility?: ClaudeCodeCapabilityTarget;
  validateExternal?: boolean;
  strictExternalValidation?: boolean;
  externalValidationRunner?: ClaudeProcessRunner;
  homeDir?: string;
  builtInAgents?: AgentDefinition[];
  customAgents?: AgentDefinition[];
  builtInSkills?: SkillDefinition[];
  customSkills?: SkillDefinition[];
  builtInHooks?: HookDefinition[];
  builtInMcpServers?: McpRegistryEntry[];
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
  const packageRoot = resolvePackageRoot(options.packageRoot);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const outputPath = path.resolve(options.outputPath ?? path.join(packageRoot, "dist", "claude-code-plugin", "0xcraft"));
  const selectedAssets = { ...DEFAULT_SELECTED_ASSETS, ...(options.selectedAssets ?? {}) };
  const dependencies = options.dependencies ?? {};
  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [];
  const emittedFiles: string[] = [];
  const config = resolveConfig(projectRoot, options, diagnostics);
  const compatibilityWarnings = getCompatibilityWarnings(options.compatibility);
  diagnostics.push(...compatibilityWarnings);
  const writer = createClaudeCodeFilesystemWriter({ outputRoot: outputPath, force: options.force });

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
      disabledSkillIds: config.disabledSkills,
      packageRoot,
      writer,
    })
    : { emittedFiles: [], diagnostics: [], skills: [], mcpServers: [] } satisfies ClaudeCodeSkillsGeneratorResult;
  collectResult(skillsResult, emittedFiles, diagnostics);

  const hooksResult = selectedAssets.hooks
    ? (dependencies.generateHooks ?? generateClaudeCodeHooks)({
      writer,
      hooks: options.builtInHooks ?? builtinHooks,
      disabledHooks: config.disabledHooks,
    })
    : emptyResult();
  collectResult(hooksResult, emittedFiles, diagnostics);

  const mcpResult = selectedAssets.mcpServers
    ? (dependencies.generateMcp ?? generateClaudeCodeMcp)({
      writer,
      builtinServers: options.builtInMcpServers ?? builtinMcpServers,
      userServers: config.mcpServers,
      skillServers: [],
    })
    : emptyResult();
  collectResult(mcpResult, emittedFiles, diagnostics);

  const settingsResult = selectedAssets.settings
    ? (dependencies.generateSettings ?? generateClaudeCodeSettings)({ writer, settings: options.settings })
    : { emittedFiles: [] } satisfies GenerateClaudeCodeSettingsResult;
  collectResult(settingsResult, emittedFiles, diagnostics);

  const manifestResult = (dependencies.generateManifest ?? generateManifestWithWriter)({
    outputRoot: outputPath,
    force: options.force,
    writer,
    packageMetadata: readPackageMetadata(packageRoot, diagnostics),
    emittedComponents: {
      agents: agentsResult.emittedFiles.length > 0,
      skills: skillsResult.emittedFiles.length > 0,
      hooks: hooksResult.emittedFiles.length > 0,
      mcpServers: mcpResult.emittedFiles.length > 0,
    },
    compatibility: {
      claudeCodeVersion: options.compatibility?.version,
      supportsDisplayName: options.compatibility?.supportsDisplayName,
    },
  });
  collectResult(manifestResult, emittedFiles, diagnostics);

  const localValidation = validateGeneratedPlugin(outputPath, uniqueSorted(emittedFiles));
  diagnostics.push(...localValidation.diagnostics);

  let externalValidation: ClaudePluginValidateResult | undefined;
  if (options.validateExternal === true) {
    externalValidation = await runClaudePluginValidate({
      pluginDir: outputPath,
      strict: options.strictExternalValidation,
      failOnMissingClaude: true,
      failOnUnsupportedCapability: options.strictExternalValidation,
      claudeCode: toValidationInfo(options.compatibility),
      runner: options.externalValidationRunner,
    });
    diagnostics.push(...externalValidation.diagnostics.map(fromValidationDiagnostic));
  }

  return {
    ok: localValidation.ok && !hasError(diagnostics) && (externalValidation?.ok ?? true),
    outputPath,
    emittedFiles: uniqueSorted(emittedFiles),
    diagnostics,
    compatibilityWarnings,
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

function resolvePackageRoot(explicitPackageRoot: string | undefined): string {
  if (explicitPackageRoot) {
    return path.resolve(explicitPackageRoot);
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (hasPackageAssets(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return process.cwd();
}

function hasPackageAssets(root: string): boolean {
  return fs.existsSync(path.join(root, "agents")) && fs.existsSync(path.join(root, "skills"));
}

function resolveConfig(
  projectRoot: string,
  options: GenerateClaudeCodePluginOptions,
  diagnostics: ClaudeCodeGeneratorDiagnostic[],
): Required<ZeroxCraftConfig> {
  if (options.config) {
    return mergeConfig(options.config);
  }

  const { config: rawConfig } = loadConfig(projectRoot, options.homeDir);
  const validation = validateConfig(rawConfig);
  if (!validation.valid) {
    diagnostics.push(...validation.errors.map((error) => ({
      severity: "warning" as const,
      code: "claude-code.config.invalid",
      message: error,
    })));
  }
  return mergeConfig(validation.config as Partial<ZeroxCraftConfig>);
}

function selectSkills(skills: SkillDefinition[], config: Required<ZeroxCraftConfig>): SkillDefinition[] {
  if (config.enabledSkills.length === 0) {
    return skills;
  }
  const enabled = new Set(config.enabledSkills);
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
    schema.parse(parseFrontmatter(fs.readFileSync(path.join(outputPath, relativeFile), "utf8")));
  } catch {
    diagnostics.push({
      severity: "error",
      code: "claude-code.local_validation.invalid_markdown_frontmatter",
      message: `Generated Claude Code markdown artifact ${relativeFile} failed frontmatter validation.`,
      details: { file: relativeFile },
    });
  }
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
  if (!markdown.startsWith("---\n")) {
    throw new Error("Missing frontmatter");
  }
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("Unterminated frontmatter");
  }

  const result: Record<string, unknown> = {};
  const lines = markdown.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const keyValue = line.match(/^([^:]+):(?:\s*(.*))?$/u);
    if (!keyValue) continue;
    const key = keyValue[1]?.trim();
    const rawValue = keyValue[2] ?? "";
    if (!key) continue;
    if (rawValue === "") {
      const values: string[] = [];
      while (lines[index + 1]?.startsWith("  - ")) {
        index++;
        values.push(parseScalar(lines[index]?.slice(4) ?? "") as string);
      }
      result[key] = values;
      continue;
    }
    result[key] = parseScalar(rawValue);
  }
  return result;
}

function parseScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  return trimmed;
}

function getCompatibilityWarnings(compatibility: ClaudeCodeCapabilityTarget | undefined): ClaudeCodeGeneratorDiagnostic[] {
  const diagnostics: ClaudeCodeGeneratorDiagnostic[] = [];
  for (const capability of ["pluginDir", "reloadPlugins"] as const) {
    const status = compatibility?.capabilities?.[capability];
    if (status === "unsupported" || status === "unknown") {
      diagnostics.push({
        severity: "warning",
        code: `claude.compat.${toSnakeCase(capability)}_${status}`,
        message: `Claude Code capability ${capability} is ${status}.`,
        details: { version: compatibility?.version },
      });
    }
  }

  if (compatibility?.supportsDisplayName !== true && !isVersionAtLeast(compatibility?.version, [2, 1, 143])) {
    diagnostics.push({
      severity: "warning",
      code: "claude.compat.display_name_unsupported",
      message: "Claude Code displayName support is unavailable or unknown; generated manifest omits displayName.",
      details: { version: compatibility?.version },
    });
  }
  return diagnostics;
}

function toValidationInfo(compatibility: ClaudeCodeCapabilityTarget | undefined): ClaudeCodeValidationInfo | undefined {
  if (!compatibility) return undefined;
  return {
    version: compatibility.version,
    capabilities: {
      pluginValidate: compatibility.capabilities?.pluginValidate,
    },
  };
}

function fromValidationDiagnostic(diagnostic: ClaudeValidationDiagnostic): ClaudeCodeGeneratorDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    details: diagnostic.version ? { version: diagnostic.version } : undefined,
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

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function isVersionAtLeast(version: string | undefined, minimum: readonly [number, number, number]): boolean {
  const match = version?.match(/^(?:v)?(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return false;
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parsed[0] !== minimum[0]) return parsed[0] > minimum[0];
  if (parsed[1] !== minimum[1]) return parsed[1] > minimum[1];
  return parsed[2] >= minimum[2];
}
