import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  AgentIR,
  CodexAgentMeta,
  CommandIR,
  HookIR,
  McpServerIR,
  PermissionIR,
  SkillIR,
} from "./index";

describe("v3 IR schemas", () => {
  test("parses a valid agent fixture", () => {
    expect(() => AgentIR.parse(validAgentFixture())).not.toThrow();
  });

  test("parses a valid skill fixture", () => {
    expect(() => SkillIR.parse(validSkillFixture())).not.toThrow();
  });

  test("parses a valid hook fixture", () => {
    expect(() => HookIR.parse(validHookFixture())).not.toThrow();
  });

  test("rejects hook fixture with empty actions", () => {
    const result = HookIR.safeParse({
      ...validHookFixture(),
      common: { ...validHookFixture().common, actions: [] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "too_small",
          path: ["common", "actions"],
        }),
      );
    }
  });

  test("rejects hook fixture with event outside the hook event union", () => {
    const result = HookIR.safeParse({
      ...validHookFixture(),
      common: { ...validHookFixture().common, events: ["tool-call.before"] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid_value",
          path: ["common", "events", 0],
        }),
      );
    }
  });

  test("rejects hook fixture with more than 32 actions", () => {
    const result = HookIR.safeParse({
      ...validHookFixture(),
      common: {
        ...validHookFixture().common,
        actions: Array.from({ length: 33 }, () => ({ type: "run_command", command: "printf ok" })),
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "too_big",
          path: ["common", "actions"],
        }),
      );
    }
  });

  test("accepts hook fixture with runtimeFiles.opencodeJs path", () => {
    const result = HookIR.safeParse({
      ...validHookFixture(),
      runtimeFiles: { opencodeJs: "hooks/audit-tools/hook.opencode.js" },
    });

    expect(result.success).toBe(true);
  });

  test("rejects unknown runtimeFiles fields", () => {
    const result = HookIR.safeParse({
      ...validHookFixture(),
      runtimeFiles: { opencodeJs: "hooks/audit-tools/hook.opencode.js", unknown: true },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "unrecognized_keys",
          path: ["runtimeFiles"],
        }),
      );
    }
  });

  test("parses a valid MCP server fixture", () => {
    expect(() => McpServerIR.parse(validMcpFixture())).not.toThrow();
  });

  test("parses a valid command fixture", () => {
    expect(() => CommandIR.parse(validCommandFixture())).not.toThrow();
  });

  test("parses a valid permission fixture", () => {
    expect(() => PermissionIR.parse(validPermissionFixture())).not.toThrow();
  });

  test("rejects a missing required field with invalid_type", () => {
    const result = AgentIR.safeParse({ ...validAgentFixture(), common: { name: "Explorer" } });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid_type",
          path: ["common", "description"],
        }),
      );
    }
  });

  test("rejects unknown keys because schemas are strict", () => {
    const result = SkillIR.safeParse({ ...validSkillFixture(), unknown: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "unrecognized_keys",
        }),
      );
    }
  });

  test("Codex agent approval_policy rejects on-failure", () => {
    expect(() => CodexAgentMeta.parse({ approval_policy: "on-request" })).not.toThrow();
    expect(() => CodexAgentMeta.parse({ approval_policy: { mode: "ask", writes: "allow" } })).not.toThrow();
    expect(() => CodexAgentMeta.parse({ approval_policy: "on-failure" })).toThrow(z.ZodError);
  });
});

function validAgentFixture() {
  return {
    id: "code-explorer",
    kind: "agent",
    sourcePath: "agents/code-explorer/AGENT.md",
    common: {
      name: "Code Explorer",
      description: "Explore code safely.",
      tags: ["code"],
      role: "subagent",
      model: "inherit",
      temperature: 0.2,
      maxTurns: 8,
      memory: { scope: "project" },
      permissions: validPermissionFixture(),
      mcpServers: ["filesystem"],
      prompt: "Inspect the codebase and report findings.",
    },
    platform: {
      opencode: { enabled: true, mode: "subagent", tools: { read: true } },
      claude: {
        name: "Code Explorer",
        description: "Explore code safely.",
        model: "sonnet",
        effort: "medium",
        maxTurns: 8,
        tools: ["Read", "Grep"],
        disallowedTools: ["Edit"],
        skills: ["code-review"],
        memory: "project",
        background: false,
        isolation: "worktree",
        ["permission" + "Mode"]: "plan",
        hooks: { before_tool: [] },
        mcpServers: ["filesystem"],
        color: "blue",
        initialPrompt: "Start with repository map.",
        plugin: { displayName: "0xcraft" },
      },
      codex: {
        name: "Code Explorer",
        description: "Explore code safely.",
        developer_instructions: "Inspect the codebase and report findings.",
        nickname_candidates: ["explorer"],
        model: "gpt-5.5",
        model_reasoning_effort: "high",
        sandbox_mode: "workspace-write",
        mcp_servers: { filesystem: { command: "mcp-server" } },
        skills: { config: { code_review: true } },
        approval_policy: "on-request",
        permissionProfiles: { safe: { approval_policy: "never" } },
      },
    },
    diagnostics: [],
    provenance: { importedFrom: "opencode", sourceFiles: ["agents/code-explorer/AGENT.md"] },
    _sources: { "common.prompt": "agents/code-explorer/AGENT.md" },
  };
}

