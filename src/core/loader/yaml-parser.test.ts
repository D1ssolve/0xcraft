import { describe, expect, test } from "bun:test";

import { parseYamlFrontmatter, serializeYamlFrontmatter } from "./yaml-parser";

describe("YAML frontmatter parser", () => {
  test("returns empty frontmatter for a body-only file", () => {
    expect(parseYamlFrontmatter("Body only\nSecond line\n")).toEqual({
      frontmatter: {},
      body: "Body only\nSecond line\n",
    });
  });

  test("normalizes CRLF input to LF in body output", () => {
    expect(parseYamlFrontmatter("---\r\nname: Test\r\n---\r\nBody\r\nNext\r\n")).toEqual({
      frontmatter: { name: "Test" },
      body: "Body\nNext\n",
    });
  });

  test("passes unknown frontmatter keys through unchanged", () => {
    const result = parseYamlFrontmatter("---\nunknownKey: true\nnested:\n  z: 1\n---\n");

    expect(result.frontmatter).toEqual({ unknownKey: true, nested: { z: 1 } });
    expect(result.body).toBe("");
  });

  test("parses empty frontmatter as an empty record", () => {
    expect(parseYamlFrontmatter("---\n---\nBody\n")).toEqual({
      frontmatter: {},
      body: "Body\n",
    });
  });

  test("parses a file ending exactly at the closing delimiter", () => {
    expect(parseYamlFrontmatter("---\nname: Test\n---")).toEqual({
      frontmatter: { name: "Test" },
      body: "",
    });
  });

  test("returns metadata-only sibling body verbatim for caller validation", () => {
    expect(parseYamlFrontmatter("---\nname: Test\n---\nnot allowed here\n")).toEqual({
      frontmatter: { name: "Test" },
      body: "not allowed here\n",
    });
  });
});

describe("YAML frontmatter serializer", () => {
  test("serializes with lexicographically sorted recursive keys and LF line endings", () => {
    const serialized = serializeYamlFrontmatter(
      {
        z: 1,
        a: { z: 2, a: 1 },
        list: [{ d: 4, c: 3 }],
      },
      "Body\r\nNext\r\n",
    );

    expect(serialized).toBe(
      "---\n" +
        "a:\n" +
        "  a: 1\n" +
        "  z: 2\n" +
        "list:\n" +
        "  - c: 3\n" +
        "    d: 4\n" +
        "z: 1\n" +
        "---\n" +
        "Body\n" +
        "Next\n",
    );
    expect(serialized).not.toContain("\r");
  });

  test("serializes empty frontmatter without synthetic keys", () => {
    expect(serializeYamlFrontmatter({}, "Body\n")).toBe("---\n---\nBody\n");
  });

  test("round-trips parse to serialize to parse with identical structure", () => {
    const first = parseYamlFrontmatter(
      "---\nz: 1\na:\n  z: 2\n  a: 1\nlist:\n  - d: 4\n    c: 3\n---\nBody\n",
    );
    const serialized = serializeYamlFrontmatter(first.frontmatter, first.body);
    const second = parseYamlFrontmatter(serialized);

    expect(second).toEqual(first);
    expect(serialized).toBe(serializeYamlFrontmatter(first.frontmatter, first.body));
  });
});
