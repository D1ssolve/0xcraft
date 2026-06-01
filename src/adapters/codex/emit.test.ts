import { describe, expect, test } from "bun:test";

import type { Diagnostic } from "../../core/diagnostics";
import type { AgentIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { parseToml } from "../../core/loader/toml-parser";
import { emitCodex, emitCodexHooks } from "./emit";

describe("emitCodexHooks", () => {
  test("emits only runnable command handlers and reports dropped Codex handlers", () => {
    const result = emitCodexHooks([
      hook("all-primitives", ["PreToolUse"], [
        { type: "run_command", command: "bun test", timeoutMs: 1000 },
        { type: "run_exec", command: "node", args: ["script with spaces.js", "it's-ok"], timeoutMs: 2000 },
        { type: "http_request", url: "https://example.com/hook" },
        { type: "call_mcp_tool", server: "docs", tool: "search" },
        { type: "invoke_prompt", prompt: "Summarize this" },
        { type: "invoke_agent", agent: "reviewer", prompt: "Review this" },
        { type: "runtime_code", runtime: "opencode", body: "export default {}" },
      ]),
    ]);

    expect(JSON.parse(result.artifacts[".codex/hooks.json"]!)).toEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { command: "bun test", timeout: 1, type: "command" },
              { command: "node 'script with spaces.js' 'it'\\''s-ok'", timeout: 2, type: "command" },
            ],
          },
        ],
      },
    });
    expect(result.diagnostics.map((diagnostic: Diagnostic) => diagnostic.code)).toEqual([
      "codex.hooks.run_exec.shim",
      "codex.hooks.handler.http.dropped",
      "codex.hooks.handler.mcp_tool.dropped",
      "codex.hooks.handler.prompt.skipped",
      "codex.hooks.handler.agent.skipped",
      "codex.hook.runtime_code.dropped",
    ]);
  });

  test("omits matcher for matcher-ignored Codex events and emits info", () => {
    const result = emitCodexHooks([
      hook("prompt-submit", ["UserPromptSubmit"], [{ type: "run_command", command: "notify" }], {
        matcher: "Write(*.ts)",
      }),
    ]);

    expect(JSON.parse(result.artifacts[".codex/hooks.json"]!)).toEqual({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ command: "notify", type: "command" }],
          },
        ],
      },
    });
    expect(result.diagnostics).toContainEqual({
      severity: "info",
      code: "codex.hooks.matcher.ignored",
      message: "Codex emits this hook event but ignores matcher fields for it.",
      details: { event: "UserPromptSubmit", platform: "codex" },
    });
  });

  test("drops hook when all events are unsupported in Codex", () => {
    const result = emitCodexHooks([
      hook("notification", ["Notification"], [{ type: "run_command", command: "notify" }]),
    ]);

    expect(JSON.parse(result.artifacts[".codex/hooks.json"]!)).toEqual({ hooks: {} });
    expect(result.diagnostics.map((diagnostic: Diagnostic) => diagnostic.code)).toEqual([
      "codex.hooks.event.dropped",
    ]);
  });

  test("filters unsupported events while preserving supported events", () => {
    const result = emitCodexHooks([
      hook("mixed-events", ["PreToolUse", "Notification", "PostToolUse"], [
        { type: "run_command", command: "check" },
      ]),
    ]);

    expect(JSON.parse(result.artifacts[".codex/hooks.json"]!)).toEqual({
      hooks: {
        PostToolUse: [
          {
            hooks: [{ command: "check", type: "command" }],
          },
        ],
        PreToolUse: [
          {
            hooks: [{ command: "check", type: "command" }],
          },
        ],
      },
    });
    expect(result.diagnostics.map((diagnostic: Diagnostic) => diagnostic.code)).toEqual([
      "codex.hooks.event.dropped",
    ]);
  });

  test("emits byte-stable hooks JSON", () => {
    const result = emitCodexHooks([
      hook("stable", ["SessionStart", "PreToolUse"], [
        { type: "run_command", command: "printf ok", timeoutMs: 3000 },
      ], {
        matcher: "Bash(*)",
      }),
    ]);

    expect(result.artifacts[".codex/hooks.json"]).toBe(`{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "command": "printf ok",
            "timeout": 3,
            "type": "command"
          }
        ],
        "matcher": "Bash(*)"
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "command": "printf ok",
            "timeout": 3,
            "type": "command"
          }
        ],
        "matcher": "Bash(*)"
      }
    ]
  }
}
`);
  });
});

