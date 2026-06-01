export const HOOK_EVENTS = [
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
  "experimental.chat.messages.transform",
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

export const CODEX_HOOK_EVENTS = [
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
] as const satisfies readonly HookEvent[];

export type CodexHookEvent = typeof CODEX_HOOK_EVENTS[number];

export const CODEX_UNSUPPORTED_EVENTS: ReadonlySet<HookEvent> = new Set(
  HOOK_EVENTS.filter((event) => !CODEX_HOOK_EVENTS.includes(event as CodexHookEvent)),
);

export const CODEX_MATCHER_IGNORED_EVENTS: ReadonlySet<HookEvent> = new Set([
  "UserPromptSubmit",
  "Stop",
]);

export type NeutralIntent =
  | "session_starts"
  | "setup"
  | "user_prompt_submitted"
  | "user_prompt_expanded"
  | "before_tool_use"
  | "permission_request"
  | "permission_denied"
  | "after_tool_use"
  | "after_tool_failure"
  | "after_tool_batch"
  | "notification"
  | "message_display"
  | "subagent_starts"
  | "subagent_stops"
  | "task_created"
  | "task_completed"
  | "stop"
  | "stop_failure"
  | "teammate_idle"
  | "instructions_loaded"
  | "config_changed"
  | "cwd_changed"
  | "file_changed"
  | "worktree_create"
  | "worktree_remove"
  | "before_compact"
  | "after_compact"
  | "elicitation"
  | "elicitation_result"
  | "session_end"
  | "experimental_chat_messages_transform";

export const EVENT_MAPPING_TABLE: Record<NeutralIntent, {
  claude: HookEvent;
  codex: CodexHookEvent | null;
}> = {
  session_starts: { claude: "SessionStart", codex: "SessionStart" },
  setup: { claude: "Setup", codex: null },
  user_prompt_submitted: { claude: "UserPromptSubmit", codex: "UserPromptSubmit" },
  user_prompt_expanded: { claude: "UserPromptExpansion", codex: null },
  before_tool_use: { claude: "PreToolUse", codex: "PreToolUse" },
  permission_request: { claude: "PermissionRequest", codex: "PermissionRequest" },
  permission_denied: { claude: "PermissionDenied", codex: null },
  after_tool_use: { claude: "PostToolUse", codex: "PostToolUse" },
  after_tool_failure: { claude: "PostToolUseFailure", codex: null },
  after_tool_batch: { claude: "PostToolBatch", codex: null },
  notification: { claude: "Notification", codex: null },
  message_display: { claude: "MessageDisplay", codex: null },
  subagent_starts: { claude: "SubagentStart", codex: "SubagentStart" },
  subagent_stops: { claude: "SubagentStop", codex: "SubagentStop" },
  task_created: { claude: "TaskCreated", codex: null },
  task_completed: { claude: "TaskCompleted", codex: null },
  stop: { claude: "Stop", codex: "Stop" },
  stop_failure: { claude: "StopFailure", codex: null },
  teammate_idle: { claude: "TeammateIdle", codex: null },
  instructions_loaded: { claude: "InstructionsLoaded", codex: null },
  config_changed: { claude: "ConfigChange", codex: null },
  cwd_changed: { claude: "CwdChanged", codex: null },
  file_changed: { claude: "FileChanged", codex: null },
  worktree_create: { claude: "WorktreeCreate", codex: null },
  worktree_remove: { claude: "WorktreeRemove", codex: null },
  before_compact: { claude: "PreCompact", codex: "PreCompact" },
  after_compact: { claude: "PostCompact", codex: "PostCompact" },
  elicitation: { claude: "Elicitation", codex: null },
  elicitation_result: { claude: "ElicitationResult", codex: null },
  session_end: { claude: "SessionEnd", codex: null },
  experimental_chat_messages_transform: { claude: "experimental.chat.messages.transform", codex: null },
};
