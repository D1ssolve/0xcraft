import { describe, expect, test } from "bun:test";

import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { CustomToolSpec } from "../../../core/mcp/custom-tool-spec";

import { bridgeCustomTools } from "./custom-tool-bridge";

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

const okResolver = (s: string): string => `/abs/resolved/${s}`;
const failResolver = (s: string): string => {
  throw new Error(`Cannot find module '${s}'`);
};

describe("bridgeCustomTools", () => {
  test("valid stdio tool → MCP descriptor only (no short-circuit field)", () => {
    const collector = new DiagnosticCollector();
    const result = bridgeCustomTools([stdio("echo")], collector, {
      resolveHandler: okResolver,
    });

    expect(result.emittedToolIds).toEqual(["echo"]);
    expect(result.mcpServers["echo-server"]).toEqual({
      type: "local",
      command: ["node", "echo.mjs"],
    });
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("http tool → remote descriptor with headers", () => {
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
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });
    expect(result.mcpServers["fetcher-server"]).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  test("sse tool → remote descriptor", () => {
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
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });
    expect(result.mcpServers["stream-server"]).toEqual({
      type: "remote",
      url: "https://example.com/sse",
    });
  });

  test("env forwarded as environment field on local descriptor", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("envy");
    tool.mcp.server.env = { FOO: "bar" };
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });
    expect(result.mcpServers["envy-server"]).toEqual({
      type: "local",
      command: ["node", "envy.mjs"],
      environment: { FOO: "bar" },
    });
  });

  test("invalid mcp → omitted from BOTH surfaces, custom_tool.mcp.invalid", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("bad");
    tool.mcp.server = {
      ...tool.mcp.server,
      transport: "stdio",
      command: [],
    } as typeof tool.mcp.server;

    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });
    expect(result.emittedToolIds).toEqual([]);
    expect(Object.keys(result.mcpServers)).toEqual([]);
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()[0]?.code).toBe("custom_tool.mcp.invalid");
  });

  test("short-circuit enabled + handler resolvable → MCP + in-process plan", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "./handler.js",
    };
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });

    expect(result.mcpServers["echo-server"]).toBeDefined();
    expect(result.inProcessPlans).toEqual([
      {
        toolId: "echo",
        handlerModule: "./handler.js",
        resolvedHandlerModule: "/abs/resolved/./handler.js",
      },
    ]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("short-circuit enabled but handler missing → MCP still emitted, custom_tool.short_circuit.missing", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "./nope.js",
    };
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: failResolver,
    });

    // MCP still emitted — invariant.
    expect(result.mcpServers["echo-server"]).toBeDefined();
    expect(result.emittedToolIds).toEqual(["echo"]);
    // In-process plan dropped.
    expect(result.inProcessPlans).toEqual([]);
    const diags = collector.getAll();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("custom_tool.short_circuit.missing");
    expect(diags[0]?.severity).toBe("warn");
  });

  test("short-circuit enabled but handler empty string → custom_tool.short_circuit.missing", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "",
    };
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: okResolver,
    });

    expect(result.mcpServers["echo-server"]).toBeDefined();
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()[0]?.code).toBe("custom_tool.short_circuit.missing");
  });

  test("short-circuit enabled=false → silently ignored, MCP only", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    tool.openCodeShortCircuit = {
      enabled: false,
      handlerModule: "./handler.js",
    };
    const result = bridgeCustomTools([tool], collector, {
      resolveHandler: failResolver,
    });

    expect(result.mcpServers["echo-server"]).toBeDefined();
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("no short-circuit field → MCP only, no plans, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const result = bridgeCustomTools([stdio("echo")], collector, {
      resolveHandler: failResolver,
    });
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("duplicate server id → first wins; warn for second; both still emit in-process plans", () => {
    const collector = new DiagnosticCollector();
    const a = stdio("a", "shared");
    const b = stdio("b", "shared");
    a.openCodeShortCircuit = { enabled: true, handlerModule: "./a.js" };
    b.openCodeShortCircuit = { enabled: true, handlerModule: "./b.js" };

    const result = bridgeCustomTools([a, b], collector, {
      resolveHandler: okResolver,
    });

    // Only first server descriptor retained.
    expect(Object.keys(result.mcpServers)).toEqual(["shared"]);
    expect(
      (result.mcpServers["shared"] as { command: string[] }).command,
    ).toEqual(["node", "a.mjs"]);

    // Both tools recorded as emitted (MCP coverage is via the shared server).
    expect(result.emittedToolIds).toEqual(["a", "b"]);
    // Both short-circuits planned.
    expect(result.inProcessPlans.map((p) => p.toolId)).toEqual(["a", "b"]);

    const codes = collector.getAll().map((d) => d.code);
    expect(codes).toContain("opencode.custom_tool.duplicate_server");
  });

  test("empty input → empty result, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const result = bridgeCustomTools([], collector, {
      resolveHandler: okResolver,
    });
    expect(result.emittedToolIds).toEqual([]);
    expect(Object.keys(result.mcpServers)).toEqual([]);
    expect(result.inProcessPlans).toEqual([]);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("default resolver path — uses Node require.resolve (smoke)", () => {
    const collector = new DiagnosticCollector();
    const tool = stdio("echo");
    // Resolve a known builtin module — guaranteed to succeed regardless of cwd.
    tool.openCodeShortCircuit = {
      enabled: true,
      handlerModule: "node:path",
    };
    const result = bridgeCustomTools([tool], collector);
    expect(result.inProcessPlans).toHaveLength(1);
    expect(result.inProcessPlans[0]?.handlerModule).toBe("node:path");
    expect(collector.getAll()).toHaveLength(0);
  });
});
