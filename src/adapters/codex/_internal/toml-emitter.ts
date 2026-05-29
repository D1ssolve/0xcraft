/**
 * Hand-rolled minimal TOML emitter.
 *
 * Covers the surface needed by the Codex adapter (ADR §5.1):
 *   - scalar strings (basic & multiline triple-quoted)
 *   - booleans, integers
 *   - string arrays
 *   - inline tables
 *   - arrays of inline tables
 *   - standard tables (`[a.b.c]`)
 *   - array-of-tables items (`[[a.b]]`)
 *
 * Output is round-trip parseable by `smol-toml`; the test suite verifies
 * the five fixture shapes called out in ADR §5.1.
 *
 * We deliberately avoid a full TOML library: Codex emission is a small,
 * fully-known set of shapes, and shipping a hand-rolled emitter keeps
 * the bundle dependency-free.
 */

/* ---------------------------------------------------------------- */
/*  Scalar emitters                                                   */
/* ---------------------------------------------------------------- */

export function tomlString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      default:
        if (code < 0x20 || code === 0x7f) {
          out += `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
        } else {
          out += ch;
        }
    }
  }
  out += '"';
  return out;
}

export function tomlMultilineString(value: string): string {
  // Triple-quoted basic string. The TOML spec only permits a fixed set of
  // backslash escapes inside basic (multiline) strings: \b \t \n \f \r \"
  // \\ \uXXXX \UXXXXXXXX, plus the line-ending backslash. Any other `\X`
  // sequence is an error. Source prompts may legitimately contain stray
  // backslashes (e.g. `\` ` ` ` escaped markdown fences), so we double
  // every backslash first, then guard against `"""` runs.
  let safe = value.replace(/\\/gu, "\\\\");
  safe = safe.replace(/"{3,}/gu, (run) => "\\" + run);
  if (safe.endsWith('"')) {
    safe = `${safe.slice(0, -1)}\\"`;
  }
  // Leading newline immediately after the opening delimiter is trimmed
  // by the TOML spec, so we add one to preserve the caller's intent.
  return `"""\n${safe}"""`;
}

export function tomlBool(value: boolean): string {
  return value ? "true" : "false";
}

export function tomlInt(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(`tomlInt requires an integer; received ${value}`);
  }
  return String(value);
}

export function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

/* ---------------------------------------------------------------- */
/*  Key / header quoting                                              */
/* ---------------------------------------------------------------- */

export function tomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/u.test(key)) return key;
  return tomlString(key);
}

function joinHeader(segments: string[]): string {
  return segments.map((segment) => tomlKey(segment)).join(".");
}

/* ---------------------------------------------------------------- */
/*  Value model                                                       */
/* ---------------------------------------------------------------- */

export interface TomlTableEntry {
  key: string;
  value: TomlValue;
}

export type TomlValue =
  | { kind: "string"; value: string }
  | { kind: "multilineString"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "stringArray"; values: string[] }
  | { kind: "inlineTable"; entries: TomlTableEntry[] }
  | { kind: "arrayOfInlineTables"; tables: TomlTableEntry[][] };

function emitValue(value: TomlValue): string {
  switch (value.kind) {
    case "string":
      return tomlString(value.value);
    case "multilineString":
      return tomlMultilineString(value.value);
    case "bool":
      return tomlBool(value.value);
    case "int":
      return tomlInt(value.value);
    case "stringArray":
      return tomlStringArray(value.values);
    case "inlineTable":
      return tomlInlineTable(value.entries);
    case "arrayOfInlineTables":
      return tomlArrayOfInlineTables(value.tables);
  }
}

function emitEntries(entries: TomlTableEntry[]): string {
  return entries.map((entry) => `${tomlKey(entry.key)} = ${emitValue(entry.value)}`).join("\n");
}

/* ---------------------------------------------------------------- */
/*  Inline tables & arrays of inline tables                           */
/* ---------------------------------------------------------------- */

export function tomlInlineTable(entries: TomlTableEntry[]): string {
  const body = entries
    .map((entry) => `${tomlKey(entry.key)} = ${emitValue(entry.value)}`)
    .join(", ");
  return `{ ${body} }`;
}

export function tomlArrayOfInlineTables(tables: TomlTableEntry[][]): string {
  const items = tables.map((entries) => tomlInlineTable(entries));
  return `[${items.join(", ")}]`;
}

/* ---------------------------------------------------------------- */
/*  Standard tables and array-of-tables items                         */
/* ---------------------------------------------------------------- */

export interface TomlTable {
  /** Header path, e.g. ["mcp_servers", "context7"] -> [mcp_servers.context7] */
  header: string[];
  entries: TomlTableEntry[];
}

export interface TomlArrayOfTablesEntry {
  /** Header path, e.g. ["hooks", "SessionStart"] -> [[hooks.SessionStart]] */
  header: string[];
  entries: TomlTableEntry[];
}

export function tomlTable(table: TomlTable): string {
  const head = `[${joinHeader(table.header)}]`;
  if (table.entries.length === 0) return head;
  return `${head}\n${emitEntries(table.entries)}`;
}

export function tomlArrayOfTablesItem(item: TomlArrayOfTablesEntry): string {
  const head = `[[${joinHeader(item.header)}]]`;
  if (item.entries.length === 0) return head;
  return `${head}\n${emitEntries(item.entries)}`;
}

/* ---------------------------------------------------------------- */
/*  Document assembly                                                 */
/* ---------------------------------------------------------------- */

/**
 * Combines pre-rendered top-level fragments (key/value lines, tables,
 * array-of-tables items) into a single TOML document. Fragments are
 * separated by a blank line; trailing whitespace is trimmed.
 */
export function tomlDocument(parts: string[]): string {
  const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  return `${cleaned.join("\n\n")}\n`;
}
