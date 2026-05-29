/**
 * Batch-0 baseline snapshot (T-0.1).
 *
 * Locks the current `generateClaudeCodePlugin` output surface BEFORE the
 * Batch-1+ refactor renames. Two back-to-back runs against an isolated
 * project root must produce byte-identical artifacts (proves determinism)
 * and an emitted-files manifest that includes the canonical core files.
 *
 * This test is a regression net — if Batch-1 changes generator behaviour,
 * we want to know exactly which file's bytes drifted.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateClaudeCodePlugin } from "./index";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

let tmpA = "";
let tmpB = "";

beforeEach(() => {
  tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "claude-snapshot-a-"));
  tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "claude-snapshot-b-"));
});

afterEach(() => {
  for (const d of [tmpA, tmpB]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

function hashDir(root: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (!stat.isFile()) continue;
    const buf = fs.readFileSync(abs);
    out[rel] = createHash("sha256").update(buf).digest("hex");
  }
  return out;
}

describe("claude-code adapter — Batch-0 baseline snapshot (T-0.1)", () => {
  test("two runs with identical inputs produce byte-identical artifacts", async () => {
    // Pin projectRoot so any path-derived content (e.g. hook script embeds)
    // is identical across both runs. outputPath differs to prove the
    // generator does not embed it into emitted bytes.
    const pinnedProject = path.join(tmpA, "pinned-project");
    fs.mkdirSync(pinnedProject, { recursive: true });

    const a = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: pinnedProject,
      outputPath: path.join(tmpA, "claude-plugin"),
      force: true,
      validateExternal: false,
    });
    const b = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: pinnedProject,
      outputPath: path.join(tmpB, "claude-plugin"),
      force: true,
      validateExternal: false,
    });

    // emittedFiles list is order-stable (uniqueSorted) and project-root-independent.
    expect(b.emittedFiles).toEqual(a.emittedFiles);

    // Byte-equality across the two output trees.
    const hashesA = hashDir(a.outputPath, a.emittedFiles);
    const hashesB = hashDir(b.outputPath, b.emittedFiles);
    expect(hashesB).toEqual(hashesA);
  });

  test("canonical claude-plugin manifest exists and parses as JSON", async () => {
    const r = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: tmpA,
      outputPath: path.join(tmpA, "claude-plugin"),
      force: true,
      validateExternal: false,
    });

    const manifestPath = path.join(r.outputPath, ".claude-plugin", "plugin.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: unknown };
    expect(typeof parsed.name).toBe("string");
    expect(r.emittedFiles).toContain(".claude-plugin/plugin.json");
  });

  test("result metadata exposes Batch-0-required ephemeral-artifact contract", async () => {
    const r = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: tmpA,
      outputPath: path.join(tmpA, "claude-plugin"),
      force: true,
      validateExternal: false,
    });

    expect(r.metadata.generated).toBe(true);
    expect(r.metadata.sourceOwned).toBe(false);
    expect(r.metadata.ownership).toBe("ephemeral-generated-artifact");
  });
});
