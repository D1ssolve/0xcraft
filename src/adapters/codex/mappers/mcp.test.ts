import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";

import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { CustomToolSpec } from "../../../core/mcp/custom-tool-spec";

import { mapCustomToolsToCodexMcp } from "./mcp";

function stdioTool(id: string, serverId = `${id}-server`): CustomToolSpec {
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

describe("mapCustomToolsToCodexMcp", () => {
  test("valid stdio tool → [mcp_servers.<id>] block round-trips via smol-toml", () => {
    const collector = new DiagnosticCollector();
    const result = mapCustomToolsToCodexMcp([stdioTool("echo")], collector);
    expect(result.emittedToolIds).toEqual(["echo"]);
    expect(result.tomlBlocks).toHaveLength(1);

    const parsed = parse(result.tomlBlocks[0] as string) as {
      mcp_servers: { "echo-server": { command: string; args: string[] } };
    };
    expect(parsed.mcp_servers["echo-server"].command).toBe("node");
    expect(parsed.mcp_servers["echo-server"].args).toEqual(["echo.mjs"]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("valid http tool → block with transport + url + headers", () => {
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
        },
      },
    };
    const result = mapCustomToolsToCodexMcp([tool], collector);
    const parsed = parse(result.tomlBlocks[0] as string) as {
      mcp_servers: {
        "fetcher-server": { transport: string; url: string; headers: string[] };
      };
    };
    expect(parsed.mcp_servers["fetcher-server"].transport).toBe("http");
    expect(parsed.mcp_servers["fetcher-server"].url).toBe(
      "https://example.com/mcp",
    );
    expect(parsed.mcp_servers["fetcher-server"].headers).toEqual([
      "Authorization=Bearer x",
    ]);
  });

  test("sse tool → dropped with codex.mcp.sse.dropped warn (T-20)", () => {
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
    const result = mapCustomToolsToCodexMcp([tool], collector);
    expect(result.tomlBlocks).toEqual([]);
    expect(result.emittedToolIds).toEqual([]);
    const warn = collector.getAll().find((d) => d.code === "codex.mcp.sse.dropped");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  test("env present → emitted as KEY=value array", () => {
    const collector = new DiagnosticCollector();
    const tool = stdioTool("envy");
    tool.mcp.server.env = { FOO: "bar", BAZ: "qux" };

    const result = mapCustomToolsToCodexMcp([tool], collector);
    const parsed = parse(result.tomlBlocks[0] as string) as {
      mcp_servers: { "envy-server": { env: string[] } };
    };
    expect(parsed.mcp_servers["envy-server"].env).toEqual([
      "FOO=bar",
      "BAZ=qux",
    ]);
  });

  test("invalid mcp → omitted, custom_tool.mcp.invalid diagnostic", () => {
    const collector = new DiagnosticCollector();
    const tool = stdioTool("bad");
    tool.mcp.server = {
      ...tool.mcp.server,
      transport: "stdio",
      command: [],
    } as typeof tool.mcp.server;

    const result = mapCustomToolsToCodexMcp([tool], collector);
    expect(result.emittedToolIds).toEqual([]);
    expect(result.tomlBlocks).toEqual([]);
    expect(collector.getAll()[0]?.code).toBe("custom_tool.mcp.invalid");
  });

  test("openCodeShortCircuit ignored silently", () => {
    const collector = new DiagnosticCollector();
    const tool = stdioTool("echo");
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "./handler.js",
    };
    const result = mapCustomToolsToCodexMcp([tool], collector);
    expect(result.emittedToolIds).toEqual(["echo"]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("duplicate server id → first wins + warn", () => {
    const collector = new DiagnosticCollector();
    const a = stdioTool("a", "shared");
    const b = stdioTool("b", "shared");
    const result = mapCustomToolsToCodexMcp([a, b], collector);
    expect(result.tomlBlocks).toHaveLength(1);
    expect(result.emittedToolIds).toEqual(["a", "b"]);
    expect(
      collector.getAll().map((d) => d.code),
    ).toContain("codex.custom_tool.duplicate_server");
  });

  test("empty input → no blocks, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const result = mapCustomToolsToCodexMcp([], collector);
    expect(result.tomlBlocks).toEqual([]);
    expect(result.emittedToolIds).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });
});
