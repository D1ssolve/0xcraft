import { describe, expect, test } from "bun:test";

import type { AgentIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { emitClaude, emitClaudeHooks } from "./emit";

describe("emitClaudeHooks", () => {
  test("emits byte-stable Claude hooks.json using documented event-keyed shape", () => {
    const result = emitClaudeHooks([
      hookFixture({
        id: "audit-tools",
        events: ["PreToolUse", "SessionStart"],
        matcher: "Bash(*)",
        actions: [
          { type: "run_command", command: "printf ok", shell: "bash", timeoutMs: 1_000 },
          { type: "http_request", url: "https://example.com/hook", headers: { "X-Test": "yes" }, allowedEnvVars: ["TOKEN"] },
        ],
      }),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.artifacts)).toEqual([".claude-plugin/hooks/hooks.json"]);
    expect(result.artifacts[".claude-plugin/hooks/hooks.json"]).toBe(`{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "command": "printf ok",
            "shell": "bash",
            "timeout": 1000,
            "type": "command"
          },
          {
            "allowedEnvVars": [
              "TOKEN"
            ],
            "headers": {
              "X-Test": "yes"
            },
            "type": "http",
            "url": "https://example.com/hook"
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
            "shell": "bash",
            "timeout": 1000,
            "type": "command"
          },
          {
            "allowedEnvVars": [
              "TOKEN"
            ],
            "headers": {
              "X-Test": "yes"
            },
            "type": "http",
            "url": "https://example.com/hook"
          }
        ],
        "matcher": "Bash(*)"
      }
    ]
  }
}
`);
  });

  test("drops runtime_code actions with Claude diagnostic and no handler output", () => {
    const result = emitClaudeHooks([
      hookFixture({
        id: "opencode-only",
        actions: [{ type: "runtime_code", runtime: "opencode", body: "export default {}" }],
      }),
    ]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "warn", code: "claude.hook.runtime_code.dropped" }),
    ]);
    expect(result.artifacts[".claude-plugin/hooks/hooks.json"]).toBe(`{
  "hooks": {}
}
`);
  });

  test("maps all portable primitives and drops only runtime_code", () => {
    const result = emitClaudeHooks([
      hookFixture({
        id: "all-primitives",
        matcher: "Write|Edit",
        actions: [
          { type: "run_command", command: "printf hello", shell: "bash", timeoutMs: 500 },
          { type: "run_exec", command: "node", args: ["script.js", "--flag"], timeoutMs: 600 },
          { type: "run_script", path: "hooks/audit.sh", runner: "bash", args: ["--strict"] },
          { type: "http_request", url: "https://example.com/audit", headers: { Authorization: "Bearer $TOKEN" } },
          { type: "call_mcp_tool", server: "filesystem", tool: "read_file", input: { path: "README.md" } },
          { type: "invoke_prompt", prompt: "Summarize hook event", model: "sonnet" },
          { type: "invoke_agent", agent: "code-reviewer", prompt: "Review this change", model: "sonnet" },
          { type: "runtime_code", runtime: "opencode", file: "hook.opencode.js" },
        ],
      }),
    ]);

    const parsed = JSON.parse(result.artifacts[".claude-plugin/hooks/hooks.json"]!);
    const handlers = parsed.hooks.PreToolUse[0].hooks;

    expect(handlers).toHaveLength(7);
    expect(handlers.map((handler: { type: string }) => handler.type)).toEqual([
      "command",
      "command",
      "command",
      "http",
      "mcp_tool",
      "prompt",
      "agent",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "WARN_LOSSY_CONVERT",
      "claude.hook.runtime_code.dropped",
    ]);
  });
});

