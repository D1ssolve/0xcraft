/**
 * OpenCode adapter `build()` entry — ADR §6, Batch 4.
 *
 * Unlike Claude Code / Codex, OpenCode integrates as a runtime plugin
 * rather than a filesystem-tree emission. `build()` therefore returns
 * `kind: "runtime-plugin"` and exposes `runtimePlugin` (the existing
 * `createPlugin` function, which already conforms to `@opencode-ai/
 * plugin`'s `Plugin` type).
 *
 * `BuildOptions.{config,projectRoot,packageRoot,outputRoot}` do not
 * apply at build time for OpenCode — configuration is resolved
 * dynamically inside the plugin at hook-invocation time via the
 * existing `createPluginHooks` path. This wrapper exists so that
 * callers can use a single canonical entry-point across all three
 * harnesses (ADR §6).
 *
 * Determinism: trivially holds — no I/O, no `files`.
 *
 * NOTE: `@opencode-ai/plugin` types remain scoped to this module
 * subtree (re-exported via `Plugin` only for the runtimePlugin field).
 */

import type { Plugin } from "@opencode-ai/plugin";

import type { BuildOptions, PlatformArtifact } from "../_shared/artifact";
import { OPENCODE_MATRIX } from "../_shared/capability-matrix";
import { DiagnosticCollector } from "../_shared/diagnostic-collector";

import { createPlugin } from "./index";
import { emitOpenCodeHookMatrixSweep } from "./mappers/hooks";

const PLATFORM = "opencode" as const;

/* ---------------------------------------------------------------- */
/*  Artifact type                                                    */
/* ---------------------------------------------------------------- */

export interface OpenCodeArtifact extends PlatformArtifact {
  platform: typeof PLATFORM;
  kind: "runtime-plugin";
  runtimePlugin: Plugin;
}

/* ---------------------------------------------------------------- */
/*  build()                                                          */
/* ---------------------------------------------------------------- */

// Intentionally async to match the canonical `build()` contract across
// adapters even though no I/O is performed.
export async function build(_options: BuildOptions): Promise<OpenCodeArtifact> {
  const diagnostics = new DiagnosticCollector();
  // T-6.3: emit one `hook.unsupported` warn per drop-warn cell on
  // OPENCODE_MATRIX. Configuration-independent / deterministic.
  emitOpenCodeHookMatrixSweep(diagnostics);

  return {
    platform: PLATFORM,
    kind: "runtime-plugin",
    ok: !diagnostics.hasErrors(),
    files: [],
    runtimePlugin: createPlugin,
    diagnostics: diagnostics.sorted(),
    capabilityReport: {
      platform: PLATFORM,
      features: OPENCODE_MATRIX,
    },
    metadata: { deterministic: true },
  };
}
