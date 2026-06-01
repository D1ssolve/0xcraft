import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REFERENCE_FILENAME_RE } from "../../core/ir/references";
import type { PlatformArtifactFile } from "./artifact";

export function normalizeLf(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

export function ensureTrailingLf(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function loadReferencesFromDir(dir: string): {
  files: Record<string, string>;
  sourceFiles: string[];
} {
  const files: Record<string, string> = {};
  const sourceFiles: string[] = [];

  if (!existsSync(dir)) return { files, sourceFiles };

  let filenames: string[];
  try {
    filenames = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((filename) => REFERENCE_FILENAME_RE.test(filename))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return { files, sourceFiles };
  }

  for (const filename of filenames) {
    const filePath = join(dir, filename);
    try {
      files[filename] = readFileSync(filePath, "utf8");
      sourceFiles.push(filePath);
    } catch {
      // Ignore unreadable reference files. Import should be best-effort.
    }
  }

  return { files, sourceFiles };
}

export function referencesToArtifactFiles(
  references: Record<string, string> | undefined,
  basePath: string,
): PlatformArtifactFile[] {
  if (!references || Object.keys(references).length === 0) return [];

  return Object.entries(references)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filename, content]) => ({
      path: `${basePath}/${filename}`,
      content: ensureTrailingLf(normalizeLf(content)),
      mode: 0o644 as number,
    }));
}
