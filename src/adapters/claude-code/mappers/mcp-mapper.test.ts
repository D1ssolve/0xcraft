import { describe, expect, test } from "bun:test";
import { mapClaudeCodeMcpServers } from "./mcp-mapper";

describe("mapClaudeCodeMcpServers", () => {
  test("maps local MCP command arrays to command plus args", () => {
    const result = mapClaudeCodeMcpServers({
      builtinServers: [
        {
          name: "mempalace",
          type: "local",
          command: ["uvx", "--from", "mempalace", "python", "-m", "mempalace.mcp_server"],
          enabledByDefault: true,
        },
      ],
    });

    expect(result.mcpJson).toEqual({
      mcpServers: {
        mempalace: {
          type: "stdio",
          command: "uvx",
          args: ["--from", "mempalace", "python", "-m", "mempalace.mcp_server"],
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("maps remote MCP configs to url and supported transport fields", () => {
    const result = mapClaudeCodeMcpServers({
      builtinServers: [
        {
          name: "context7",
          type: "remote",
          url: "https://mcp.context7.com/mcp",
          headers: { "X-Plugin": "0xcraft" },
          env: { CONTEXT7_MODE: "docs" },
          enabledByDefault: true,
        },
      ],
    });

    expect(result.mcpJson.mcpServers.context7).toEqual({
      type: "http",
      url: "https://mcp.context7.com/mcp",
      headers: { "X-Plugin": "0xcraft" },
      env: { CONTEXT7_MODE: "docs" },
    });
  });

  test("preserves env and headers in output only and redacts them from diagnostics", () => {
    const result = mapClaudeCodeMcpServers({
      userServers: {
        secret_remote: {
          type: "remote",
          url: "not-a-url",
          env: { API_TOKEN: "secret-env-value" },
          headers: { Authorization: "Bearer secret-header-value" },
        },
        valid_remote: {
          type: "remote",
          url: "https://example.test/mcp",
          env: { API_TOKEN: "secret-env-value" },
          headers: { Authorization: "Bearer secret-header-value" },
        },
      },
    });

    expect(result.mcpJson.mcpServers.valid_remote).toEqual({
      type: "http",
      url: "https://example.test/mcp",
      env: { API_TOKEN: "secret-env-value" },
      headers: { Authorization: "Bearer secret-header-value" },
    });
    expect(result.mcpJson.mcpServers.secret_remote).toBeUndefined();

    const diagnosticsText = JSON.stringify(result.diagnostics);
    expect(diagnosticsText).not.toContain("secret-env-value");
    expect(diagnosticsText).not.toContain("secret-header-value");
    expect(diagnosticsText).not.toContain("API_TOKEN");
    expect(diagnosticsText).not.toContain("Authorization");
  });

  test("uses user-configured MCP servers after built-ins so user entries override same-name built-ins", () => {
    const result = mapClaudeCodeMcpServers({
      builtinServers: [
        {
          name: "context7",
          type: "remote",
          url: "https://mcp.context7.com/mcp",
          enabledByDefault: true,
        },
      ],
      userServers: {
        context7: {
          type: "remote",
          url: "https://override.example.test/mcp",
        },
      },
    });

    expect(result.mcpJson.mcpServers.context7).toEqual({
      type: "http",
      url: "https://override.example.test/mcp",
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "claude.mcp.user_override",
      severity: "warning",
      serverName: "context7",
    }));
  });

  test("excludes skill-embedded MCP servers by default", () => {
    const result = mapClaudeCodeMcpServers({
      skillServers: [
        {
          skillId: "nlm-skill",
          name: "notebooklm-mcp",
          type: "local",
          command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
        },
      ],
    });

    expect(result.mcpJson.mcpServers["notebooklm-mcp"]).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "claude.mcp.skill_server_excluded",
      severity: "warning",
      serverName: "notebooklm-mcp",
    }));
  });

  test("includes skill-embedded MCP servers only with explicit opt-in", () => {
    const result = mapClaudeCodeMcpServers({
      includeSkillMcpServers: true,
      skillServers: [
        {
          skillId: "nlm-skill",
          name: "notebooklm-mcp",
          type: "local",
          command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
        },
      ],
    });

    expect(result.mcpJson.mcpServers["notebooklm-mcp"]).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("omits invalid MCP entries and returns diagnostics", () => {
    const result = mapClaudeCodeMcpServers({
      builtinServers: [
        { name: "local_missing_command", type: "local", enabledByDefault: true },
        { name: "remote_missing_url", type: "remote", enabledByDefault: true },
        { name: "empty_command", type: "local", command: [], enabledByDefault: true },
      ],
      userServers: {
        remote_bad_url: { type: "remote", url: "not-a-url" },
      },
    });

    expect(result.mcpJson).toEqual({ mcpServers: {} });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "claude.mcp.invalid_local_command", serverName: "local_missing_command" }),
      expect.objectContaining({ code: "claude.mcp.invalid_remote_url", serverName: "remote_missing_url" }),
      expect.objectContaining({ code: "claude.mcp.invalid_local_command", serverName: "empty_command" }),
      expect.objectContaining({ code: "claude.mcp.invalid_remote_url", serverName: "remote_bad_url" }),
    ]));
  });
});
