import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { z, type ZodError, type ZodType } from "zod";

import type { Diagnostic } from "../diagnostics";
import type { DiagnosticCode } from "../diagnostics/codes";
import {
  AgentRole,
  ClaudeAgentMeta,
  CodexAgentMeta,
  OpenCodeAgentMeta,
} from "../ir/agent";
import { ClaudeCommandMeta, CodexCommandMeta, OpenCodeCommandMeta } from "../ir/command";
import { ClaudeHookMeta, CodexHookMeta, HookRuntime, OpenCodeHookMeta } from "../ir/hook";
import { ClaudeMcpMeta, CodexMcpMeta, McpTransport, OpenCodeMcpMeta } from "../ir/mcp";
import { PermissionIR } from "../ir/permission";
import { REFERENCE_FILENAME_RE } from "../ir/references";
import { ClaudeSkillMeta, CodexSkillMeta, OpenCodeSkillMeta } from "../ir/skill";
import { resolveIncludes } from "./include-resolver";
import { parseToml } from "./toml-parser";
import { parseYamlFrontmatter } from "./yaml-parser";

export type PlatformId = "opencode" | "claude" | "codex";
export type RawResourcePlatform = "common" | PlatformId;
export type ResourceKind = "agent" | "skill" | "hook" | "mcp" | "command";

export interface RawReferenceFile {
  filename: string;
  content: string;
  filePath: string;
}

export interface RawResourceFile {
  id: string;
  kind: ResourceKind;
  file: string;
  platform: RawResourcePlatform;
  frontmatter: Record<string, unknown>;
  body: string;
  references?: RawReferenceFile[];
  diagnostics?: Diagnostic[];
}

type CodedLoaderError = Error & {
  code: DiagnosticCode;
  details: Record<string, unknown>;
};

interface ResourceDefinition {
  kind: ResourceKind;
  directory: string;
  commonFile: string;
  commonSchema: ZodType<Record<string, unknown>>;
  platformSchemas: Record<PlatformId, ZodType<Record<string, unknown>>>;
}

const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

const includeSchema = z.array(z.string()).optional();
const schemaVersion = z.string().optional();

const AgentCommonFrontmatter = z.object({
  schema: schemaVersion,
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  role: AgentRole.optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTurns: z.number().int().optional(),
  memory: z.record(z.string(), z.unknown()).optional(),
  permissions: PermissionIR.optional(),
  mcpServers: z.array(z.string()).optional(),
  include: includeSchema,
}).strict();

const SkillCommonFrontmatter = z.object({
  schema: schemaVersion,
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  autoload: z.boolean().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  "disallowed-tools": z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  include: includeSchema,
}).strict();

const HookCommonFrontmatter = z.object({
  schema: schemaVersion,
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  events: z.array(z.string()),
  runtime: HookRuntime.optional(),
  actions: z.array(z.unknown()),
  modifiers: z.array(z.unknown()).optional(),
  timeoutMs: z.number().int().optional(),
  include: includeSchema,
}).strict();

const McpCommonFrontmatter = z.object({
  schema: schemaVersion,
  name: z.string(),
  description: z.string().optional(),
  transport: McpTransport,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  wrapper: z.enum(["direct", "wrapped"]).optional(),
  include: includeSchema,
}).strict();

const CommandCommonFrontmatter = z.object({
  schema: schemaVersion,
  name: z.string(),
  description: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.array(z.object({
    name: z.string(),
    description: z.string(),
    required: z.boolean(),
  }).strict()).optional(),
  include: includeSchema,
}).strict();

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    kind: "agent",
    directory: "agents",
    commonFile: "AGENT.md",
    commonSchema: AgentCommonFrontmatter,
    platformSchemas: { opencode: OpenCodeAgentMeta, claude: ClaudeAgentMeta, codex: CodexAgentMeta },
  },
  {
    kind: "skill",
    directory: "skills",
    commonFile: "SKILL.md",
    commonSchema: SkillCommonFrontmatter,
    platformSchemas: { opencode: OpenCodeSkillMeta, claude: ClaudeSkillMeta, codex: CodexSkillMeta },
  },
  {
    kind: "hook",
    directory: "hooks",
    commonFile: "HOOK.md",
    commonSchema: HookCommonFrontmatter,
    platformSchemas: { opencode: OpenCodeHookMeta, claude: ClaudeHookMeta, codex: CodexHookMeta },
  },
  {
    kind: "mcp",
    directory: "mcp",
    commonFile: "MCP.md",
    commonSchema: McpCommonFrontmatter,
    platformSchemas: { opencode: OpenCodeMcpMeta, claude: ClaudeMcpMeta, codex: CodexMcpMeta },
  },
  {
    kind: "command",
    directory: "commands",
    commonFile: "COMMAND.md",
    commonSchema: CommandCommonFrontmatter,
    platformSchemas: { opencode: OpenCodeCommandMeta, claude: ClaudeCommandMeta, codex: CodexCommandMeta },
  },
];

