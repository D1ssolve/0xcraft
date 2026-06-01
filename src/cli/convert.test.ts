import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runConvert } from "./convert";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("0xcraft convert", () => {
  test("returns ERR_SAME_PLATFORM when source and target match", () => {
    const input = tempDir("convert-same-in-");
    const output = tempDir("convert-same-out-");

    const result = runConvert({ from: "codex", to: "codex", in: input, out: output });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "ERR_SAME_PLATFORM" }),
    );
  });

  test("converts codex to opencode and writes artifacts", () => {
    const input = tempDir("convert-cdx-in-");
    const output = tempDir("convert-cdx-out-");
    writeCodexAgent(input);

    const result = runConvert({ from: "codex", to: "opencode", in: input, out: output });

    expect(result.exitCode).toBe(0);
    expect(result.written.length).toBeGreaterThan(0);
  });

  test("--strict upgrades warnings to errors and prevents writing", () => {
    const input = tempDir("convert-strict-in-");
    const output = tempDir("convert-strict-out-");
    writeCodexAgent(input, "on-failure");

    const result = runConvert({ from: "codex", to: "opencode", in: input, out: output, strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  test("--json mode returns structured result with diagnostics", () => {
    const input = tempDir("convert-json-in-");
    const output = tempDir("convert-json-out-");
    writeCodexAgent(input);

    const result = runConvert({ from: "codex", to: "opencode", in: input, out: output, json: true });

    expect(result.exitCode).toBe(0);
    // json mode is handled by the action handler capturing stdout;
    // runConvert returns structured result regardless
    expect(result.diagnostics).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeCodexAgent(root: string, approvalPolicy?: string): void {
  const agentsDir = join(root, ".codex", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, "reviewer.toml"), [
    'name = "Reviewer"',
    'description = "Reviews code"',
    'developer_instructions = "Review code carefully."',
    'model = "gpt-5.5"',
    approvalPolicy ? `approval_policy = "${approvalPolicy}"` : undefined,
    "",
  ].filter((line) => line !== undefined).join("\n"));
}