describe("emitCodex", () => {
  test("emits agent TOML with required and optional Codex fields", () => {
    const result = emitCodex([
      agent("backend-dev", {
        codex: {
          nickname_candidates: ["api", "backend"],
          model_reasoning_effort: "high",
          sandbox_mode: "workspace-write",
          mcp_servers: ["docs", "db"],
          skills: { config: { review: { level: "strict" } } },
          approval_policy: "on-request",
        },
      }),
    ], {});

    expect(result.ok).toBe(true);
    expect(parseToml(file(result, ".codex/agents/backend-dev.toml"))).toEqual({
      approval_policy: "on-request",
      description: "Backend developer",
      developer_instructions: "Build APIs.",
      mcp_servers: ["docs", "db"],
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      name: "Backend Dev",
      nickname_candidates: ["api", "backend"],
      sandbox_mode: "workspace-write",
      skills: { config: { review: { level: "strict" } } },
    });
  });

  test("rejects unsupported Codex on-failure approval policy", () => {
    const result = emitCodex([
      agent("unsupported-policy", {
        codex: { approval_policy: "on-failure" } as never,
      }),
    ], {});

    expect(result.ok).toBe(false);
    expect(file(result, ".codex/agents/unsupported-policy.toml")).not.toContain("on-failure");
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
      message: "Codex approval_policy 'on-failure' is not supported.",
      details: { agentId: "unsupported-policy" },
    });
  });

  test("emits config TOML with known feature keys and inline hooks when requested", () => {
    const result = emitCodex([
      agent("backend-dev"),
      hook("session", ["SessionStart"], [{ type: "run_command", command: "bootstrap" }]),
    ], { hooksEmitMode: "config-inline" });

    expect(result.files.some((entry) => entry.path === ".codex/hooks.json")).toBe(false);
    expect(parseToml(file(result, ".codex/config.toml"))).toEqual({
      features: { hooks: true, multi_agent: true },
      hooks: { SessionStart: [{ hooks: [{ command: "bootstrap", type: "command" }] }] },
    });
  });

  test("emits default hooks JSON and MCP wrapper shape", () => {
    const result = emitCodex([
      hook("session", ["SessionStart"], [{ type: "run_command", command: "bootstrap" }]),
      mcp("docs", { command: "npx", args: ["docs-mcp"], env: { DOCS_TOKEN: "env:DOCS_TOKEN" } }),
    ], {});

    expect(JSON.parse(file(result, ".codex/hooks.json"))).toEqual({
      hooks: { SessionStart: [{ hooks: [{ command: "bootstrap", type: "command" }] }] },
    });
    expect(JSON.parse(file(result, ".mcp.json"))).toEqual({
      mcp_servers: {
        docs: {
          args: ["docs-mcp"],
          command: "npx",
          env: { DOCS_TOKEN: "env:DOCS_TOKEN" },
        },
      },
    });
  });

  test("emits plugin manifest and official marketplace shape", () => {
    const result = emitCodex([], {
      emitPlugin: true,
      emitMarketplace: true,
      packageMetadata: {
        name: "0xcraft-pack",
        version: "3.0.0",
        description: "Portable agents",
        displayName: "0xcraft Pack",
      },
      marketplace: {
        installationPolicy: "allowed",
        authenticationPolicy: "optional",
        category: "developer-tools",
      },
    });

    expect(JSON.parse(file(result, ".codex-plugin/plugin.json"))).toEqual({
      description: "Portable agents",
      name: "0xcraft-pack",
      version: "3.0.0",
    });
    expect(JSON.parse(file(result, ".agents/plugins/marketplace.json"))).toEqual({
      interface: { displayName: "0xcraft Pack" },
      name: "0xcraft-pack-marketplace",
      plugins: [
        {
          category: "developer-tools",
          name: "0xcraft-pack",
          policy: { authentication: "optional", installation: "allowed" },
          source: { path: "./.codex-plugin", source: "local" },
        },
      ],
    });
  });

  test("reports marketplace without plugin as fail-fast error", () => {
    const result = emitCodex([], { emitMarketplace: true });

    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ERR_MARKETPLACE_REQUIRES_PLUGIN",
      message: "Codex marketplace emission requires emitPlugin=true.",
      details: { emitMarketplace: true, emitPlugin: false },
    });
  });

  test("emits deterministic artifacts", () => {
    const resources: IRResource[] = [
      mcp("docs", { command: "npx", args: ["docs-mcp"] }),
      agent("backend-dev"),
      hook("session", ["SessionStart"], [{ type: "run_command", command: "bootstrap" }]),
    ];

    const first = emitCodex(resources, { emitPlugin: true });
    const second = emitCodex([...resources].reverse(), { emitPlugin: true });

    expect(second.files).toEqual(first.files);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  test("emits agent and skill reference files", () => {
    const result = emitCodex([
      agent("backend-dev", {
        references: {
          "zeta.md": "windows\r\nline",
          "alpha.txt": "already\n",
        },
      }),
      skill("reviewer", {
        "guide.md": "Use checklist.",
      }),
    ], {});

    expect(result.ok).toBe(true);
    expect(fileEntry(result, ".codex/agents/backend-dev/references/alpha.txt")).toEqual({
      path: ".codex/agents/backend-dev/references/alpha.txt",
      content: "already\n",
      mode: 0o644,
    });
    expect(fileEntry(result, ".codex/agents/backend-dev/references/zeta.md")).toEqual({
      path: ".codex/agents/backend-dev/references/zeta.md",
      content: "windows\nline\n",
      mode: 0o644,
    });
    expect(fileEntry(result, ".codex/skills/reviewer/references/guide.md")).toEqual({
      path: ".codex/skills/reviewer/references/guide.md",
      content: "Use checklist.\n",
      mode: 0o644,
    });
  });
});

