import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { claudeCodeSettingsJsonSchema } from "../types/claude-code-types";
import { generateClaudeCodeSettings } from "./settings";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

describe("generateClaudeCodeSettings", () => {
  test("writes root settings.json with supported Claude Code keys only", () => {
    const outputRoot = makeTempDir("0xcraft-claude-settings-supported-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSettings({
      writer,
      settings: {
        agent: "backend-developer",
        subagentStatusLine: "compact",
      },
    });

    expect(result.emittedFiles).toEqual(["settings.json"]);
    const settings = readJson(path.join(outputRoot, "settings.json"));
    expect(settings).toEqual({
      agent: "backend-developer",
      subagentStatusLine: "compact",
    });
    expect(() => claudeCodeSettingsJsonSchema.parse(settings)).not.toThrow();
  });

  test("does not store general 0xcraft config in Claude plugin settings.json", () => {
    const outputRoot = makeTempDir("0xcraft-claude-settings-filter-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    generateClaudeCodeSettings({
      writer,
      settings: {
        agent: "code-reviewer",
        agents: { backendDeveloper: { enabled: true } },
        skills: { paths: ["skills"] },
        mcp: { context7: { command: ["uvx", "context7"] } },
        permissions: { allow: ["Bash(*)"] },
      },
    });

    expect(readJson(path.join(outputRoot, "settings.json"))).toEqual({ agent: "code-reviewer" });
  });

  test("omits settings.json deterministically when no supported settings are provided", () => {
    const outputRoot = makeTempDir("0xcraft-claude-settings-empty-");
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSettings({
      writer,
      settings: {
        agents: { backendDeveloper: { enabled: true } },
        skills: { paths: ["skills"] },
      },
    });

    expect(result.emittedFiles).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, "settings.json"))).toBe(false);
  });
});
