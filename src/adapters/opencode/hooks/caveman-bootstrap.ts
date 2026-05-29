import { buildCavemanBootstrap } from "../../_shared/bootstrap-text";

/**
 * Caveman bootstrap hook — injects caveman skill load instruction
 * on the first user message.
 *
 * Thin wrapper around the shared `buildCavemanBootstrap` builder.
 */
export function createCavemanBootstrapHook() {
  return {
    buildBootstrap(): string {
      return buildCavemanBootstrap({ projectRoot: "", platform: "opencode" }).text;
    },
  };
}
