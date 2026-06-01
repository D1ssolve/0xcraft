import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveIncludes } from "./include-resolver";

const sandboxes: string[] = [];

function sandbox(): string {
  const directory = mkdtempSync(join(tmpdir(), "0xcraft-include-resolver-"));
  sandboxes.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("include resolver", () => {
  test("does nothing when frontmatter has no include directive", () => {
    const root = sandbox();
    const file = join(root, "AGENT.md");
    writeFileSync(file, "---\nname: Agent\n---\nBody\n");

    expect(() => resolveIncludes(file, { name: "Agent" }, new Set())).not.toThrow();
  });

  test("walks acyclic include arrays relative to current file", () => {
    const root = sandbox();
    const file = join(root, "AGENT.md");
    const child = join(root, "partials", "one.md");
    mkdirSync(join(root, "partials"), { recursive: true });
    writeFileSync(file, "---\ninclude:\n  - partials/one.md\n---\nBody\n");
    writeFileSync(child, "---\nname: Partial\n---\nPartial\n");

    expect(() => resolveIncludes(file, { include: ["partials/one.md"] }, new Set())).not.toThrow();
  });

  test("throws ERR_CYCLIC_INCLUDE when includes revisit a file", () => {
    const root = sandbox();
    const first = join(root, "first.md");
    const second = join(root, "second.md");
    writeFileSync(first, "---\ninclude:\n  - second.md\n---\nFirst\n");
    writeFileSync(second, "---\ninclude:\n  - first.md\n---\nSecond\n");

    expect(() => resolveIncludes(first, { include: ["second.md"] }, new Set())).toThrow(
      expect.objectContaining({
        code: "ERR_CYCLIC_INCLUDE",
        details: expect.objectContaining({ file: first }),
      }),
    );
  });
});
