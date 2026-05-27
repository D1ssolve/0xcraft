/**
 * Hook definitions — harness-agnostic.
 *
 * Each hook has a unique ID, a description, and a type indicating
 * when it fires. The OpenCode adapter maps these to the plugin's
 * hook API (chat.message, tool.execute.before, etc.).
 */
export interface HookDefinition {
  /** Unique kebab-case identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** When this hook fires */
  type: HookType;
  /** Whether this hook is enabled by default */
  enabledByDefault: boolean;
}

export type HookType =
  | "session.start"
  | "message.first"
  | "message.transform"
  | "system.transform"
  | "tool.before"
  | "tool.after"
  | "config";

/**
 * Built-in hooks ported from the user's existing plugins.
 *
 * Token optimization: hooks that inject text into every message
 * (caveman, agents-guard, git-worktree) are carefully designed
 * to be as short as possible. They only inject on the FIRST
 * user message of a session, not on every message.
 */
export const builtinHooks: HookDefinition[] = [
  {
    id: "agents-guard",
    description:
      "On first message, checks whether AGENTS.md exists at the project root. If missing, injects a high-priority instruction to run codebase-indexer before handling the user's request.",
    type: "message.first",
    enabledByDefault: true,
  },
  {
    id: "caveman-bootstrap",
    description:
      "On first message, injects a bootstrap instruction to load the caveman skill. The skill itself is loaded lazily via the skill tool, not injected into every message.",
    type: "message.first",
    enabledByDefault: true,
  },
  {
    id: "git-worktree-bootstrap",
    description:
      "On first message, injects a bootstrap instruction to load the git-worktree skill when the project is inside a .tasks task folder or has a .git file (worktree indicator).",
    type: "message.first",
    enabledByDefault: true,
  },
];

export function getHookById(id: string): HookDefinition | undefined {
  return builtinHooks.find((h) => h.id === id);
}

export function getEnabledHooks(disabledHooks: string[]): HookDefinition[] {
  return builtinHooks.filter((h) => !disabledHooks.includes(h.id));
}