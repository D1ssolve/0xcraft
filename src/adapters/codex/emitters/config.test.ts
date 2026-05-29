import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";
import { mergeConfig, type ZeroxCraftConfig, type PartialZeroxCraftConfig } from "../../../core/config";
import { builtinHooks, type HookSpec } from "../../../core/hooks";
import { builtinMcpServers, type McpServerSpec } from "../../../core/mcp";
import { emitCodexConfig } from "./config";

function baseConfig(overrides: PartialZeroxCraftConfig = {}): ZeroxCraftConfig {
  return mergeConfig(overrides);
}

function hooksByIds(ids: string[]): HookSpec[] {
  return builtinHooks.filter((h) => ids.includes(h.id));
}

const allEnabledMcps: McpServerSpec[] = builtinMcpServers.filter((m) => m.enabledByDefault);

describe("emitCodexConfig — features block", () => {
  test("always emits hooks and child_agents_md = true", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [],
      hooks: [],
    });
    const parsed = parse(toml) as { features: Record<string, unknown> };
    expect(parsed.features.hooks).toBe(true);
    expect(parsed.features.child_agents_md).toBe(true);
  });

  test("features block present even when no MCPs and no hooks", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [],
      hooks: [],
    });
    expect(toml).toContain("[features]");
    expect(toml).not.toContain("[mcp_servers");
    expect(toml).not.toContain("[hooks.");
    expect(toml).not.toContain("[[hooks.");
  });
});

describe("emitCodexConfig — mcp_servers", () => {
  test("emits one [mcp_servers.<name>] block per enabled MCP", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: allEnabledMcps,
      hooks: [],
    });
    const parsed = parse(toml) as { mcp_servers: Record<string, Record<string, unknown>> };
    for (const server of allEnabledMcps) {
      expect(parsed.mcp_servers[server.id]).toBeDefined();
    }
  });

  test("local MCP emits command + args", () => {
    const local: McpServerSpec = {
      id: "sequential-thinking",
      transport: "stdio",
      command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabledByDefault: true,
      description: "x",
    };
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [local],
      hooks: [],
    });
    const parsed = parse(toml) as { mcp_servers: { "sequential-thinking": Record<string, unknown> } };
    const entry = parsed.mcp_servers["sequential-thinking"];
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "@modelcontextprotocol/server-sequential-thinking"]);
  });

  test("remote MCP emits url natively (no unverified warning per ADR Rev 2)", () => {
    const remote: McpServerSpec = {
      id: "context7",
      transport: "http",
      url: "https://mcp.context7.com/mcp",
      enabledByDefault: true,
      description: "x",
    };
    const { toml, diagnostics } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [remote],
      hooks: [],
    });
    const parsed = parse(toml) as { mcp_servers: { context7: Record<string, unknown> } };
    expect(parsed.mcp_servers.context7.url).toBe("https://mcp.context7.com/mcp");
    expect(diagnostics.some((d) => d.code === "codex.mcp.remote_unverified")).toBe(false);
  });

  test("no [mcp_servers.*] blocks when MCP list is empty (but [features] still present)", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [],
      hooks: [],
    });
    expect(toml).toContain("[features]");
    expect(toml).not.toContain("[mcp_servers");
  });

  test("does NOT emit [agents.<id>] index entries (old schema dropped)", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: allEnabledMcps,
      hooks: builtinHooks,
    });
    expect(toml).not.toMatch(/\[agents\.[^\]]+\]/);
    expect(toml).not.toContain("config_file");
  });
});

describe("emitCodexConfig — hook tables NEVER appear in config.toml (Batch D)", () => {
  test("config.toml never contains [hooks.*] tables — descriptors live in hooks.json", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [],
      hooks: builtinHooks,
    });
    expect(toml).not.toContain("[hooks.");
    expect(toml).not.toContain("[[hooks.");
  });

  test("config.toml contains zero `command = ...` strings (those live in hooks.json)", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [],
      hooks: builtinHooks,
    });
    const matches = [...toml.matchAll(/^command\s*=/gm)];
    expect(matches.length).toBe(0);
  });

  test("hooks=[] and hooks=<all-builtins> produce identical config.toml", () => {
    const a = emitCodexConfig({ config: baseConfig(), mcpServers: [], hooks: [] }).toml;
    const b = emitCodexConfig({ config: baseConfig(), mcpServers: [], hooks: builtinHooks }).toml;
    expect(b).toBe(a);
  });
});

