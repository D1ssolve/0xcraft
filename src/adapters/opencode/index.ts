import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { createConfigHandler } from "./hooks/config-handler";
import { createAgentsGuardHook } from "./hooks/agents-guard";
import { createCavemanBootstrapHook } from "./hooks/caveman-bootstrap";
import { createGitWorktreeBootstrapHook } from "./hooks/git-worktree-bootstrap";
import { mergeConfig, type ZeroxCraftConfig } from "../../core/config";
import { builtinAgents } from "../../core/agents";
import { builtinSkills } from "../../core/skills";
import { builtinMcpServers } from "../../core/mcp";
import { builtinHooks } from "../../core/hooks";

/**
 * 0xcraft OpenCode plugin entry point.
 *
 * This is the thin adapter that connects the harness-agnostic core
 * to the OpenCode plugin API. All business logic lives in core/.
 */
export async function createPlugin(input: PluginInput): Promise<Hooks> {
  const { directory, worktree } = input;
  const projectRoot = worktree || directory || process.cwd();

  // TODO: Load user config from ~/.config/opencode/0xcraft.json[c]
  // and walked project configs. For now, use defaults.
  const userConfig: Partial<ZeroxCraftConfig> = {};
  const config = mergeConfig(userConfig);

  // Determine which hooks are active
  const enabledHooks = builtinHooks.filter(
    (h) => !config.disabledHooks.includes(h.id)
  );

  // Build the hooks object
  const hooks: Hooks = {};

  // Config hook — registers agents, skills, MCPs
  hooks.config = createConfigHandler({ config, projectRoot });

  // Message transform hook — injects bootstrap prompts on first message
  if (config.agentsGuardEnabled || config.cavemanBootstrapEnabled || config.gitWorktreeBootstrapEnabled) {
    hooks["experimental.chat.messages.transform"] = async (_input: unknown, output: any) => {
      if (!output.messages?.length) return;

      const firstUser = output.messages.find((m: any) => m.info?.role === "user");
      if (!firstUser?.parts?.length) return;

      // Check if already injected
      const alreadyInjected = firstUser.parts.some(
        (p: any) => p.type === "text" && p.text?.includes("0XCRAFT_BOOTSTRAP")
      );
      if (alreadyInjected) return;

      const bootstrapParts: string[] = [];

      if (config.agentsGuardEnabled) {
        const agentsGuard = createAgentsGuardHook({ projectRoot });
        const guardText = agentsGuard.buildBootstrap();
        if (guardText) bootstrapParts.push(guardText);
      }

      if (config.cavemanBootstrapEnabled) {
        const caveman = createCavemanBootstrapHook();
        const cavemanText = caveman.buildBootstrap();
        if (cavemanText) bootstrapParts.push(cavemanText);
      }

      if (config.gitWorktreeBootstrapEnabled) {
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