import { describe, expect, test } from "bun:test";
import type { HookDefinition } from "../../../core/hooks";
import { mapHooksToClaudeCode } from "./hook-mapper";

const baseHook = {
  description: "Test hook",
  enabledByDefault: true,
} satisfies Omit<HookDefinition, "id" | "type">;

describe("Claude Code hook mapper", () => {
  test("omits command-hook intents until hook scripts have source ownership", () => {
    const result = mapHooksToClaudeCode({
      hooks: [
        { ...baseHook, id: "session-setup", type: "session.start" },
        { ...baseHook, id: "tool-policy", type: "tool.before" },
        { ...baseHook, id: "tool-audit", type: "tool.after" },
      ],
    });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "claude.hook.command_scripts_deferred",
        hookId: "session-setup",
      }),
      expect.objectContaining({
        severity: "warning",
        code: "claude.hook.command_scripts_deferred",
        hookId: "tool-policy",
      }),
      expect.objectContaining({
        severity: "warning",
        code: "claude.hook.command_scripts_deferred",
        hookId: "tool-audit",
      }),
    ]);
  });

  test("omits disabled hooks", () => {
    const result = mapHooksToClaudeCode({
      hooks: [
        { ...baseHook, id: "session-setup", type: "session.start" },
        { ...baseHook, id: "tool-policy", type: "tool.before" },
      ],
      disabledHooks: ["tool-policy"],
    });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "claude.hook.command_scripts_deferred",
        hookId: "session-setup",
      }),
    ]);
  });

  test("defers OpenCode first-message injection hooks with diagnostics", () => {
    const result = mapHooksToClaudeCode({
      hooks: [
        { ...baseHook, id: "agents-guard", type: "message.first" },
        { ...baseHook, id: "caveman-bootstrap", type: "message.first" },
      ],
    });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude.hook.deferred_first_message",
        hookId: "agents-guard",
        message:
          "Hook `agents-guard` uses OpenCode first-message injection; Claude Code prompt-rewrite parity is unverified, so mapping is deferred.",
      },
      {
        severity: "warning",
        code: "claude.hook.deferred_first_message",
        hookId: "caveman-bootstrap",
        message:
          "Hook `caveman-bootstrap` uses OpenCode first-message injection; Claude Code prompt-rewrite parity is unverified, so mapping is deferred.",
      },
    ]);
  });

  test("returns diagnostics and omits unsupported or lossy hook intents", () => {
    const result = mapHooksToClaudeCode({
      hooks: [
        { ...baseHook, id: "message-transform", type: "message.transform" },
        { ...baseHook, id: "system-transform", type: "system.transform" },
        { ...baseHook, id: "config-loader", type: "config" },
      ],
    });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "claude.hook.unsupported_intent",
      "claude.hook.unsupported_intent",
      "claude.hook.unsupported_intent",
    ]);
  });

  test("returns empty output when no hooks are provided", () => {
    const result = mapHooksToClaudeCode({ hooks: [] });

    expect(result).toEqual({ diagnostics: [] });
  });

  test("rejects unsafe hook ids before building command paths", () => {
    const result = mapHooksToClaudeCode({
      hooks: [{ ...baseHook, id: "../escape", type: "session.start" }],
    });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "claude.hook.invalid_id",
        hookId: "../escape",
        message: "Hook `../escape` has an unsafe id for Claude Code hook mapping.",
      },
    ]);
  });
});
