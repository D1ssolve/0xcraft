import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePackageRoot } from "./package-root";

describe("resolvePackageRoot", () => {
  let tmpRoot: string;
  let pkgRoot: string;
  let nestedDir: string;
  let unrelatedDir: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-pkgroot-"));
    pkgRoot = path.join(tmpRoot, "pkg");
    fs.mkdirSync(path.join(pkgRoot, "agents"), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, "skills"), { recursive: true });

    nestedDir = path.join(pkgRoot, "src", "adapters", "opencode");
    fs.mkdirSync(nestedDir, { recursive: true });

    unrelatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-unrelated-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(unrelatedDir, { recursive: true, force: true });
  });

  test("walks parents from startDir to find package root", () => {
    const result = resolvePackageRoot({ startDir: nestedDir, cwd: unrelatedDir });
    expect(result).toBe(pkgRoot);
  });

  test("returns the directory itself when it already has agents/ + skills/", () => {
    expect(resolvePackageRoot({ startDir: pkgRoot, cwd: unrelatedDir })).toBe(pkgRoot);
  });

  test("falls back to cwd when startDir walk fails but cwd has assets", () => {
    const result = resolvePackageRoot({ startDir: unrelatedDir, cwd: pkgRoot });
    expect(result).toBe(pkgRoot);
  });

  test("falls back to startDir when neither startDir nor cwd has assets", () => {
    const result = resolvePackageRoot({ startDir: unrelatedDir, cwd: unrelatedDir });
    expect(result).toBe(unrelatedDir);
  });
});
