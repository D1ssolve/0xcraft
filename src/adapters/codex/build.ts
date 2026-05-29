/**
 * Codex adapter `build()` entry — ADR §6, Batch 4.
 *
 * Pure in-memory build. Delegates to `buildCodexFiles` and returns a
 * `PlatformArtifact` with files sorted by POSIX path. No tempdirs,
 * no disk read-back, no cleanup.
 *
 * Determinism: same `BuildOptions` → byte-identical `files` array and
 * sorted `diagnostics`. No timestamps.
 */

import type { Diagnostic } from "../../core/diagnostics";
import type {
  BuildOptions,
  PlatformArtifact,
  PlatformArtifactFile,
} from "../_shared/artifact";
import { CODEX_MATRIX } from "../_shared/capability-matrix";
import { DiagnosticCollector } from "../_shared/diagnostic-collector";

import { buildCodexFiles, type GenerateCodexPluginOptions } from "./index";

const PLATFORM = "codex" as const;

/* ---------------------------------------------------------------- */
/*  Artifact type                                                    */
/* ---------------------------------------------------------------- */

export interface CodexArtifact extends PlatformArtifact {
  platform: typeof PLATFORM;
  kind: "filesystem-tree";
  /** Adapter default output root (used by CLI writers). */
  outputPath: string;
}

/* ---------------------------------------------------------------- */
/*  build()                                                          */
/* ---------------------------------------------------------------- */

export async function build(options: BuildOptions): Promise<CodexArtifact> {
  const diagnostics = new DiagnosticCollector();

  // Adapter default outputPath when none supplied — same project root.
  // No tempdir, no disk side effects.
  const outputPath = options.outputRoot ?? options.projectRoot;

  const generatorOptions: GenerateCodexPluginOptions = {
    packageRoot: options.packageRoot,
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    config: options.config,
  };

  const built = await buildCodexFiles(generatorOptions);

  for (const d of built.diagnostics) {
    diagnostics.add(d);
  }

  const files = sortFiles(built.files);

  const ok = built.ok && !diagnostics.hasErrors();

  return {
    platform: PLATFORM,
    kind: "filesystem-tree",
    ok,
    files,
    diagnostics: diagnostics.sorted(),
    capabilityReport: {
      platform: PLATFORM,
      features: CODEX_MATRIX,
    },
    metadata: { deterministic: true },
    outputPath,
  };
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                          */
/* ---------------------------------------------------------------- */

function sortFiles(files: PlatformArtifactFile[]): PlatformArtifactFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// `Diagnostic` is re-exported for adapters consuming this module.
export type { Diagnostic };
