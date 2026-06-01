import { describe, expect, test } from "bun:test";

import { parseToml, serializeToml } from "./toml-parser";

describe("TOML parser/serializer", () => {
  test("parses empty input as an empty object", () => {
    expect(parseToml("")).toEqual({});
    expect(parseToml("   \n\t  ")).toEqual({});
  });

  test("parses simple key/value TOML", () => {
    expect(parseToml('name = "0xcraft"\nenabled = true\ncount = 3\n')).toEqual({
      name: "0xcraft",
      enabled: true,
      count: 3,
    });
  });

  test("serializes top-level keys in lexicographic order with LF endings", () => {
    const output = serializeToml({ zeta: 1, alpha: "first", middle: true });

    expect(output).toBe('alpha = "first"\nmiddle = true\nzeta = 1\n');
    expect(output).not.toContain("\r\n");
  });

  test("serializes nested tables with stable recursive key ordering", () => {
    const output = serializeToml({
      table: {
        zeta: 1,
        alpha: "first",
        nested: { beta: 2, alpha: 1 },
      },
    });

    expect(output).toContain('[table]\nalpha = "first"\nzeta = 1\n');
    expect(output).toContain("[table.nested]\nalpha = 1\nbeta = 2\n");
    expect(parseToml(output)).toEqual({
      table: {
        alpha: "first",
        zeta: 1,
        nested: { alpha: 1, beta: 2 },
      },
    });
  });

  test("preserves array element order while sorting keys inside object elements", () => {
    const output = serializeToml({
      values: [3, 1, 2],
      tables: [
        { zeta: "first", alpha: 1 },
        { zeta: "second", alpha: 2 },
      ],
    });

    expect(parseToml(output)).toEqual({
      values: [3, 1, 2],
      tables: [
        { alpha: 1, zeta: "first" },
        { alpha: 2, zeta: "second" },
      ],
    });
  });

  test("round-trips mixed TOML fixtures structurally", () => {
    const input = `
title = "mixed"
numbers = [1, 2, 3]

[owner]
name = "Alice"
active = true

[database]
ports = [8000, 8001]
enabled = true

[[agents]]
name = "explorer"
tools = ["read", "grep"]

[[agents]]
name = "writer"
tools = ["edit"]
`;

    const parsed = parseToml(input);
    const serialized = serializeToml(parsed);

    expect(parseToml(serialized)).toEqual(parsed);
  });

  test("rethrows parse errors with clear TOML context", () => {
    expect(() => parseToml("not valid toml")).toThrow(/Failed to parse TOML:/);
  });
});
