/**
 * T-26 — End-to-end integration test for the Codex CLI plugin/marketplace
 * flow.
 *
 * Exercises the full pipeline:
 *   1. `codex generate --plugin --marketplace` writes:
 *        - .codex/config.toml + agents/*.toml + hooks/{hooks.json,*.sh}
 *        - .codex-plugin/plugin.json (+ skill/hook copies, .mcp.json if any)
 *        - .agents/plugins/marketplace.json
 *   2. `doctor --harness codex` against the resulting tree exits cleanly
 *      with no `fail` checks once the user config opts into plugin+marketplace.
 *
 * Asserts the integration of the CLI flag layer (T-25), the bundle emitter
 * (Batch E), and the doctor checks added in T-24.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCodexCommand } from "../cli/codex";
import { runDoctor } from "../cli/doctor";
import type { BunOnPathChecker } from "../cli/_shared";

const bunPresent: BunOnPathChecker = () => null;

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("T-26 codex CLI E2E: --plugin --marketplace + doctor", () => {
  test("full pipeline: generate writes all trees; doctor exits with no failures", async () => {
    const projectRoot = makeTempDir("0xcraft-codex-e2e-");

    // User config opts into both the bundle and the marketplace stub so
    // doctor can validate the on-disk result against the same config the
    // CLI used for generation.
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "0xcraft.json"),
      JSON.stringify({
        platforms: { codex: { emitPlugin: true, emitMarketplace: true } },
      }),
    );

    const exitCodes: number[] = [];
    const stderr: string[] = [];
    const command = createCodexCommand({
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
    });

    await command.parseAsync(
      [
        "node",
        "test",
        "generate",
        "--output",
        projectRoot,
        "--project",
        projectRoot,
        "--plugin",
        "--marketplace",
        "--force",
      ],
      { from: "node" },
    );

    // The CLI must finish with exit 0 (no errors). `setExitCode` is only
    // called on the failure path, so empty array == success.
    expect(exitCodes.find((c) => c !== 0)).toBeUndefined();

    // Core Codex tree.
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "agents"))).toBe(true);

    // Filesystem-plugin bundle.
    const pluginJson = path.join(projectRoot, ".codex-plugin", "plugin.json");
    expect(fs.existsSync(pluginJson)).toBe(true);

    // Marketplace stub.
    const marketplaceJson = path.join(
      projectRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    expect(fs.existsSync(marketplaceJson)).toBe(true);

    // Marketplace points at the bundle dir.
    const marketplace = JSON.parse(fs.readFileSync(marketplaceJson, "utf-8")) as {
      name: string;
      plugins: Array<{ name: string; path: string }>;
    };
    expect(marketplace.plugins[0]!.path).toBe("./.codex-plugin");

    // Doctor against the generated tree: NO `fail`-status checks.
    const doctor = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const failures = doctor.checks.filter((c) => c.status === "fail");
    expect(failures).toEqual([]);
    expect(doctor.ok).toBe(true);

    // Specifically, the new T-24 checks must all be `ok` (or absent).
    const t24Codes = doctor.checks
      .map((c) => c.code)
      .filter(
        (c): c is string =>
          typeof c === "string" &&
          (c === "codex.plugin.bundle.missing" ||
            c === "codex.plugin.marketplace.missing" ||
            c === "codex.plugin.marketplace_requires_plugin"),
      );
    expect(t24Codes).toEqual([]);
  });

  test("E2E without flags: no plugin/marketplace files written; doctor still ok", async () => {
    const projectRoot = makeTempDir("0xcraft-codex-e2e-nodirs-");

    const command = createCodexCommand({
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: () => undefined,
    });

    await command.parseAsync(
      [
        "node",
        "test",
        "generate",
        "--output",
        projectRoot,
        "--project",
        projectRoot,
        "--force",
      ],
      { from: "node" },
    );

    // Core tree present.
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(true);
    // Bundle + marketplace NOT present (opt-out default).
    expect(fs.existsSync(path.join(projectRoot, ".codex-plugin"))).toBe(false);
    expect(
      fs.existsSync(path.join(projectRoot, ".agents", "plugins", "marketplace.json")),
    ).toBe(false);

    const doctor = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    expect(doctor.ok).toBe(true);
  });

  test("T-27 determinism: two consecutive --plugin --marketplace runs yield byte-identical files", async () => {
    // Use the SAME projectRoot for both runs so per-project artifacts
    // (e.g. UserPromptFirst marker filename hashed from projectRoot)
    // are byte-stable. Different projectRoots intentionally produce
    // different per-project marker paths.
    const projectRoot = makeTempDir("0xcraft-codex-determinism-");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "0xcraft.json"),
      JSON.stringify({
        platforms: { codex: { emitPlugin: true, emitMarketplace: true } },
      }),
    );

    async function runOnce(): Promise<Map<string, Buffer>> {
      const command = createCodexCommand({
        stdout: () => undefined,
        stderr: () => undefined,
        setExitCode: () => undefined,
      });
      await command.parseAsync(
        [
          "node",
          "test",
          "generate",
          "--output",
          projectRoot,
          "--project",
          projectRoot,
          "--plugin",
          "--marketplace",
          "--force",
        ],
        { from: "node" },
      );

      // Snapshot all emitted files (relative path → bytes) across the
      // three emitted trees. Skip the user 0xcraft.json we wrote
      // ourselves (not an emitter output).
      const files = new Map<string, Buffer>();
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          const rel = path.relative(projectRoot, full);
          if (rel === path.join(".codex", "0xcraft.json")) continue;
          files.set(rel, fs.readFileSync(full));
        }
      };
      walk(projectRoot);
      return files;
    }

    const first = await runOnce();
    const second = await runOnce();

    // Same set of files in both runs.
    expect([...first.keys()].sort()).toEqual([...second.keys()].sort());

    // Byte-identical content for every emitted file.
    for (const [rel, bytes] of first.entries()) {
      const other = second.get(rel)!;
      if (!other.equals(bytes)) {
        throw new Error(
          `Non-deterministic file ${rel}\n--- first ---\n${bytes.toString("utf-8").slice(0, 600)}\n--- second ---\n${other.toString("utf-8").slice(0, 600)}`,
        );
      }
      expect(other.equals(bytes)).toBe(true);
    }
  });
});