export function loadSourceTree(sourceRoot: string, platforms: PlatformId[]): RawResourceFile[] {
  const absoluteRoot = resolve(sourceRoot);
  const resources: RawResourceFile[] = [];

  for (const definition of RESOURCE_DEFINITIONS) {
    const kindRoot = join(absoluteRoot, definition.directory);
    if (!existsSync(kindRoot)) {
      continue;
    }

    for (const entry of sortedDirectoryEntries(kindRoot)) {
      const resourceDirectory = join(kindRoot, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }

      validateResourceId(entry.name, resourceDirectory);
      rejectActiveCodexMarkdownAgent(definition, resourceDirectory);

      const common = loadCommonFile(definition, entry.name, resourceDirectory, platforms);
      if (common !== undefined) {
        resources.push(common);
      }

      for (const platform of platforms) {
        const sibling = loadPlatformSibling(definition, entry.name, resourceDirectory, platform);
        if (sibling !== undefined) {
          resources.push(sibling);
        }
      }
    }
  }

  return resources;
}

/**
 * Load raw resource files for a single pack resource directory.
 * Used by the build pipeline to integrate pack resources with a pre-known namespaced id.
 * Bypasses directory-name ID validation (pack IDs are validated by the pack resolver).
 */
export function loadResourceDirectoryRaw(
  id: string,
  directory: string,
  kind: ResourceKind,
  platforms: PlatformId[],
): RawResourceFile[] {
  const definition = RESOURCE_DEFINITIONS.find((d) => d.kind === kind);
  if (definition === undefined) {
    return [];
  }

  const files: RawResourceFile[] = [];
  const common = loadCommonFile(definition, id, directory, platforms);
  if (common !== undefined) {
    files.push(common);
  }

  for (const platform of platforms) {
    const sibling = loadPlatformSibling(definition, id, directory, platform);
    if (sibling !== undefined) {
      files.push(sibling);
    }
  }

  return files;
}

function loadCommonFile(
  definition: ResourceDefinition,
  id: string,
  resourceDirectory: string,
  platforms: PlatformId[],
): RawResourceFile | undefined {
  const file = join(resourceDirectory, definition.commonFile);
  if (!existsSync(file)) {
    return undefined;
  }

  const parsed = parseYamlFrontmatter(readFileSync(file, "utf8"));
  validateFrontmatter(definition.commonSchema, parsed.frontmatter, "ERR_UNKNOWN_FRONTMATTER_KEY", file);
  resolveIncludes(file, parsed.frontmatter, new Set());

  const diagnostics = missingSiblingDiagnostics(definition, resourceDirectory, platforms);
  const resource: RawResourceFile = {
    id,
    kind: definition.kind,
    file,
    platform: "common",
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };

  if (diagnostics.length > 0) {
    resource.diagnostics = diagnostics;
  }

  if (definition.kind === "agent" || definition.kind === "skill") {
    const { files: refFiles, diagnostics: refDiags } = loadReferencesDir(resourceDirectory, id, definition.kind);
    if (refFiles.length > 0) {
      resource.references = refFiles;
    }
    if (refDiags.length > 0) {
      resource.diagnostics = [...(resource.diagnostics ?? []), ...refDiags];
    }
  }

  return resource;
}

