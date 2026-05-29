/**
 * Codex marketplace stub emitter — Batch E / T-19.
 *
 * Produces a repo-local `.agents/plugins/marketplace.json` describing
 * the single `.codex-plugin/` bundle this repo emits. Pure function,
 * no filesystem access.
 *
 * Gating is performed by the caller (orchestrator checks
 * `config.platforms.codex.emitMarketplace === true` AND
 * `emitPlugin === true`). CLI flag `--marketplace` without `--plugin`
 * is rejected separately in `src/cli/codex.ts` (T-25).
 */

import type { CodexBuiltFile } from "../index";

const MARKETPLACE_PATH = ".agents/plugins/marketplace.json";

export interface EmitCodexMarketplaceOptions {
  packageName: string;
  packageVersion?: string;
  /** Relative path to the bundle dir. Defaults to "./.codex-plugin". */
  bundlePath?: string;
}

export interface CodexMarketplaceManifest {
  name: string;
  plugins: Array<{
    name: string;
    path: string;
    version?: string;
  }>;
}

export interface EmitCodexMarketplaceResult {
  files: CodexBuiltFile[];
  manifest: CodexMarketplaceManifest;
}

export function emitCodexMarketplace(
  options: EmitCodexMarketplaceOptions,
): EmitCodexMarketplaceResult {
  const bundlePath = options.bundlePath ?? "./.codex-plugin";

  const plugin: CodexMarketplaceManifest["plugins"][number] = {
    name: options.packageName,
    path: bundlePath,
  };
  if (options.packageVersion !== undefined) {
    plugin.version = options.packageVersion;
  }

  const manifest: CodexMarketplaceManifest = {
    name: `${options.packageName}-marketplace`,
    plugins: [plugin],
  };

  return {
    manifest,
    files: [
      {
        path: MARKETPLACE_PATH,
        content: JSON.stringify(manifest, null, 2) + "\n",
      },
    ],
  };
}
