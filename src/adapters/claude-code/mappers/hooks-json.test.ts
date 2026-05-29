import { describe, expect, test } from "bun:test";
import { HOOK_EVENTS, type HookSpec } from "../../../core/hooks";
import {
  mapHooksToClaudeCode,
  mapEventToClaudeCodeEvent,
  type ClaudeCodeMappedHookScriptRef,
} from "./hooks";

const baseHook = {
  description: "Test hook",
  enabledByDefault: true,
  marker: "<!-- X -->",
} satisfies Omit<HookSpec, "id" | "event">;

describe("mapEventToClaudeCodeEvent", () => {
  test("maps every canonical event to a Claude Code event", () => {
    expect(mapEventToClaudeCodeEvent(HOOK_EVENTS.SessionStart)).toBe("SessionStart");
    expect(mapEventToClaudeCodeEvent(HOOK_EVENTS.UserPromptFirst)).toBe("UserPromptSubmit");
    expect(mapEventToClaudeCodeEvent(HOOK_EVENTS.UserPromptEvery)).toBe("UserPromptSubmit");
    expect(mapEventToClaudeCodeEvent(HOOK_EVENTS.BeforeToolCall)).toBe("PreToolUse");
    expect(mapEventToClaudeCodeEvent(HOOK_EVENTS.AfterToolCall)).toBe("PostToolUse");
  });
});

describe("Claude Code hook mapper", () => {
  test("emits hooks.json grouping by event with script commands and matchers", () => {
    const hooks: HookSpec[] = [
      { ...baseHook, id: "session-setup", event: HOOK_EVENTS.SessionStart },
      { ...baseHook, id: "first-prompt", event: HOOK_EVENTS.UserPromptFirst },
    ];
    const scriptRefs: ClaudeCodeMappedHookScriptRef[] = [
      {
        hookId: "session-setup",
        hookEventName: "SessionStart",
        scriptPath: "hooks/session-setup.mjs",
      },
      {
        hookId: "first-prompt",
        hookEventName: "UserPromptSubmit",
        scriptPath: "hooks/first-prompt.mjs",
      },
    ];

    const result = mapHooksToClaudeCode({ hooks, scriptRefs });

    expect(result.diagnostics).toEqual([]);
    expect(result.hooksJson).toBeDefined();
    const json = result.hooksJson!;
    expect(Object.keys(json.hooks).sort()).toEqual(["SessionStart", "UserPromptSubmit"]);
    expect(json.hooks.SessionStart![0]!.matcher).toBe("startup|resume|clear");
    expect(json.hooks.SessionStart![0]!.hooks[0]).toEqual({
      type: "command",
      command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/session-setup.mjs",
    });
    expect(json.hooks.UserPromptSubmit![0]!.matcher).toBeUndefined();
    expect(json.hooks.UserPromptSubmit![0]!.hooks[0]).toEqual({
      type: "command",
      command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/first-prompt.mjs",
    });
  });

  test("omits disabled hooks", () => {
    const hooks: HookSpec[] = [
      { ...baseHook, id: "a", event: HOOK_EVENTS.SessionStart },
      { ...baseHook, id: "b", event: HOOK_EVENTS.SessionStart },
    ];
    const scriptRefs: ClaudeCodeMappedHookScriptRef[] = [
      { hookId: "a", hookEventName: "SessionStart", scriptPath: "hooks/a.mjs" },
    ];

    const result = mapHooksToClaudeCode({
      hooks,
      scriptRefs,
      disabledHooks: ["b"],
    });

    expect(result.hooksJson).toBeDefined();
    expect(result.hooksJson!.hooks.SessionStart!.length).toBe(1);
  });

  test("warns when no script ref exists for an enabled hook", () => {
    const hooks: HookSpec[] = [
      { ...baseHook, id: "no-script", event: HOOK_EVENTS.SessionStart },
    ];

    const result = mapHooksToClaudeCode({ hooks, scriptRefs: [] });

    expect(result.hooksJson).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "claude.hook.no_script",
        hookId: "no-script",
      }),
    ]);
  });

  test("returns empty output when no hooks are provided", () => {
    const result = mapHooksToClaudeCode({ hooks: [], scriptRefs: [] });

    expect(result).toEqual({ diagnostics: [] });
  });

  test("rejects unsafe hook ids", () => {
    const hooks: HookSpec[] = [
      { ...baseHook, id: "../escape", event: HOOK_EVENTS.SessionStart },
    ];

    const result = mapHooksToClaudeCode({ hooks, scriptRefs: [] });

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

  test("uses node runtime when requested", () => {
    const hooks: HookSpec[] = [
      { ...baseHook, id: "a", event: HOOK_EVENTS.SessionStart },
    ];
    const scriptRefs: ClaudeCodeMappedHookScriptRef[] = [
      { hookId: "a", hookEventName: "SessionStart", scriptPath: "hooks/a.mjs" },
    ];

    const result = mapHooksToClaudeCode({ hooks, scriptRefs, runtime: "node" });

    expect(result.hooksJson!.hooks.SessionStart![0]!.hooks[0]).toEqual({
      type: "command",
      command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/a.mjs",
    });
  });
});
