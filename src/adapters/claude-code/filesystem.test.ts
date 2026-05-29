import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createClaudeCodeFilesystemWriter } from "./filesystem";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("createClaudeCodeFilesystemWriter", () => {
  test("writes stable JSON with two-space formatting and final newline", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-json-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const emitted = writer.writeJson(".claude-plugin/plugin.json", {
      z: true,
      nested: { beta: 2, alpha: 1 },
      list: [{ delta: 4, gamma: 3 }],
      a: "first",
    });

    expect(emitted).toEqual([".claude-plugin/plugin.json"]);
    expect(readText(path.join(outputRoot, ".claude-plugin", "plugin.json"))).toBe(
      '{\n  "a": "first",\n  "list": [\n    {\n      "delta": 4,\n      "gamma": 3\n    }\n  ],\n  "nested": {\n    "alpha": 1,\n    "beta": 2\n  },\n  "z": true\n}\n',
    );
  });

  test("writes Markdown with exactly one final newline", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-markdown-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    writer.writeMarkdown("skills/example/SKILL.md", "# Skill\n\nBody\n\n");

    expect(readText(path.join(outputRoot, "skills", "example", "SKILL.md"))).toBe("# Skill\n\nBody\n");
  });

  test("prevents path traversal outside the output root", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-traversal-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    expect(() => writer.writeMarkdown("../escape.md", "bad")).toThrow("outside output root");
    expect(() => writer.writeJson("/tmp/escape.json", {})).toThrow("outside output root");
  });

  test("fails when output exists unless force is true", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-overwrite-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });
    writer.writeMarkdown("README.md", "first");

    expect(() => writer.writeMarkdown("README.md", "second")).toThrow("already exists");

    const forceWriter = createClaudeCodeFilesystemWriter({ outputRoot, force: true });
    forceWriter.writeMarkdown("README.md", "second");

    expect(readText(path.join(outputRoot, "README.md"))).toBe("second\n");
  });

  test("preflights non-empty output roots before writing anything without force", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-preflight-");
    fs.writeFileSync(path.join(outputRoot, "existing.txt"), "keep");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    expect(() => writer.writeMarkdown("README.md", "new")).toThrow("Output directory already exists and is not empty");

    expect(fs.existsSync(path.join(outputRoot, "README.md"))).toBe(false);
    expect(readText(path.join(outputRoot, "existing.txt"))).toBe("keep");
  });

  test("allows empty existing output roots without force", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-empty-root-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    writer.writeMarkdown("README.md", "new");

    expect(readText(path.join(outputRoot, "README.md"))).toBe("new\n");
  });

  test("copies skill support files inside plugin root in deterministic order", () => {
    const sourceRoot = makeTempDir("0xcraft-claude-fs-source-");
    const outputRoot = makeTempDir("0xcraft-claude-fs-copy-");
    fs.mkdirSync(path.join(sourceRoot, "skill", "nested"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "skill", "z.txt"), "z");
    fs.writeFileSync(path.join(sourceRoot, "skill", "SKILL.md"), "# Skill");
    fs.writeFileSync(path.join(sourceRoot, "skill", "nested", "b.txt"), "b");
    fs.writeFileSync(path.join(sourceRoot, "skill", "nested", "a.txt"), "a");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const emitted = writer.copyDirectory(path.join(sourceRoot, "skill"), "skills/example");

    expect(emitted).toEqual([
      "skills/example/SKILL.md",
      "skills/example/nested/a.txt",
      "skills/example/nested/b.txt",
      "skills/example/z.txt",
    ]);
    expect(readText(path.join(outputRoot, "skills", "example", "nested", "a.txt"))).toBe("a");
    expect(readText(path.join(outputRoot, "skills", "example", "nested", "b.txt"))).toBe("b");
    expect(readText(path.join(outputRoot, "skills", "example", "z.txt"))).toBe("z");
  });

  test("rejects copied symlinks so plugin output cannot reference external files", () => {
    const sourceRoot = makeTempDir("0xcraft-claude-fs-symlink-source-");
    const outputRoot = makeTempDir("0xcraft-claude-fs-symlink-output-");
    fs.mkdirSync(path.join(sourceRoot, "skill"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "outside.txt"), "secret");
    fs.symlinkSync(path.join(sourceRoot, "outside.txt"), path.join(sourceRoot, "skill", "linked.txt"));
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    expect(() => writer.copyDirectory(path.join(sourceRoot, "skill"), "skills/example")).toThrow("symbolic links");
  });

  test("writeFile honours sandbox-root containment and applies POSIX mode", () => {
    const outputRoot = makeTempDir("0xcraft-claude-fs-writefile-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const emitted = writer.writeFile("hooks/sample.mjs", "#!/usr/bin/env bun\n", 0o755);
    expect(emitted).toEqual(["hooks/sample.mjs"]);

    const dest = path.join(outputRoot, "hooks", "sample.mjs");
    expect(readText(dest)).toBe("#!/usr/bin/env bun\n");
    // Best-effort mode assertion — POSIX only. Skip on Windows where chmod
    // is silently dropped.
    if (process.platform !== "win32") {
      const mode = fs.statSync(dest).mode & 0o777;
      expect(mode).toBe(0o755);
    }

    expect(() => writer.writeFile("../escape.mjs", "bad")).toThrow("outside output root");
    expect(() => writer.writeFile("/tmp/escape.mjs", "bad")).toThrow("outside output root");
  });
});
