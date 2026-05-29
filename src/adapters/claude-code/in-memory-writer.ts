/**
 * In-memory implementation of `ClaudeCodeFilesystemWriter`.
 *
 * Captures every write into a map keyed by POSIX relative path. No disk
 * touch (except `copyDirectory`, which still reads source bytes from the
 * package root — the destination side stays in memory). Used by
 * `buildClaudeCodeFiles` to assemble a `PlatformArtifact` purely in RAM
 * for T-12.9.
 *
 * Path containment is enforced against a virtual root string so the same
 * "/" path semantics as the disk writer apply: absolute paths and `..`
 * traversal are rejected.
 */
import fs from "node:fs";
import path from "node:path";

import type { ClaudeCodeFilesystemWriter } from "./filesystem";

export interface InMemoryFile {
  /** POSIX-style relative path under the virtual root. */
  path: string;
  /** UTF-8 contents (binary files captured as base64 elsewhere; n/a here). */
  content: string;
  /** Optional POSIX file mode (e.g. 0o755 for executables). */
  mode?: number;
}

export interface InMemoryWriter extends ClaudeCodeFilesystemWriter {
  /** Snapshot of every captured file, sorted by POSIX path. */
  snapshot(): InMemoryFile[];
  /** Return the raw content for a relative path, or `undefined`. */
  get(relativePath: string): string | undefined;
}

const VIRTUAL_ROOT = "/__in_memory__";

export function createInMemoryClaudeCodeWriter(): InMemoryWriter {
  const files = new Map<string, InMemoryFile>();

  function put(rel: string, content: string | Buffer, mode?: number): string {
    const normalized = toPosixRelative(VIRTUAL_ROOT, resolveInsideRoot(VIRTUAL_ROOT, rel));
    const text = typeof content === "string" ? content : content.toString("utf8");
    const entry: InMemoryFile = { path: normalized, content: text };
    if (mode !== undefined) entry.mode = mode;
    files.set(normalized, entry);
    return normalized;
  }

  return {
    writeJson(rel, value) {
      const text = `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
      return [put(rel, text)];
    },
    writeMarkdown(rel, content) {
      return [put(rel, withSingleFinalNewline(content))];
    },
    overwriteMarkdown(rel, content) {
      return [put(rel, withSingleFinalNewline(content))];
    },
    writeFile(rel, content, mode) {
      return [put(rel, content, mode)];
    },
    copyDirectory(sourceDirectory, relativeDestination, exclude) {
      const sourceRoot = path.resolve(sourceDirectory);
      const emitted: string[] = [];
      walkSource(sourceRoot, sourceRoot, relativeDestination, exclude, (relDest, buf) => {
        emitted.push(put(relDest, buf));
      });
      return emitted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
    snapshot() {
      return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    get(relativePath) {
      // Normalize same way as put() so callers can pass any form.
      try {
        const normalized = toPosixRelative(VIRTUAL_ROOT, resolveInsideRoot(VIRTUAL_ROOT, relativePath));
        return files.get(normalized)?.content;
      } catch {
        return undefined;
      }
    },
  };
}

function walkSource(
  root: string,
  current: string,
  relDest: string,
  exclude: ((sourceRelativePosixPath: string) => boolean) | undefined,
  emit: (relDestFile: string, buf: Buffer) => void,
): void {
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic links into Claude Code plugin output: ${current}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Source is not a directory: ${current}`);
  }
  const entries = fs
    .readdirSync(current, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const sourcePath = path.join(current, entry.name);
    const destRel = `${relDest}/${entry.name}`;
    const lst = fs.lstatSync(sourcePath);
    if (lst.isSymbolicLink()) {
      throw new Error(`Refusing to copy symbolic links into Claude Code plugin output: ${sourcePath}`);
    }
    if (lst.isDirectory()) {
      walkSource(root, sourcePath, destRel, exclude, emit);
      continue;
    }
    if (!lst.isFile()) {
      throw new Error(`Refusing to copy unsupported filesystem entry: ${sourcePath}`);
    }
    if (exclude !== undefined) {
      const rel = path.relative(root, sourcePath).split(path.sep).join(path.posix.sep);
      if (exclude(rel)) continue;
    }
    emit(destRel, fs.readFileSync(sourcePath));
  }
}

function resolveInsideRoot(virtualRoot: string, rel: string): string {
  if (typeof rel !== "string" || rel.length === 0) {
    throw new Error("In-memory writer: relative path must be a non-empty string");
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`In-memory writer: refusing absolute path: ${rel}`);
  }
  const resolved = path.posix.resolve(virtualRoot, rel.split(path.sep).join("/"));
  const relative = path.posix.relative(virtualRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.posix.isAbsolute(relative)) {
    throw new Error(`In-memory writer: refusing path outside virtual root: ${rel}`);
  }
  return resolved;
}

function toPosixRelative(virtualRoot: string, resolved: string): string {
  return path.posix.relative(virtualRoot, resolved);
}

function withSingleFinalNewline(content: string): string {
  return `${content.replace(/[\r\n]+$/u, "")}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isPlainObject(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
