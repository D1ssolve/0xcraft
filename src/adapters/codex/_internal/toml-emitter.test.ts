import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";
import {
  tomlArrayOfInlineTables,
  tomlArrayOfTablesItem,
  tomlBool,
  tomlDocument,
  tomlInlineTable,
  tomlInt,
  tomlKey,
  tomlMultilineString,
  tomlString,
  tomlStringArray,
  tomlTable,
} from "./toml-emitter";

describe("toml-emitter scalar helpers", () => {
  test("tomlString escapes \\, \", \\n, \\r, \\t and control chars", () => {
    expect(tomlString("a")).toBe(`"a"`);
    expect(tomlString(`he said "hi"`)).toBe(`"he said \\"hi\\""`);
    expect(tomlString("path\\to")).toBe(`"path\\\\to"`);
    expect(tomlString("line1\nline2")).toBe(`"line1\\nline2"`);
    expect(tomlString("a\rb")).toBe(`"a\\rb"`);
    expect(tomlString("a\tb")).toBe(`"a\\tb"`);
    expect(tomlString("\u0001")).toBe(`"\\u0001"`);
  });

  test("tomlMultilineString emits triple-quoted block", () => {
    const out = tomlMultilineString("hello\nworld");
    expect(out.startsWith(`"""\n`)).toBe(true);
    expect(out.endsWith(`"""`)).toBe(true);
  });

  test("tomlBool / tomlInt", () => {
    expect(tomlBool(true)).toBe("true");
    expect(tomlBool(false)).toBe("false");
    expect(tomlInt(42)).toBe("42");
    expect(() => tomlInt(1.5)).toThrow();
  });

  test("tomlStringArray quotes each entry", () => {
    expect(tomlStringArray(["a", "b"])).toBe(`["a", "b"]`);
  });

  test("tomlKey leaves bare keys unquoted but quotes special ones", () => {
    expect(tomlKey("mcp_servers")).toBe("mcp_servers");
    expect(tomlKey("with.dot")).toBe(`"with.dot"`);
    expect(tomlKey("space here")).toBe(`"space here"`);
  });

  test("tomlInlineTable round-trips simple shape", () => {
    const out = tomlInlineTable([
      { key: "type", value: { kind: "string", value: "command" } },
      { key: "enabled", value: { kind: "bool", value: true } },
    ]);
    expect(out).toBe(`{ type = "command", enabled = true }`);
  });

  test("tomlArrayOfInlineTables emits `[{...}, {...}]`", () => {
    const out = tomlArrayOfInlineTables([
      [{ key: "n", value: { kind: "int", value: 1 } }],
      [{ key: "n", value: { kind: "int", value: 2 } }],
    ]);
    expect(out).toBe(`[{ n = 1 }, { n = 2 }]`);
  });
});

/* ---------------------------------------------------------------- */
/*  5 fixtures from ADR §5.1 — round-tripped via smol-toml            */
/* ---------------------------------------------------------------- */

describe("toml-emitter ADR §5.1 fixtures", () => {
  test("fixture 1: feature flags + skill mcp_servers", () => {
    const doc = tomlDocument([
      tomlTable({
        header: ["features"],
        entries: [
          { key: "agents_guard", value: { kind: "bool", value: true } },
          { key: "caveman", value: { kind: "bool", value: false } },
        ],
      }),
      tomlTable({
        header: ["mcp_servers", "context7"],
        entries: [
          { key: "command", value: { kind: "string", value: "context7-mcp" } },
          {
            key: "args",
            value: { kind: "stringArray", values: ["--stdio"] },
          },
        ],
      }),
    ]);

    const parsed = parse(doc) as Record<string, unknown>;
    expect((parsed.features as Record<string, unknown>).agents_guard).toBe(true);
    expect((parsed.features as Record<string, unknown>).caveman).toBe(false);
    const ctx7 = (parsed.mcp_servers as Record<string, unknown>).context7 as Record<string, unknown>;
    expect(ctx7.command).toBe("context7-mcp");
    expect(ctx7.args).toEqual(["--stdio"]);
  });

  test("fixture 2: per-agent TOML with multiline developer_instructions", () => {
    const doc = tomlDocument([
      [
        `name = ${tomlString("backend-developer")}`,
        `description = ${tomlString("Implements server-side code")}`,
        `model = ${tomlString("claude-opus-4.7")}`,
        `developer_instructions = ${tomlMultilineString("Follow ADR.\nWrite tests for non-trivial logic.")}`,
        `mcp_servers = ${tomlStringArray(["context7", "mempalace"])}`,
      ].join("\n"),
    ]);

    const parsed = parse(doc) as Record<string, unknown>;
    expect(parsed.name).toBe("backend-developer");
    expect(parsed.model).toBe("claude-opus-4.7");
    expect(parsed.developer_instructions).toBe("Follow ADR.\nWrite tests for non-trivial logic.");
    expect(parsed.mcp_servers).toEqual(["context7", "mempalace"]);
  });

  test("fixture 3: nested array-of-tables for hooks", () => {
    const doc = tomlDocument([
      tomlArrayOfTablesItem({
        header: ["hooks", "SessionStart"],
        entries: [{ key: "matcher", value: { kind: "string", value: "startup" } }],
      }),
      tomlArrayOfTablesItem({
        header: ["hooks", "SessionStart", "hooks"],
        entries: [
          { key: "type", value: { kind: "string", value: "command" } },
          { key: "command", value: { kind: "string", value: "echo hi" } },
        ],
      }),
    ]);

    const parsed = parse(doc) as { hooks: { SessionStart: Array<Record<string, unknown>> } };
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    const session = parsed.hooks.SessionStart[0]!;
    expect(session.matcher).toBe("startup");
    const inner = session.hooks as Array<Record<string, unknown>>;
    expect(inner).toHaveLength(1);
    expect(inner[0]?.type).toBe("command");
    expect(inner[0]?.command).toBe("echo hi");
  });

  test("fixture 4: edge case strings (quotes, backslashes, newlines, tab)", () => {
    const doc = tomlDocument([
      [
        `quoted = ${tomlString(`with "quotes"`)}`,
        `backslash = ${tomlString("C:\\path\\to\\file")}`,
        `newline = ${tomlString("a\nb")}`,
        `tab = ${tomlString("a\tb")}`,
      ].join("\n"),
    ]);

    const parsed = parse(doc) as Record<string, string>;
    expect(parsed.quoted).toBe(`with "quotes"`);
    expect(parsed.backslash).toBe("C:\\path\\to\\file");
    expect(parsed.newline).toBe("a\nb");
    expect(parsed.tab).toBe("a\tb");
  });

  test("fixture 5: multiline triple-quoted with backticks and code", () => {
    const codeBlock = "Run this:\n```bash\necho hi\n```\nDone.";
    const doc = tomlDocument([`instructions = ${tomlMultilineString(codeBlock)}`]);

    const parsed = parse(doc) as Record<string, string>;
    expect(parsed.instructions).toBe(codeBlock);
  });
});
