import { describe, expect, test } from "bun:test";

import {
  CODEX_HOOK_EVENTS,
  CODEX_MATCHER_IGNORED_EVENTS,
  CODEX_UNSUPPORTED_EVENTS,
  EVENT_MAPPING_TABLE,
  HOOK_EVENTS,
} from "./events";

const EXPECTED_HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "MessageDisplay",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
] as const;

const EXPECTED_CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "PreCompact",
  "PostCompact",
] as const;

describe("hook runtime events", () => {
  test("exports all 30 Claude hook events in spec order", () => {
    expect(HOOK_EVENTS).toEqual(EXPECTED_HOOK_EVENTS);
    expect(HOOK_EVENTS).toHaveLength(30);
  });

  test("exports the 10 Codex hook events", () => {
    expect(CODEX_HOOK_EVENTS).toEqual(EXPECTED_CODEX_HOOK_EVENTS);
    expect(CODEX_HOOK_EVENTS).toHaveLength(10);
  });

  test("tracks the 20 Claude events unsupported by Codex", () => {
    expect(CODEX_UNSUPPORTED_EVENTS.size).toBe(20);

    for (const event of HOOK_EVENTS) {
      expect(CODEX_UNSUPPORTED_EVENTS.has(event)).toBe(!CODEX_HOOK_EVENTS.includes(event as never));
    }
  });

  test("tracks exactly the Codex events where matcher is ignored", () => {
    expect([...CODEX_MATCHER_IGNORED_EVENTS]).toEqual(["UserPromptSubmit", "Stop"]);
  });

  test("maps every Claude hook event through a neutral intent", () => {
    const mappings = Object.values(EVENT_MAPPING_TABLE);

    expect(mappings).toHaveLength(HOOK_EVENTS.length);
    expect(new Set(mappings.map((mapping) => mapping.claude))).toEqual(new Set(HOOK_EVENTS));

    for (const mapping of mappings) {
      if (mapping.codex === null) {
        expect(CODEX_UNSUPPORTED_EVENTS.has(mapping.claude)).toBe(true);
      } else {
        expect(CODEX_HOOK_EVENTS.includes(mapping.codex)).toBe(true);
        expect(CODEX_UNSUPPORTED_EVENTS.has(mapping.claude)).toBe(false);
      }
    }
  });
});
