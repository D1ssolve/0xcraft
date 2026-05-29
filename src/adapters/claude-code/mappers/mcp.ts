/**
 * Claude Code custom-tool → MCP descriptor mapper (Batch 7, ADR §4).
 *
 * Translates `CustomToolSpec[]` into Claude Code MCP server entries
 * (the same shape used by `.mcp.json` / `plugin.json` `mcpServers`).
 *
 * Claude Code has no in-process tool equivalent — the
 * `openCodeShortCircuit` field is ignored silently here (spec §6).
 *
 * Validation gate is shared with the other two adapters via
 * `_shared/custom-tool-validation.ts`. Invalid tools are omitted and
 * the gate emits `custom_tool.mcp.invalid` on the collector.
 *
 * Built-in MCP servers and custom-tool MCP descriptors both flow through
 * this mapper.
 */

import type {
  CustomToolSpec,
} from "../../../core/mcp/custom-tool-spec";
import type {
  McpServerSpec,
  McpServerStdioSpec,
  McpServerHttpSpec,
  McpServerSseSpec,
} from "../../../core/mcp/mcp-types";

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { validateCustomToolMcp } from "../../_shared/custom-tool-validation";

import type { ClaudeCodeMcpServer } from "../types/claude-code-types";
import { claudeCodeMcpJsonSchema, type ClaudeCodeMcpJson } from "../types/claude-code-types";

export type ClaudeMcpDiagnosticSeverity = "warning" | "error";
export type ClaudeMcpSource = "builtin" | "user" | "skill";

export interface ClaudeMcpDiagnostic {
  severity: ClaudeMcpDiagnosticSeverity;
  code: string;
  message: string;
  serverName: string;
  source: ClaudeMcpSource;
  skillId?: string;
}

export interface ClaudeMcpServerInput {
  name: string;
  type: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabledByDefault?: boolean;
}

export interface ClaudeSkillMcpServerInput extends ClaudeMcpServerInput {
  skillId: string;
}

export interface ClaudeCodeMcpMapperOptions {
  builtinServers?: ClaudeMcpServerInput[];
  userServers?: Record<string, Omit<ClaudeMcpServerInput, "name">>;
  skillServers?: ClaudeSkillMcpServerInput[];
  includeSkillMcpServers?: boolean;
}

export interface ClaudeCodeMcpMapperResult {
  mcpJson: ClaudeCodeMcpJson;
  diagnostics: ClaudeMcpDiagnostic[];
}

export interface ClaudeCodeCustomToolMcpResult {
  /** Server entries keyed by `mcp.server.id`, ready to merge into mcpServers. */
  mcpServers: Record<string, ClaudeCodeMcpServer>;
  /** Tool ids that survived validation (in input order, deduped). */
  emittedToolIds: string[];
}

export function mapClaudeCodeMcpServers(options: ClaudeCodeMcpMapperOptions): ClaudeCodeMcpMapperResult {
  const diagnostics: ClaudeMcpDiagnostic[] = [];
  const mcpServers: Record<string, ClaudeCodeMcpServer> = {};

  for (const server of options.builtinServers ?? []) {
    if (server.enabledByDefault === false && !options.userServers?.[server.name]) {
      continue;
    }

    addMappedServer(mcpServers, diagnostics, server, "builtin");
  }

  for (const skillServer of options.skillServers ?? []) {
    if (!options.includeSkillMcpServers) {
      diagnostics.push({
        severity: "warning",
        code: "claude.mcp.skill_server_excluded",
        message: `Skill-embedded MCP server '${skillServer.name}' is excluded by default; opt in explicitly because Claude plugin MCP starts when enabled.`,
        serverName: skillServer.name,
        source: "skill",
        skillId: skillServer.skillId,
      });
      continue;
    }

    addMappedServer(mcpServers, diagnostics, skillServer, "skill", skillServer.skillId);
  }

  for (const [name, userServer] of Object.entries(options.userServers ?? {})) {
    if (mcpServers[name]) {
      diagnostics.push({
        severity: "warning",
        code: "claude.mcp.user_override",
        message: `User-configured MCP server '${name}' overrides an earlier MCP server with the same name.`,
        serverName: name,
        source: "user",
      });
    }

    addMappedServer(mcpServers, diagnostics, { ...userServer, name }, "user");
  }

  return {
    mcpJson: claudeCodeMcpJsonSchema.parse({ mcpServers }),
    diagnostics,
  };
}

