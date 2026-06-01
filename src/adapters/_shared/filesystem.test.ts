import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PlatformArtifact, PlatformArtifactFile } from "./artifact";
import { resolveInsideRoot, writeArtifact } from "./filesystem";

function mkArtifact(files: PlatformArtifactFile[]): PlatformArtifact {
  return {
    platform: "claude-code",
    kind: "filesystem-tree",
    ok: true,
    files,
    diagnostics: [],
    capabilityReport: {
      platform: "claude-code",
      features: {} as PlatformArtifact["capabilityReport"]["features"],
    },
    metadata: { deterministic: true },
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-fs-"));
}

describe("resolveInsideRoot", () => {
  test("resolves a relative path under the root", () => {
    const root = makeTmpDir();
    expect(resolveInsideRoot(root, "a/b.txt")).toBe(path.resolve(root, "a/b.txt"));
  });

  test("rejects empty string", () => {
    expect(() => resolveInsideRoot("/tmp", "")).toThrow(/non-empty/);
  });

  test("rejects absolute paths", () => {
    expect(() => resolveInsideRoot("/tmp", "/etc/passwd")).toThrow(/absolute/);
  });

  test("rejects paths that escape root via ..", () => {
    expect(() => resolveInsideRoot("/tmp/root", "../escape")).toThrow(/outside output root/);
  });

  test("rejects path that equals the root", () => {
    expect(() => resolveInsideRoot("/tmp/root", ".")).toThrow(/output root itself/);
  });
});

describe("writeArtifact", () => {
  test("writes files under outputRoot and returns sorted absolute paths", () => {
    const root = makeTmpDir();
    const artifact = mkArtifact([
      { path: "z/last.txt", content: "z" },
      { path: "a/first.txt", content: "a" },
      { path: "m/mid.txt", content: "m" },
    ]);
    const { written } = writeArtifact(artifact, root);
    expect(written).toEqual([
      path.resolve(root, "a/first.txt"),
      path.resolve(root, "m/mid.txt"),
      path.resolve(root, "z/last.txt"),
    ]);
    for (const p of written) expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(path.resolve(root, "a/first.txt"), "utf-8")).toBe("a");
  });

  test("creates outputRoot when missing", () => {
    const base = makeTmpDir();
    const root = path.join(base, "nested/new");
    const artifact = mkArtifact([{ path: "x.txt", content: "x" }]);
    writeArtifact(artifact, root);
    expect(fs.existsSync(path.join(root, "x.txt"))).toBe(true);
  });

  test("throws when outputRoot exists but is a file", () => {
    const base = makeTmpDir();
    const filePath = path.join(base, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    const artifact = mkArtifact([{ path: "x.txt", content: "x" }]);
    expect(() => writeArtifact(artifact, filePath)).toThrow(/not a directory/);
  });

  test("refuses to overwrite when force is not set", () => {
    const root = makeTmpDir();
    const artifact = mkArtifact([{ path: "x.txt", content: "first" }]);
    writeArtifact(artifact, root);
    expect(() =>
      writeArtifact(mkArtifact([{ path: "x.txt", content: "second" }]), root),
    ).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(root, "x.txt"), "utf-8")).toBe("first");
  });

  test("overwrites when force=true", () => {
    const root = makeTmpDir();
    writeArtifact(mkArtifact([{ path: "x.txt", content: "first" }]), root);
    writeArtifact(mkArtifact([{ path: "x.txt", content: "second" }]), root, { force: true });
    expect(fs.readFileSync(path.join(root, "x.txt"), "utf-8")).toBe("second");
  });

  test("rejects absolute paths in artifact.files", () => {
    const root = makeTmpDir();
    expect(() =>
      writeArtifact(mkArtifact([{ path: "/etc/passwd", content: "x" }]), root),
    ).toThrow(/absolute/);
  });

  test("rejects path traversal via ..", () => {
    const root = makeTmpDir();
    expect(() =>
      writeArtifact(mkArtifact([{ path: "../escape.txt", content: "x" }]), root),
    ).toThrow(/outside output root/);
  });

  test("applies POSIX mode when set", () => {
    const root = makeTmpDir();
    writeArtifact(
      mkArtifact([{ path: "run.sh", content: "#!/bin/sh\n", mode: 0o755 }]),
      root,
    );
    const stat = fs.statSync(path.join(root, "run.sh"));
    // On POSIX, the lower 9 bits should match 0o755. On Windows this is
    // best-effort; restrict the assertion accordingly.
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o755);
    }
  });
});
