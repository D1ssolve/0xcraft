/**
 * Shared validation gate for `CustomToolSpec.mcp`.
 *
 * Lives in `_shared` so all three adapters (opencode, claude-code,
 * codex) use the identical pass/fail decision and the identical
 * diagnostic code (`custom_tool.mcp.invalid`).
 *
 * Pure function: `(spec, collector) → boolean`. Emits a `warn` on the
 * collector and returns `false` for any invalid case; returns `true`
 * for a valid spec. Adapters MUST omit the tool from their output when
 * `false` is returned.
 *
 * Validates the canonical `CustomToolMcpSpec` shape (spec §6):
 *   - `mcp.toolName` is a non-empty string
 *   - `mcp.server` matches the `McpServerSpec` discriminated union
 *     (one of `stdio` / `http` / `sse`) with the required transport
 *     payload (`command` for stdio; `url` for http/sse)
 */

import type { CustomToolSpec } from "../../core/mcp/custom-tool-spec";
import type { McpServerSpec } from "../../core/mcp/mcp-types";

import type { DiagnosticCollector } from "./diagnostic-collector";

const INVALID_CODE = "custom_tool.mcp.invalid";

/**
 * Return `true` if the custom tool's `mcp` block is structurally valid.
 *
 * Emits exactly one `warn` diagnostic with code `custom_tool.mcp.invalid`
 * when the spec is rejected; emits none on success.
 */
export function validateCustomToolMcp(
  spec: CustomToolSpec,
  collector: DiagnosticCollector,
): boolean {
  const reason = checkCustomToolMcp(spec);
  if (reason === null) return true;

  collector.warn(
    INVALID_CODE,
    `Custom tool '${spec.id}' has an invalid MCP descriptor: ${reason}. Tool omitted from all adapter outputs.`,
    {
      toolId: spec.id,
      reason,
    },
  );
  return false;
}

function checkCustomToolMcp(spec: CustomToolSpec): string | null {
  if (!isNonEmptyString(spec.id)) return "id missing";

  const mcp = spec.mcp as CustomToolSpec["mcp"] | undefined;
  if (mcp === undefined || mcp === null || typeof mcp !== "object") {
    return "mcp block missing";
  }

  if (!isNonEmptyString(mcp.toolName)) {
    return "mcp.toolName missing or empty";
  }

  const server = mcp.server as McpServerSpec | undefined;
  if (server === undefined || server === null || typeof server !== "object") {
    return "mcp.server missing";
  }

  if (!isNonEmptyString(server.id)) return "mcp.server.id missing or empty";

  switch (server.transport) {
    case "stdio":
      if (!Array.isArray(server.command) || server.command.length === 0) {
        return "mcp.server.command must be a non-empty string array for stdio transport";
      }
      if (!server.command.every((arg) => typeof arg === "string" && arg.length > 0)) {
        return "mcp.server.command entries must be non-empty strings";
      }
      return null;

    case "http":
    case "sse":
      if (!isNonEmptyString(server.url)) {
        return `mcp.server.url required for ${server.transport} transport`;
      }
      try {
        new URL(server.url);
      } catch {
        return `mcp.server.url is not a valid URL for ${server.transport} transport`;
      }
      return null;

    default:
      return `mcp.server.transport must be one of "stdio" | "http" | "sse"`;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Exported diagnostic code so adapters and tests can reference it. */
export const CUSTOM_TOOL_MCP_INVALID_CODE = INVALID_CODE;
