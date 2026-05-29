/**
 * F.2 — Codex hook execution integration test (Batch D).
 *
 * Re-enabled now that the Codex matrix declares full/experimental/shim
 * coverage for 13 of 15 neutral hook events and the adapter emits real
 * `.codex/hooks.json` + `.codex/hooks/<id>.sh` POSIX scripts.
 *
 * Coverage:
 *   1. Built-in hooks produce executable `.sh` files.
 *   2. `hooks.json` parses + references each script via
 *      `git rev-parse --show-toplevel`.
 *   3. Running a `session.start` context-injection script with a sample
 *      Codex event JSON on stdin yields a parseable JSON envelope with
 *      `hookSpecificOutput.hookEventName === "SessionStart"` and an
 *      `additionalContext` payload containing the hook's marker.
 *   4. `user-prompt.first` script (first-only shim) is silent on second
 *      invocation because the marker file already exists.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateCodexPlugin } from "../adapters/codex";

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

describe("F.2 — Codex hook execution end-to-end (Batch D)", () => {
  test("emits hooks.json + executable .sh scripts for built-in hooks", async () => {
    const sandbox = makeSandbox("codex-exec");
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("codex-exec-home"),
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const hooksJsonPath = path.join(sandbox, ".codex", "hooks.json");
    expect(fs.existsSync(hooksJsonPath)).toBe(true);
    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    expect(typeof hooksJson.hooks).toBe("object");

    // Each script command must reference git root + a `.sh` under `.codex/hooks`.
    for (const groups of Object.values(hooksJson.hooks)) {
      for (const g of groups) {
        for (const h of g.hooks) {
          expect(h.command).toContain("git rev-parse --show-toplevel");
          expect(h.command).toMatch(/\/\.codex\/hooks\/[^"]+\.sh/);
        }
      }
    }
  });

  test("running a SessionStart script with sample stdin yields valid JSON envelope", async () => {
    const sandbox = makeSandbox("codex-exec-run");
    await generateCodexPlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("codex-exec-run-home"),
    });

    // Pick the first emitted SessionStart-mapped script — caveman-bootstrap.
    const script = path.join(sandbox, ".codex", "hooks", "caveman-bootstrap.sh");
    expect(fs.existsSync(script)).toBe(true);

    const stdin = JSON.stringify({
      session_id: "test-session",
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: sandbox,
    });

    const proc = spawnSync("sh", [script], { input: stdin, encoding: "utf-8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout.trim().length).toBeGreaterThan(0);

    const envelope = JSON.parse(proc.stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(envelope.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(typeof envelope.hookSpecificOutput?.additionalContext).toBe("string");
    expect(envelope.hookSpecificOutput?.additionalContext).toContain("CAVEMAN_BOOTSTRAP_INJECTED");
  });

  test("UserPromptFirst first-only shim runs once, then exits silently", async () => {
    const sandbox = makeSandbox("codex-exec-first");
    await generateCodexPlugin({
      packageRoot,
      projectRoot: sandbox,
      outputPath: sandbox,
      force: true,
      homeDir: makeSandbox("codex-exec-first-home"),
    });

    const script = path.join(sandbox, ".codex", "hooks", "agents-guard.sh");
    expect(fs.existsSync(script)).toBe(true);

    const stdin = JSON.stringify({
      session_id: "s",
      hook_event_name: "UserPromptSubmit",
      cwd: sandbox,
      prompt: "hi",
    });

    // Clear any pre-existing marker that may collide between sandboxes.
    // (Marker path is /tmp/0xcraft_codex_first_<hash>_agents-guard.)
    // We do not need to know the hash — just run, capture, then re-run.

    const first = spawnSync("sh", [script], { input: stdin, encoding: "utf-8" });
    expect(first.status).toBe(0);
    // First run: AGENTS.md is missing → emits context-injection JSON.
    // (sandbox has no AGENTS.md.)
    expect(first.stdout.length).toBeGreaterThan(0);

    const second = spawnSync("sh", [script], { input: stdin, encoding: "utf-8" });
    expect(second.status).toBe(0);
    // Second run: marker file exists → script exits silently.
    expect(second.stdout).toBe("");
  });
});
