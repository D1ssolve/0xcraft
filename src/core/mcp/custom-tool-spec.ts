/**
 * Custom tool specification (spec §6, ADR §4).
 *
 * Custom tools are surfaced to agents via MCP as the canonical path.
 * The optional `openCodeShortCircuit` field lets the OpenCode adapter
 * additionally expose the same logic via its native in-process `tool`
 * plugin surface for lower latency. Other adapters ignore the
 * short-circuit field silently and always go through MCP.
 *
 * `inputSchema` (spec §6) is intentionally deferred — not required by
 * Batch 7 (custom-tool MCP bridge). It will be re-added when the
 * input-schema validation surface lands.
 */

import type { McpServerSpec } from "./mcp-types";

export interface CustomToolMcpSpec {
  /** The MCP server hosting this tool (canonical discriminated union). */
  server: McpServerSpec;
  /** Tool name as registered on the MCP server. */
  toolName: string;
}

export interface CustomToolOpenCodeShortCircuitSpec {
  /** When true, OpenCode also registers the in-process tool. */
  enabled: boolean;
  /** Module path implementing the in-process OpenCode tool handler. */
  handlerModule: string;
}

export interface CustomToolSpec {
  /** Unique kebab-case id. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** MCP surface (always required — MCP is the canonical path). */
  mcp: CustomToolMcpSpec;
  /** Optional OpenCode in-process short-circuit. */
  openCodeShortCircuit?: CustomToolOpenCodeShortCircuitSpec;
}
