/**
 * MCP server registry — harness-agnostic.
 *
 * MCP servers that 0xcraft auto-configures. These are separate
 * from skill-embedded MCPs (which are started on-demand by skills).
 *
 * The OpenCode adapter registers these via the plugin `config` hook.
 */
import type { McpServerSpec } from "./mcp-types";

/**
 * Built-in MCP servers.
 *
 * These are always-available MCP servers that 0xcraft registers
 * in the OpenCode config. Skill-embedded MCPs are handled separately
 * by the skill registry.
 */
export const builtinMcpServers: McpServerSpec[] = [
  {
    id: "sequential-thinking",
    transport: "stdio",
    command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabledByDefault: true,
    description:
      "Sequential thinking MCP server for structured problem-solving",
  },
  {
    id: "context7",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    enabledByDefault: true,
    description: "Up-to-date library and framework documentation via Context7",
  },
  {
    id: "mempalace",
    transport: "stdio",
    command: [
      "uvx",
      "--from",
      "mempalace",
      "python",
      "-m",
      "mempalace.mcp_server",
    ],
    enabledByDefault: true,
    description: "Memory palace system for persistent knowledge management",
  },
  {
    id: "notebooklm-mcp",
    transport: "stdio",
    command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
    enabledByDefault: false,
    description:
      "Google NotebookLM integration for research and content generation",
  },
  {
    id: "fetch-mcp",
    transport: "stdio",
    command: ["uvx", "mcp-server-fetch"],
    enabledByDefault: false,
    description:
      "A Model Context Protocol server that provides web content fetching capabilities. This server enables LLMs to retrieve and process content from web pages, converting HTML to markdown for easier consumption.",
  },
];

export function getMcpByName(name: string): McpServerSpec | undefined {
  return builtinMcpServers.find((m) => m.id === name);
}

export function getEnabledMcpServers(disabled: string[] = []): McpServerSpec[] {
  return builtinMcpServers.filter((m) => m.enabledByDefault && !disabled.includes(m.id));
}
