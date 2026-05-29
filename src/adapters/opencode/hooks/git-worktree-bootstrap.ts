import { buildGitWorktreeBootstrap } from "../../_shared/bootstrap-text";

/**
 * Git Worktree bootstrap hook — injects the git-worktree skill load
 * instruction when the project root is a worktree or a `.tasks` folder.
 *
 * Thin wrapper around the shared `buildGitWorktreeBootstrap` builder.
 */
export function createGitWorktreeBootstrapHook(args: { projectRoot: string }) {
  const { projectRoot } = args;

  return {
    buildBootstrap(): string {
      return buildGitWorktreeBootstrap({ projectRoot, platform: "opencode" })?.text ?? "";
    },
  };
}
