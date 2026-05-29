/**
 * Codex `.codex-plugin/plugin.json` manifest mapper — Batch E / T-17.
 *
 * Pure transform: collects already-resolved registry inputs +
 * `packageMetadata` and produces a deterministic manifest object
 * matching ADR-003 shape.
 *
 * Notes:
 *  - `apps` is gated by `emitApps` (defaults to `false`).
 *  - `hooks` key is omitted when no hook entries are emitted.
 *  - `mcpServers` is JSON-shape mirror of `.codex/config.toml`
 *    `[mcp_servers]` blocks (stdio: command/args; http|sse: url/headers).
 *  - Keys inside object literals are emitted in declaration order — the
 *    JSON emitter is responsible for stable output ordering.
 *  - This mapper does NOT import any platform SDK and does NOT touch the
 *    filesystem.
 */

import type {
  McpServerSpec,
  McpServerStdioSpec,
  McpServerHttpSpec,
  McpServerSseSpec,
} from "../../../core/mcp/mcp-types";
import type { SkillDefinition } from "../../../core/skills";

import type { CodexHookEntry } from "./hooks";

/* ---------------------------------------------------------------- */
/*  Public types                                                      */
/* ---------------------------------------------------------------- */

export interface CodexPluginManifestPackageMetadata {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export interface CodexPluginManifestInterface {
  displayName?: string;
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities?: string[];
}

export interface CodexPluginManifestMcpStdio {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CodexPluginManifestMcpHttpLike {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export type CodexPluginManifestMcpServer =
  | CodexPluginManifestMcpStdio
  | CodexPluginManifestMcpHttpLike;

export interface CodexPluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: string[];
  mcpServers?: Record<string, CodexPluginManifestMcpServer>;
  hooks?: string;
  interface?: CodexPluginManifestInterface;
  apps?: Record<string, unknown>;
}

export interface MapCodexPluginManifestOptions {
  packageMetadata: CodexPluginManifestPackageMetadata;
  /** Already-filtered list of skills emitted into `.codex-plugin/skills/`. */
  skills: ReadonlyArray<SkillDefinition>;
  /** Resolved MCP servers (after built-in/user merge). */
  mcpServers: ReadonlyArray<McpServerSpec>;
  /** Codex hook entries emitted into `.codex-plugin/hooks/hooks.json`. */
  hookEntries: ReadonlyArray<CodexHookEntry>;
  /** Optional human-facing interface block. */
  interface?: CodexPluginManifestInterface;
  /** Emit `apps` block (defaults to false). */
  emitApps?: boolean;
  /** Apps payload (only used when `emitApps === true`). */
  apps?: Record<string, unknown>;
}

/* ---------------------------------------------------------------- */
/*  Mapper                                                            */
/* ---------------------------------------------------------------- */

export function mapCodexPluginManifest(
  options: MapCodexPluginManifestOptions,
): CodexPluginManifest {
  const meta = options.packageMetadata;

  const manifest: CodexPluginManifest = { name: meta.name };

  if (meta.version !== undefined) manifest.version = meta.version;
  if (meta.description !== undefined) manifest.description = meta.description;
  if (meta.author !== undefined) manifest.author = meta.author;
  if (meta.homepage !== undefined) manifest.homepage = meta.homepage;
  if (meta.repository !== undefined) manifest.repository = meta.repository;
  if (meta.license !== undefined) manifest.license = meta.license;
  if (meta.keywords !== undefined && meta.keywords.length > 0) {
    manifest.keywords = [...meta.keywords];
  }

  if (options.skills.length > 0) {
    manifest.skills = options.skills
      .map((s) => `skills/${s.id}/SKILL.md`)
      .sort();
  }

  if (options.mcpServers.length > 0) {
    const mcp: Record<string, CodexPluginManifestMcpServer> = {};
    // Sort by id for determinism.
    const sorted = [...options.mcpServers].sort((a, b) => a.id.localeCompare(b.id));
    for (const server of sorted) {
      mcp[server.id] = translateMcpServer(server);
    }
    manifest.mcpServers = mcp;
  }

  if (options.hookEntries.length > 0) {
    manifest.hooks = "hooks/hooks.json";
  }

  if (options.interface !== undefined && hasInterfaceField(options.interface)) {
    manifest.interface = pickInterfaceFields(options.interface);
  }

  if (options.emitApps === true && options.apps !== undefined) {
    manifest.apps = options.apps;
  }

  return manifest;
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

function translateMcpServer(server: McpServerSpec): CodexPluginManifestMcpServer {
  switch (server.transport) {
    case "stdio":
      return translateStdio(server);
    case "http":
      return translateHttpLike(server, "http");
    case "sse":
      return translateHttpLike(server, "sse");
  }
}

function translateStdio(server: McpServerStdioSpec): CodexPluginManifestMcpStdio {
  const [command, ...args] = server.command;
  const entry: CodexPluginManifestMcpStdio = {
    type: "stdio",
    command: command ?? "",
  };
  if (args.length > 0) entry.args = args;
  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    entry.env = server.env;
  }
  return entry;
}

function translateHttpLike(
  server: McpServerHttpSpec | McpServerSseSpec,
  type: "http" | "sse",
): CodexPluginManifestMcpHttpLike {
  const entry: CodexPluginManifestMcpHttpLike = {
    type,
    url: server.url,
  };
  if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
    entry.headers = server.headers;
  }
  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    entry.env = server.env;
  }
  return entry;
}

function hasInterfaceField(iface: CodexPluginManifestInterface): boolean {
  return (
    iface.displayName !== undefined ||
    iface.shortDescription !== undefined ||
    iface.longDescription !== undefined ||
    iface.developerName !== undefined ||
    iface.category !== undefined ||
    (iface.capabilities !== undefined && iface.capabilities.length > 0)
  );
}

function pickInterfaceFields(iface: CodexPluginManifestInterface): CodexPluginManifestInterface {
  const out: CodexPluginManifestInterface = {};
  if (iface.displayName !== undefined) out.displayName = iface.displayName;
  if (iface.shortDescription !== undefined) out.shortDescription = iface.shortDescription;
  if (iface.longDescription !== undefined) out.longDescription = iface.longDescription;
  if (iface.developerName !== undefined) out.developerName = iface.developerName;
  if (iface.category !== undefined) out.category = iface.category;
  if (iface.capabilities !== undefined && iface.capabilities.length > 0) {
    out.capabilities = [...iface.capabilities];
  }
  return out;
}
