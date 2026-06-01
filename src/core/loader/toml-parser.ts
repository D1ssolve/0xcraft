import { parse, stringify } from "smol-toml";

type TomlRecord = Record<string, unknown>;

export function parseToml(content: string): TomlRecord {
  if (content.trim() === "") {
    return {};
  }

  try {
    return parse(content) as TomlRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse TOML: ${message}`, { cause: error });
  }
}

export function serializeToml(data: TomlRecord): string {
  return stringify(sortTomlValue(data) as TomlRecord).replace(/\r\n?/g, "\n");
}

function sortTomlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortTomlValue);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sorted: TomlRecord = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortTomlValue(value[key]);
  }

  return sorted;
}

function isPlainRecord(value: unknown): value is TomlRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}