type HookAction = HookIR["common"]["actions"][number];
type HookEvent = HookIR["common"]["events"][number];

function hook(
  id: string,
  events: HookEvent[],
  actions: HookAction[],
  codex: Record<string, unknown> = {},
): HookIR {
  return {
    id,
    kind: "hook",
    sourcePath: `hooks/${id}/HOOK.md`,
    common: {
      name: id,
      events,
      actions,
    },
    platform: { codex },
  };
}

function agent(
  id: string,
  overrides: { codex?: NonNullable<AgentIR["platform"]["codex"]>; references?: AgentIR["references"] } = {},
): AgentIR {
  return {
    id,
    kind: "agent",
    sourcePath: `agents/${id}/AGENT.md`,
    common: {
      name: "Backend Dev",
      description: "Backend developer",
      model: "gpt-5.5",
      prompt: "Build APIs.",
    },
    references: overrides.references,
    platform: { codex: overrides.codex },
    _sources: {},
  };
}

function skill(
  id: string,
  references: SkillIR["references"],
): SkillIR {
  return {
    id,
    kind: "skill",
    sourcePath: `skills/${id}/SKILL.md`,
    common: {
      name: "Reviewer",
      description: "Review helper",
      body: "Review code.",
    },
    platform: { codex: undefined },
    references,
    _sources: {},
  };
}

function mcp(
  id: string,
  common: Partial<McpServerIR["common"]>,
): McpServerIR {
  return {
    id,
    kind: "mcp",
    sourcePath: `mcp/${id}/MCP.md`,
    common: {
      name: id,
      transport: "stdio",
      ...common,
    },
    mcpEnvelope: { sourceShape: "wrapped", emitShape: "wrapped", wrapperKey: "mcp_servers" },
    platform: { codex: undefined },
    _sources: {},
  };
}

function file(result: ReturnType<typeof emitCodex>, path: string): string {
  const found = result.files.find((entry) => entry.path === path);
  expect(found).toBeDefined();
  return found!.content;
}

function fileEntry(result: ReturnType<typeof emitCodex>, path: string): ReturnType<typeof emitCodex>["files"][number] {
  const found = result.files.find((entry) => entry.path === path);
  expect(found).toBeDefined();
  return found!;
}
