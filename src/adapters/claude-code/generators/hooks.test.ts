import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { HookDefinition } from "../../../core/hooks";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { claudeCodeHooksJsonSchema } from "../types/claude-code-types";
import { generateClaudeCodeHooks } from "./hooks";

const baseHook = {
  description: "Test hook",
  enabledByDefault: true,
} satisfies Omit<HookDefinition, "id" | "type">;

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

describe("generateClaudeCodeHooks", () => {
  test("omits hooks/hooks.json when command-hook scripts are deferred", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-generator-supported-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [
        { ...baseHook, id: "session-setup", type: "session.start" },
        { ...baseHook, id: "tool-policy", type: "tool.before" },
      ],
    });

    expect(result.emittedFiles).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, "hooks", "hooks.json"))).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "claude.hook.command_scripts_deferred", hookId: "session-setup" }),
      expect.objectContaining({ code: "claude.hook.command_scripts_deferred", hookId: "tool-policy" }),
    ]);
  });

  test("omits hooks file and reports diagnostics when only unsupported OpenCode hooks are present", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-generator-unsupported-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [{ ...baseHook, id: "agents-guard", type: "message.first" }],
    });

    expect(result.emittedFiles).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, "hooks", "hooks.json"))).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude.hook.deferred_first_message",
        hookId: "agents-guard",
        message:
          "Hook `agents-guard` uses OpenCode first-message injection; Claude Code prompt-rewrite parity is unverified, so mapping is deferred.",
      },
    ]);
  });

  test("does not emit placeholder commands for deferred command-hook scripts", () => {
    const outputRoot = makeTempDir("0xcraft-claude-hooks-generator-placeholders-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeHooks({
      writer,
      hooks: [{ ...baseHook, id: "tool-policy", type: "tool.before" }],
    });

    expect(result.emittedFiles).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, "hooks", "hooks.json"))).toBe(false);
    expect(JSON.stringify(result.diagnostics)).not.toContain("${CLAUDE_PLUGIN_ROOT}/scripts/hooks/tool-policy.sh");
    expect(JSON.stringify(result.diagnostics)).not.toContain(outputRoot);
    expect(JSON.stringify(result.diagnostics)).not.toContain(process.cwd());
  });
});
