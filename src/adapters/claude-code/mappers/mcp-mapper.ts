import { claudeCodeMcpJsonSchema, type ClaudeCodeMcpJson, type ClaudeCodeMcpServer } from "../types/claude-code-types";

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
