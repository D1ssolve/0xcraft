/**
 * YAML frontmatter parser / serializer for adapter pipelines.
 *
 * Shared by OpenCode and Claude Code adapters; will also be used by
 * the Codex skill emitter. Supports scalars (string / number / boolean),
 * quoted strings, and list values written as:
 *
 *     key:
 *       - item one
 *       - item two
 *
 * No nested objects beyond a single level of list values; that matches
 * the existing claude-code parser and is sufficient for agent / skill
 * frontmatter used across all three harnesses.
 */

export interface ParsedFrontmatter {
  meta: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_DELIMITER = "---";

export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith(`${FRONTMATTER_DELIMITER}\n`) && content !== FRONTMATTER_DELIMITER) {
    if (!content.startsWith(FRONTMATTER_DELIMITER)) {
      return { meta: {}, body: content };
    }
  }

  // Find the closing `\n---` after position 4 (skip opening "---\n")
  const startSearchAt = content.startsWith(`${FRONTMATTER_DELIMITER}\n`) ? 4 : 3;
  const end = content.indexOf(`\n${FRONTMATTER_DELIMITER}`, startSearchAt);
  if (end === -1) {
    return { meta: {}, body: content };
  }

  const headerStart = content.startsWith(`${FRONTMATTER_DELIMITER}\n`) ? 4 : 3;
  const header = content.slice(headerStart, end);
  const afterClosing = end + (`\n${FRONTMATTER_DELIMITER}`).length;
  const rest = content.slice(afterClosing);
  // Strip leading whitespace/newlines after closing `---` (matches the
  // legacy OpenCode parser; tolerates blank lines between frontmatter
  // and body).
  const body = rest.replace(/^[ \t]*\n/, "").replace(/^\n+/, "");

  const meta: Record<string, unknown> = {};
  const lines = header.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) continue;
    if (line.trim() === "") continue;

    const match = line.match(/^([^:]+):(?:\s*(.*))?$/u);
    if (!match) continue;

    const key = match[1]?.trim();
    const rawValue = match[2] ?? "";
    if (!key) continue;

    if (rawValue.trim() === "") {
      // Look ahead: list items (`  - `) or nested object (`  key: value`).
      const nextLine = lines[index + 1] ?? "";
      if (nextLine.match(/^\s*-\s+/u)) {
        // Collect list items prefixed with `  - `.
        const values: string[] = [];
        while (lines[index + 1]?.match(/^\s*-\s+/u)) {
          index++;
          const next = lines[index] ?? "";
          const itemMatch = next.match(/^\s*-\s+(.*)$/u);
          if (itemMatch) {
            values.push(parseScalar(itemMatch[1] ?? "") as string);
          }
        }
        meta[key] = values;
        continue;
      }
      if (nextLine.match(/^\s+[^:\s][^:]*:/u)) {
        // Collect nested `  subKey: value` pairs (single level only).
        const nested: Record<string, unknown> = {};
        while (lines[index + 1]?.match(/^\s+[^:\s][^:]*:/u)) {
          index++;
          const next = lines[index] ?? "";
          const nestedMatch = next.match(/^\s+([^:]+):\s*(.*)$/u);
          if (!nestedMatch) continue;
          const nestedKey = nestedMatch[1]?.trim();
          const nestedValue = nestedMatch[2] ?? "";
          if (!nestedKey) continue;
          nested[nestedKey] = parseScalar(nestedValue);
        }
        meta[key] = nested;
        continue;
      }
      // Empty value with no following list/nested block → empty string.
      meta[key] = "";
      continue;
    }

    meta[key] = parseScalar(rawValue);
  }

  return { meta, body };
}

function parseScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Serialize a flat frontmatter object back to canonical YAML.
 * Scalars become `key: value`. String values containing `:`, `#`, leading/
 * trailing whitespace, or YAML reserved words are quoted with double quotes.
 * String arrays are emitted as block lists. Other types are coerced to JSON.
 */
export function serializeFrontmatter(meta: Record<string, unknown>): string {
  const lines: string[] = [FRONTMATTER_DELIMITER];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${serializeScalar(item)}`);
      }
      continue;
    }
    lines.push(`${key}: ${serializeScalar(value)}`);
  }
  lines.push(FRONTMATTER_DELIMITER);
  return lines.join("\n");
}

function serializeScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    if (needsQuoting(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  // Fallback: JSON encode.
  return JSON.stringify(value ?? null);
}

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  if (value !== value.trim()) return true;
  if (/[:#"'`\n\r\t]/u.test(value)) return true;
  if (value === "true" || value === "false" || value === "null") return true;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return true;
  return false;
}
