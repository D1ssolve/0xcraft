/**
 * MCP server registry — harness-agnostic.
 *
 * MCP servers that 0xcraft auto-configures. These are separate
 * from skill-embedded MCPs (which are started on-demand by skills).
 *
 * The OpenCode adapter registers these via the plugin `config` hook.
 */
export interface McpRegistryEntry {
  /** Unique name for the MCP server */
  name: string;
  /** "local" (stdio) or "remote" (HTTP) */
  type: "local" | "remote";
  /** For local: command + args */
  command?: string[];
  /** For remote: URL */
  url?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** HTTP headers for remote servers */
  headers?: Record<string, string>;
  /** Whether this MCP is enabled by default */
  enabledByDefault: boolean;
  /** Description for config UI */
  description: string;
}

/**
 * Built-in MCP servers.
 *
 * These are always-available MCP servers that 0xcraft registers
 * in the OpenCode config. Skill-embedded MCPs are handled separately
 * by the skill registry.
 */
export const builtinMcpServers: McpRegistryEntry[] = [
  {
    name: "sequential-thinking",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabledByDefault: true,
    description: "Sequential thinking MCP server for structured problem-solving",
  },
  {
    name: "context7",
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    enabledByDefault: true,
    description: "Up-to-date library and framework documentation via Context7",
  },
  {
    name: "mempalace",
    type: "local",
    command: ["uvx", "--from", "mempalace", "python", "-m", "mempalace.mcp_server"],
    enabledByDefault: true,
    description: "Memory palace system for persistent knowledge management",
  },
  {
    name: "notebooklm-mcp",
    type: "local",
    command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
    enabledByDefault: false,
    description: "Google NotebookLM integration for research and content generation",
  },
];

export function getMcpByName(name: string): McpRegistryEntry | undefined {
  return builtinMcpServers.find((m) => m.name === name);
}

export function getEnabledMcpServers(disabled: string[] = []): McpRegistryEntry[] {
  return builtinMcpServers.filter((m) => !disabled.includes(m.name));
}