import { describe, expect, test } from "bun:test";

import { DiagnosticCollector } from "./diagnostic-collector";
import {
  validateCustomToolMcp,
  CUSTOM_TOOL_MCP_INVALID_CODE,
} from "./custom-tool-validation";
import type { CustomToolSpec } from "../../core/mcp/custom-tool-spec";
import type { McpServerSpec } from "../../core/mcp/mcp-types";

function stdioTool(overrides: Partial<CustomToolSpec> = {}): CustomToolSpec {
  return {
    id: "echo",
    description: "echo tool",
    mcp: {
      toolName: "echo",
      server: {
        id: "echo-server",
        description: "echo MCP",
        enabledByDefault: true,
        transport: "stdio",
        command: ["node", "echo.mjs"],
      },
    },
    ...overrides,
  };
}

describe("validateCustomToolMcp", () => {
  test("valid stdio spec → true, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    expect(validateCustomToolMcp(stdioTool(), collector)).toBe(true);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("valid http spec → true", () => {
    const collector = new DiagnosticCollector();
    const spec: CustomToolSpec = {
      id: "fetcher",
      description: "fetch",
      mcp: {
        toolName: "fetch",
        server: {
          id: "fetch-server",
          description: "fetch MCP",
          enabledByDefault: true,
          transport: "http",
          url: "https://example.com/mcp",
        },
      },
    };
    expect(validateCustomToolMcp(spec, collector)).toBe(true);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("valid sse spec → true", () => {
    const collector = new DiagnosticCollector();
    const spec: CustomToolSpec = {
      id: "stream",
      description: "stream",
      mcp: {
        toolName: "stream",
        server: {
          id: "stream-server",
          description: "stream MCP",
          enabledByDefault: true,
          transport: "sse",
          url: "https://example.com/sse",
        },
      },
    };
    expect(validateCustomToolMcp(spec, collector)).toBe(true);
    expect(collector.getAll()).toHaveLength(0);
  });

  test("missing toolName → warn", () => {
    const collector = new DiagnosticCollector();
    const spec = stdioTool();
    spec.mcp.toolName = "";
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    const diags = collector.getAll();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe(CUSTOM_TOOL_MCP_INVALID_CODE);
    expect(diags[0]?.severity).toBe("warn");
  });

  test("stdio with empty command → warn", () => {
    const collector = new DiagnosticCollector();
    const spec = stdioTool();
    spec.mcp.server = {
      ...spec.mcp.server,
      transport: "stdio",
      command: [],
    } as typeof spec.mcp.server;
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    expect(collector.getAll()).toHaveLength(1);
  });

  test("http without url → warn", () => {
    const collector = new DiagnosticCollector();
    const spec: CustomToolSpec = {
      id: "broken",
      description: "broken",
      mcp: {
        toolName: "broken",
        // @ts-expect-error - intentional invalid
        server: {
          id: "broken",
          description: "x",
          enabledByDefault: true,
          transport: "http",
        },
      },
    };
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    const diags = collector.getAll();
    expect(diags[0]?.code).toBe(CUSTOM_TOOL_MCP_INVALID_CODE);
  });

  test("http with malformed url → warn", () => {
    const collector = new DiagnosticCollector();
    const spec: CustomToolSpec = {
      id: "bad-url",
      description: "x",
      mcp: {
        toolName: "x",
        server: {
          id: "bad",
          description: "x",
          enabledByDefault: true,
          transport: "http",
          url: "not-a-url",
        },
      },
    };
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    expect(collector.getAll()).toHaveLength(1);
  });

  test("unknown transport → warn", () => {
    const collector = new DiagnosticCollector();
    const spec: CustomToolSpec = {
      id: "weird",
      description: "x",
      mcp: {
        toolName: "x",
        server: {
          id: "weird",
          description: "x",
          enabledByDefault: true,
          transport: "websocket",
          url: "https://example.com",
        } as unknown as McpServerSpec,
      },
    };
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    expect(collector.getAll()).toHaveLength(1);
  });

  test("missing mcp block → warn", () => {
    const collector = new DiagnosticCollector();
    // @ts-expect-error - intentional invalid
    const spec: CustomToolSpec = { id: "no-mcp", description: "x" };
    expect(validateCustomToolMcp(spec, collector)).toBe(false);
    expect(collector.getAll()).toHaveLength(1);
  });
});
