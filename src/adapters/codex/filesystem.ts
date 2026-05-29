/**
 * Codex adapter sandboxed filesystem writer.
 *
 * Mirrors the Claude Code writer pattern (intentionally NOT importing
 * its concrete impl per layer rules), but uses a smaller API tuned
 * for the Codex emitter shape:
 *
 *   - `writeFile(relativePath, content, mode?)` — single-file write
 *     with optional POSIX mode (used for executable hook scripts).
 *
 * All paths are interpreted relative to `outputRoot`. Absolute paths
 * and paths that resolve outside `outputRoot` are rejected. Parents
 * are created on demand. When `force !== true`, attempting to write
 * over an existing file throws.
 */
import fs from "node:fs";
import path from "node:path";

export interface CodexFilesystemWriterOptions {
  outputRoot: string;
  force?: boolean;
}

export interface CodexFilesystemWriter {
  outputRoot: string;
  writeFile(relativePath: string, content: string, mode?: number): void;
}

export function createCodexFilesystemWriter(
  options: CodexFilesystemWriterOptions,
): CodexFilesystemWriter {
  const outputRoot = path.resolve(options.outputRoot);
  const force = options.force === true;

  function resolveInside(relativePath: string): string {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error("Codex writer: relativePath must be a non-empty string");
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Codex writer: refusing absolute path: ${relativePath}`);
    }
    const resolved = path.resolve(outputRoot, relativePath);
    const rel = path.relative(outputRoot, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      // empty `rel` means the caller targeted outputRoot itself.
      if (rel === "") {
        throw new Error(
          `Codex writer: refusing to write to output root directly: ${relativePath}`,
        );
      }
      throw new Error(`Codex writer: refusing path outside output root: ${relativePath}`);
    }
    return resolved;
  }

  return {
    outputRoot,

    writeFile(relativePath, content, mode): void {
      const dest = resolveInside(relativePath);
      if (fs.existsSync(dest) && !force) {
        throw new Error(`Codex writer: file already exists (pass force=true to overwrite): ${dest}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
      if (typeof mode === "number") {
        fs.chmodSync(dest, mode);
      }
    },
  };
}
