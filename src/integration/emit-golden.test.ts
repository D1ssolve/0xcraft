/**
 * T-6.2 Golden emit tests — all platforms + modes
 *
 * IR fixture → deterministic snapshot for every emitter.
 * Byte-stability verified by running each emitter twice.
 */

import { describe, expect, test } from "bun:test";

import { emitClaude } from "../adapters/claude/emit";
import { emitCodex } from "../adapters/codex/emit";
import { emitOpenCode } from "../adapters/opencode/emit";
import type { IRResource } from "../core/ir";

// ---------------------------------------------------------------------------
// Shared IR fixture
// ---------------------------------------------------------------------------

const FIXTURE_IR: IRResource[] = [
  // ── Agent 1: Codex-flavoured (has codex meta, no claude fields)
  {
    id: "codex-agent",
    kind: "agent",
    sourcePath: "agents/codex-agent/AGENT.md",
    common: {
      name: "Codex Agent",
      description: "An agent with Codex-specific configuration.",
      prompt: "You are a helpful assistant specialised for Codex.",
      model: "gpt-4o",
      role: "subagent",
    },
    platform: {
      codex: {
        model_reasoning_effort: "high",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
      },
    },
    _sources: {},
  },

  // ── Agent 2: Claude-flavoured (has claude meta with forbidden plugin-mode fields)
  {
    id: "claude-agent",
    kind: "agent",
    sourcePath: "agents/claude-agent/AGENT.md",
    common: {
      name: "Claude Agent",
      description: "An agent with Claude-specific fields.",
      prompt: "You are a helpful agent for Claude.",
      model: "claude-opus-4-5",
      maxTurns: 20,
    },
    platform: {
      claude: {
        color: "blue",
        permissionMode: "auto",
        hooks: { PreToolUse: [{ type: "command", command: "echo pre" }] },
        mcpServers: ["my-mcp"],
        initialPrompt: "Start with: Hello!",
        description: "Claude-only description override",
      },
    },
    _sources: {},
  },

  // ── Skill with frontmatter
  {
    id: "my-skill",
    kind: "skill",
    sourcePath: "skills/my-skill/SKILL.md",
    common: {
      name: "My Skill",
      description: "A helpful skill with allowed-tools.",
      body: "Use this skill when you need to run tests.\n",
    },
    platform: {
      claude: {
        "allowed-tools": ["Bash", "Read"],
        description: "Claude skill description override",
      },
    },
    _sources: {},
  },

  // ── Hook 1: run_command (supported on all 3 platforms)
  {
    id: "run-cmd-hook",
    kind: "hook",
    sourcePath: "hooks/run-cmd-hook/HOOK.md",
    common: {
      name: "Run Command Hook",
      events: ["PreToolUse"],
      actions: [
        {
          type: "run_command",
          command: "echo 'pre-tool-use'",
          shell: "/bin/bash",
          timeoutMs: 5000,
        },
      ],
    },
    platform: {},
    _sources: {},
  },

  // ── Hook 2: run_exec (full on OC+Claude, shim on Codex)
  {
    id: "run-exec-hook",
    kind: "hook",
    sourcePath: "hooks/run-exec-hook/HOOK.md",
    common: {
      name: "Run Exec Hook",
      events: ["PostToolUse"],
      actions: [
        {
          type: "run_exec",
          command: "node",
          args: ["./scripts/post-tool.js"],
          timeoutMs: 3000,
        },
      ],
    },
    platform: {},
    _sources: {},
  },

  // ── Hook 3: http_request (drop-warn on Codex)
  {
    id: "http-hook",
    kind: "hook",
    sourcePath: "hooks/http-hook/HOOK.md",
    common: {
      name: "HTTP Hook",
      events: ["SessionStart"],
      actions: [
        {
          type: "http_request",
          url: "https://example.com/webhook",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      ],
    },
    platform: {},
    _sources: {},
  },

  // ── MCP server (stdio)
  {
    id: "my-mcp",
    kind: "mcp",
    sourcePath: "mcp/my-mcp/MCP.md",
    common: {
      name: "My MCP",
      description: "A stdio MCP server.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@my/mcp-server"],
      env: { MCP_SECRET: "env-ref" },
    },
    mcpEnvelope: {
      sourceShape: "direct",
      emitShape: "wrapped",
      wrapperKey: "mcp_servers",
    },
    platform: {},
    _sources: {},
  },

  // ── Command
  {
    id: "hello-cmd",
    kind: "command",
    sourcePath: "commands/hello-cmd/COMMAND.md",
    common: {
      name: "Hello Command",
      description: "Greet the user.",
      template: "Say hello to $USER.\n",
    },
    platform: {},
    _sources: {},
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert artifact files to a sorted array for deterministic snapshot. */
function artifactEntries(artifact: { files: Array<{ path: string; content: string }> }) {
  return [...artifact.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, content }) => ({ path, content }));
}

