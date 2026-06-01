/**
 * Neutral lifecycle events (spec §5.1).
 *
 * 15 canonical events, platform-agnostic. Adapters map these onto
 * their native hook surfaces (or `drop-warn` per the capability matrix).
 */

export enum HookEvent {
  SessionStart = "session.start",
  SessionEnd = "session.end",
  UserPromptFirst = "user-prompt.first",
  UserPromptEvery = "user-prompt.every",
  MessageTransform = "message.transform",
  BeforeToolCall = "tool-call.before",
  AfterToolCall = "tool-call.after",
  AfterToolFailure = "tool-call.failure",
  PermissionRequest = "permission.request",
  AgentSpawn = "agent.spawn",
  AgentStop = "agent.stop",
  BeforeCompact = "compact.before",
  AfterCompact = "compact.after",
  Notification = "notification",
  ShellEnvironment = "shell.environment",
}

/** Backward-compatible object alias for existing core/adapters. */
export const HOOK_EVENTS = HookEvent;
