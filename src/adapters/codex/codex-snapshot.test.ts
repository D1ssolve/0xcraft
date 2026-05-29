/**
 * Batch-0 baseline snapshot (T-0.2).
 *
 * Locks the current `generateCodexPlugin` output surface BEFORE Batch-1+
 * refactor renames. Two back-to-back runs against isolated project roots
 * must produce byte-identical artifacts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import { generateCodexPlugin } from "./index";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

let tmpA = "";
let tmpB = "";

beforeEach(() => {
  tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "codex-snapshot-a-"));
  tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "codex-snapshot-b-"));
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

describe("codex adapter — Batch-0 baseline snapshot (T-0.2)", () => {
  test("two runs with identical inputs produce byte-identical artifacts", async () => {
    // Pin projectRoot so path-derived hook content matches across runs.
    // outputPath differs to prove generator does not embed it.
    const pinnedProject = path.join(tmpA, "pinned-project");
    fs.mkdirSync(pinnedProject, { recursive: true });

    const a = await generateCodexPlugin({
      packageRoot,
      projectRoot: pinnedProject,
      outputPath: path.join(tmpA, "out"),
      force: true,
    });
    const b = await generateCodexPlugin({
      packageRoot,
      projectRoot: pinnedProject,
      outputPath: path.join(tmpB, "out"),
      force: true,
    });

    expect(b.emittedFiles.slice().sort()).toEqual(a.emittedFiles.slice().sort());

    const hashesA = hashDir(a.outputPath, a.emittedFiles);
    const hashesB = hashDir(b.outputPath, b.emittedFiles);
    expect(hashesB).toEqual(hashesA);
  });

  test(".codex/config.toml parses and exposes Batch-0 feature flags", async () => {
    const r = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpA,
      force: true,
    });

    const configPath = path.join(r.outputPath, ".codex", "config.toml");
    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = parseToml(fs.readFileSync(configPath, "utf-8")) as {
      features: Record<string, unknown>;
    };
    expect(parsed.features.hooks).toBe(true);
    expect(parsed.features.child_agents_md).toBe(true);
    expect(r.emittedFiles).toContain(".codex/config.toml");
  });

  test("emittedFiles contains at least one agent and is error-free", async () => {
    const r = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpA,
      force: true,
    });
    expect(r.ok).toBe(true);
    expect(r.emittedFiles.some((f) => f.startsWith(".codex/agents/") && f.endsWith(".toml"))).toBe(
      true,
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
