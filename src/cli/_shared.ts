/**
 * Shared CLI helpers — harness id validation, diagnostic printing,
 * project/package root resolution, artifact writing, exit-code computation.
 *
 * Pure CLI utility surface. No `@opencode-ai/*` imports.
 *
 * Spec §10 / ADR §6.
 */
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Diagnostic } from "../core/diagnostics/diagnostic";
import { PLATFORM_IDS, isPlatformId, type PlatformId } from "../core/config/config-types";
import {
  resolvePackageRoot as resolvePackageRootShared,
  type ResolvePackageRootOptions,
} from "../adapters/_shared/package-root";
import {
  writeArtifact as writeArtifactShared,
  type WriteArtifactOptions,
  type WriteArtifactResult,
} from "../adapters/_shared/filesystem";
import type { PlatformArtifact } from "../adapters/_shared/artifact";
import { sanitizeDetails } from "../adapters/_shared/diagnostic-collector";

export { PLATFORM_IDS, isPlatformId, type PlatformId };
export type { Diagnostic, PlatformArtifact };

/* ---------------------------------------------------------------- */
/*  Project / package root                                            */
/* ---------------------------------------------------------------- */

export interface ResolveProjectRootOptions {
  /** Explicit `--project <dir>` argument. Wins over cwd-walk. */
  project?: string;
  /** Override cwd (test seam). */
  cwd?: string;
}

/**
 * Resolve the consumer project root.
 *
 * Priority:
 *   1. `options.project` if provided (resolved against cwd).
 *   2. Walk up from cwd looking for `package.json`; first match wins.
 *   3. Fall back to cwd.
 */
export function resolveProjectRoot(options: ResolveProjectRootOptions = {}): string {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.project !== undefined && options.project !== "") {
    return path.resolve(cwd, options.project);
  }
  let current = cwd;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwd;
}

/**
 * Resolve the 0xcraft package root by walking up from this module's
 * directory looking for the bundled `agents/` + `skills/` assets.
 */
export function resolvePackageRoot(options: ResolvePackageRootOptions = {}): string {
  const startDir =
    options.startDir ?? path.dirname(fileURLToPath(import.meta.url));
  return resolvePackageRootShared({ ...options, startDir });
}

/* ---------------------------------------------------------------- */
/*  Diagnostic printing                                               */
/* ---------------------------------------------------------------- */

export interface DiagnosticWriters {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface PrintDiagnosticsOptions extends DiagnosticWriters {
  /** When `true`, emit a single JSON line containing the diagnostics array. */
  json?: boolean;
}

/**
 * Print a Diagnostic in `[0xcraft] <LEVEL> <code> — <message>` format.
 * Routes `error` and `warn` to stderr; `info` to stdout.
 *
 * `details` are sanitized before printing (secret redaction per spec §12).
 */
export function printDiagnostic(diagnostic: Diagnostic, writers: DiagnosticWriters = {}): void {
  const stdout = writers.stdout ?? ((line: string) => console.log(line));
  const stderr = writers.stderr ?? ((line: string) => console.error(line));
  const level = diagnostic.severity.toUpperCase();
  const safeDetails = sanitizeDetails(diagnostic.details);
  const suffix = safeDetails ? ` ${JSON.stringify(safeDetails)}` : "";
  const line = `[0xcraft] ${level} ${diagnostic.code} — ${diagnostic.message}${suffix}`;
  if (diagnostic.severity === "error" || diagnostic.severity === "warn") {
    stderr(line);
  } else {
    stdout(line);
  }
}

/**
 * Print every diagnostic. Respects `--json` by emitting a single JSON
 * line of the (sanitized) diagnostics array on stdout instead of human
 * lines. Always prefixed `[0xcraft]`.
 */
export function printDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: PrintDiagnosticsOptions = {},
): void {
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  if (options.json) {
    const sanitized = diagnostics.map((d) => {
      const safe: Diagnostic = {
        severity: d.severity,
        code: d.code,
        message: d.message,
      };
      const dt = sanitizeDetails(d.details);
      if (dt !== undefined) safe.details = dt;
      return safe;
    });
    stdout(JSON.stringify({ diagnostics: sanitized }));
    return;
  }
  for (const d of diagnostics) {
    printDiagnostic(d, options);
  }
}

export function diagnosticsHaveError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export function diagnosticsHaveWarn(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "warn");
}

/* ---------------------------------------------------------------- */
/*  Strict mode                                                       */
/* ---------------------------------------------------------------- */

/**
 * Return a copy of `diagnostics` with every `warn` upgraded to `error`.
 * Used by `doctor --strict` and `install --strict`.
 */
export function upgradeWarnsToErrors(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map((d) =>
    d.severity === "warn" ? { ...d, severity: "error" as const } : { ...d },
  );
}

/* ---------------------------------------------------------------- */
/*  Exit-code policy                                                  */
/* ---------------------------------------------------------------- */

/**
 * Compute exit code from a diagnostic stream per spec §10:
 *   - 0: no diagnostics, or only `info` entries
 *   - 1: any `error`
 *   - 2: no `error` but at least one `warn`
 */
export function exitFromDiagnostics(diagnostics: readonly Diagnostic[]): 0 | 1 | 2 {
  if (diagnosticsHaveError(diagnostics)) return 1;
  if (diagnosticsHaveWarn(diagnostics)) return 2;
  return 0;
}

/* ---------------------------------------------------------------- */
/*  Artifact writing                                                  */
/* ---------------------------------------------------------------- */

/**
 * Write a `PlatformArtifact` to `outputRoot`. Delegates to
 * `adapters/_shared/filesystem.writeArtifact` which enforces root
 * containment (no path traversal escape).
 */
export function writeArtifact(
  artifact: PlatformArtifact,
  outputRoot: string,
  options: WriteArtifactOptions = {},
): WriteArtifactResult {
  return writeArtifactShared(artifact, outputRoot, options);
}

export type { WriteArtifactOptions, WriteArtifactResult };

/* ---------------------------------------------------------------- */
/*  bun PATH probe                                                    */
/* ---------------------------------------------------------------- */

/**
 * Probe `bun --version`. Returns null when bun is on PATH, otherwise an
 * error-severity Diagnostic suitable for doctor output.
 *
 * Injectable for tests via the `bunOnPathChecker` dependency on
 * `runDoctor`.
 */
export type BunOnPathChecker = () => Diagnostic | null;

export const defaultBunOnPathChecker: BunOnPathChecker = () => {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return null;
  } catch {
    return {
      severity: "error",
      code: "bun.not_on_path",
      message: "bun not found on PATH; hook scripts require bun",
    };
  }
};
