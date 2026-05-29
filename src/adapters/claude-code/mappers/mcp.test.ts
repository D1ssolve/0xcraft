import { describe, expect, test } from "bun:test";

import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { CustomToolSpec } from "../../../core/mcp/custom-tool-spec";

import { mapCustomToolsToClaudeCodeMcp } from "./mcp";

function stdio(id: string, serverId = `${id}-server`): CustomToolSpec {
  return {
    id,
    description: id,
    mcp: {
      toolName: id,
      server: {
        id: serverId,
        description: "x",
        enabledByDefault: true,
        transport: "stdio",
        command: ["node", `${id}.mjs`],
      },
    },
  };
}

describe("mapCustomToolsToClaudeCodeMcp", () => {
  test("valid stdio tool → mcpServers entry", () => {
    const collector = new DiagnosticCollector();
    const result = mapCustomToolsToClaudeCodeMcp([stdio("echo")], collector);

    expect(result.emittedToolIds).toEqual(["echo"]);
    expect(result.mcpServers["echo-server"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["echo.mjs"],
    });
    expect(collector.getAll()).toHaveLength(0);
  });

  test("valid http tool → http entry preserves headers + env", () => {
    const collector = new DiagnosticCollector();
    const tool: CustomToolSpec = {
      id: "fetcher",
      description: "x",
      mcp: {
        toolName: "fetch",
        server: {
          id: "fetcher-server",
          description: "x",
          enabledByDefault: true,
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
          env: { FOO: "bar" },
        },
      },
    };
    const result = mapCustomToolsToClaudeCodeMcp([tool], collector);
    expect(result.mcpServers["fetcher-server"]).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
      env: { FOO: "bar" },
    });
  });

  test("sse tool → sse entry", () => {
    const collector = new DiagnosticCollector();
    const tool: CustomToolSpec = {
      id: "stream",
      description: "x",
      mcp: {
        toolName: "stream",
        server: {
          id: "stream-server",
          description: "x",
          enabledByDefault: true,
          transport: "sse",
          url: "https://example.com/sse",
        },
      },
    };
    const result = mapCustomToolsToClaudeCodeMcp([tool], collector);
    expect(result.mcpServers["stream-server"]?.type).toBe("sse");
  });

  test("invalid mcp → omitted, custom_tool.mcp.invalid diagnostic", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("bad");
    tool.mcp.server = {
      ...tool.mcp.server,
      transport: "stdio",
      command: [],
    } as typeof tool.mcp.server;

    const result = mapCustomToolsToClaudeCodeMcp([tool], collector);
    expect(result.emittedToolIds).toEqual([]);
    expect(Object.keys(result.mcpServers)).toEqual([]);
    const diags = collector.getAll();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("custom_tool.mcp.invalid");
  });

  test("openCodeShortCircuit ignored silently (no diagnostic)", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "./handler.js",
    };
    const result = mapCustomToolsToClaudeCodeMcp([tool], collector);
    expect(result.emittedToolIds).toEqual(["echo"]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("duplicate server id → first wins; warn for second", () => {
    const collector = new DiagnosticCollector();
    const a = stdio("a", "shared");
    const b = stdio("b", "shared");
    const result = mapCustomToolsToClaudeCodeMcp([a, b], collector);

    expect(result.emittedToolIds).toEqual(["a", "b"]);
    expect(Object.keys(result.mcpServers)).toEqual(["shared"]);
    // First tool's command preserved
    expect((result.mcpServers["shared"] as { command: string }).command).toBe("node");
    const codes = collector.getAll().map((d) => d.code);
    expect(codes).toContain("claude_code.custom_tool.duplicate_server");
  });

  test("empty input → empty result, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const result = mapCustomToolsToClaudeCodeMcp([], collector);
    expect(result.emittedToolIds).toEqual([]);
    expect(Object.keys(result.mcpServers)).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });
});
