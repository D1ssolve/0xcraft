import { z, type ZodError, type ZodType } from "zod";

import type { ZeroxCraftConfig } from "../config/config-schema";
import type { DiagnosticCode } from "../diagnostics/codes";
import {
  AgentIR,
  type AgentIR as AgentIRType,
  CommandIR,
  type CommandIR as CommandIRType,
  HookIR,
  type HookIR as HookIRType,
  McpServerIR,
  type McpServerIR as McpServerIRType,
  SkillIR,
  type SkillIR as SkillIRType,
} from "../ir";
import type { PlatformId, RawResourceFile, ResourceKind } from "../loader/file-loader";
import { basenameOrigin, createSourceTracker, isPlainRecord } from "./source-tracker";

export type IRResource = AgentIRType | SkillIRType | HookIRType | McpServerIRType | CommandIRType;

type CodedMergeError = Error & {
  code: DiagnosticCode;
  details: Record<string, unknown>;
};

type MergeMode = "append" | "replace";
type MergeDirective = Record<string, MergeMode>;

const PLATFORM_IDS: PlatformId[] = ["opencode", "claude", "codex"];

const COMMON_KEYS: Record<ResourceKind, readonly string[]> = {
  agent: ["name", "description", "tags", "role", "model", "temperature", "maxTurns", "memory", "permissions", "mcpServers"],
  skill: ["name", "description", "tags", "autoload", "allowed-tools", "disallowed-tools", "mcpServers"],
  hook: ["name", "description", "enabled", "events", "runtime", "actions", "modifiers", "timeoutMs"],
  mcp: ["name", "description", "transport", "command", "args", "url", "env", "headers", "enabled", "wrapper"],
  command: ["name", "description", "agent", "model", "arguments"],
};

const PLATFORM_KEYS: Record<ResourceKind, Record<PlatformId, readonly string[]>> = {
  agent: {
    opencode: ["schema", "enabled", "role", "mode", "model", "color", "temperature", "tools", "permission", "mcpServers", "plugin", "experimental"],
    claude: ["name", "description", "model", "effort", "maxTurns", "tools", "disallowedTools", "skills", "memory", "background", "isolation", "permissionMode", "hooks", "mcpServers", "color", "initialPrompt", "plugin"],
    codex: ["name", "description", "developer_instructions", "nickname_candidates", "model", "model_reasoning_effort", "sandbox_mode", "mcp_servers", "skills", "approval_policy", "permissionProfiles", "permissions", "agents"],
  },
  skill: {
    opencode: ["schema", "enabled", "autoload", "allowed-tools", "disallowed-tools", "mcpServers", "tags", "experimental"],
    claude: ["name", "description", "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable", "allowed-tools", "disallowed-tools", "model", "effort", "context", "agent", "hooks", "paths", "shell"],
    codex: ["enabled", "autoload", "skills", "cwd", "env_vars", "bearer_token_env_var", "env_http_headers"],
  },
  hook: {
    opencode: ["schema", "enabled", "runtime", "events", "factory", "jsFile", "experimental"],
    claude: [],
    codex: [],
  },
  mcp: {
    opencode: [],
    claude: ["wrapper"],
    codex: ["wrapper", "cwd", "env_vars", "bearer_token_env_var", "env_http_headers"],
  },
  command: {
    opencode: [],
    claude: [],
    codex: [],
  },
};

const IR_SCHEMAS: Record<ResourceKind, ZodType<IRResource>> = {
  agent: AgentIR,
  skill: SkillIR,
  hook: HookIR,
  mcp: McpServerIR,
  command: CommandIR,
};

