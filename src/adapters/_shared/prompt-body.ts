/**
 * Extract the markdown body (post-frontmatter) of a prompt file on disk.
 *
 * `extractPromptBody` throws on I/O failure (legacy callers expect this);
 * `extractPromptBodySafe` swallows the throw and returns diagnostics so
 * generators can keep going.
 */

import fs from "node:fs";
import { parseFrontmatter } from "./frontmatter";
import type { Diagnostic } from "./diagnostic-collector";

export function extractPromptBody(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const { body } = parseFrontmatter(content);
  return body.trim();
}

export interface ExtractPromptBodySafeResult {
  body: string;
  diagnostics: Diagnostic[];
}

export function extractPromptBodySafe(filePath: string): ExtractPromptBodySafeResult {
  try {
    return { body: extractPromptBody(filePath), diagnostics: [] };
  } catch (error) {
    return {
      body: "",
      diagnostics: [
        {
          severity: "error",
          code: "shared.prompt_body.read_failed",
          message: `Failed to read prompt body from ${filePath}: ${(error as Error).message}`,
          details: { filePath },
        },
      ],
    };
  }
}
