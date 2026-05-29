/**
 * Harness-neutral MCP server type (spec §3.6).
 *
 * `McpServerSpec` is the canonical discriminated union; transport
 * lives in the `transport` discriminator (`stdio | http | sse`).
 */

/* ---------------------------------------------------------------- */
/*  Canonical: McpServerSpec                                          */
/* ---------------------------------------------------------------- */

interface McpServerSpecBase {
  /** Unique server id (kebab-case). */
  id: string;
  /** Human-readable description for the config UI. */
  description: string;
  /** Whether this MCP is enabled by default. */
  enabledByDefault: boolean;
  /** Environment variables forwarded to the server process / request. */
  env?: Record<string, string>;
}

export interface McpServerStdioSpec extends McpServerSpecBase {
  transport: "stdio";
  command: string[];
}

export interface McpServerHttpSpec extends McpServerSpecBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpServerSseSpec extends McpServerSpecBase {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerSpec =
  | McpServerStdioSpec
  | McpServerHttpSpec
  | McpServerSseSpec;

/* ---------------------------------------------------------------- */
/*  User-side config shape (id/description/enabledByDefault optional) */
/* ---------------------------------------------------------------- */

/**
 * MCP server entry as written in user config. The map key in
 * `mcpServers: Record<string, McpServerConfigEntry>` provides the name;
 * registry fields default at consume-time.
 */
export type McpServerConfigEntry =
  | (Omit<McpServerStdioSpec, "id" | "description" | "enabledByDefault"> & {
    id?: string;
    description?: string;
    enabledByDefault?: boolean;
  })
  | (Omit<McpServerHttpSpec, "id" | "description" | "enabledByDefault"> & {
    id?: string;
    description?: string;
    enabledByDefault?: boolean;
  })
  | (Omit<McpServerSseSpec, "id" | "description" | "enabledByDefault"> & {
    id?: string;
    description?: string;
    enabledByDefault?: boolean;
  });
