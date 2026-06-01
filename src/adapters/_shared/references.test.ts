import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { loadReferencesFromDir, referencesToArtifactFiles } from "./references";

describe("referencesToArtifactFiles", () => {
  test("returns no artifact files when references are omitted or empty", () => {
    expect(referencesToArtifactFiles(undefined, "agents/example/references")).toEqual([]);
    expect(referencesToArtifactFiles({}, "agents/example/references")).toEqual([]);
  });

  test("converts references to sorted artifact files under the base path", () => {
    expect(
      referencesToArtifactFiles(
        {
          "zeta.md": "Zeta",
          "alpha.txt": "Alpha",
        },
        "skills/example/references",
      ),
    ).toEqual([
      {
        path: "skills/example/references/alpha.txt",
        content: "Alpha\n",
        mode: 0o644,
      },
      {
        path: "skills/example/references/zeta.md",
        content: "Zeta\n",
        mode: 0o644,
      },
    ]);
  });

  test("normalizes CRLF content and preserves an existing trailing LF", () => {
    expect(
      referencesToArtifactFiles(
        {
          "example.md": "Line 1\r\nLine 2\n",
        },
        "agents/example/references",
      ),
    ).toEqual([
      {
        path: "agents/example/references/example.md",
        content: "Line 1\nLine 2\n",
        mode: 0o644,
      },
    ]);
  });
});

describe("loadReferencesFromDir", () => {
  test("loads sorted valid reference files and returns source file paths", () => {
    const dir = join(tmpdir(), `references-test-${crypto.randomUUID()}`);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "zeta.txt"), "Z\n");
      writeFileSync(join(dir, "alpha.md"), "A\n");
      writeFileSync(join(dir, "invalid.json"), "skip\n");
      mkdirSync(join(dir, "nested.md"));

      expect(loadReferencesFromDir(dir)).toEqual({
        files: {
          "alpha.md": "A\n",
          "zeta.txt": "Z\n",
        },
        sourceFiles: [join(dir, "alpha.md"), join(dir, "zeta.txt")],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns empty collections for missing reference directories", () => {
    expect(loadReferencesFromDir(join(tmpdir(), `missing-${crypto.randomUUID()}`))).toEqual({
      files: {},
      sourceFiles: [],
    });
  });
});
