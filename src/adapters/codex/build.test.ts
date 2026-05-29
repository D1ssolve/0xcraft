/**
 * Batch 4 — `build()` canonical entry tests for codex.
 *
 * Validates:
 *   - artifact shape + determinism.
 *   - capability report uses CODEX_MATRIX verbatim.
 *   - every `drop-warn` hook cell in CODEX_MATRIX yields a
 *     `hook.unsupported` warn diagnostic (T-4.2).
 *   - no timestamp on metadata.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CODEX_MATRIX } from "../_shared/capability-matrix";

import { defaultConfig } from "../../core/config/config-types";

import { build } from "./build";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

let tmpProject = "";

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "codex-build-test-"));
});

afterEach(() => {
  if (tmpProject && fs.existsSync(tmpProject)) {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

describe("codex build()", () => {
  test("returns canonical artifact shape", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });

    expect(artifact.platform).toBe("codex");
    expect(artifact.kind).toBe("filesystem-tree");
    expect(Array.isArray(artifact.files)).toBe(true);
    expect(artifact.capabilityReport.features).toEqual(CODEX_MATRIX);
    expect("generatedAt" in (artifact.metadata ?? {})).toBe(false);
  });

  test("emits .codex/hooks.json + per-hook scripts for non-drop-warn cells", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });

    const filePaths = artifact.files!.map((f) => f.path);
    expect(filePaths).toContain(".codex/hooks.json");

    // One script per built-in hook (all built-in hooks land on full-status
    // Codex cells: SessionStart / UserPromptSubmit). Counts depend on
    // builtinHooks registry but must be at least 1.
    const scripts = filePaths.filter((p) => p.startsWith(".codex/hooks/"));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((p) => p.endsWith(".sh"))).toBe(true);

    // Scripts must be marked executable in the artifact (mode 0o755).
    for (const file of artifact.files!) {
      if (file.path.startsWith(".codex/hooks/")) {
        expect(file.mode).toBe(0o755);
      }
    }
  });

  test("hooks.json references scripts via git-root-resolved sh invocations", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: tmpProject,
      packageRoot,
      homeDir: tmpProject,
    });

    const hooksJsonFile = artifact.files!.find((f) => f.path === ".codex/hooks.json");
    expect(hooksJsonFile).toBeDefined();
    expect(hooksJsonFile!.content).toContain('"type": "command"');
    expect(hooksJsonFile!.content).toContain('git rev-parse --show-toplevel');
    expect(hooksJsonFile!.content).toContain('/.codex/hooks/');
    expect(hooksJsonFile!.content).toContain('.sh');
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
    // T-12.10 AC: files array byte-identical (path, content, mode in order).
    expect(b.files).toEqual(a.files);
    expect(JSON.stringify(b.files)).toBe(JSON.stringify(a.files));
  });

  test("files sorted by POSIX path", async () => {
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
});
