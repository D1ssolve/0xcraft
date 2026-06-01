import { describe, expect, test } from "bun:test";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("returns empty meta + raw body when no frontmatter present", () => {
    const result = parseFrontmatter("hello world");
    expect(result.meta).toEqual({});
    expect(result.body).toBe("hello world");
  });

  test("parses scalar string, number, boolean", () => {
    const content = `---
name: my-agent
temperature: 0.7
enabled: true
disabled: false
---
body text`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBe("my-agent");
    expect(meta.temperature).toBe(0.7);
    expect(meta.enabled).toBe(true);
    expect(meta.disabled).toBe(false);
    expect(body).toBe("body text");
  });

  test("parses quoted strings", () => {
    const content = `---
description: "hello: world"
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.description).toBe("hello: world");
  });

  test("parses list values", () => {
    const content = `---
tools:
  - read
  - write
  - bash
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.tools).toEqual(["read", "write", "bash"]);
  });

  test("preserves body unchanged across closing delimiter", () => {
    const content = `---
key: value
---
# Markdown

Paragraph.`;
    const { body } = parseFrontmatter(content);
    expect(body).toBe("# Markdown\n\nParagraph.");
  });

  test("returns body unchanged on unterminated frontmatter", () => {
    const content = "---\nkey: value\nno closing";
    const result = parseFrontmatter(content);
    expect(result.meta).toEqual({});
    expect(result.body).toBe(content);
  });
});

describe("serializeFrontmatter", () => {
  test("emits scalars in `key: value` form", () => {
    const out = serializeFrontmatter({ name: "agent", temperature: 0.5, enabled: true });
    expect(out).toBe(`---
name: agent
temperature: 0.5
enabled: true
---`);
  });

  test("quotes strings that contain colons", () => {
    const out = serializeFrontmatter({ description: "hello: world" });
    expect(out.includes(`"hello: world"`)).toBe(true);
  });

  test("emits list values as block sequence", () => {
    const out = serializeFrontmatter({ tools: ["read", "write"] });
    expect(out).toBe(`---
tools:
  - read
  - write
---`);
  });

  test("round-trips a representative frontmatter object", () => {
    const original = {
      name: "agent",
      description: "with: colon",
      temperature: 0.5,
      enabled: true,
      tools: ["read", "write"],
    };
    const serialized = serializeFrontmatter(original);
    const fullDoc = `${serialized}\nbody`;
    const { meta, body } = parseFrontmatter(fullDoc);
    expect(meta.name).toBe("agent");
    expect(meta.description).toBe("with: colon");
    expect(meta.temperature).toBe(0.5);
    expect(meta.enabled).toBe(true);
    expect(meta.tools).toEqual(["read", "write"]);
    expect(body).toBe("body");
  });
});