describe("emitClaude", () => {
  test("emits plugin root layout with manifest, agents, skills, hooks, and MCP", () => {
    const result = emitClaude(pluginFixture(), {
      mode: "claude-plugin",
      packageMetadata: {
        name: "0xcraft-test-plugin",
        displayName: "0xcraft Test Plugin",
        version: "1.2.3",
        description: "Portable 0xcraft resources.",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual([
      ".claude-plugin/.mcp.json",
      ".claude-plugin/agents/reviewer.md",
      ".claude-plugin/hooks/hooks.json",
      ".claude-plugin/plugin.json",
      ".claude-plugin/skills/audit/SKILL.md",
    ]);
    expect(JSON.parse(fileContent(result, ".claude-plugin/plugin.json"))).toEqual({
      agents: { reviewer: { description: "Review code changes.", name: "Code Reviewer" } },
      description: "Portable 0xcraft resources.",
      displayName: "0xcraft Test Plugin",
      name: "0xcraft-test-plugin",
      skills: { audit: { description: "Audit tool calls.", name: "Audit" } },
      version: "1.2.3",
    });
  });

  test("strips plugin-forbidden agent fields with one diagnostic per stripped field", () => {
    const result = emitClaude([agentFixture()], {
      mode: "claude-plugin",
      packageMetadata: { name: "strip-test", version: "0.0.0", description: "Strip test." },
    });

    const agentFile = fileContent(result, ".claude-plugin/agents/reviewer.md");

    expect(agentFile).toContain("name: Code Reviewer");
    expect(agentFile).toContain("description: Review code changes.");
    expect(agentFile).toContain("model: claude-sonnet-4-20250514");
    expect(agentFile).not.toContain("permissionMode");
    expect(agentFile).not.toContain("hooks:");
    expect(agentFile).not.toContain("mcpServers");
    expect(agentFile).not.toContain("color:");

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "claude.agent.plugin.field_stripped",
      "claude.agent.plugin.field_stripped",
      "claude.agent.plugin.field_stripped",
      "claude.agent.plugin.field_stripped",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.details?.field)).toEqual([
      "color",
      "hooks",
      "mcpServers",
      "permissionMode",
    ]);
  });

  test("emits Claude skill hyphenated keys without camelCase aliases", () => {
    const result = emitClaude([skillFixture()], {
      mode: "claude-plugin",
      packageMetadata: { name: "skill-test", version: "0.0.0", description: "Skill test." },
    });

    const skillFile = fileContent(result, ".claude-plugin/skills/audit/SKILL.md");

    expect(skillFile).toContain("allowed-tools:");
    expect(skillFile).toContain("disallowed-tools:");
    expect(skillFile).toContain("argument-hint: <path>");
    expect(skillFile).not.toContain("allowedTools");
  });

  test("emits plugin agent and skill references next to their Claude files", () => {
    const agent: AgentIR = {
      ...agentFixture(),
      references: {
        "zeta.txt": "line one\r\nline two",
        "alpha.md": "# Alpha\n",
      },
    };
    const skill: SkillIR = {
      ...skillFixture(),
      references: {
        "example.md": "Example",
      },
    };

    const result = emitClaude([agent, skill], {
      mode: "claude-plugin",
      packageMetadata: { name: "refs-test", version: "0.0.0", description: "Refs test." },
    });

    expect(result.files.map((file) => file.path)).toEqual([
      ".claude-plugin/agents/reviewer.md",
      ".claude-plugin/agents/reviewer/references/alpha.md",
      ".claude-plugin/agents/reviewer/references/zeta.txt",
      ".claude-plugin/plugin.json",
      ".claude-plugin/skills/audit/references/example.md",
      ".claude-plugin/skills/audit/SKILL.md",
    ]);
    expect(fileContent(result, ".claude-plugin/agents/reviewer/references/zeta.txt")).toBe("line one\nline two\n");
    expect(fileContent(result, ".claude-plugin/skills/audit/references/example.md")).toBe("Example\n");
  });

  test("emits MCP with mcpServers wrapper", () => {
    const result = emitClaude([mcpFixture()], {
      mode: "claude-plugin",
      packageMetadata: { name: "mcp-test", version: "0.0.0", description: "MCP test." },
    });

    expect(JSON.parse(fileContent(result, ".claude-plugin/.mcp.json"))).toEqual({
      mcpServers: {
        filesystem: {
          args: ["/tmp/workspace"],
          command: "npx",
          env: { FS_ROOT: "/tmp/workspace" },
        },
      },
    });
  });

  test("is deterministic across repeated plugin emissions", () => {
    const ir = pluginFixture().toReversed();
    const options = {
      mode: "claude-plugin" as const,
      packageMetadata: {
        name: "0xcraft-test-plugin",
        displayName: "0xcraft Test Plugin",
        version: "1.2.3",
        description: "Portable 0xcraft resources.",
      },
    };

    const first = emitClaude(ir, options);
    const second = emitClaude(ir, options);

    expect(first.files).toEqual(second.files);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  test("emits full Claude subagent agents with all Claude-specific fields preserved", () => {
    const result = emitClaude([agentFixture(), skillFixture(), mcpFixture(), hookFixture({
      id: "audit-tools",
      actions: [{ type: "run_command", command: "printf ok" }],
    })], {
      mode: "claude-subagent",
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual([".claude/agents/reviewer.md"]);

    const agentFile = fileContent(result, ".claude/agents/reviewer.md");

    expect(agentFile).toContain("name: Code Reviewer");
    expect(agentFile).toContain("description: Review code changes.");
    expect(agentFile).toContain("model: claude-sonnet-4-20250514");
    expect(agentFile).toContain("effort: high");
    expect(agentFile).toContain("maxTurns: 5");
    expect(agentFile).toContain("tools:");
    expect(agentFile).toContain("  - Read");
    expect(agentFile).toContain("  - Grep");
    expect(agentFile).toContain("disallowedTools:");
    expect(agentFile).toContain("  - Write");
    expect(agentFile).toContain("skills:");
    expect(agentFile).toContain("  - audit");
    expect(agentFile).toContain("memory: project");
    expect(agentFile).toContain("background: false");
    expect(agentFile).toContain("isolation: worktree");
    expect(agentFile).toContain("permissionMode: plan");
    expect(agentFile).toContain("hooks:");
    expect(agentFile).toContain("PreToolUse");
    expect(agentFile).toContain("mcpServers:");
    expect(agentFile).toContain("  - filesystem");
    expect(agentFile).toContain("color: blue");
    expect(agentFile).toContain("initialPrompt: Review this code");
    expect(agentFile).toEndWith("Review code for correctness and security.\n");
  });

  test("emits subagent agent references but not skill references", () => {
    const agent: AgentIR = {
      ...agentFixture(),
      references: {
        "guide.md": "Use checklist.",
      },
    };
    const skill: SkillIR = {
      ...skillFixture(),
      references: {
        "skip.md": "Subagent mode does not emit skills.",
      },
    };

    const result = emitClaude([agent, skill], { mode: "claude-subagent" });

    expect(result.files.map((file) => file.path)).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/agents/reviewer/references/guide.md",
    ]);
    expect(fileContent(result, ".claude/agents/reviewer/references/guide.md")).toBe("Use checklist.\n");
    expect(result.files.some((file) => file.path.includes("skip.md"))).toBe(false);
  });

  test("is deterministic across repeated subagent emissions", () => {
    const ir = [skillFixture(), mcpFixture(), agentFixture()];
    const options = { mode: "claude-subagent" as const };

    const first = emitClaude(ir, options);
    const second = emitClaude(ir.toReversed(), options);

    expect(first.files).toEqual(second.files);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });
});

type HookFixtureOptions = {
  id: string;
  events?: HookIR["common"]["events"];
  matcher?: string;
  actions: HookIR["common"]["actions"];
};

function hookFixture(options: HookFixtureOptions): HookIR {
  return {
    id: options.id,
    kind: "hook",
    sourcePath: `hooks/${options.id}/HOOK.md`,
    common: {
      name: options.id,
      enabled: true,
      events: options.events ?? ["PreToolUse"],
      runtime: "portable",
      actions: options.actions,
    },
    platform: {
      claude: options.matcher === undefined ? {} : { matcher: options.matcher },
    },
    _sources: { "common.actions": `hooks/${options.id}/HOOK.md` },
  };
}

function pluginFixture(): IRResource[] {
  return [agentFixture(), skillFixture(), hookFixture({
    id: "audit-tools",
    matcher: "Bash(*)",
    actions: [{ type: "run_command", command: "printf ok", shell: "bash", timeoutMs: 1_000 }],
  }), mcpFixture()];
}

function agentFixture(): AgentIR {
  return {
    id: "reviewer",
    kind: "agent",
    sourcePath: ".claude-plugin/agents/reviewer/AGENT.md",
    common: {
      name: "Code Reviewer",
      description: "Review code changes.",
      model: "claude-sonnet-4-20250514",
      maxTurns: 5,
      prompt: "Review code for correctness and security.",
    },
    platform: {
      claude: {
        effort: "high",
        tools: ["Read", "Grep"],
        disallowedTools: ["Write"],
        skills: ["audit"],
        memory: "project",
        background: false,
        isolation: "worktree",
        permissionMode: "plan",
        hooks: { PreToolUse: [{ type: "command", command: "audit.sh" }] },
        mcpServers: ["filesystem"],
        color: "blue",
        initialPrompt: "Review this code",
      },
    },
    _sources: {},
  };
}

function skillFixture(): SkillIR {
  return {
    id: "audit",
    kind: "skill",
    sourcePath: ".claude-plugin/skills/audit/SKILL.md",
    common: {
      name: "Audit",
      description: "Audit tool calls.",
      "allowed-tools": ["Read", "Grep"],
      "disallowed-tools": ["Write"],
      body: "Audit recent tool usage before final response.",
    },
    platform: {
      claude: {
        when_to_use: "Before final review.",
        "argument-hint": "<path>",
        "allowed-tools": ["Read", "Grep"],
      },
    },
    _sources: {},
  };
}

function mcpFixture(): McpServerIR {
  return {
    id: "filesystem",
    kind: "mcp",
    sourcePath: "mcp/filesystem/MCP.md",
    common: {
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      args: ["/tmp/workspace"],
      env: { FS_ROOT: "/tmp/workspace" },
    },
    mcpEnvelope: { sourceShape: "wrapped", emitShape: "wrapped", wrapperKey: "mcpServers" },
    platform: { claude: { wrapper: "mcpServers" } },
    _sources: {},
  };
}

function fileContent(result: ReturnType<typeof emitClaude>, path: string): string {
  const file = result.files.find((entry) => entry.path === path);
  expect(file).toBeDefined();
  return file!.content;
}
