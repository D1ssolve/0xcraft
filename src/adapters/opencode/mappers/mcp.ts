import type { ZeroxCraftConfig } from "../../../core/config";
import type { McpServerConfigEntry, McpServerSpec } from "../../../core/mcp";

export type OpencodeMcpEntry =
  | { type: "local"; command: string | string[]; environment?: Record<string, string> }
  | { type: "remote"; url: string; headers?: Record<string, string> };

/** Pure mapping — null when required fields missing. */
export function specToOpencodeMcp(server: McpServerSpec | McpServerConfigEntry): OpencodeMcpEntry | null {
  if (server.transport === "stdio" && server.command) {
    return {
      type: "local",
      command: server.command,
      ...(server.env ? { environment: server.env } : {}),
    };
  }

  if ((server.transport === "http" || server.transport === "sse") && server.url) {
    return {
      type: "remote",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return null;
}

/** Filters built-in MCPs by enabledByDefault + user config. */
export function selectEnabledMcpServers(
  builtins: ReadonlyArray<McpServerSpec>,
  config: ZeroxCraftConfig,
): McpServerSpec[] {
  return builtins.filter((mcp) => {
    if (!mcp.enabledByDefault && !config.mcpServers[mcp.id]) return false;
    return true;
  });
}

/** Aggregates built-ins + user mcpServers into the OpenCode mcp record. */
export function mapMcpServersToOpencode(args: {
  builtins: ReadonlyArray<McpServerSpec>;
  config: ZeroxCraftConfig;
}): Record<string, OpencodeMcpEntry> {
  const mcp: Record<string, OpencodeMcpEntry> = {};

  for (const mcpServer of selectEnabledMcpServers(args.builtins, args.config)) {
    const mcpConfig = specToOpencodeMcp(mcpServer);
    if (mcpConfig) mcp[mcpServer.id] = mcpConfig;
  }

  // Skill-embedded MCPs (skill.mcpServers) are intentionally NOT registered here.
  for (const [name, server] of Object.entries(args.config.mcpServers)) {
    const mcpConfig = specToOpencodeMcp(server);
    if (mcpConfig) mcp[name] = mcpConfig;
  }

  return mcp;
}