export function mergeResource(
  raw: RawResourceFile[],
  config: ZeroxCraftConfig,
  cliOverrides: Record<string, unknown>,
  kind: ResourceKind,
  id: string,
): IRResource {
  const files = raw.filter((file) => file.kind === kind && file.id === id);
  const commonFiles = files.filter((file) => file.platform === "common");
  const common = mergeCommonFiles(commonFiles, kind, id);
  const tracker = createSourceTracker();
  const sourceFiles = files.map((file) => file.file).sort((left, right) => left.localeCompare(right));
  const commonOrigin = common === undefined ? undefined : basenameOrigin(common.file);
  const commonMetadata = pickAllowed(common?.frontmatter ?? {}, COMMON_KEYS[kind]);

  if (commonOrigin !== undefined) {
    tracker.recordObject("common", commonMetadata, commonOrigin);
    recordSemanticSources(tracker, commonMetadata, commonOrigin);
  }

  const resource: Record<string, unknown> = {
    id,
    kind,
    sourcePath: common?.file ?? files[0]?.file ?? `${kind}s/${id}`,
    common: buildCommonIR(kind, commonMetadata, common?.body ?? ""),
    platform: {},
    provenance: { sourceFiles },
  };

  if (kind === "agent" || kind === "skill") {
    addReferences(resource, commonFiles);
  }

  if (kind === "mcp") {
    resource.mcpEnvelope = buildMcpEnvelope(commonMetadata);
  }

  const diagnostics = files.flatMap((file) => file.diagnostics ?? []);
  if (diagnostics.length > 0) {
    resource.diagnostics = diagnostics;
  }

  const platform = resource.platform as Record<string, Record<string, unknown>>;
  const configOverrides = configOverridesFor(config, kind, id);
  const cliPlatform = platformForOverrides(files, configOverrides, cliOverrides);

  for (const sibling of files.filter(isPlatformSibling)) {
    const platformId = sibling.platform;
    const origin = basenameOrigin(sibling.file);
    const { frontmatter, merge } = stripMergeDirective(sibling.frontmatter);
    const merged = mergePlatformFrontmatter(common?.frontmatter ?? {}, frontmatter, merge, kind, platformId);
    platform[platformId] = { ...(platform[platformId] ?? {}), ...merged };
    tracker.recordObject(`platform.${platformId}`, merged, origin);
    recordSemanticSources(tracker, merged, origin);
  }

  for (const [platformId, overrides] of configOverrides) {
    platform[platformId] = mergeObjects(platform[platformId] ?? {}, overrides);
    tracker.recordObject(`platform.${platformId}`, overrides, ".0xcraft/config.json");
    recordSemanticSources(tracker, overrides, ".0xcraft/config.json");
  }

  if (Object.keys(cliOverrides).length > 0) {
    platform[cliPlatform] = mergeObjects(platform[cliPlatform] ?? {}, cliOverrides);
    tracker.recordObject(`platform.${cliPlatform}`, cliOverrides, "<cli>");
    recordSemanticSources(tracker, cliOverrides, "<cli>");
  }

  resource._sources = tracker.sources();
  return parseIR(kind, resource);
}

export function mergeAllResources(
  rawFiles: RawResourceFile[],
  config: ZeroxCraftConfig,
  cliOverrides: Record<string, unknown>,
): IRResource[] {
  return [...groupKeys(rawFiles)]
    .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))
    .map(({ kind, id }) => mergeResource(rawFiles, config, cliOverrides, kind, id));
}

function mergeCommonFiles(files: RawResourceFile[], kind: ResourceKind, id: string): RawResourceFile | undefined {
  if (files.length <= 1) {
    return files[0];
  }

  const [first, ...rest] = files;
  if (first === undefined) {
    return undefined;
  }
  for (const next of rest) {
    for (const [key, value] of Object.entries(next.frontmatter)) {
      if (key in first.frontmatter && !deepEqual(first.frontmatter[key], value)) {
        // Spec wording allows normal documented overrides across precedence levels.
        // Defensive ambiguity is therefore scoped to impossible same-level collisions:
        // two common files for one (kind,id) with incompatible same-key metadata.
        throw codedError("ERR_AMBIGUOUS_FRONTMATTER_MERGE", "Ambiguous common frontmatter merge", {
          kind,
          id,
          field: key,
          files: [first.file, next.file],
        });
      }
    }
  }

  return files.reduce<RawResourceFile>((merged, next) => ({
    ...merged,
    frontmatter: { ...merged.frontmatter, ...next.frontmatter },
    body: next.body.length > 0 ? next.body : merged.body,
  }), first);
}

function isPlatformSibling(file: RawResourceFile): file is RawResourceFile & { platform: PlatformId } {
  return file.platform !== "common";
}

function buildCommonIR(kind: ResourceKind, metadata: Record<string, unknown>, body: string): Record<string, unknown> {
  const common = { ...metadata };
  if (kind === "agent") {
    common.prompt = body;
  }
  if (kind === "skill") {
    common.body = body;
  }
  if (kind === "command") {
    common.template = body;
  }
  if (kind === "hook" && common.modifiers === undefined) {
    common.modifiers = [];
  }
  return common;
}

function addReferences(resource: Record<string, unknown>, commonFiles: RawResourceFile[]): void {
  const referenceFiles = commonFiles.flatMap((file) => file.references ?? []);
  if (referenceFiles.length === 0) {
    return;
  }

  const references: Record<string, string> = {};
  for (const reference of referenceFiles) {
    references[reference.filename] = reference.content;
  }

  resource.references = Object.fromEntries(
    Object.keys(references)
      .sort((left, right) => left.localeCompare(right))
      .map((filename) => [filename, references[filename]]),
  );

  const provenance = resource.provenance as { sourceFiles: string[] };
  provenance.sourceFiles = [...new Set([...provenance.sourceFiles, ...referenceFiles.map((file) => file.filePath)])]
    .sort((left, right) => left.localeCompare(right));
}

