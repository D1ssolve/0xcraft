import { describe, expect, test } from "bun:test";

import { HookEvent } from "./hook-event";

const REQUIRED_SEMANTIC_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptFirst",
  "UserPromptEvery",
  "MessageTransform",
  "BeforeToolCall",
  "AfterToolCall",
  "AfterToolFailure",
  "PermissionRequest",
  "BeforeCompact",
  "AfterCompact",
  "AgentSpawn",
  "AgentStop",
  "Notification",
  "ShellEnvironment",
] as const;

describe("HookEvent", () => {
  test("contains all 15 semantic events", () => {
    for (const eventName of REQUIRED_SEMANTIC_EVENTS) {
      expect(HookEvent[eventName]).toBeDefined();
    }
  });

  test("values are semantic (no platform names)", () => {
    for (const value of Object.values(HookEvent)) {
      expect(value).not.toMatch(/^(Pre|Post)ToolUse$/);
    }
  });
});
