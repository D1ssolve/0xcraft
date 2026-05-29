/**
 * OpenCode custom-tool bridge (Batch 7, ADR §4 / spec §6).
 *
 * Pure planner that translates `CustomToolSpec[]` into two parallel
 * surfaces:
 *
 *   1. **MCP descriptors** — `mcpServers` map keyed by `mcp.server.id`.
 *      Always produced for valid specs. Caller merges this into the
 *      OpenCode plugin config alongside built-in MCP servers.
 *
 *   2. **In-process tool registrations** — produced ONLY when
 *      `openCodeShortCircuit.enabled === true` AND the handler module
 *      resolves. The handler module is loaded lazily by the caller at
 *      runtime; the bridge only verifies resolvability up front to
 *      decide whether to plan the registration.
 *
 * Invariants (ADR §4):
 *  - MCP descriptor is the canonical path. In-process is an
 *    optimization layered on top — it MUST NEVER be the sole
 *    representation. This bridge enforces that by always emitting the
 *    MCP descriptor first; the short-circuit plan rides alongside.
 *  - Invalid `spec.mcp` → `custom_tool.mcp.invalid` warn, tool fully
 *    omitted from BOTH surfaces.
 *  - Short-circuit requested but handler missing → `custom_tool.short_
 *    circuit.missing` warn; MCP descriptor still emitted.
 *  - Short-circuit `enabled: false` → silently ignored.
 *  - Duplicate `mcp.server.id` across tools → later one's descriptor is
 *    dropped (first-wins for snapshot stability) with
 *    `opencode.custom_tool.duplicate_server` warn. In-process plan
 *    still emitted for the duplicate tool (a second tool may legitimately
 *    short-circuit even if its MCP server descriptor was already wired
 *    by the first tool).
 *
 * Stays a planner — no actual `tool()` registration, no SDK import.
 * `@opencode-ai/plugin` types stay isolated to the call-site that owns
 * runtime registration (per Layer Rules in AGENTS.md).
 */

import { createRequire } from "node:module";

import type { CustomToolSpec } from "../../../core/mcp/custom-tool-spec";
import type {
  McpServerSpec,
  McpServerStdioSpec,
  McpServerHttpSpec,
  McpServerSseSpec,
} from "../../../core/mcp/mcp-types";

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { validateCustomToolMcp } from "../../_shared/custom-tool-validation";

/* ---------------------------------------------------------------- */
/*  Descriptor shape                                                 */
/* ---------------------------------------------------------------- */

/**
 * OpenCode MCP descriptor shape (matches `toOpenCodeMcp` in
 * `hooks/config-handler.ts`). Kept structural (not imported from the
 * SDK) so this file remains adapter-internal and SDK-free.
 */
export type OpenCodeMcpDescriptor =
  | {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
    };

export interface OpenCodeInProcessToolPlan {
  /** Tool id from `CustomToolSpec.id`. */
  toolId: string;
  /** Resolved absolute module path for the handler. */
  resolvedHandlerModule: string;
  /** Original (unresolved) module specifier — useful for diagnostics. */
  handlerModule: string;
}

export interface OpenCodeCustomToolBridgeResult {
  /** MCP server descriptors keyed by `mcp.server.id`. */
  mcpServers: Record<string, OpenCodeMcpDescriptor>;
  /**
   * Short-circuit plans. Caller is expected to lazily `import()` the
   * `resolvedHandlerModule` and register the in-process tool against
   * `toolId` at runtime.
   */
  inProcessPlans: OpenCodeInProcessToolPlan[];
  /** Tool ids whose MCP descriptor was emitted. */
  emittedToolIds: string[];
}

/* ---------------------------------------------------------------- */
/*  Public API                                                       */
/* ---------------------------------------------------------------- */

export interface BridgeCustomToolsOptions {
  /**
   * Module resolver injected for testability. Default uses
   * `createRequire(import.meta.url).resolve`. Must return an absolute
   * path; throw to signal "not resolvable".
   */
  resolveHandler?: (specifier: string) => string;
}

