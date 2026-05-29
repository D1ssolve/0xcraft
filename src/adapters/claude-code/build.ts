/**
 * Claude Code adapter `build()` entry — T-12.9 in-memory refactor.
 *
 * Calls `buildClaudeCodeFiles` to run the generator orchestration
 * against an in-memory writer, then assembles the canonical
 * `PlatformArtifact` directly from the captured files. No `mkdtempSync`,
 * no `rmSync`, no `readFileSync` round-trip.
 *
 * Determinism: same `BuildOptions` → byte-identical `files` arrays
 * across consecutive calls.
 */

import type { Diagnostic } from "../../core/diagnostics";
import type {
  BuildOptions,
  PlatformArtifact,
  PlatformArtifactFile,
} from "../_shared/artifact";
import { CLAUDE_CODE_MATRIX } from "../_shared/capability-matrix";
import { DiagnosticCollector } from "../_shared/diagnostic-collector";

import {
  buildClaudeCodeFiles,
  type BuildClaudeCodeFilesOptions,
  type ClaudeCodeGeneratorDiagnostic,
} from "./index";

const PLATFORM = "claude-code" as const;

/* ---------------------------------------------------------------- */
/*  Artifact type                                                    */
/* ---------------------------------------------------------------- */

export interface ClaudeCodeArtifact extends PlatformArtifact {
  platform: typeof PLATFORM;
  kind: "filesystem-tree";
}

/* ---------------------------------------------------------------- */
/*  build()                                                          */
/* ---------------------------------------------------------------- */

export async function build(options: BuildOptions): Promise<ClaudeCodeArtifact> {
  const diagnostics = new DiagnosticCollector();

  const builderOptions: BuildClaudeCodeFilesOptions = {
    packageRoot: options.packageRoot,
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    config: options.config,
  };

  const result = await buildClaudeCodeFiles(builderOptions);

  for (const d of result.diagnostics) {
    diagnostics.add(toCoreDiagnostic(d));
  }

  // Convert in-memory files → PlatformArtifactFile[], sorted by POSIX path.
  const files: PlatformArtifactFile[] = result.files.map((f) => {
    const out: PlatformArtifactFile = { path: f.path, content: f.content };
    if (f.mode !== undefined) out.mode = f.mode;
    return out;
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const ok = result.ok && !diagnostics.hasErrors();

  return {
    platform: PLATFORM,
    kind: "filesystem-tree",
    ok,
    files,
    diagnostics: diagnostics.sorted(),
    capabilityReport: {
      platform: PLATFORM,
      features: CLAUDE_CODE_MATRIX,
    },
    metadata: { deterministic: true },
  };
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                          */
/* ---------------------------------------------------------------- */

function toCoreDiagnostic(d: ClaudeCodeGeneratorDiagnostic): Diagnostic {
  return {
    severity: d.severity === "error" ? "error" : "warn",
    code: d.code,
    message: d.message,
    ...(d.details ? { details: d.details } : {}),
  };
}
