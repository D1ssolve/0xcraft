import { describe, expect, test } from "bun:test";
import type { AgentSpec } from "../../../core/agents";
import type { PermissionSpec } from "../../../core/permission/permission-spec";
import { claudeCodeAgentFrontmatterSchema } from "../types/claude-code-types";
import { mapAgentToClaudeCodeAgent } from "./agents";

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
        permission: spec({ tools: { edit: "deny", webfetch: "deny" } }),
      }),
      "You are a backend developer.\nWrite tests first.",
    );

    expect(result.frontmatter).toEqual({
      name: "backend-developer",
      description: "Writes production backend code",
      model: "github-copilot/gpt-5.5",
      color: "secondary",
      disallowedTools: ["Edit", "MultiEdit", "WebFetch", "Write"],
    });
    expect(result.body).toBe("You are a backend developer.\nWrite tests first.");
    // Only diagnostic expected: temperature drop (no permission diagnostics for clean allow/deny).
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.capability.agent_temperature.dropped",
        permission: "agentTemperature",
        message:
          "Claude Code sub-agent frontmatter has no temperature field; AgentSpec.temperature is dropped.",
        details: { temperature: 0.9 },
      },
    ]);
    expect(claudeCodeAgentFrontmatterSchema.parse(result.frontmatter)).toEqual(result.frontmatter);
  });

  test("omits model when absent or blank at runtime", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({ model: "   " }) as AgentSpec,
      "Prompt body",
    );

    expect(result.frontmatter).toEqual({
      name: "fixture-agent",
      description: "Fixture agent",
      color: "info",
    });
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.capability.agent_temperature.dropped",
        permission: "agentTemperature",
        message:
          "Claude Code sub-agent frontmatter has no temperature field; AgentSpec.temperature is dropped.",
        details: { temperature: 0.3 },
      },
    ]);
  });

  test("emits external-contract diagnostics for task-routing and filesystem", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({
        permission: spec({
          delegation: { "code-explorer": "allow", "team-lead": "deny" },
          filesystem: { readableRoots: ["~/.nuget/packages"] },
        }),
      }),
      "Prompt body",
    );

    expect(result.frontmatter.disallowedTools).toBeUndefined();
    const codes = result.diagnostics.map((d) => d.code);
    // Legacy external-contract codes preserved (T-12.6):
    expect(codes).toContain("claude-code.permission.task-routing-lossy");
    expect(codes).toContain("claude-code.permission.unsupported");
    // Canonical codes also emitted (additive):
    expect(codes).toContain("permission.delegation.lossy");
    expect(codes).toContain("permission.filesystem.unsupported");

    const taskDiag = result.diagnostics.find(
      (d) => d.code === "claude-code.permission.task-routing-lossy",
    );
    expect(taskDiag?.permission).toBe("task");
    expect(taskDiag?.details).toEqual({
      permission: "task",
      allowedAgents: ["code-explorer"],
      deniedAgents: ["team-lead"],
    });

    const fsDiag = result.diagnostics.find(
      (d) => d.code === "claude-code.permission.unsupported",
    );
    expect(fsDiag?.permission).toBe("external_directory");
  });

  test("emits native color and mcpServers, drops temperature/mode/permissionMode/hooks", () => {
    const result = mapAgentToClaudeCodeAgent(
      {
        ...createAgent(),
        permissionMode: "acceptEdits",
        hooks: { UserPromptSubmit: [] },
        mcpServers: ["unsafe"],
      } as unknown as AgentSpec & Record<string, unknown>,
      "Prompt body",
    );

    expect(result.frontmatter.color).toBe("info");
    expect(result.frontmatter.mcpServers).toEqual(["unsafe"]);
    expect(result.frontmatter).not.toHaveProperty("temperature");
    expect(result.frontmatter).not.toHaveProperty("mode");
    expect(result.frontmatter).not.toHaveProperty("permissionMode");
    expect(result.frontmatter).not.toHaveProperty("hooks");
    expect(claudeCodeAgentFrontmatterSchema.parse(result.frontmatter)).toEqual(result.frontmatter);

    const silencing = result.diagnostics.find(
      (d) => d.code === "claude-code.capability.plugin_mode_silencing",
    );
    expect(silencing).toBeDefined();
    expect(silencing?.details?.silenced).toEqual(["mcpServers", "permissionMode", "hooks"]);

    expect(
      result.diagnostics.some((d) => d.code === "claude-code.capability.agent_temperature.dropped"),
    ).toBe(true);
  });

  test("mcpServers object cast → not emitted to frontmatter, still triggers silencing", () => {
    const result = mapAgentToClaudeCodeAgent(
      {
        ...createAgent({ color: "accent" }),
        mcpServers: { unsafe: { command: "uvx" } },
      } as unknown as AgentSpec & Record<string, unknown>,
      "Prompt body",
    );

    expect(result.frontmatter).not.toHaveProperty("mcpServers");
    const silencing = result.diagnostics.find(
      (d) => d.code === "claude-code.capability.plugin_mode_silencing",
    );
    expect(silencing).toBeDefined();
    expect(silencing?.details?.silenced).toEqual(["mcpServers"]);
  });

  test("agent with temperature only → drops temperature, no plugin-mode silencing", () => {
    const result = mapAgentToClaudeCodeAgent(
      createAgent({ temperature: 0.7, color: "accent" }),
      "Prompt body",
    );

    expect(result.frontmatter).not.toHaveProperty("temperature");
    expect(result.frontmatter.color).toBe("accent");
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.capability.agent_temperature.dropped",
        permission: "agentTemperature",
        message:
          "Claude Code sub-agent frontmatter has no temperature field; AgentSpec.temperature is dropped.",
        details: { temperature: 0.7 },
      },
    ]);
    expect(
      result.diagnostics.some((d) => d.code === "claude-code.capability.plugin_mode_silencing"),
    ).toBe(false);
  });

  test("agent with mcpServers array cast → emits mcpServers + plugin-mode silencing", () => {
    const result = mapAgentToClaudeCodeAgent(
      {
        ...createAgent({ color: "accent" }),
        mcpServers: ["mempalace"],
      } as unknown as AgentSpec & Record<string, unknown>,
      "Prompt body",
    );

    expect(result.frontmatter.mcpServers).toEqual(["mempalace"]);
    const silencing = result.diagnostics.find(
      (d) => d.code === "claude-code.capability.plugin_mode_silencing",
    );
    expect(silencing).toBeDefined();
    expect(silencing?.details?.silenced).toEqual(["mcpServers"]);
  });

  test("agent without forward fields → no plugin-mode silencing diagnostic", () => {
    const result = mapAgentToClaudeCodeAgent(createAgent({ color: "accent" }), "Prompt body");

    expect(
      result.diagnostics.some((d) => d.code === "claude-code.capability.plugin_mode_silencing"),
    ).toBe(false);
  });

  test("pluginMode=false suppresses silencing diagnostic even when forward fields present", () => {
    const result = mapAgentToClaudeCodeAgent(
      {
        ...createAgent(),
        mcpServers: ["mempalace"],
      } as unknown as AgentSpec & Record<string, unknown>,
      "Prompt body",
      { pluginMode: false },
    );

    expect(result.frontmatter.mcpServers).toEqual(["mempalace"]);
    expect(
      result.diagnostics.some((d) => d.code === "claude-code.capability.plugin_mode_silencing"),
    ).toBe(false);
  });
});

function spec(overrides: Partial<PermissionSpec> = {}): PermissionSpec {
  return {
    sandbox: "workspace-write",
    tools: {},
    bash: {},
    ...overrides,
  };
}

function createAgent(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    id: "fixture-agent",
    name: "Fixture Agent",
    description: "Fixture agent",
    mode: "subagent",
    model: "sonnet",
    color: "info",
    temperature: 0.3,
    promptFile: "agents/fixture-agent.agent.md",
    ...overrides,
  };
}
