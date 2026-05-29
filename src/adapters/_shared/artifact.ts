/**
 * Adapter `build()` contract — `BuildOptions` and `PlatformArtifact`.
 *
 * Spec §4.1. Every per-platform adapter exports `build(options) =>
 * Promise<PlatformArtifact>`. Same `BuildOptions` + same registries MUST
 * produce a byte-identical `files` list, sorted `diagnostics`, and sorted
 * `capabilityReport.features`. No timestamps anywhere.
 *
 * `metadata.generatedAt?: never` enforces the no-timestamp rule at the
 * type level — any attempt to set it is a compile error.
 */

import type { CapabilityReport, Diagnostic, PlatformId } from "../../core/diagnostics";
import type { ZeroxCraftConfig } from "../../core/config/config-types";

/* ---------------------------------------------------------------- */
/*  BuildOptions                                                     */
/* ---------------------------------------------------------------- */

export interface BuildOptions {
  /** Resolved & validated configuration (post legacy normalization). */
  config: ZeroxCraftConfig;

  /** Absolute path to the consumer project root. */
  projectRoot: string;

  /** Absolute path to the 0xcraft package root (for bundled asset reads). */
  packageRoot: string;

  /**
   * Optional override for where filesystem-tree artifacts should be
   * written. Adapters compute their default when omitted.
   */
  outputRoot?: string;

  /** Strict mode upgrades drop/degrade warnings to errors per spec §11. */
  strict?: boolean;

  /**
   * Override for the user home directory. Primarily a test seam; defaults
   * to `os.homedir()` when the adapter needs it.
   */
  homeDir?: string;
}

/* ---------------------------------------------------------------- */
/*  PlatformArtifact                                                 */
/* ---------------------------------------------------------------- */

/**
 * The kind of artifact produced by `build()`. Determines which adapter
 * fields downstream consumers should read:
 *
 *   - `runtime-plugin`    — runtime plugin object (OpenCode)
 *   - `filesystem-tree`   — files to write to outputRoot (Claude Code
 *                           and Codex; Codex's `.codex/config.toml` +
 *                           `.codex/agents/*.toml` is a filesystem tree)
 *   - `config-fragment`   — config patch + auxiliary files (reserved
 *                           for future adapters; no current adapter
 *                           uses this kind)
 */
export type PlatformArtifactKind = "runtime-plugin" | "filesystem-tree" | "config-fragment";

/** A single file in `PlatformArtifact.files`. */
export interface PlatformArtifactFile {
  /** POSIX-style relative path from outputRoot. */
  path: string;
  /** UTF-8 file contents. Binary data must be base64-encoded by the adapter. */
  content: string;
  /** Optional POSIX file mode (e.g. `0o755` for executables). */
  mode?: number;
}

export interface PlatformArtifactMetadata {
  /** Always literal `true`. Marker that the build is deterministic. */
  deterministic: true;
  /**
   * Forbidden — no timestamps in artifacts. Encoded as `never` so that
   * any attempt to set it is a compile-time error.
   */
  generatedAt?: never;
  /** Optional 0xcraft version or content hash for provenance. */
  sourceVersion?: string;
}

export interface PlatformArtifact {
  platform: PlatformId;
  kind: PlatformArtifactKind;
  /** `true` when build succeeded with no `error` diagnostics. */
  ok: boolean;
  /** Files to be written (filesystem-tree / config-fragment artifacts). */
  files: PlatformArtifactFile[];
  /** Adapter-shaped config patch (runtime-plugin / config-fragment). */
  configPatch?: unknown;
  /** Adapter-shaped runtime plugin object (runtime-plugin artifacts). */
  runtimePlugin?: unknown;
  /** Sorted diagnostics produced during the build. */
  diagnostics: Diagnostic[];
  /** Per-feature capability report (spec §11). */
  capabilityReport: CapabilityReport;
  metadata: PlatformArtifactMetadata;
}