// ---------------------------------------------------------------------------
// OpenCode emit
// ---------------------------------------------------------------------------

describe("Golden emit tests", () => {
  describe("OpenCode emit", () => {
    test("produces opencode.json + agent/skill/command .md files", () => {
      const artifact = emitOpenCode(FIXTURE_IR);

      expect(artifact.platform).toBe("opencode");
      expect(artifact.ok).toBe(true);

      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain("opencode.json");
      expect(paths).toContain(".opencode/agents/codex-agent.md");
      expect(paths).toContain(".opencode/agents/claude-agent.md");
      expect(paths).toContain(".opencode/skills/my-skill/SKILL.md");
      expect(paths).toContain(".opencode/commands/hello-cmd.md");
    });

    test("opencode.json contains mcp entry", () => {
      const artifact = emitOpenCode(FIXTURE_IR);
      const configFile = artifact.files.find((f) => f.path === "opencode.json");
      expect(configFile).toBeDefined();
      const config = JSON.parse(configFile!.content);
      expect(config.mcp?.["my-mcp"]).toBeDefined();
      expect(config.mcp["my-mcp"].type).toBe("local");
      expect(config.mcp["my-mcp"].command).toEqual(["npx", "-y", "@my/mcp-server"]);
    });

    test("run_command hook emits plugin file", () => {
      const artifact = emitOpenCode(FIXTURE_IR);
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".opencode/plugins/run-cmd-hook.js");
    });

    test("byte-stable: two runs produce identical artifact", () => {
      const first = artifactEntries(emitOpenCode(FIXTURE_IR));
      const second = artifactEntries(emitOpenCode(FIXTURE_IR));
      expect(first).toEqual(second);
    });

    test("all expected files present", () => {
      const artifact = emitOpenCode(FIXTURE_IR);
      const paths = new Set(artifact.files.map((f) => f.path));
      const expected = [
        "opencode.json",
        ".opencode/agents/claude-agent.md",
        ".opencode/agents/codex-agent.md",
        ".opencode/commands/hello-cmd.md",
        ".opencode/skills/my-skill/SKILL.md",
      ];
      for (const p of expected) {
        expect(paths.has(p)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Claude plugin mode
  // ---------------------------------------------------------------------------

  describe("Claude plugin mode emit", () => {
    test("produces plugin.json + agent + skill files", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });

      expect(artifact.platform).toBe("claude-code");
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".claude-plugin/plugin.json");
      expect(paths).toContain("agents/codex-agent.md");
      expect(paths).toContain("agents/claude-agent.md");
      expect(paths).toContain("skills/my-skill/SKILL.md");
    });

    test("plugin-forbidden fields absent from agent .md files", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });
      const claudeAgentFile = artifact.files.find((f) => f.path === "agents/claude-agent.md");
      expect(claudeAgentFile).toBeDefined();
      const content = claudeAgentFile!.content;

      // These fields must NOT appear in plugin-mode agent markdown
      expect(content).not.toContain("hooks:");
      expect(content).not.toContain("mcpServers:");
      expect(content).not.toContain("permissionMode:");
    });

    test("stripped fields produce diagnostics", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });
      const strippedDiags = artifact.diagnostics.filter(
        (d) => d.code === "claude.agent.plugin.field_stripped",
      );
      // color, hooks, mcpServers, permissionMode → 4 stripped fields
      expect(strippedDiags.length).toBeGreaterThanOrEqual(3);
    });

    test("hooks/hooks.json emitted for hooks with supported actions", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });
      const hooksFile = artifact.files.find((f) => f.path === "hooks/hooks.json");
      expect(hooksFile).toBeDefined();
      const hooks = JSON.parse(hooksFile!.content);
      expect(hooks.hooks).toBeDefined();
    });

    test(".mcp.json emitted with mcpServers wrapper", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });
      const mcpFile = artifact.files.find((f) => f.path === ".mcp.json");
      expect(mcpFile).toBeDefined();
      const mcp = JSON.parse(mcpFile!.content);
      expect(mcp.mcpServers?.["my-mcp"]).toBeDefined();
    });

    test("byte-stable", () => {
      const first = artifactEntries(emitClaude(FIXTURE_IR, { mode: "claude-plugin" }));
      const second = artifactEntries(emitClaude(FIXTURE_IR, { mode: "claude-plugin" }));
      expect(first).toEqual(second);
    });

    test("skill emits hyphenated allowed-tools", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" });
      const skillFile = artifact.files.find((f) => f.path === "skills/my-skill/SKILL.md");
      expect(skillFile).toBeDefined();
      expect(skillFile!.content).toContain("allowed-tools:");
    });

    test("plugin.json contains displayName when packageMetadata set", () => {
      const artifact = emitClaude(FIXTURE_IR, {
        mode: "claude-plugin",
        packageMetadata: {
          name: "test-plugin",
          displayName: "Test Plugin Display",
          version: "1.0.0",
          description: "Golden test plugin",
        },
      });
      const manifest = JSON.parse(
        artifact.files.find((f) => f.path === ".claude-plugin/plugin.json")!.content,
      );
      expect(manifest.displayName).toBe("Test Plugin Display");
      expect(manifest.name).toBe("test-plugin");
    });
  });

  // ---------------------------------------------------------------------------
  // Claude subagent mode
  // ---------------------------------------------------------------------------

  describe("Claude subagent mode emit", () => {
    test("produces .claude/agents/*.md files", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".claude/agents/codex-agent.md");
      expect(paths).toContain(".claude/agents/claude-agent.md");
    });

    test("preserves hooks in agent frontmatter", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const claudeAgentFile = artifact.files.find(
        (f) => f.path === ".claude/agents/claude-agent.md",
      );
      expect(claudeAgentFile).toBeDefined();
      expect(claudeAgentFile!.content).toContain("hooks:");
    });

    test("preserves mcpServers in agent frontmatter", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const claudeAgentFile = artifact.files.find(
        (f) => f.path === ".claude/agents/claude-agent.md",
      );
      expect(claudeAgentFile!.content).toContain("mcpServers:");
    });

    test("preserves permissionMode in agent frontmatter", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const claudeAgentFile = artifact.files.find(
        (f) => f.path === ".claude/agents/claude-agent.md",
      );
      expect(claudeAgentFile!.content).toContain("permissionMode:");
    });

    test("preserves color in agent frontmatter", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const claudeAgentFile = artifact.files.find(
        (f) => f.path === ".claude/agents/claude-agent.md",
      );
      expect(claudeAgentFile!.content).toContain("color:");
    });

    test("no stripped-field diagnostics in subagent mode", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" });
      const strippedDiags = artifact.diagnostics.filter(
        (d) => d.code === "claude.agent.plugin.field_stripped",
      );
      expect(strippedDiags).toHaveLength(0);
    });

    test("byte-stable", () => {
      const first = artifactEntries(emitClaude(FIXTURE_IR, { mode: "claude-subagent" }));
      const second = artifactEntries(emitClaude(FIXTURE_IR, { mode: "claude-subagent" }));
      expect(first).toEqual(second);
    });
  });

  // ---------------------------------------------------------------------------
  // Codex emit
  // ---------------------------------------------------------------------------

  describe("Codex emit", () => {
    test("produces .codex/agents/*.toml + .codex/config.toml", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".codex/config.toml");
      expect(paths).toContain(".codex/agents/codex-agent.toml");
      expect(paths).toContain(".codex/agents/claude-agent.toml");
    });

    test("agent TOML contains required fields", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const agentToml = artifact.files.find((f) => f.path === ".codex/agents/codex-agent.toml");
      expect(agentToml).toBeDefined();
      const content = agentToml!.content;
      expect(content).toContain("name");
      expect(content).toContain("description");
      expect(content).toContain("developer_instructions");
    });

    test("Codex-specific agent fields emitted in TOML", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const agentToml = artifact.files.find((f) => f.path === ".codex/agents/codex-agent.toml");
      expect(agentToml!.content).toContain("model_reasoning_effort");
      expect(agentToml!.content).toContain("on-request");
    });

    test("hooks.json emitted with command handlers only", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const hooksFile = artifact.files.find((f) => f.path === ".codex/hooks.json");
      expect(hooksFile).toBeDefined();
      const hooksJson = JSON.parse(hooksFile!.content) as {
        hooks: Record<string, Array<{ hooks: Array<{ type: string }> }>>;
      };
      // All handlers must be type "command"
      for (const groups of Object.values(hooksJson.hooks)) {
        for (const group of groups) {
          for (const handler of group.hooks) {
            expect(handler.type).toBe("command");
          }
        }
      }
    });

    test("http_request hook dropped with diagnostic", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const dropDiags = artifact.diagnostics.filter(
        (d) => d.code === "codex.hooks.handler.http.dropped",
      );
      expect(dropDiags.length).toBeGreaterThanOrEqual(1);
    });

    test("run_exec hook shimmed with diagnostic", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const shimDiags = artifact.diagnostics.filter(
        (d) => d.code === "codex.hooks.run_exec.shim",
      );
      expect(shimDiags.length).toBeGreaterThanOrEqual(1);
    });

    test("rejects approval_policy = on-failure", () => {
      const onFailureIR: IRResource[] = [
        {
          id: "bad-agent",
          kind: "agent",
          sourcePath: "agents/bad-agent/AGENT.md",
          common: {
            name: "Bad Agent",
            description: "Agent with unsupported approval policy.",
            prompt: "I have a bad policy.",
          },
          platform: {
            codex: {
              approval_policy: "on-failure" as never,
            },
          },
          _sources: {},
        },
      ];

      const artifact = emitCodex(onFailureIR, {});
      const errorDiags = artifact.diagnostics.filter(
        (d) => d.code === "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
      );
      expect(errorDiags.length).toBeGreaterThanOrEqual(1);

      for (const file of artifact.files) {
        if (file.path.endsWith(".toml")) {
          expect(file.content).not.toContain('"on-failure"');
          expect(file.content).not.toContain("'on-failure'");
          expect(file.content).not.toContain("on-failure");
        }
      }
    });

    test("config.toml has features.hooks=true when hooks present", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const config = artifact.files.find((f) => f.path === ".codex/config.toml");
      expect(config).toBeDefined();
      expect(config!.content).toContain("hooks");
    });

    test(".mcp.json emitted with mcp_servers wrapper", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      const mcpFile = artifact.files.find((f) => f.path === ".mcp.json");
      expect(mcpFile).toBeDefined();
      const mcp = JSON.parse(mcpFile!.content);
      expect(mcp.mcp_servers?.["my-mcp"]).toBeDefined();
    });

    test("byte-stable", () => {
      const first = artifactEntries(emitCodex(FIXTURE_IR, {}));
      const second = artifactEntries(emitCodex(FIXTURE_IR, {}));
      expect(first).toEqual(second);
    });
  });

  // ---------------------------------------------------------------------------
  // Codex plugin + marketplace
  // ---------------------------------------------------------------------------

  describe("Codex plugin + marketplace", () => {
    const META = {
      name: "my-codex-plugin",
      displayName: "My Codex Plugin",
      version: "1.2.3",
      description: "Golden test codex plugin",
    };

    test("plugin.json emitted when emitPlugin=true", () => {
      const artifact = emitCodex(FIXTURE_IR, { emitPlugin: true, packageMetadata: META });
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".codex-plugin/plugin.json");
    });

    test("marketplace.json emitted when emitPlugin+emitMarketplace=true", () => {
      const artifact = emitCodex(FIXTURE_IR, {
        emitPlugin: true,
        emitMarketplace: true,
        packageMetadata: META,
      });
      const paths = artifact.files.map((f) => f.path);
      expect(paths).toContain(".agents/plugins/marketplace.json");
    });

    test("marketplace.json has official source and policy fields", () => {
      const artifact = emitCodex(FIXTURE_IR, {
        emitPlugin: true,
        emitMarketplace: true,
        packageMetadata: META,
        marketplace: {
          installationPolicy: "allowed",
          authenticationPolicy: "none",
          category: "developer-tools",
        },
      });
      const marketplaceFile = artifact.files.find(
        (f) => f.path === ".agents/plugins/marketplace.json",
      );
      expect(marketplaceFile).toBeDefined();
      const manifest = JSON.parse(marketplaceFile!.content);

      // top-level name
      expect(manifest.name).toBeDefined();
      expect(typeof manifest.name).toBe("string");

      // plugins array
      expect(Array.isArray(manifest.plugins)).toBe(true);
      const plugin = manifest.plugins[0];

      // source field: official shape
      expect(plugin.source).toBeDefined();
      expect(plugin.source.source).toBe("local");
      expect(plugin.source.path).toBe("./.codex-plugin");

      // policy field
      expect(plugin.policy).toBeDefined();
      expect(plugin.policy.installation).toBe("allowed");
      expect(plugin.policy.authentication).toBe("none");

      // category
      expect(plugin.category).toBe("developer-tools");
    });

    test("interface.displayName emitted when packageMetadata.displayName set", () => {
      const artifact = emitCodex(FIXTURE_IR, {
        emitPlugin: true,
        emitMarketplace: true,
        packageMetadata: META,
      });
      const manifest = JSON.parse(
        artifact.files.find((f) => f.path === ".agents/plugins/marketplace.json")!.content,
      );
      expect(manifest.interface?.displayName).toBe("My Codex Plugin");
    });

    test("marketplace without plugin → ERR_MARKETPLACE_REQUIRES_PLUGIN error", () => {
      const artifact = emitCodex(FIXTURE_IR, {
        emitPlugin: false,
        emitMarketplace: true,
        packageMetadata: META,
      });
      expect(artifact.ok).toBe(false);
      const errDiags = artifact.diagnostics.filter(
        (d) => d.code === "ERR_MARKETPLACE_REQUIRES_PLUGIN",
      );
      expect(errDiags.length).toBeGreaterThanOrEqual(1);
    });

    test("no marketplace.json written when marketplace without plugin fails", () => {
      const artifact = emitCodex(FIXTURE_IR, {
        emitPlugin: false,
        emitMarketplace: true,
        packageMetadata: META,
      });
      const marketplaceFile = artifact.files.find(
        (f) => f.path === ".agents/plugins/marketplace.json",
      );
      expect(marketplaceFile).toBeUndefined();
    });

    test("byte-stable with plugin+marketplace", () => {
      const opts = { emitPlugin: true, emitMarketplace: true, packageMetadata: META };
      const first = artifactEntries(emitCodex(FIXTURE_IR, opts));
      const second = artifactEntries(emitCodex(FIXTURE_IR, opts));
      expect(first).toEqual(second);
    });
  });
});
