/**
 * Git Worktree bootstrap hook — injects git-worktree skill load instruction
 * when the project is inside a .tasks task folder or has a .git file.
 *
 * Token optimization: only injects on the FIRST user message.
 * The actual skill content is loaded lazily via the skill tool.
 */
const MARKER = "GIT_WORKTREE_BOOTSTRAP_INJECTED";

export function createGitWorktreeBootstrapHook(args: { projectRoot: string }) {
  const { projectRoot } = args;

  return {
    buildBootstrap(): string | null {
      // Only inject if we're in a worktree context
      // Check for .git file (not directory) — indicates a worktree
      const gitPath = path.join(projectRoot, ".git");
      const isWorktree = fs.existsSync(gitPath) && fs.statSync(gitPath).isFile();

      // Check for .tasks directory — indicates task folder
      const tasksPath = path.join(projectRoot, ".tasks");
      const isTaskFolder = fs.existsSync(tasksPath);

      if (!isWorktree && !isTaskFolder) return null;

      return `<!-- ${MARKER} -->
<GitWorktree_Context>
Use the skill tool to load the "git-worktree" skill IMMEDIATELY — this is not optional.

Do NOT load the git-worktree skill again after this first load — it persists for the entire session.
</GitWorktree_Context>`;
    },
  };
}

import path from "path";
import fs from "fs";