function validSkillFixture() {
  return {
    id: "code-review",
    kind: "skill",
    sourcePath: "skills/code-review/SKILL.md",
    common: {
      name: "Code Review",
      description: "Review code changes.",
      tags: ["review"],
      autoload: false,
      "allowed-tools": ["Read"],
      "disallowed-tools": ["Write"],
      mcpServers: ["filesystem"],
      body: "Review code for defects.",
    },
    platform: {
      opencode: { enabled: true, autoload: false, experimental: { preload: false } },
      claude: {
        name: "Code Review",
        description: "Review code changes.",
        when_to_use: "Use before merging.",
        "argument-hint": "diff path",
        arguments: { path: "string" },
        "disable-model-invocation": false,
        "user-invocable": true,
        "allowed-tools": ["Read"],
        "disallowed-tools": ["Write"],
        model: "sonnet",
        effort: "low",
        context: "fork",
        agent: "code-explorer",
        hooks: { before_tool: [] },
        paths: ["src"],
        shell: "bash",
      },
      codex: {
        enabled: true,
        autoload: false,
        skills: { config: { code_review: true } },
        cwd: ".",
        env_vars: { NODE_ENV: "test" },
        bearer_token_env_var: "TOKEN",
        env_http_headers: { Authorization: "TOKEN" },
      },
    },
    _sources: { "common.body": "skills/code-review/SKILL.md" },
  };
}

function validHookFixture() {
  return {
    id: "audit-tools",
    kind: "hook",
    sourcePath: "hooks/audit-tools/HOOK.md",
    common: {
      name: "Audit Tools",
      description: "Audit tool calls.",
      enabled: true,
      events: ["PreToolUse"],
      runtime: "portable",
      actions: [{ type: "run_command", command: "printf ok" }],
      modifiers: [{ type: "timeout", timeoutMs: 1000 }],
      timeoutMs: 1000,
    },
    platform: {
      opencode: { factory: "createAuditToolsHook", jsFile: "hook.opencode.js" },
      claude: { matcher: "Write", command: "printf ok" },
      codex: { event: "pre_tool", command: "printf ok" },
    },
    runtimeFiles: { opencodeJs: "hooks/audit-tools/hook.opencode.js" },
    _sources: { "common.actions": "hooks/audit-tools/HOOK.md" },
  };
}

function validMcpFixture() {
  return {
    id: "filesystem",
    kind: "mcp",
    sourcePath: "mcp/filesystem/MCP.md",
    common: {
      name: "Filesystem",
      description: "Filesystem MCP.",
      transport: "stdio",
      command: "mcp-server-filesystem",
      args: ["."],
      env: { LOG_LEVEL: "info" },
      headers: { "X-Test": "yes" },
      enabled: true,
      wrapper: "wrapped",
    },
    mcpEnvelope: { sourceShape: "wrapped", emitShape: "platform-default", wrapperKey: "mcpServers" },
    platform: {
      opencode: { npm: "@modelcontextprotocol/server-filesystem" },
      claude: { wrapper: "mcpServers" },
      codex: { wrapper: "mcp_servers", cwd: "." },
    },
    _sources: { common: "mcp/filesystem/MCP.md" },
  };
}

function validCommandFixture() {
  return {
    id: "explain-code",
    kind: "command",
    sourcePath: "commands/explain-code/COMMAND.md",
    common: {
      name: "Explain Code",
      description: "Explain selected code.",
      agent: "code-explorer",
      model: "inherit",
      arguments: [{ name: "path", description: "File path", required: true }],
      template: "Explain {path}.",
    },
    platform: {
      opencode: { slash: "/explain-code" },
      claude: { namespace: "0xcraft" },
      codex: { promptFile: "explain-code.md" },
    },
    _sources: { "common.template": "commands/explain-code/COMMAND.md" },
  };
}

function validPermissionFixture() {
  return {
    default: "ask",
    tools: { Read: "allow", Write: "ask" },
    bash: { allow: ["ls"], ask: ["bun test"], deny: ["rm -rf /"] },
    sandbox: "workspace-write",
    platform: {
      opencode: { edit: "ask" },
      claude: { ["permission" + "Mode"]: "plan" },
      codex: { approval_policy: "on-request", permissions: { write: "ask" }, profiles: { safe: {} } },
    },
    _sources: { default: "agent.codex.toml" },
  };
}
