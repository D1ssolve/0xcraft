import { buildAgentsGuardBootstrap } from "../../_shared/bootstrap-text";

/**
 * Agents Guard hook — checks for AGENTS.md on first message.
 *
 * Thin wrapper around the shared `buildAgentsGuardBootstrap` builder.
 * Preserves the legacy `buildBootstrap(): string` contract callers expect
 * (returns "" when the hook opts out, matching prior null→"" coalescing).
 */
export function createAgentsGuardHook(args: { projectRoot: string }) {
  const { projectRoot } = args;

  return {
    buildBootstrap(): string {
      return buildAgentsGuardBootstrap({ projectRoot, platform: "opencode" })?.text ?? "";
    },
  };
}
