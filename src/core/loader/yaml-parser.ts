import { parse, stringify } from "yaml";

export interface ParsedYamlFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseYamlFrontmatter(content: string): ParsedYamlFrontmatter {
  const normalized = normalizeLineEndings(content);

  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const closingDelimiterStart = findClosingDelimiterStart(normalized);

  if (closingDelimiterStart === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const yamlContent = normalized.slice("---\n".length, closingDelimiterStart);
  const frontmatter = toFrontmatterRecord(parse(yamlContent) as unknown);
  const bodyStart = closingDelimiterStart + "\n---".length;
  const body = normalized.startsWith("\n", bodyStart) ? normalized.slice(bodyStart + 1) : normalized.slice(bodyStart);

  return { frontmatter, body };
}

export function serializeYamlFrontmatter(data: Record<string, unknown>, body: string): string {
  const normalizedBody = normalizeLineEndings(body);
  const sortedData = sortKeysRecursive(data);
  const yamlContent = stringify(sortedData).replace(/\r\n?/g, "\n");

  if (yamlContent.trim().length === 0 || yamlContent.trim() === "{}") {
    return `---\n---\n${normalizedBody}`;
  }

  return `---\n${yamlContent}---\n${normalizedBody}`;
}

function findClosingDelimiterStart(content: string): number {
  const delimiter = "\n---";
  let searchFrom = "---\n".length - 1;

  while (searchFrom < content.length) {
    const delimiterStart = content.indexOf(delimiter, searchFrom);

    if (delimiterStart === -1) {
      return -1;
    }

    const delimiterEnd = delimiterStart + delimiter.length;
    if (content[delimiterEnd] === "\n" || delimiterEnd === content.length) {
      return delimiterStart;
    }

    searchFrom = delimiterEnd;
  }

  return -1;
}

function toFrontmatterRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (isPlainRecord(value)) {
    return value;
  }

  return {};
}

function sortKeysRecursive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeysRecursive(value[key])]),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
