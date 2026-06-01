import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { DiagnosticCode } from "../diagnostics/codes";
import { parseYamlFrontmatter } from "./yaml-parser";

export type CodedLoaderError = Error & {
  code: DiagnosticCode;
  details: Record<string, unknown>;
};

/**
 * Phase 1 include scaffold.
 *
 * `include: ["relative/path.md"]` entries are walked only to detect cycles.
 * Full include expansion/merge semantics are deferred until Phase 2 if the spec
 * requires materializing included content into IR.
 */
export function resolveIncludes(file: string, frontmatter: Record<string, unknown>, visited: Set<string>): void {
  const absoluteFile = resolve(file);

  if (visited.has(absoluteFile)) {
    throw codedError("ERR_CYCLIC_INCLUDE", "Include graph contains a cycle", {
      file: absoluteFile,
    });
  }

  visited.add(absoluteFile);

  for (const includePath of includePaths(frontmatter)) {
    const includedFile = resolve(dirname(absoluteFile), includePath);
    if (!existsSync(includedFile)) {
      continue;
    }

    const included = parseYamlFrontmatter(readFileSync(includedFile, "utf8"));
    resolveIncludes(includedFile, included.frontmatter, visited);
  }

  visited.delete(absoluteFile);
}

function includePaths(frontmatter: Record<string, unknown>): string[] {
  const value = frontmatter.include;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function codedError(code: DiagnosticCode, message: string, details: Record<string, unknown>): CodedLoaderError {
  const error = new Error(message) as CodedLoaderError;
  error.code = code;
  error.details = details;
  return error;
}
