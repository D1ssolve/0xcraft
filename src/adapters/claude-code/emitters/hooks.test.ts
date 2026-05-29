import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { builtinHooks, getHookById, HookEvent, type HookSpec } from "../../../core/hooks";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { generateClaudeCodeHooks } from "./hooks";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hook(id: string): HookSpec {
  const h = getHookById(id);
  if (!h) throw new Error(`missing builtin hook ${id}`);
  return h;
}

describe("generateClaudeCodeHooks", () => {
  test("emits real hook shim scripts and hooks.json for all three bootstrap hooks", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-real-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: builtinHooks,
    });

    // hooks.json written
    expect(result.emittedFiles).toContain("hooks/hooks.json");
    const hooksJsonPath = path.join(outputRoot, "hooks", "hooks.json");
    expect(fs.existsSync(hooksJsonPath)).toBe(true);

    // scriptFiles returned for every bootstrap hook
    const scriptPaths = result.scriptFiles.map((f) => f.path).sort();
    expect(scriptPaths).toEqual([
      "hooks/agents-guard.mjs",
      "hooks/caveman-bootstrap.mjs",
      "hooks/git-worktree-bootstrap.mjs",
    ]);
    for (const sf of result.scriptFiles) {
      expect(sf.mode).toBe(0o755);
      expect(sf.content.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    }

    // hooks.json shape — SessionStart contains caveman + git-worktree, UserPromptSubmit contains agents-guard
    const hooksJson = readJson(hooksJsonPath) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "SessionStart",
      "UserPromptSubmit",
    ]);
    const sessionStart = hooksJson.hooks.SessionStart!;
    expect(sessionStart.length).toBe(2);
    for (const group of sessionStart) {
      expect(group.matcher).toBe("startup|resume|clear");
    }
    const commands = sessionStart.map((g) => g.hooks[0]!.command).sort();
    expect(commands[0]).toContain("caveman-bootstrap.mjs");
    expect(commands[1]).toContain("git-worktree-bootstrap.mjs");
    expect(commands[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(commands[0]).toMatch(/^bun /);

    const userPromptSubmit = hooksJson.hooks.UserPromptSubmit!;
    expect(userPromptSubmit.length).toBe(1);
    expect(userPromptSubmit[0]!.hooks[0]!.command).toContain("agents-guard.mjs");

    // No deferred-first-message warnings
    expect(JSON.stringify(result.diagnostics)).not.toContain("deferred_first_message");
  });

  test("disabled hooks produce no script file and no hooks.json entry", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-disabled-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: builtinHooks,
      disabledHooks: ["caveman-bootstrap", "git-worktree-bootstrap"],
    });

    const scriptPaths = result.scriptFiles.map((f) => f.path);
    expect(scriptPaths).toEqual(["hooks/agents-guard.mjs"]);

    const hooksJson = readJson(path.join(outputRoot, "hooks", "hooks.json")) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(hooksJson.hooks).sort()).toEqual(["UserPromptSubmit"]);
  });

  test("no hooks → no hooks.json and no script files", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-empty-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [],
    });

    expect(result.emittedFiles).toEqual([]);
    expect(result.scriptFiles).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, "hooks", "hooks.json"))).toBe(false);
  });

  test("node runtime → node shebang + node prefix in command", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-node-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [hook("caveman-bootstrap")],
      runtime: "node",
    });

    expect(result.scriptFiles[0]!.content.startsWith("#!/usr/bin/env node\n")).toBe(true);
    const hooksJson = readJson(path.join(outputRoot, "hooks", "hooks.json")) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(hooksJson.hooks.SessionStart[0]!.hooks[0]!.command).toMatch(/^node /);
  });

  test("rejects unsafe hook id without emitting a script", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-unsafe-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const unsafe: HookSpec = {
      id: "../escape",
      description: "x",
      event: HookEvent.SessionStart,
      enabledByDefault: true,
      marker: "<!-- X -->",
    };

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [unsafe],
    });

    // The mapper rejects the unsafe id; no hooks.json entry.
    expect(result.emittedFiles).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === "claude.hook.invalid_id")).toBe(true);
  });
});
