import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { createConfigHandler } from "./hooks/config-handler";
import { createAgentsGuardHook } from "./hooks/agents-guard";
import { createCavemanBootstrapHook } from "./hooks/caveman-bootstrap";
import { createGitWorktreeBootstrapHook } from "./hooks/git-worktree-bootstrap";
import { mergeConfig, loadConfig, type ZeroxCraftConfig } from "../../core/config";
import { builtinHooks } from "../../core/hooks";
import { createOpenCodeLogger } from "./logger";

type MutableConfigShape = Record<string, unknown>;
type PluginInput = Parameters<Plugin>[0];

interface CreatePluginOptions {
  homeDir?: string;
  packageStartDir?: string;
  packageCwd?: string;
}

interface PluginRootInput {
  worktree?: unknown;
  directory?: unknown;
}

function usableRoot(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
}

function hasPackageAssets(root: string): boolean {
  return fs.existsSync(path.join(root, "agents")) && fs.existsSync(path.join(root, "skills"));
}

export function resolvePluginRoot(input: PluginRootInput, client?: unknown): string {
  const logger = createOpenCodeLogger({ client });
  const worktree = usableRoot(input.worktree);
  const directory = usableRoot(input.directory);

  if (worktree) {
    if (directory && worktree !== directory) {
      logger.log({
        level: "debug",
        code: "opencode.root.worktree_directory_differ",
        message: "OpenCode worktree and directory differ; using worktree.",
        extra: { worktree, directory },
      });
    }
    return worktree;
  }

  if (directory) return directory;

  const cwd = process.cwd();
  logger.log({
    level: "warn",
    code: "opencode.root.fallback.cwd",
    message: "OpenCode root missing; using process.cwd().",
    extra: { cwd },
  });
  return cwd;
}

export function resolvePackageRoot(args: { startDir: string; cwd?: string; client?: unknown }): string {
  const logger = createOpenCodeLogger({ client: args.client });
  const startDir = path.resolve(args.startDir);
  const cwd = path.resolve(args.cwd ?? process.cwd());
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    if (hasPackageAssets(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (hasPackageAssets(cwd)) return cwd;

  logger.log({
    level: "warn",
    code: "opencode.package_root.not_found",
    message: "Unable to resolve 0xcraft package root with agents/ and skills/ assets.",
    extra: { startDir, cwd },
  });
  return startDir;
}

/**
 * 0xcraft OpenCode plugin entry point.
 *
 * This is the thin adapter that connects the harness-agnostic core
 * to the OpenCode plugin API. All business logic lives in core/.
 *
 * The plugin function signature matches @opencode-ai/plugin's Plugin type.
 */
export async function createPluginHooks(input: PluginInput, options: CreatePluginOptions = {}): Promise<Hooks> {
  const projectRoot = resolvePluginRoot(input, input.client);
  const packageRoot = resolvePackageRoot({
    startDir: options.packageStartDir ?? path.dirname(fileURLToPath(import.meta.url)),
    cwd: options.packageCwd,
    client: input.client,
  });

  // Load config from walked project configs + user config
  const { config: rawConfig } = loadConfig(projectRoot, options.homeDir, {
    diagnosticSink: createOpenCodeLogger({ client: input.client }).log,
  });
  const userConfig: Partial<ZeroxCraftConfig> = rawConfig as Partial<ZeroxCraftConfig>;
  const config = mergeConfig(userConfig);

  // Determine which hooks are active (respects both boolean flags AND disabledHooks)
  const enabledHooks = builtinHooks.filter(
    (h) => !config.disabledHooks.includes(h.id)
  );
  const isHookActive = (hookId: string): boolean =>
    enabledHooks.some((h) => h.id === hookId);

  // Build the hooks object
  const hooks: Hooks = {};

  // Config hook — registers agents, skills, MCPs
  const configHandler = createConfigHandler({ config, projectRoot, pkgRoot: packageRoot });
  hooks.config = async (inputConfig) => {
    await configHandler(inputConfig as unknown as MutableConfigShape);
  };

  // Message transform hook — injects bootstrap prompts on first message
  const agentsGuardActive = config.agentsGuardEnabled && isHookActive("agents-guard");
  const cavemanActive = config.cavemanBootstrapEnabled && isHookActive("caveman-bootstrap");
  const worktreeActive = config.gitWorktreeBootstrapEnabled && isHookActive("git-worktree-bootstrap");

  interface MessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
  }

  interface OcMessage {
    info?: { role?: string; [key: string]: unknown };
    parts?: MessagePart[];
    [key: string]: unknown;
  }

  interface TransformOutput {
    messages?: OcMessage[];
    [key: string]: unknown;
  }

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  if (agentsGuardActive || cavemanActive || worktreeActive) {
    hooks["experimental.chat.messages.transform"] = async (_input: unknown, output: unknown) => {
      if (!isRecord(output)) return;
      const messages = (output as TransformOutput).messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

      const firstUser = messages.find((m): m is OcMessage =>
        isRecord(m) && isRecord(m.info) && m.info.role === "user"
      );
      if (!firstUser) return;
      if (!Array.isArray(firstUser.parts) || firstUser.parts.length === 0) return;

      // Check if already injected by any of our markers
      const alreadyInjected = firstUser.parts.some(
        (p) => isRecord(p) && p.type === "text" && typeof p.text === "string" && (
          p.text.includes("AGENTS_GUARD_INJECTED") ||
          p.text.includes("CAVEMAN_BOOTSTRAP_INJECTED") ||
          p.text.includes("GIT_WORKTREE_BOOTSTRAP_INJECTED")
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
        const basePart = isRecord(referencePart) ? referencePart : {};
        firstUser.parts.unshift({ ...basePart, type: "text", text: combinedBootstrap });
      }
    };
  }

  return hooks;
}

export const createPlugin: Plugin = async (input) => createPluginHooks(input);
