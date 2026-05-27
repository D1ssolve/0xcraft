import { createClaudeCodeFilesystemWriter } from "../filesystem";
import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import { claudeCodeManifestSchema, type ClaudeCodeManifest } from "../types/claude-code-types";

export interface ClaudeCodeManifestPackageMetadata {
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export interface ClaudeCodeManifestEmittedComponents {
  agents?: boolean;
  skills?: boolean;
  hooks?: boolean;
  mcpServers?: boolean;
  commands?: boolean;
  outputStyles?: boolean;
  lspServers?: boolean;
}

export interface ClaudeCodeManifestCompatibility {
  claudeCodeVersion?: string;
  supportsDisplayName?: boolean;
}

export interface GenerateClaudeCodeManifestOptions {
  outputRoot: string;
  force?: boolean;
  writer?: ClaudeCodeFilesystemWriter;
  packageMetadata: ClaudeCodeManifestPackageMetadata;
  emittedComponents: ClaudeCodeManifestEmittedComponents;
  compatibility?: ClaudeCodeManifestCompatibility;
}

export interface GenerateClaudeCodeManifestResult {
  manifest: ClaudeCodeManifest;
  emittedFiles: string[];
}

const DISPLAY_NAME_MIN_VERSION = [2, 1, 143] as const;

const COMPONENT_PATHS = {
  agents: "agents/",
  skills: "skills/",
  hooks: "hooks/hooks.json",
  mcpServers: ".mcp.json",
  commands: "commands/",
  outputStyles: "output-styles/",
  lspServers: "lsp-servers/",
} satisfies Record<keyof ClaudeCodeManifestEmittedComponents, string>;

export function generateClaudeCodeManifest(options: GenerateClaudeCodeManifestOptions): GenerateClaudeCodeManifestResult {
  const manifest = claudeCodeManifestSchema.parse({
    name: options.packageMetadata.name,
    ...(shouldEmitDisplayName(options.packageMetadata, options.compatibility)
      ? { displayName: options.packageMetadata.displayName }
      : {}),
    ...optionalString("version", options.packageMetadata.version),
    ...optionalString("description", options.packageMetadata.description),
    ...optionalString("author", options.packageMetadata.author),
    ...optionalString("homepage", options.packageMetadata.homepage),
    ...optionalString("repository", options.packageMetadata.repository),
    ...optionalString("license", options.packageMetadata.license),
    ...(options.packageMetadata.keywords && options.packageMetadata.keywords.length > 0
      ? { keywords: options.packageMetadata.keywords }
      : {}),
    ...buildComponentPaths(options.emittedComponents),
  });

  const writer = options.writer ?? createClaudeCodeFilesystemWriter({
    outputRoot: options.outputRoot,
    force: options.force,
  });

  return {
    manifest,
    emittedFiles: writer.writeJson(".claude-plugin/plugin.json", manifest),
  };
}

function optionalString<Key extends keyof ClaudeCodeManifest>(key: Key, value: string | undefined): Partial<ClaudeCodeManifest> {
  if (value === undefined) {
    return {};
  }

  return { [key]: value } as Partial<ClaudeCodeManifest>;
}

function buildComponentPaths(components: ClaudeCodeManifestEmittedComponents): Partial<ClaudeCodeManifest> {
  const paths: Partial<ClaudeCodeManifest> = {};

  for (const key of Object.keys(COMPONENT_PATHS) as Array<keyof ClaudeCodeManifestEmittedComponents>) {
    if (components[key] === true) {
      paths[key] = COMPONENT_PATHS[key];
    }
  }

  return paths;
}

function shouldEmitDisplayName(
  metadata: ClaudeCodeManifestPackageMetadata,
  compatibility: ClaudeCodeManifestCompatibility | undefined,
): boolean {
  if (!metadata.displayName) {
    return false;
  }

  if (compatibility?.supportsDisplayName === true) {
    return true;
  }

  return isVersionAtLeast(compatibility?.claudeCodeVersion, DISPLAY_NAME_MIN_VERSION);
}

function isVersionAtLeast(version: string | undefined, minimum: readonly [number, number, number]): boolean {
  const parsed = parseSemver(version);
  if (!parsed) {
    return false;
  }

  if (parsed[0] !== minimum[0]) {
    return parsed[0] > minimum[0];
  }
  if (parsed[1] !== minimum[1]) {
    return parsed[1] > minimum[1];
  }

  return parsed[2] >= minimum[2];
}

function parseSemver(version: string | undefined): [number, number, number] | null {
  const match = version?.match(/^(?:v)?(\d+)\.(\d+)\.(\d+)/u);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
