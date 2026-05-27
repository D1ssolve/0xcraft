import { describe, expect, test } from "bun:test";
import type { AgentPermissions } from "../../../core/agents/agent-types";
import { mapAgentPermissionsToClaudeDisallowedTools } from "./permission-mapper";

describe("Claude Code permission mapper", () => {
  test("maps edit and write denies to Claude edit tool denies without duplicates", () => {
    const result = mapAgentPermissionsToClaudeDisallowedTools({ edit: "deny", write: "deny" });

    expect(result.disallowedTools).toEqual(["Edit", "MultiEdit", "Write"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("maps known non-edit deny permissions to Claude tool denies", () => {
    const result = mapAgentPermissionsToClaudeDisallowedTools({
      bash: "deny",
      webfetch: "deny",
      websearch: "deny",
      task: "deny",
    });

    expect(result.disallowedTools).toEqual(["Bash", "WebFetch", "WebSearch", "Task"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("does not map allow permissions to disallowed tools", () => {
    const result = mapAgentPermissionsToClaudeDisallowedTools({
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
      websearch: "allow",
      task: "allow",
    });

    expect(result.disallowedTools).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("maps deny-all task routing to coarse Task deny", () => {
    const result = mapAgentPermissionsToClaudeDisallowedTools({ task: { "*": "deny" } });

    expect(result.disallowedTools).toEqual(["Task"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("emits diagnostic instead of coarse Task deny for lossy per-agent task routing", () => {
    const result = mapAgentPermissionsToClaudeDisallowedTools({
      task: { "*": "deny", "code-explorer": "allow" },
    });

    expect(result.disallowedTools).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.permission.task-routing-lossy",
        permission: "task",
        message:
          "Claude Code plugin agents cannot represent per-agent task routing; leaving Task available instead of applying unsafe coarse deny.",
        details: { allowedAgents: ["code-explorer"], deniedAgents: ["*"] },
      },
    ]);
  });

  test("emits structured diagnostics for external directories and unsupported permissions", () => {
    const permissions = {
      external_directory: { "~/.nuget/packages*": "allow" },
      question: "allow",
      todowrite: "deny",
      todoread: "deny",
      custom_permission: "deny",
    } as AgentPermissions & Record<string, unknown>;

    const result = mapAgentPermissionsToClaudeDisallowedTools(permissions);

    expect(result.disallowedTools).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "external_directory",
        message: "Claude Code permission mapper does not support external_directory; no hidden behavior change applied.",
      },
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "question",
        message: "Claude Code permission mapper does not support question; no hidden behavior change applied.",
      },
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "todowrite",
        message: "Claude Code permission mapper does not support todowrite; no hidden behavior change applied.",
      },
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "todoread",
        message: "Claude Code permission mapper does not support todoread; no hidden behavior change applied.",
      },
      {
        severity: "warning",
        code: "claude-code.permission.unsupported",
        permission: "custom_permission",
        message: "Claude Code permission mapper does not support custom_permission; no hidden behavior change applied.",
      },
    ]);
  });
});
