import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { createConfigHandler } from "./hooks/config-handler";
import { createHookTransform } from "./hooks/hook-shim-builder";
import { loadConfig } from "../../core/config";
import { builtinHooks } from "../../core/hooks";
import { createOpenCodeLogger } from "./logger";
import { resolvePackageRoot as sharedResolvePackageRoot } from "../_shared/package-root";

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

export function resolvePluginRoot(input: PluginRootInput, client?: unknown): string {
  const logger = createOpenCodeLogger({ client });
  const worktree = usableRoot(input.worktree);
  const directory = usableRoot(input.directory);

  if (worktree) {
    if (directory && worktree !== directory) {
      logger.log({
        severity: "info",
        code: "opencode.root.worktree_directory_differ",
        message: "OpenCode worktree and directory differ; using worktree.",
        details: { worktree, directory },
      });
    }
    return worktree;
  }

  if (directory) return directory;

  const cwd = process.cwd();
  logger.log({
    severity: "warn",
    code: "opencode.root.fallback.cwd",
    message: "OpenCode root missing; using process.cwd().",
    details: { cwd },
  });
  return cwd;
}

/**
 * Resolve the 0xcraft package root containing `agents/` and `skills/` asset
 * directories. Delegates to `_shared/package-root.resolvePackageRoot` and
 * logs a warning via the OpenCode client logger when no candidate matches.
 *
 * Kept as a thin re-export so existing callers (and tests) keep the same
 * signature including the `client` logger arg.
 */
export function resolvePackageRoot(args: { startDir: string; cwd?: string; client?: unknown }): string {
  const startDir = path.resolve(args.startDir);
  const cwd = path.resolve(args.cwd ?? process.cwd());
  const resolved = sharedResolvePackageRoot({ startDir, cwd });

  // Shared helper falls back to `startDir` when no assets are found, so a
  // result equal to `startDir` without assets indicates a lookup miss.
  if (resolved === startDir) {
    const startHasAssets =
      fs.existsSync(path.join(startDir, "agents")) && fs.existsSync(path.join(startDir, "skills"));
    if (!startHasAssets) {
      const logger = createOpenCodeLogger({ client: args.client });
      logger.log({
        severity: "warn",
        code: "opencode.package_root.not_found",
        message: "Unable to resolve 0xcraft package root with agents/ and skills/ assets.",
        details: { startDir, cwd },
      });
    }
  }
  return resolved;
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

  // Load config from walked project configs + user config (harness=opencode).
  const logger = createOpenCodeLogger({ client: input.client });
  const { config } = loadConfig({
    harness: "opencode",
    projectRoot,
    homeDir: options.homeDir,
    diagnosticSink: (d) => logger.log(d),
  });

  // Determine which hooks are active purely from `disabled.hooks`.
  const enabledHooks = builtinHooks.filter((h) => !config.disabled.hooks.includes(h.id));

  const hooks: Hooks = {};

  // Config hook — registers agents, skills, MCPs.
  const configHandler = createConfigHandler({ config, projectRoot, pkgRoot: packageRoot });
  hooks.config = async (inputConfig) => {
    await configHandler(inputConfig as unknown as MutableConfigShape);
  };

  // Message transform hook — injects bootstrap prompts on first user
  // message. Only registered when at least one bootstrap hook is enabled.
  if (enabledHooks.length > 0) {
    hooks["experimental.chat.messages.transform"] = createHookTransform({
      hooks: enabledHooks,
      projectRoot,
    });
  }

  return hooks;
}

export const createPlugin: Plugin = async (input) => createPluginHooks(input);

/* ------------------------------------------------------------------ */
/*  Batch 4 — canonical build() entry (ADR §6)                         */
/* ------------------------------------------------------------------ */
export { build, type OpenCodeArtifact } from "./build";
