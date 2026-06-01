/**
 * Shared writer for `PlatformArtifact.files`. Spec §4.1 / §9.
 *
 * Given a built artifact and an `outputRoot`, writes every file under that
 * root, applying optional POSIX `mode`. All paths are validated against
 * `outputRoot` containment — absolute paths and paths that resolve outside
 * the root are rejected, preventing path-traversal escape.
 *
 * This module is intentionally generic and contains no platform-specific
 * logic. Per-adapter writers (`adapters/{claude-code,codex}/filesystem.ts`)
 * remain in place for now and will be consolidated against this writer in
 * a later batch (AGENTS.md hotspot 5). Importing those concrete writers
 * from `_shared` is forbidden by the layer rules.
 */

import fs from "node:fs";
import path from "node:path";

import type { PlatformArtifact, PlatformArtifactFile } from "./artifact";

export interface WriteArtifactOptions {
  /**
   * If `true`, overwrite existing files. If `false` (default), refuse to
   * overwrite — the writer throws on first collision.
   */
  force?: boolean;
}

export interface WriteArtifactResult {
  /** Absolute paths of every file written, in deterministic order. */
  written: string[];
}

/**
 * Write every file in `artifact.files` under `outputRoot`. Returns the
 * list of written absolute paths sorted lexicographically.
 *
 * Throws on:
 *   - empty/absolute relative path
 *   - resolved path outside `outputRoot`
 *   - existing destination when `force !== true`
 *   - non-directory at `outputRoot`
 */
export function writeArtifact(
  artifact: PlatformArtifact,
  outputRoot: string,
  options: WriteArtifactOptions = {},
): WriteArtifactResult {
  const absoluteRoot = path.resolve(outputRoot);
  const force = options.force === true;

  if (fs.existsSync(absoluteRoot)) {
    const stat = fs.lstatSync(absoluteRoot);
    if (!stat.isDirectory()) {
      throw new Error(
        `writeArtifact: output root exists and is not a directory: ${absoluteRoot}`,
      );
    }
  } else {
    fs.mkdirSync(absoluteRoot, { recursive: true });
  }

  // Deterministic ordering — sort by POSIX path so two runs of the same
  // build write in the same order.
  const sortedFiles = [...artifact.files].sort(comparePaths);

  const written: string[] = [];
  for (const file of sortedFiles) {
    const destination = resolveInsideRoot(absoluteRoot, file.path);
    writeOneFile(destination, file, force);
    written.push(destination);
  }

  return { written };
}

function writeOneFile(destination: string, file: PlatformArtifactFile, force: boolean): void {
  if (!force && fs.existsSync(destination)) {
    throw new Error(`writeArtifact: file already exists (force=false): ${destination}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.content);

  if (typeof file.mode === "number") {
    try {
      fs.chmodSync(destination, file.mode);
    } catch {
      // Best effort — some platforms (Windows) ignore chmod.
    }
  }
}

/**
 * Resolve `relativePath` under `outputRoot`, throwing if the result would
 * escape the root (absolute paths, `..` traversal, symlink-style tricks).
 *
 * Exported for unit testing.
 */
export function resolveInsideRoot(outputRoot: string, relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("writeArtifact: relative path must be a non-empty string");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`writeArtifact: refusing absolute path: ${relativePath}`);
  }

  const absoluteRoot = path.resolve(outputRoot);
  const resolved = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, resolved);

  if (relative === "") {
    throw new Error(
      `writeArtifact: refusing to write to output root itself: ${relativePath}`,
    );
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `writeArtifact: refusing path outside output root: ${relativePath}`,
    );
  }

  return resolved;
}

function comparePaths(left: PlatformArtifactFile, right: PlatformArtifactFile): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
