import { describe, expect, test } from "bun:test";
import type { AgentDefinition } from "../../../core/agents/agent-types";
import { claudeCodeAgentFrontmatterSchema } from "../types/claude-code-types";
import { mapAgentToClaudeCodeAgent } from "./agent-mapper";

describe("Claude Code agent mapper", () => {
  test("maps agent id, description, model, prompt body, and permission denies", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({
        id: "backend-developer",
        name: "Backend Developer",
        description: "Writes production backend code",
        model: "github-copilot/gpt-5.5",
        color: "secondary",
        temperature: 0.9,
        mode: "subagent",
        permissions: { edit: "deny", webfetch: "deny" },
      }),
      "You are a backend developer.\nWrite tests first.",
    );

    expect(result.frontmatter).toEqual({
      name: "backend-developer",
      description: "Writes production backend code",
      model: "github-copilot/gpt-5.5",
      disallowedTools: ["Edit", "MultiEdit", "Write", "WebFetch"],
    });
    expect(result.body).toBe("You are a backend developer.\nWrite tests first.");
    expect(result.diagnostics).toEqual([]);
    expect(claudeCodeAgentFrontmatterSchema.parse(result.frontmatter)).toEqual(result.frontmatter);
  });

  test("omits model when absent or blank at runtime", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({ model: "   " }) as AgentDefinition,
      "Prompt body",
    );

    expect(result.frontmatter).toEqual({
      name: "fixture-agent",
      description: "Fixture agent",
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("uses permission mapper diagnostics", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({
        permissions: {
          external_directory: { "~/.nuget/packages*": "allow" },
          task: { "*": "deny", "code-explorer": "allow" },
        },
      }),
      "Prompt body",
    );

    expect(result.frontmatter.disallowedTools).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.permission.task-routing-lossy",
        permission: "task",
        message:
          "Claude Code plugin agents cannot represent per-agent task routing; leaving Task available instead of applying unsafe coarse deny.",
        details: { allowedAgents: ["code-explorer"], deniedAgents: ["*"] },
      },
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "external_directory",
        message: "Claude Code permission mapper does not support external_directory; no hidden behavior change applied.",
      },
    ]);
  });

  test("drops OpenCode-only fields and plugin-agent-forbidden fields", () => {
    const result = mapAgentToClaudeCodeAgent(
      {
        ...createAgent(),
        permissionMode: "acceptEdits",
        hooks: { UserPromptSubmit: [] },
        mcpServers: { unsafe: { command: "uvx" } },
      } as AgentDefinition & Record<string, unknown>,
      "Prompt body",
    );

    expect(result.frontmatter).not.toHaveProperty("color");
    expect(result.frontmatter).not.toHaveProperty("temperature");
    expect(result.frontmatter).not.toHaveProperty("mode");
    expect(result.frontmatter).not.toHaveProperty("permissionMode");
    expect(result.frontmatter).not.toHaveProperty("hooks");
    expect(result.frontmatter).not.toHaveProperty("mcpServers");
    expect(claudeCodeAgentFrontmatterSchema.parse(result.frontmatter)).toEqual(result.frontmatter);
  });
});

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "fixture-agent",
    name: "Fixture Agent",
    description: "Fixture agent",
    mode: "subagent",
    model: "sonnet",
    color: "info",
    temperature: 0.3,
    permissions: {},
    promptFile: "agents/fixture-agent.agent.md",
    ...overrides,
  };
}
