/**
 * Pure builders for the three built-in bootstrap hooks.
 *
 * These produce the literal text payloads that the OpenCode, Claude
 * Code, and Codex adapters inject on session start / first user prompt.
 * The text is identical across harnesses; only the injection mechanism
 * differs per platform.
 *
 * Each builder returns:
 *   - `{ marker, text }` when the hook should fire, OR
 *   - `null` when the hook is a no-op for the current project state
 *     (e.g. AGENTS.md already exists; not a worktree).
 *
 * IMPORTANT: these builders MUST NOT import from any per-harness adapter
 * or platform SDK. The text is harness-neutral.
 */

import fs from "node:fs";
import path from "node:path";
import type { PlatformId } from "../../core/config/config-types";
import { getHookById } from "../../core/hooks";

export type { PlatformId };

export interface BootstrapBuilderContext {
  projectRoot: string;
  platform: PlatformId;
}

export interface BootstrapPayload {
  marker: string;
  text: string;
}

export const CAVEMAN_MARKER = "<!-- CAVEMAN_BOOTSTRAP_INJECTED -->";
export const AGENTS_GUARD_MARKER = "<!-- AGENTS_GUARD_INJECTED -->";
export const GIT_WORKTREE_MARKER = "<!-- GIT_WORKTREE_BOOTSTRAP_INJECTED -->";

export function buildCavemanBootstrap(_ctx: BootstrapBuilderContext): BootstrapPayload {
  const text = `${CAVEMAN_MARKER}
<EXTREMELY_IMPORTANT>
Caveman mode must be active for this session.

Use the skill tool to load the "caveman" skill IMMEDIATELY — this is not optional. Call the skill tool with name="caveman" right now, before responding to any user message. The caveman skill contains the always-on communication rules that must be applied to every response.

Do NOT load the caveman skill again after this first load — it persists for the entire session.
</EXTREMELY_IMPORTANT>`;
  return { marker: CAVEMAN_MARKER, text };
}

export function buildAgentsGuardBootstrap(ctx: BootstrapBuilderContext): BootstrapPayload | null {
  const agentsPath = path.join(ctx.projectRoot, "AGENTS.md");
  if (fs.existsSync(agentsPath)) return null;

  const text = `${AGENTS_GUARD_MARKER}
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
  return { marker: AGENTS_GUARD_MARKER, text };
}

export function buildGitWorktreeBootstrap(ctx: BootstrapBuilderContext): BootstrapPayload | null {
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

  const text = `${GIT_WORKTREE_MARKER}
<GitWorktree_Context>
Use the skill tool to load the "git-worktree" skill IMMEDIATELY — this is not optional.

Do NOT load the git-worktree skill again after this first load — it persists for the entire session.
</GitWorktree_Context>`;
  return { marker: GIT_WORKTREE_MARKER, text };
}

/**
 * Return the raw bootstrap text for a known hook id WITHOUT applying any
 * filesystem gating (e.g. AGENTS.md presence, .git worktree detection).
 *
 * Generators that need to inline the bootstrap payload into a self-contained
 * runtime script (where the runtime check happens at script execution time,
 * not at generation time) use this. Returns `null` for unknown hook ids.
 *
 * NOTE: `projectRoot` only affects the agents-guard text (it embeds the path
 * in the message). When generating reusable scripts that resolve their own
 * project root at runtime, pass the placeholder the script will substitute,
 * or accept that the embedded path string is informational only.
 */
export function getBootstrapTextForHookId(
  hookId: string,
  ctx: BootstrapBuilderContext = { projectRoot: "<project>", platform: "codex" },
): string | null {
  switch (hookId) {
    case "caveman-bootstrap":
      return buildCavemanBootstrap(ctx).text;
    case "agents-guard": {
      // Build the text directly — skip the AGENTS.md filesystem gate.
      return `${AGENTS_GUARD_MARKER}
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
    }
    case "git-worktree-bootstrap":
      return `${GIT_WORKTREE_MARKER}
<GitWorktree_Context>
Use the skill tool to load the "git-worktree" skill IMMEDIATELY — this is not optional.

Do NOT load the git-worktree skill again after this first load — it persists for the entire session.
</GitWorktree_Context>`;
    default:
      return null;
  }
}

/**
 * Convenience dispatcher: maps a hook ID to its builder.
 * Returns `null` when the hook ID is unknown or the builder opts out.
 */
export function buildBootstrapByHookId(
  hookId: string,
  ctx: BootstrapBuilderContext,
): BootstrapPayload | null {
  // Prefer the hook's own `buildContext` builder when available — keeps
  // bootstrap text owned by the hook definition. Falls back to the legacy
  // switch below when the hook lacks `buildContext` (defensive default).
  const hook = getHookById(hookId);
  if (hook?.buildContext) {
    const text = hook.buildContext(ctx);
    if (text === null) return null;
    return { marker: hook.marker, text };
  }

  switch (hookId) {
    case "caveman-bootstrap":
      return buildCavemanBootstrap(ctx);
    case "agents-guard":
      return buildAgentsGuardBootstrap(ctx);
    case "git-worktree-bootstrap":
      return buildGitWorktreeBootstrap(ctx);
    default:
      return null;
  }
}
