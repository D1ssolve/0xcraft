import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { generateClaudeCodeMcp } from "./mcp";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("generateClaudeCodeMcp", () => {
  test("writes .mcp.json with local and remote MCP servers in Claude schema", () => {
    const outputRoot = makeTempDir("0xcraft-claude-mcp-generator-fixture-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeMcp({
      writer,
      builtinServers: [
        {
          name: "mempalace",
          type: "local",
          command: ["uvx", "--from", "mempalace", "python", "-m", "mempalace.mcp_server"],
          enabledByDefault: true,
        },
        {
          name: "context7",
          type: "remote",
          url: "https://mcp.context7.com/mcp",
          headers: { "X-Plugin": "0xcraft" },
          enabledByDefault: true,
        },
      ],
    });

    expect(result.emittedFiles).toEqual([".mcp.json"]);
    expect(result.diagnostics).toEqual([]);
    expect(readText(path.join(outputRoot, ".mcp.json"))).toBe(
      '{\n  "mcpServers": {\n    "context7": {\n      "headers": {\n        "X-Plugin": "0xcraft"\n      },\n      "type": "http",\n      "url": "https://mcp.context7.com/mcp"\n    },\n    "mempalace": {\n      "args": [\n        "--from",\n        "mempalace",\n        "python",\n        "-m",\n        "mempalace.mcp_server"\n      ],\n      "command": "uvx",\n      "type": "stdio"\n    }\n  }\n}\n',
    );
  });

  test("omits invalid MCP entries with diagnostics and writes only valid entries", () => {
    const outputRoot = makeTempDir("0xcraft-claude-mcp-generator-invalid-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeMcp({
      writer,
      builtinServers: [
        { name: "empty_command", type: "local", command: [], enabledByDefault: true },
        { name: "valid_local", type: "local", command: ["node", "server.js"], enabledByDefault: true },
      ],
      userServers: {
        bad_remote: { type: "remote", url: "not-a-url" },
      },
    });

    expect(result.emittedFiles).toEqual([".mcp.json"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "claude.mcp.invalid_local_command", serverName: "empty_command" }),
      expect.objectContaining({ code: "claude.mcp.invalid_remote_url", serverName: "bad_remote" }),
    ]));
    expect(JSON.parse(readText(path.join(outputRoot, ".mcp.json")))).toEqual({
      mcpServers: {
        valid_local: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      },
    });
  });

  test("does not expose env or header secrets in diagnostics", () => {
    const outputRoot = makeTempDir("0xcraft-claude-mcp-generator-secrets-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeMcp({
      writer,
      userServers: {
        secret_remote: {
          type: "remote",
          url: "not-a-url",
          env: { API_TOKEN: "secret-env-value" },
          headers: { Authorization: "Bearer secret-header-value" },
        },
      },
    });

    const diagnosticsText = JSON.stringify(result.diagnostics);
    expect(diagnosticsText).not.toContain("secret-env-value");
    expect(diagnosticsText).not.toContain("secret-header-value");
    expect(diagnosticsText).not.toContain("API_TOKEN");
    expect(diagnosticsText).not.toContain("Authorization");
  });

  test("writes a valid empty .mcp.json for an empty MCP set", () => {
    const outputRoot = makeTempDir("0xcraft-claude-mcp-generator-empty-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeMcp({ writer });

    expect(result.emittedFiles).toEqual([".mcp.json"]);
    expect(result.diagnostics).toEqual([]);
    expect(readText(path.join(outputRoot, ".mcp.json"))).toBe('{\n  "mcpServers": {}\n}\n');
  });
});