function loadReferencesDir(
  resourceDirectory: string,
  resourceId: string,
  kind: "agent" | "skill",
): { files: RawReferenceFile[]; diagnostics: Diagnostic[] } {
  const referencesDir = join(resourceDirectory, "references");
  if (!existsSync(referencesDir)) {
    return { files: [], diagnostics: [] };
  }

  const files: RawReferenceFile[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const entry of readdirSync(referencesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = join(referencesDir, entry.name);
    if (!REFERENCE_FILENAME_RE.test(entry.name)) {
      diagnostics.push({
        severity: "warn",
        code: "WARN_REFERENCE_INVALID_FILENAME",
        message: `Invalid reference filename for ${kind}`,
        details: { file: filePath, filename: entry.name, resourceId, kind },
      });
      continue;
    }

    try {
      const content = readReferenceTextFile(filePath);
      files.push({ filename: entry.name, content, filePath });
    } catch {
      diagnostics.push({
        severity: "warn",
        code: "WARN_REFERENCE_BINARY_SKIPPED",
        message: `Skipped non-text reference file for ${kind}`,
        details: { file: filePath, filename: entry.name, resourceId, kind },
      });
    }
  }

  files.sort((left, right) => left.filename.localeCompare(right.filename));
  return { files, diagnostics };
}

function readReferenceTextFile(filePath: string): string {
  const content = readFileSync(filePath, "utf8");
  if (content.includes("\u0000") || content.includes("\uFFFD")) {
    throw new Error("Reference file is not valid UTF-8 text");
  }
  return content;
}

function loadPlatformSibling(
  definition: ResourceDefinition,
  id: string,
  resourceDirectory: string,
  platform: PlatformId,
): RawResourceFile | undefined {
  const file = join(resourceDirectory, siblingFileName(definition.kind, platform));
  if (!existsSync(file)) {
    return undefined;
  }

  if (platform === "codex") {
    const frontmatter = parseToml(readFileSync(file, "utf8"));
    validateFrontmatter(definition.platformSchemas.codex, frontmatter, "ERR_UNKNOWN_TOML_KEY", file, true);
    return { id, kind: definition.kind, file, platform, frontmatter, body: "" };
  }

  const parsed = parseYamlFrontmatter(readFileSync(file, "utf8"));
  if (parsed.body.trim() !== "") {
    throw codedError("ERR_PLATFORM_BODY_FORBIDDEN", "Metadata-only platform sibling contains body content", {
      file,
      field: "body",
      platform,
      kind: definition.kind,
      id,
    });
  }

  validateFrontmatter(definition.platformSchemas[platform], parsed.frontmatter, "ERR_UNKNOWN_FRONTMATTER_KEY", file, true);
  return { id, kind: definition.kind, file, platform, frontmatter: parsed.frontmatter, body: "" };
}

function missingSiblingDiagnostics(definition: ResourceDefinition, resourceDirectory: string, platforms: PlatformId[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const platform of platforms) {
    const sibling = join(resourceDirectory, siblingFileName(definition.kind, platform));
    if (!existsSync(sibling)) {
      diagnostics.push({
        severity: "info",
        code: "INFO_MISSING_PLATFORM_SIBLING",
        message: `Missing ${platform} platform sibling for ${definition.kind}`,
        details: { file: sibling, platform, kind: definition.kind },
      });
    }
  }

  return diagnostics;
}

function siblingFileName(kind: ResourceKind, platform: PlatformId): string {
  if (platform === "codex") {
    return `${kind}.codex.toml`;
  }

  return `${kind}.${platform}.md`;
}

function validateResourceId(id: string, file: string): void {
  if (!RESOURCE_ID_PATTERN.test(id)) {
    throw codedError("ERR_INVALID_RESOURCE_ID", "Resource directory name is not a valid 0xcraft ID", { file, id });
  }
}

function rejectActiveCodexMarkdownAgent(definition: ResourceDefinition, resourceDirectory: string): void {
  if (definition.kind !== "agent") {
    return;
  }

  const staleFile = join(resourceDirectory, "agent.codex.md");
  if (!existsSync(staleFile)) {
    return;
  }

  if (readFileSync(staleFile, "utf8").trim() !== "") {
    throw codedError("ERR_CODEX_MARKDOWN_AGENT_META", "Codex agent metadata must use agent.codex.toml", { file: staleFile });
  }
}

function validateFrontmatter(
  schema: ZodType<Record<string, unknown>>,
  value: Record<string, unknown>,
  code: "ERR_UNKNOWN_FRONTMATTER_KEY" | "ERR_UNKNOWN_TOML_KEY",
  file: string,
  allowMergeDirective = false,
): void {
  const result = schema.safeParse(allowMergeDirective ? stripMergeDirective(value) : value);
  if (result.success) {
    return;
  }

  const unknownKey = firstUnknownKey(result.error);
  if (unknownKey !== undefined) {
    throw codedError(code, code === "ERR_UNKNOWN_TOML_KEY" ? "Unknown TOML metadata key" : "Unknown YAML frontmatter key", {
      file,
      field: unknownKey,
    });
  }

  throw result.error;
}

function stripMergeDirective(value: Record<string, unknown>): Record<string, unknown> {
  const { merge, ...rest } = value;
  return rest;
}

function firstUnknownKey(error: ZodError): string | undefined {
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      return issue.keys[0];
    }
  }

  return undefined;
}

function sortedDirectoryEntries(directory: string): Dirent<string>[] {
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
}

function codedError(code: DiagnosticCode, message: string, details: Record<string, unknown>): CodedLoaderError {
  const error = new Error(message) as CodedLoaderError;
  error.code = code;
  error.details = details;
  return error;
}