/**
 * Pure-ish planner: returns MCP descriptors + in-process registration
 * plans for an array of custom tools. Emits diagnostics on `collector`.
 *
 * "Pure-ish": handler resolution touches the filesystem via
 * `require.resolve`. The resolver is injectable for hermetic tests.
 */
export function bridgeCustomTools(
  tools: ReadonlyArray<CustomToolSpec>,
  collector: DiagnosticCollector,
  options: BridgeCustomToolsOptions = {},
): OpenCodeCustomToolBridgeResult {
  const resolveHandler = options.resolveHandler ?? defaultResolveHandler;

  const mcpServers: Record<string, OpenCodeMcpDescriptor> = {};
  const inProcessPlans: OpenCodeInProcessToolPlan[] = [];
  const emittedToolIds: string[] = [];

  for (const tool of tools) {
    if (!validateCustomToolMcp(tool, collector)) continue;

    // MCP surface — canonical.
    const serverId = tool.mcp.server.id;
    if (Object.prototype.hasOwnProperty.call(mcpServers, serverId)) {
      collector.warn(
        "opencode.custom_tool.duplicate_server",
        `Custom tool '${tool.id}' targets MCP server id '${serverId}' already emitted by an earlier tool; descriptor not overwritten.`,
        { toolId: tool.id, serverId },
      );
    } else {
      mcpServers[serverId] = translateServer(tool.mcp.server);
    }
    emittedToolIds.push(tool.id);

    // Optional in-process short-circuit.
    const shortCircuit = tool.openCodeShortCircuit;
    if (shortCircuit === undefined || shortCircuit.enabled !== true) continue;

    const handlerModule = shortCircuit.handlerModule;
    if (typeof handlerModule !== "string" || handlerModule.length === 0) {
      collector.warn(
        "custom_tool.short_circuit.missing",
        `Custom tool '${tool.id}' requested OpenCode short-circuit but 'handlerModule' is empty; MCP descriptor still emitted, in-process tool skipped.`,
        { toolId: tool.id, handlerModule: String(handlerModule) },
      );
      continue;
    }

    let resolved: string;
    try {
      resolved = resolveHandler(handlerModule);
    } catch (error) {
      collector.warn(
        "custom_tool.short_circuit.missing",
        `Custom tool '${tool.id}' short-circuit handler module '${handlerModule}' could not be resolved; MCP descriptor still emitted, in-process tool skipped.`,
        {
          toolId: tool.id,
          handlerModule,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      continue;
    }

    inProcessPlans.push({
      toolId: tool.id,
      handlerModule,
      resolvedHandlerModule: resolved,
    });
  }

  return { mcpServers, inProcessPlans, emittedToolIds };
}

/* ---------------------------------------------------------------- */
/*  Server translation                                               */
/* ---------------------------------------------------------------- */

function translateServer(server: McpServerSpec): OpenCodeMcpDescriptor {
  switch (server.transport) {
    case "stdio":
      return translateStdio(server);
    case "http":
    case "sse":
      return translateRemote(server);
  }
}

function translateStdio(server: McpServerStdioSpec): OpenCodeMcpDescriptor {
  // validateCustomToolMcp guarantees command.length >= 1 and entries are non-empty.
  return {
    type: "local",
    command: [...server.command],
    ...(server.env ? { environment: server.env } : {}),
  };
}

function translateRemote(
  server: McpServerHttpSpec | McpServerSseSpec,
): OpenCodeMcpDescriptor {
  return {
    type: "remote",
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
  };
}

/* ---------------------------------------------------------------- */
/*  Default handler resolver                                         */
/* ---------------------------------------------------------------- */

const moduleRequire = createRequire(import.meta.url);

function defaultResolveHandler(specifier: string): string {
  return moduleRequire.resolve(specifier);
}
