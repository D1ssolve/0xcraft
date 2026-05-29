/**
 * F.3 — Doctor smoke test against generator output.
 *
 * Generates a real `.codex/` tree via `generateCodexPlugin`, then runs
 * `runDoctor({ harness: "codex" })` against it and asserts the doctor
 * reports a healthy environment. Also verifies the negative path: a
 * generated tree with `bun` simulated absent surfaces `bun.not_on_path`.
 *
 * T-10.2 — additionally spawns `bun run src/cli/index.ts doctor
 * --harness <id> --project <seededSandbox>` as a subprocess for each of
 * the three harnesses, asserting exit code 0 in a seeded environment
 * (option (a) of the task spec).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateClaudeCodePlugin } from "../adapters/claude-code";
import { generateCodexPlugin } from "../adapters/codex";
import { runDoctor } from "../cli/doctor";
import type { BunOnPathChecker } from "../cli/_shared";

const packageRoot = path.resolve(import.meta.dir, "..", "..");

const sandboxes: string[] = [];

function makeSandbox(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `0xcraft-int-${prefix}-`));
  sandboxes.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

const bunPresent: BunOnPathChecker = () => null;
const bunMissing: BunOnPathChecker = () => ({
  severity: "error",
  code: "bun.not_on_path",
  message: "bun not found on PATH; hook scripts require bun",
});

describe("F.3 — Doctor smoke against generated Codex tree", () => {
  let sandbox: string;

  beforeAll(async () => {
    sandbox = makeSandbox("doctor-smoke");
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("doctor-smoke-home"),
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Sanity guard so failed doctor results are explicable.
    expect(fs.existsSync(path.join(sandbox, ".codex", "config.toml"))).toBe(true);
  });

  test("runDoctor reports ok=true with bun present", async () => {
    const result = await runDoctor({
      harness: "codex",
      projectRoot: sandbox,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    if (!result.ok) {
      // Surface failing checks to make debugging trivial when this regresses.
      const failing = result.checks
        .filter((c) => c.status === "fail")
        .map((c) => `${c.code}: ${c.message}`)
        .join("\n");
      throw new Error(`runDoctor reported failures:\n${failing}`);
    }
    expect(result.ok).toBe(true);

    const errorChecks = result.checks.filter((c) => c.status === "fail");
    expect(errorChecks).toEqual([]);

    // Expected positive signals.
    expect(
      result.checks.some(
        (c) => c.category === "System" && c.status === "ok" && c.name.toLowerCase().includes("bun"),
      ),
    ).toBe(true);
    // No missing-config / missing-hook codes should surface.
    expect(result.checks.some((c) => c.code === "codex.config.missing")).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.hook.missing")).toBe(false);
  });

  test("runDoctor surfaces bun.not_on_path when bun missing", async () => {
    const result = await runDoctor({
      harness: "codex",
      projectRoot: sandbox,
      dependencies: { bunOnPathChecker: bunMissing },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "bun.not_on_path")).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/*  T-10.2 — subprocess doctor smoke for all three harnesses         */
/* ---------------------------------------------------------------- */

describe("T-10.2 — `bun run src/cli/index.ts doctor --harness <id>` subprocess", () => {
  const cliEntry = path.resolve(packageRoot, "src", "cli", "index.ts");

  async function seedClaudeCode(): Promise<string> {
    const sandbox = makeSandbox("t102-cc");
    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("t102-cc-home"),
    });
    expect(result.ok).toBe(true);
    return sandbox;
  }

  async function seedCodex(): Promise<string> {
    const sandbox = makeSandbox("t102-codex");
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("t102-codex-home"),
    });
    expect(result.ok).toBe(true);
    // Sanity: config.toml must exist for codex doctor to pass cleanly.
    expect(fs.existsSync(path.join(sandbox, ".codex", "config.toml"))).toBe(true);
    return sandbox;
  }

  function seedOpenCode(): string {
    // OpenCode doctor only inspects the project root for environment
    // signals (no required tree to seed). Fresh mkdtemp is sufficient.
    return makeSandbox("t102-oc");
  }

  async function spawnDoctor(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", "run", cliEntry, "doctor", ...args], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }

  test("--harness opencode exits 0 or 2 (no fail-severity) in seeded sandbox", async () => {
    const proj = seedOpenCode();
    const { exitCode, stdout, stderr } = await spawnDoctor([
      "--harness",
      "opencode",
      "--project",
      proj,
    ]);
    if (exitCode !== 0 && exitCode !== 2) {
      console.error("opencode doctor stdout:\n" + stdout);
      console.error("opencode doctor stderr:\n" + stderr);
    }
    // Exit 0 = clean; exit 2 = warns only (drop-warn matrix cells are
    // structural and expected). Exit 1 = at least one fail-severity check
    // and indicates a real environment problem — not allowed here.
    expect([0, 2]).toContain(exitCode);
  }, 30_000);

  test("--harness claude-code exits 0 or 2 (no fail-severity) in seeded sandbox", async () => {
    const proj = await seedClaudeCode();
    const { exitCode, stdout, stderr } = await spawnDoctor([
      "--harness",
      "claude-code",
      "--project",
      proj,
    ]);
    if (exitCode !== 0 && exitCode !== 2) {
      console.error("claude-code doctor stdout:\n" + stdout);
      console.error("claude-code doctor stderr:\n" + stderr);
    }
    expect([0, 2]).toContain(exitCode);
  }, 30_000);

  test("--harness codex exits 0 or 2 (no fail-severity) in seeded sandbox (option (a))", async () => {
    const proj = await seedCodex();
    const { exitCode, stdout, stderr } = await spawnDoctor([
      "--harness",
      "codex",
      "--project",
      proj,
    ]);
    if (exitCode !== 0 && exitCode !== 2) {
      console.error("codex doctor stdout:\n" + stdout);
      console.error("codex doctor stderr:\n" + stderr);
    }
    expect([0, 2]).toContain(exitCode);
  }, 30_000);
});
