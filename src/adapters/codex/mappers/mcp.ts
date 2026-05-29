/**
 * Codex custom-tool → MCP descriptor mapper (Batch 7, ADR §4).
 *
 * Translates `CustomToolSpec[]` into Codex `[mcp_servers.<id>]` TOML
 * blocks. Codex has no in-process tool surface — the
 * `openCodeShortCircuit` field is ignored silently here (spec §6).
 *
 * Validation gate is shared with the other two adapters via
 * `_shared/custom-tool-validation.ts`. Invalid tools are omitted and
 * the gate emits `custom_tool.mcp.invalid` on the collector.
 *
 * Built-in MCP servers continue to flow through the existing
 * `config-emitter.ts` `emitMcpServerBlock` path; this file owns ONLY
 * the custom-tool flow. Returned `tomlBlocks` are pre-rendered strings
 * caller can splice into the document via `tomlDocument([...])`.
 */

import type { CustomToolSpec } from "../../../core/mcp/custom-tool-spec";
import type {
  McpServerSpec,
  McpServerStdioSpec,
  McpServerHttpSpec,
} from "../../../core/mcp/mcp-types";

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { validateCustomToolMcp } from "../../_shared/custom-tool-validation";

import {
  tomlTable,
  type TomlTableEntry,
  type TomlValue,
} from "../_internal/toml-emitter";

export interface CodexCustomToolMcpResult {
  /** Pre-rendered `[mcp_servers.<id>]` blocks in deterministic input order. */
  tomlBlocks: string[];
  /** Tool ids that survived validation (in input order, deduped). */
  emittedToolIds: string[];
}

/**
 * Map custom tools to Codex `[mcp_servers.<id>]` TOML blocks. Pure
 * function.
 *
 * Behavior:
 *  - Invalid `spec.mcp` → omit; `custom_tool.mcp.invalid` warn from the
 *    shared validator.
 *  - Duplicate `mcp.server.id` across tools → later one is dropped with
 *    `codex.custom_tool.duplicate_server` warn (first-wins to keep
 *    snapshot stable).
 *  - `openCodeShortCircuit` field on input is ignored silently.
 */
export function mapCustomToolsToCodexMcp(
  tools: ReadonlyArray<CustomToolSpec>,
  collector: DiagnosticCollector,
): CodexCustomToolMcpResult {
  const tomlBlocks: string[] = [];
  const emittedToolIds: string[] = [];
  const seenServerIds = new Set<string>();

  for (const tool of tools) {
    if (!validateCustomToolMcp(tool, collector)) continue;

    const server = tool.mcp.server;

    // T-20: Codex does not support SSE transport — drop with dedicated diagnostic.
    if (server.transport === "sse") {
      collector.warn(
        "codex.mcp.sse.dropped",
        `Custom tool '${tool.id}' targets MCP server '${server.id}' using transport='sse' which Codex does not support; tool dropped.`,
        { toolId: tool.id, serverId: server.id, transport: server.transport, url: server.url },
      );
      continue;
    }

    const serverId = server.id;
    if (seenServerIds.has(serverId)) {
      collector.warn(
        "codex.custom_tool.duplicate_server",
        `Custom tool '${tool.id}' targets MCP server id '${serverId}' already emitted by an earlier tool; block not re-emitted.`,
        { toolId: tool.id, serverId },
      );
      emittedToolIds.push(tool.id);
      continue;
    }

    tomlBlocks.push(emitServerBlock(server));
    seenServerIds.add(serverId);
    emittedToolIds.push(tool.id);
  }

  return { tomlBlocks, emittedToolIds };
}

function emitServerBlock(server: McpServerSpec): string {
  const entries: TomlTableEntry[] = [];

  switch (server.transport) {
    case "stdio":
      entries.push(...stdioEntries(server));
      break;
    case "http":
      entries.push(...httpEntries(server));
      break;
    case "sse":
      // Unreachable: SSE is filtered out by the caller (T-20).
      throw new Error(
        `codex.mcp: emitServerBlock received SSE transport for '${server.id}' — caller must drop SSE before invoking.`,
      );
  }

  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    entries.push({ key: "env", value: envValue(server.env) });
  }

  return tomlTable({
    header: ["mcp_servers", server.id],
    entries,
  });
}

function stdioEntries(server: McpServerStdioSpec): TomlTableEntry[] {
  // validateCustomToolMcp guarantees non-empty command + non-empty entries.
  const [command, ...args] = server.command;
  const entries: TomlTableEntry[] = [
    { key: "command", value: stringValue(command as string) },
  ];
  if (args.length > 0) {
    entries.push({ key: "args", value: stringArrayValue(args) });
  }
  return entries;
}

function httpEntries(server: McpServerHttpSpec): TomlTableEntry[] {
  const entries: TomlTableEntry[] = [
    { key: "transport", value: stringValue("http") },
    { key: "url", value: stringValue(server.url) },
  ];
  if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
    entries.push({ key: "headers", value: headerArrayValue(server.headers) });
  }
  return entries;
}

function stringValue(value: string): TomlValue {
  return { kind: "string", value };
}

function stringArrayValue(values: string[]): TomlValue {
  return { kind: "stringArray", values };
}

function envValue(env: Record<string, string>): TomlValue {
  // Mirrors codex/config-emitter.ts builtin convention: KEY=value entries.
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return { kind: "stringArray", values: lines };
}

function headerArrayValue(headers: Record<string, string>): TomlValue {
  const lines = Object.entries(headers).map(([k, v]) => `${k}=${v}`);
  return { kind: "stringArray", values: lines };
}
