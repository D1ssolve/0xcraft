/**
 * Batch 4 — `build()` canonical entry tests for claude-code.
 *
 * Validates:
 *   - artifact shape (`platform`, `kind`, `files`, `capabilityReport`).
 *   - byte-identical `files` between two consecutive `build()` calls
 *     (determinism, ADR §6).
 *   - capability report uses CLAUDE_CODE_MATRIX verbatim.
 *   - no `generatedAt`-style timestamp on metadata.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CLAUDE_CODE_MATRIX } from "../_shared/capability-matrix";

import { defaultConfig } from "../../core/config/config-types";

import { build } from "./build";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

let tmpProject = "";

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "claude-build-test-"));
});

afterEach(() => {
  if (tmpProject && fs.existsSync(tmpProject)) {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

describe("claude-code build()", () => {
  test("returns canonical artifact shape", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });

    expect(artifact.platform).toBe("claude-code");
    expect(artifact.kind).toBe("filesystem-tree");
    expect(Array.isArray(artifact.files)).toBe(true);
    expect(artifact.files!.length).toBeGreaterThan(0);
    expect(artifact.capabilityReport.platform).toBe("claude-code");
    expect(artifact.capabilityReport.features).toEqual(CLAUDE_CODE_MATRIX);
    expect(artifact.metadata).toBeDefined();
    expect((artifact.metadata as unknown as Record<string, unknown>).deterministic).toBe(true);
    // T-4.4: no timestamp fields.
    expect("generatedAt" in (artifact.metadata ?? {})).toBe(false);
  });

  test("files are sorted by POSIX path", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });
    const paths = artifact.files!.map((f) => f.path);
    const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(paths).toEqual(sorted);
  });

  test("two consecutive build() calls produce byte-identical files", async () => {
    const a = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });
    const b = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });

    // Match codex test style: assert full file array equality, then
    // JSON-stringify equality. Map-based assertions would lose order /
    // duplicate-path detection / mode.
    expect(b.files).toEqual(a.files);
    expect(JSON.stringify(b.files)).toBe(JSON.stringify(a.files));
  });
});
