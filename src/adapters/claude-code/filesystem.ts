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
  copyDirectory(sourceDirectory: string, relativeDestination: string): string[];
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

    copyDirectory(sourceDirectory, relativeDestination) {
      preflightOutputRoot(outputRoot, force, outputRootPreflighted);
      outputRootPreflighted = true;
      const sourceRoot = path.resolve(sourceDirectory);
      const destinationRoot = resolveInsideOutputRoot(outputRoot, relativeDestination);
      const emitted: string[] = [];

      copyDirectoryContents(sourceRoot, destinationRoot, outputRoot, force, emitted);

      return emitted.sort(comparePaths);
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
  sourceDirectory: string,
  destinationDirectory: string,
  outputRoot: string,
  force: boolean,
  emitted: string[],
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
      copyDirectoryContents(sourcePath, destinationPath, outputRoot, force, emitted);
      continue;
    }

    if (!stat.isFile()) {
      throw new Error(`Refusing to copy unsupported filesystem entry: ${sourcePath}`);
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
