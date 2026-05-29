import { describe, expect, test } from "bun:test";
import { mergeConfig } from "../../../core/config";
import type { McpServerSpec } from "../../../core/mcp";
import { mapMcpServersToOpencode, selectEnabledMcpServers, specToOpencodeMcp } from "./mcp";

const builtins: McpServerSpec[] = [
  {
    id: "always-on",
    description: "Always on",
    enabledByDefault: true,
    transport: "stdio",
    command: ["node", "server.js"],
    env: { NODE_ENV: "test" },
  },
  {
    id: "opt-in",
    description: "Opt in",
    enabledByDefault: false,
    transport: "http",
    url: "https://example.test/mcp",
  },
];

describe("OpenCode MCP mapper", () => {
  test("stdio maps to local entry", () => {
    expect(specToOpencodeMcp(builtins[0]!)).toEqual({
      type: "local",
      command: ["node", "server.js"],
      environment: { NODE_ENV: "test" },
    });
  });

  test("http maps to remote entry", () => {
    expect(
      specToOpencodeMcp({
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer token" },
      }),
    ).toEqual({
      type: "remote",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer token" },
    });
  });

  test("sse maps to remote entry preserving existing behavior", () => {
    expect(
      specToOpencodeMcp({
        transport: "sse",
        url: "https://example.test/sse",
      }),
    ).toEqual({ type: "remote", url: "https://example.test/sse" });
  });

  test("missing required fields return null", () => {
    expect(specToOpencodeMcp({ transport: "stdio" } as never)).toBeNull();
    expect(specToOpencodeMcp({ transport: "http" } as never)).toBeNull();
    expect(specToOpencodeMcp({ transport: "sse" } as never)).toBeNull();
  });

  test("built-ins filter by enabledByDefault plus user config", () => {
    const selected = selectEnabledMcpServers(
      builtins,
      mergeConfig({ mcpServers: { "opt-in": { transport: "http", url: "https://example.test/mcp" } } }),
    );

    expect(selected.map((server) => server.id)).toEqual(["always-on", "opt-in"]);
  });

  test("aggregates built-ins and user mcpServers with user entries overriding", () => {
    expect(
      mapMcpServersToOpencode({
        builtins,
        config: mergeConfig({
          mcpServers: {
            "always-on": { transport: "http", url: "https://override.test/mcp" },
            custom: { transport: "stdio", command: ["uvx", "custom-server"] },
          },
        }),
      }),
    ).toEqual({
      "always-on": { type: "remote", url: "https://override.test/mcp" },
      custom: { type: "local", command: ["uvx", "custom-server"] },
    });
  });

  test("skill-embedded MCPs are not auto-registered", () => {
    expect(
      mapMcpServersToOpencode({
        builtins,
        config: mergeConfig({ enabled: { skills: ["nlm-skill"] } }),
      })["notebooklm-mcp"],
    ).toBeUndefined();
  });
});
