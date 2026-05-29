import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractPromptBody, extractPromptBodySafe } from "./prompt-body";

describe("prompt-body", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-prompt-"));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("extractPromptBody strips frontmatter and trims", () => {
    const file = path.join(tmp, "agent.md");
    fs.writeFileSync(
      file,
      `---
name: agent
---

# Body heading

paragraph.
`,
    );
    expect(extractPromptBody(file)).toBe("# Body heading\n\nparagraph.");
  });

  test("extractPromptBody returns whole file when no frontmatter", () => {
    const file = path.join(tmp, "plain.md");
    fs.writeFileSync(file, "just text\n");
    expect(extractPromptBody(file)).toBe("just text");
  });

  test("extractPromptBodySafe returns error diagnostic on missing file", () => {
    const result = extractPromptBodySafe(path.join(tmp, "missing.md"));
    expect(result.body).toBe("");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("shared.prompt_body.read_failed");
  });
});
