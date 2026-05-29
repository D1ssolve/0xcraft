import fs from "fs";
import path from "path";

export interface ClaudeCodeFilesystemWriterOptions {
  outputRoot: string;
  force?: boolean;
}

export interface ClaudeCodeFilesystemWriter {
  writeJson(relativePath: string, value: unknown): string[];
  writeMarkdown(relativePath: string, content: string): string[];
  overwriteMarkdown(relativePath: string, content: string): string[];
  /**
   * Copy a directory tree.
   *
   * `exclude` (optional) — predicate called with each source-relative
   * POSIX path. Returning `true` skips that file. Callers use this to
   * avoid the wasteful copy-then-overwrite pattern for files they
   * intend to rewrite immediately afterwards (e.g. `SKILL.md`).
   */
  copyDirectory(
    sourceDirectory: string,
    relativeDestination: string,
    exclude?: (sourceRelativePosixPath: string) => boolean,
  ): string[];
  /**
   * Write an arbitrary file relative to the output root with an optional
   * POSIX file mode (best-effort `chmod` on platforms that support it).
   * Enforces the same sandbox-root containment guard as the other write
   * methods.
   */
  writeFile(relativePath: string, content: string | Buffer, mode?: number): string[];
}

export function createClaudeCodeFilesystemWriter(options: ClaudeCodeFilesystemWriterOptions): ClaudeCodeFilesystemWriter {
  const outputRoot = path.resolve(options.outputRoot);
  const force = options.force === true;
  let outputRootPreflighted = false;

  return {
    writeJson(relativePath, value) {
      preflightOutputRoot(outputRoot, force, outputRootPreflighted);
      outputRootPreflighted = true;
      const destination = resolveInsideOutputRoot(outputRoot, relativePath);
      writeFile(destination, `${JSON.stringify(sortJsonValue(value), null, 2)}\n`, force);
      return [toPosixRelativePath(outputRoot, destination)];
    },

    writeMarkdown(relativePath, content) {
      preflightOutputRoot(outputRoot, force, outputRootPreflighted);
      outputRootPreflighted = true;
      const destination = resolveInsideOutputRoot(outputRoot, relativePath);
      writeFile(destination, withSingleFinalNewline(content), force);
      return [toPosixRelativePath(outputRoot, destination)];
    },

    overwriteMarkdown(relativePath, content) {
      preflightOutputRoot(outputRoot, true, outputRootPreflighted);
      outputRootPreflighted = true;
      const destination = resolveInsideOutputRoot(outputRoot, relativePath);
      writeFile(destination, withSingleFinalNewline(content), true);
      return [toPosixRelativePath(outputRoot, destination)];
    },

    copyDirectory(sourceDirectory, relativeDestination, exclude) {
      preflightOutputRoot(outputRoot, force, outputRootPreflighted);
      outputRootPreflighted = true;
      const sourceRoot = path.resolve(sourceDirectory);
      const destinationRoot = resolveInsideOutputRoot(outputRoot, relativeDestination);
      const emitted: string[] = [];

      copyDirectoryContents(sourceRoot, sourceRoot, destinationRoot, outputRoot, force, emitted, exclude);

      return emitted.sort(comparePaths);
    },

    writeFile(relativePath, content, mode) {
      preflightOutputRoot(outputRoot, force, outputRootPreflighted);
      outputRootPreflighted = true;
      const destination = resolveInsideOutputRoot(outputRoot, relativePath);
      writeFile(destination, content, force);
      if (mode !== undefined) {
        try {
          fs.chmodSync(destination, mode);
        } catch {
          // best-effort; some platforms (e.g. Windows) ignore chmod.
        }
      }
      return [toPosixRelativePath(outputRoot, destination)];
    },
  };
}

function preflightOutputRoot(outputRoot: string, force: boolean, alreadyPreflighted: boolean): void {
  if (force || alreadyPreflighted || !fs.existsSync(outputRoot)) {
    return;
  }

  const stat = fs.lstatSync(outputRoot);
  if (!stat.isDirectory()) {
    throw new Error(`Output path already exists and is not a directory: ${outputRoot}`);
  }

  if (fs.readdirSync(outputRoot).length > 0) {
    throw new Error(`Output directory already exists and is not empty: ${outputRoot}`);
  }
}

function writeFile(destination: string, content: string | Buffer, force: boolean): void {
  if (!force && fs.existsSync(destination)) {
    throw new Error(`Output already exists: ${destination}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function copyDirectoryContents(
  sourceRoot: string,
  sourceDirectory: string,
  destinationDirectory: string,
  outputRoot: string,
  force: boolean,
  emitted: string[],
  exclude: ((sourceRelativePosixPath: string) => boolean) | undefined,
): void {
  const sourceStat = fs.lstatSync(sourceDirectory);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic links into Claude Code plugin output: ${sourceDirectory}`);
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`Source is not a directory: ${sourceDirectory}`);
  }

  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    assertInsideOutputRoot(outputRoot, destinationPath);

    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to copy symbolic links into Claude Code plugin output: ${sourcePath}`);
    }

    if (stat.isDirectory()) {
      copyDirectoryContents(sourceRoot, sourcePath, destinationPath, outputRoot, force, emitted, exclude);
      continue;
    }

    if (!stat.isFile()) {
      throw new Error(`Refusing to copy unsupported filesystem entry: ${sourcePath}`);
    }

    if (exclude !== undefined) {
      const rel = path.relative(sourceRoot, sourcePath).split(path.sep).join(path.posix.sep);
      if (exclude(rel)) continue;
    }

    writeFile(destinationPath, fs.readFileSync(sourcePath), force);
    emitted.push(toPosixRelativePath(outputRoot, destinationPath));
  }
}

function resolveInsideOutputRoot(outputRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside output root: ${relativePath}`);
  }

  const resolvedPath = path.resolve(outputRoot, relativePath);
  assertInsideOutputRoot(outputRoot, resolvedPath);
  return resolvedPath;
}

function assertInsideOutputRoot(outputRoot: string, candidatePath: string): void {
  const relativePath = path.relative(outputRoot, path.resolve(candidatePath));

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`Refusing to write outside output root: ${candidatePath}`);
}

function toPosixRelativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join(path.posix.sep);
}

function withSingleFinalNewline(content: string): string {
  return `${content.replace(/[\r\n]+$/u, "")}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(comparePaths)) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