describe("emitCodexConfig — T-20 SSE drop + mcp extensions", () => {
  test("SSE MCP server dropped with codex.mcp.sse.dropped warn", () => {
    const sseServer: McpServerSpec = {
      id: "stream",
      transport: "sse",
      url: "https://example.com/sse",
      enabledByDefault: true,
      description: "x",
    };
    const result = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [sseServer],
      hooks: [],
    });
    expect(result.toml).not.toContain("[mcp_servers.stream]");
    const warn = result.diagnostics.find((d) => d.code === "codex.mcp.sse.dropped");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  test("stdio MCP gets cwd from mcpExtensions", () => {
    const stdio: McpServerSpec = {
      id: "local",
      transport: "stdio",
      command: ["node", "x.js"],
      enabledByDefault: true,
      description: "x",
    };
    const { toml } = emitCodexConfig({
      config: baseConfig({
        platforms: { codex: { mcpExtensions: { local: { cwd: "/tmp/work" } } } },
      }),
      mcpServers: [stdio],
      hooks: [],
    });
    const parsed = parse(toml) as { mcp_servers: { local: { cwd: string } } };
    expect(parsed.mcp_servers.local.cwd).toBe("/tmp/work");
  });

  test("http MCP gets bearer_token_env_var + env_http_headers from extension", () => {
    const http: McpServerSpec = {
      id: "remote",
      transport: "http",
      url: "https://api.example/mcp",
      enabledByDefault: true,
      description: "x",
    };
    const { toml } = emitCodexConfig({
      config: baseConfig({
        platforms: {
          codex: {
            mcpExtensions: {
              remote: {
                bearer_token_env_var: "API_TOKEN",
                env_http_headers: { "X-Trace": "TRACE_ID" },
              },
            },
          },
        },
      }),
      mcpServers: [http],
      hooks: [],
    });
    const parsed = parse(toml) as {
      mcp_servers: { remote: { bearer_token_env_var: string; env_http_headers: string[] } };
    };
    expect(parsed.mcp_servers.remote.bearer_token_env_var).toBe("API_TOKEN");
    expect(parsed.mcp_servers.remote.env_http_headers).toEqual(["X-Trace=TRACE_ID"]);
  });

  test("env_vars extension applies to both stdio + http", () => {
    const stdio: McpServerSpec = {
      id: "s",
      transport: "stdio",
      command: ["node"],
      enabledByDefault: true,
      description: "x",
    };
    const http: McpServerSpec = {
      id: "h",
      transport: "http",
      url: "https://x.example/mcp",
      enabledByDefault: true,
      description: "x",
    };
    const { toml } = emitCodexConfig({
      config: baseConfig({
        platforms: {
          codex: {
            mcpExtensions: {
              s: { env_vars: ["HOME"] },
              h: { env_vars: ["PATH", "HOME"] },
            },
          },
        },
      }),
      mcpServers: [stdio, http],
      hooks: [],
    });
    const parsed = parse(toml) as {
      mcp_servers: { s: { env_vars: string[] }; h: { env_vars: string[] } };
    };
    expect(parsed.mcp_servers.s.env_vars).toEqual(["HOME"]);
    expect(parsed.mcp_servers.h.env_vars).toEqual(["PATH", "HOME"]);
  });

  test("T-20 secret redaction: SSE-drop diagnostic does not leak headers/env", () => {
    const sseServer: McpServerSpec = {
      id: "stream",
      transport: "sse",
      url: "https://example.com/sse",
      enabledByDefault: true,
      description: "x",
      headers: { Authorization: "Bearer SECRET_TOKEN_VALUE" },
      env: { SECRET_API_KEY: "secret-value-zzz" },
    };
    const { diagnostics } = emitCodexConfig({
      config: baseConfig(),
      mcpServers: [sseServer],
      hooks: [],
    });
    const blob = JSON.stringify(diagnostics);
    expect(blob.includes("SECRET_TOKEN_VALUE")).toBe(false);
    expect(blob.includes("secret-value-zzz")).toBe(false);
  });
});

describe("emitCodexConfig — T-23 [permissions.<name>] beta gating", () => {
  test("does NOT emit [permissions.*] when permissionsBeta is false (default)", () => {
    const { toml, diagnostics } = emitCodexConfig({
      config: baseConfig({
        platforms: {
          codex: {
            permissionProfiles: {
              strict: { sandbox_mode: "read-only", approval_policy: "on-request" },
            },
          },
        },
      }),
      mcpServers: [],
      hooks: [],
    });
    expect(toml.includes("[permissions.strict]")).toBe(false);
    const info = diagnostics.find((d) => d.code === "codex.permissions.beta.disabled");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
  });

  test("emits [permissions.<name>] blocks sorted by name when permissionsBeta is true", () => {
    const { toml } = emitCodexConfig({
      config: baseConfig({
        platforms: {
          codex: {
            permissionsBeta: true,
            permissionProfiles: {
              zzz: { sandbox_mode: "danger-full-access" },
              aaa: { sandbox_mode: "read-only", approval_policy: "never" },
              mmm: { approval_policy: "untrusted" },
            },
          },
        },
      }),
      mcpServers: [],
      hooks: [],
    });
    const parsed = parse(toml) as {
      permissions: { aaa: object; mmm: object; zzz: object };
    };
    expect(Object.keys(parsed.permissions)).toEqual(["aaa", "mmm", "zzz"]);
    // Defensive: assert ordering in raw text too.
    const aIdx = toml.indexOf("[permissions.aaa]");
    const mIdx = toml.indexOf("[permissions.mmm]");
    const zIdx = toml.indexOf("[permissions.zzz]");
    expect(aIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });

  test("approval_policy='on-failure' rejected with error diagnostic even if schema bypassed", () => {
    const { toml, diagnostics } = emitCodexConfig({
      config: baseConfig({
        platforms: {
          codex: {
            permissionsBeta: true,
            permissionProfiles: {
              // Cast around the schema to simulate a future relaxation.
              bad: { approval_policy: "on-failure" as unknown as "never" },
            },
          },
        },
      }),
      mcpServers: [],
      hooks: [],
    });
    expect(toml.includes("on-failure")).toBe(false);
    const err = diagnostics.find((d) => d.code === "codex.permissions.approval_policy.invalid");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
  });
});