function mergePlatformFrontmatter(
  common: Record<string, unknown>,
  sibling: Record<string, unknown>,
  mergeDirective: MergeDirective,
  kind: ResourceKind,
  platform: PlatformId,
): Record<string, unknown> {
  const allowed = PLATFORM_KEYS[kind][platform];
  const output: Record<string, unknown> = allowed.length === 0 ? {} : pickAllowed(sibling, allowed);

  for (const [key, mode] of Object.entries(mergeDirective)) {
    if (mode !== "append" || !Array.isArray(common[key]) || !Array.isArray(sibling[key])) {
      continue;
    }
    output[key] = [...common[key], ...sibling[key]];
  }

  return allowed.length === 0 ? { ...sibling } : output;
}

function stripMergeDirective(frontmatter: Record<string, unknown>): { frontmatter: Record<string, unknown>; merge: MergeDirective } {
  const { merge, ...rest } = frontmatter;
  return { frontmatter: rest, merge: parseMergeDirective(merge) };
}

function parseMergeDirective(value: unknown): MergeDirective {
  if (!isPlainRecord(value)) {
    return {};
  }

  const directive: MergeDirective = {};
  for (const [key, mode] of Object.entries(value)) {
    if (mode === "append" || mode === "replace") {
      directive[key] = mode;
    }
  }
  return directive;
}

function configOverridesFor(config: ZeroxCraftConfig, kind: ResourceKind, id: string): Array<[PlatformId, Record<string, unknown>]> {
  const overrides: Array<[PlatformId, Record<string, unknown>]> = [];
  const platforms = config.platforms as unknown as Record<PlatformId, Record<string, unknown>>;

  for (const platform of PLATFORM_IDS) {
    const platformConfig = platforms[platform];
    const value = platformConfig?.[configCollectionName(kind)];
    if (isPlainRecord(value) && isPlainRecord(value[id])) {
      overrides.push([platform, value[id]]);
    }

    if (kind === "mcp" && isPlainRecord(platformConfig?.mcpExtensions) && isPlainRecord(platformConfig.mcpExtensions[id])) {
      overrides.push([platform, platformConfig.mcpExtensions[id]]);
    }
  }

  return overrides;
}

function configCollectionName(kind: ResourceKind): string {
  if (kind === "mcp") {
    return "mcpServers";
  }
  return `${kind}s`;
}

function platformForOverrides(
  files: RawResourceFile[],
  configOverrides: Array<[PlatformId, Record<string, unknown>]>,
  cliOverrides: Record<string, unknown>,
): PlatformId {
  if (configOverrides.length > 0) {
    return configOverrides[configOverrides.length - 1]?.[0] ?? "codex";
  }

  const sibling = files.find((file) => file.platform !== "common");
  if (sibling?.platform !== undefined && sibling.platform !== "common") {
    return sibling.platform;
  }

  if (Object.keys(cliOverrides).length > 0) {
    return "codex";
  }

  return "codex";
}

function buildMcpEnvelope(common: Record<string, unknown>): Record<string, string> {
  const wrapper = common.wrapper === "direct" ? "direct" : "wrapped";
  return {
    sourceShape: wrapper,
    emitShape: wrapper,
    wrapperKey: wrapper === "direct" ? "" : "mcpServers",
  };
}

function pickAllowed(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) {
      output[key] = input[key];
    }
  }
  return output;
}

function mergeObjects(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainRecord(output[key]) && isPlainRecord(value)) {
      output[key] = mergeObjects(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function recordSemanticSources(
  tracker: ReturnType<typeof createSourceTracker>,
  value: Record<string, unknown>,
  origin: string,
): void {
  for (const key of Object.keys(value)) {
    tracker.record(key, origin);
  }
}

function groupKeys(rawFiles: RawResourceFile[]): Set<{ kind: ResourceKind; id: string }> {
  const seen = new Map<string, { kind: ResourceKind; id: string }>();
  for (const file of rawFiles) {
    seen.set(`${file.kind}:${file.id}`, { kind: file.kind, id: file.id });
  }
  return new Set(seen.values());
}

function parseIR(kind: ResourceKind, value: Record<string, unknown>): IRResource {
  try {
    return IR_SCHEMAS[kind].parse(value);
  } catch (error) {
    if (isUnknownKeyZodError(error)) {
      throw codedError("ERR_UNKNOWN_FRONTMATTER_KEY", "Merged IR contains an unknown field", {
        kind,
        field: firstUnknownPath(error),
      });
    }
    throw error;
  }
}

function isUnknownKeyZodError(error: unknown): error is ZodError {
  return error instanceof z.ZodError && error.issues.some((issue) => issue.code === "unrecognized_keys");
}

function firstUnknownPath(error: ZodError): string | undefined {
  const issue = error.issues.find((candidate) => candidate.code === "unrecognized_keys");
  if (issue?.code !== "unrecognized_keys") {
    return undefined;
  }
  return [...issue.path.map(String), issue.keys[0]].filter(Boolean).join(".");
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function codedError(code: DiagnosticCode, message: string, details: Record<string, unknown>): CodedMergeError {
  const error = new Error(message) as CodedMergeError;
  error.code = code;
  error.details = details;
  return error;
}
