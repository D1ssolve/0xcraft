import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createConfigHandler } from "./hooks/config-handler";
import { createAgentsGuardHook } from "./hooks/agents-guard";
import { createCavemanBootstrapHook } from "./hooks/caveman-bootstrap";
import { createGitWorktreeBootstrapHook } from "./hooks/git-worktree-bootstrap";
import { mergeConfig, loadConfig, type ZeroxCraftConfig } from "../../core/config";
import { builtinHooks } from "../../core/hooks";

function findPackageRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, "agents")) && fs.existsSync(path.join(current, "skills"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * 0xcraft OpenCode plugin entry point.
 *
 * This is the thin adapter that connects the harness-agnostic core
 * to the OpenCode plugin API. All business logic lives in core/.
 *
 * The plugin function signature matches @opencode-ai/plugin's Plugin type.
 */
export async function createPlugin(input: {
  worktree?: string;
  directory?: string;
  project?: unknown;
  client?: unknown;
  $?: unknown;
  [key: string]: unknown;
}): Promise<Record<string, unknown>> {
  const projectRoot = input.worktree || input.directory || process.cwd();
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

  // Load config from walked project configs + user config
  const { config: rawConfig } = loadConfig(projectRoot);
  const userConfig: Partial<ZeroxCraftConfig> = rawConfig as Partial<ZeroxCraftConfig>;
  const config = mergeConfig(userConfig);

  // Determine which hooks are active (respects both boolean flags AND disabledHooks)
  const enabledHooks = builtinHooks.filter(
    (h) => !config.disabledHooks.includes(h.id)
  );
  const isHookActive = (hookId: string): boolean =>
    enabledHooks.some((h) => h.id === hookId);

  // Build the hooks object
  const hooks: Record<string, unknown> = {};

  // Config hook — registers agents, skills, MCPs
  hooks.config = createConfigHandler({ config, projectRoot, pkgRoot: packageRoot });

  // Message transform hook — injects bootstrap prompts on first message
  const agentsGuardActive = config.agentsGuardEnabled && isHookActive("agents-guard");
  const cavemanActive = config.cavemanBootstrapEnabled && isHookActive("caveman-bootstrap");
  const worktreeActive = config.gitWorktreeBootstrapEnabled && isHookActive("git-worktree-bootstrap");

  if (agentsGuardActive || cavemanActive || worktreeActive) {
    hooks["experimental.chat.messages.transform"] = async (_input: unknown, output: any) => {
      if (!output.messages?.length) return;

      const firstUser = output.messages.find((m: any) => m.info?.role === "user");
      if (!firstUser?.parts?.length) return;

      // Check if already injected by any of our markers
      const alreadyInjected = firstUser.parts.some(
        (p: any) => p.type === "text" && (
          p.text?.includes("AGENTS_GUARD_INJECTED") ||
          p.text?.includes("CAVEMAN_BOOTSTRAP_INJECTED") ||
          p.text?.includes("GIT_WORKTREE_BOOTSTRAP_INJECTED")
        )
      );
      if (alreadyInjected) return;

      const bootstrapParts: string[] = [];

      if (agentsGuardActive) {
        const agentsGuard = createAgentsGuardHook({ projectRoot });
        const guardText = agentsGuard.buildBootstrap();
        if (guardText) bootstrapParts.push(guardText);
      }

      if (cavemanActive) {
        const caveman = createCavemanBootstrapHook();
        const cavemanText = caveman.buildBootstrap();
        if (cavemanText) bootstrapParts.push(cavemanText);
      }

      if (worktreeActive) {
        const worktreeHook = createGitWorktreeBootstrapHook({ projectRoot });
        const worktreeText = worktreeHook.buildBootstrap();
        if (worktreeText) bootstrapParts.push(worktreeText);
      }

      if (bootstrapParts.length > 0) {
        const combinedBootstrap = bootstrapParts.join("\n\n");
        const referencePart = firstUser.parts[0];
        firstUser.parts.unshift({ ...referencePart, type: "text", text: combinedBootstrap });
      }
    };
  }

  return hooks;
}
