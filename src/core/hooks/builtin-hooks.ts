/**
 * Built-in hook registry — harness-agnostic.
 *
 * Hooks are defined as plain data here. Adapters (OpenCode, Claude Code,
 * Codex) read this registry and translate each entry into their native
 * hook surface (or `drop-warn` per the capability matrix).
 *
 * Token optimisation: bootstrap-style hooks inject only on session
 * start (or the first user prompt), never on every message.
 */

import fs from "node:fs";
import path from "node:path";
import type { HookSpec, HookContext } from "./hook-spec";
import { HookEvent } from "./hook-event";

export const builtinHooks: HookSpec[] = [
  {
    id: "agents-guard",
    description:
      "On the first user prompt, checks whether AGENTS.md exists at the project root. If missing, injects a high-priority instruction to run codebase-indexer before handling the user's request.",
    event: HookEvent.UserPromptFirst,
    enabledByDefault: true,
    marker: "<!-- AGENTS_GUARD_INJECTED -->",
    buildContext: (ctx: HookContext) => {
      const agentsPath = path.join(ctx.projectRoot, "AGENTS.md");
      if (fs.existsSync(agentsPath)) return null;
      return `<!-- AGENTS_GUARD_INJECTED -->
<EXTREMELY_IMPORTANT>
AGENTS.md is missing from the project root (${ctx.projectRoot}).

You MUST run the codebase-indexer agent NOW, before doing anything else.
Do NOT start on the user's request until AGENTS.md has been written to disk.

Steps:
1. Invoke the \`codebase-indexer\` agent for this project (root: ${ctx.projectRoot}).
2. Wait until it writes AGENTS.md.
3. Read AGENTS.md.
4. Then fulfill the user's original request using the conventions documented there.
</EXTREMELY_IMPORTANT>`;
    },
  },
  {
    id: "caveman-bootstrap",
    description:
      "On session start, injects a bootstrap instruction to load the caveman skill. The skill itself is loaded lazily via the skill tool, not injected into every message.",
    event: HookEvent.SessionStart,
    enabledByDefault: true,
    marker: "<!-- CAVEMAN_BOOTSTRAP_INJECTED -->",
    buildContext: () => {
      return `<!-- CAVEMAN_BOOTSTRAP_INJECTED -->
<EXTREMELY_IMPORTANT>
Caveman mode must be active for this session.

Use the skill tool to load the "caveman" skill IMMEDIATELY — this is not optional. Call the skill tool with name="caveman" right now, before responding to any user message. The caveman skill contains the always-on communication rules that must be applied to every response.

Do NOT load the caveman skill again after this first load — it persists for the entire session.
</EXTREMELY_IMPORTANT>`;
    },
  },
  {
    id: "git-worktree-bootstrap",
    description:
      "On session start, injects a bootstrap instruction to load the git-worktree skill when the project is inside a .tasks task folder or has a .git file (worktree indicator).",
    event: HookEvent.SessionStart,
    enabledByDefault: true,
    marker: "<!-- GIT_WORKTREE_BOOTSTRAP_INJECTED -->",
    buildContext: (ctx: HookContext) => {
      const gitPath = path.join(ctx.projectRoot, ".git");
      let isWorktree = false;
      try {
        isWorktree = fs.existsSync(gitPath) && fs.statSync(gitPath).isFile();
      } catch {
        isWorktree = false;
      }
      const tasksPath = path.join(ctx.projectRoot, ".tasks");
      const isTaskFolder = fs.existsSync(tasksPath);
      if (!isWorktree && !isTaskFolder) return null;
      return `<!-- GIT_WORKTREE_BOOTSTRAP_INJECTED -->
<GitWorktree_Context>
Use the skill tool to load the "git-worktree" skill IMMEDIATELY — this is not optional.

Do NOT load the git-worktree skill again after this first load — it persists for the entire session.
</GitWorktree_Context>`;
    },
  },
];

export function getHookById(id: string): HookSpec | undefined {
  return builtinHooks.find((h) => h.id === id);
}

export function getEnabledHooks(disabledHooks: string[]): HookSpec[] {
  return builtinHooks.filter((h) => !disabledHooks.includes(h.id));
}