/**
 * Map custom tools to Claude Code MCP descriptors. Pure function.
 *
 * Behavior:
 *  - Invalid `spec.mcp` → omit; `custom_tool.mcp.invalid` warn from the
 *    shared validator.
 *  - Duplicate `mcp.server.id` across tools → later one is dropped with
 *    a `claude_code.custom_tool.duplicate_server` warn (deterministic,
 *    first-wins to keep snapshot stable).
 *  - `openCodeShortCircuit` field on input is ignored silently.
 */
export function mapCustomToolsToClaudeCodeMcp(
  tools: ReadonlyArray<CustomToolSpec>,
  collector: DiagnosticCollector,
): ClaudeCodeCustomToolMcpResult {
  const mcpServers: Record<string, ClaudeCodeMcpServer> = {};
  const emittedToolIds: string[] = [];

  for (const tool of tools) {
    if (!validateCustomToolMcp(tool, collector)) continue;

    const serverId = tool.mcp.server.id;
    if (Object.prototype.hasOwnProperty.call(mcpServers, serverId)) {
      collector.warn(
        "claude_code.custom_tool.duplicate_server",
        `Custom tool '${tool.id}' targets MCP server id '${serverId}' already emitted by an earlier tool; tool retained but server descriptor not overwritten.`,
        { toolId: tool.id, serverId },
      );
      emittedToolIds.push(tool.id);
      continue;
    }

    mcpServers[serverId] = translateServer(tool.mcp.server);
    emittedToolIds.push(tool.id);
  }

  return { mcpServers, emittedToolIds };
}

function translateServer(server: McpServerSpec): ClaudeCodeMcpServer {
  switch (server.transport) {
    case "stdio":
      return translateStdio(server);
    case "http":
      return translateHttp(server);
    case "sse":
      return translateSse(server);
  }
}

function translateStdio(server: McpServerStdioSpec): ClaudeCodeMcpServer {
  const [command, ...args] = server.command;
  // validateCustomToolMcp guarantees command.length >= 1 at this point.
  const entry: ClaudeCodeMcpServer = {
    type: "stdio",
    command: command as string,
    ...(args.length > 0 ? { args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
  return entry;
}

function translateHttp(server: McpServerHttpSpec): ClaudeCodeMcpServer {
  return {
    type: "http",
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

function translateSse(server: McpServerSseSpec): ClaudeCodeMcpServer {
  return {
    type: "sse",
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

function addMappedServer(
  mcpServers: Record<string, ClaudeCodeMcpServer>,
  diagnostics: ClaudeMcpDiagnostic[],
  server: ClaudeMcpServerInput,
  source: ClaudeMcpSource,
  skillId?: string,
): void {
  const mapped = mapMcpServer(server, source, diagnostics, skillId);
  if (mapped) {
    mcpServers[server.name] = mapped;
  }
}

function mapMcpServer(
  server: ClaudeMcpServerInput,
  source: ClaudeMcpSource,
  diagnostics: ClaudeMcpDiagnostic[],
  skillId?: string,
): ClaudeCodeMcpServer | null {
  if (server.type === "local") {
    return mapLocalMcpServer(server, source, diagnostics, skillId);
  }

  return mapRemoteMcpServer(server, source, diagnostics, skillId);
}

function mapLocalMcpServer(
  server: ClaudeMcpServerInput,
  source: ClaudeMcpSource,
  diagnostics: ClaudeMcpDiagnostic[],
  skillId?: string,
): ClaudeCodeMcpServer | null {
  const [command, ...args] = server.command ?? [];
  if (!command || command.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      code: "claude.mcp.invalid_local_command",
      message: `Local MCP server '${server.name}' was omitted because it has no command executable.`,
      serverName: server.name,
      source,
      ...(skillId ? { skillId } : {}),
    });
    return null;
  }

  return {
    type: "stdio",
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

function mapRemoteMcpServer(
  server: ClaudeMcpServerInput,
  source: ClaudeMcpSource,
  diagnostics: ClaudeMcpDiagnostic[],
  skillId?: string,
): ClaudeCodeMcpServer | null {
  if (!server.url || !isValidUrl(server.url)) {
    diagnostics.push({
      severity: "error",
      code: "claude.mcp.invalid_remote_url",
      message: `Remote MCP server '${server.name}' was omitted because it has no valid URL.`,
      serverName: server.name,
      source,
      ...(skillId ? { skillId } : {}),
    });
    return null;
  }

  return {
    type: "http",
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
