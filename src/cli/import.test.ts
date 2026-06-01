import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runImport } from "./import";

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-import-"));
}

function writeCodexAgent(root: string, approvalPolicy?: string): void {
  const agentsDir = path.join(root, ".codex", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "reviewer.toml"),
    [
      'name = "Reviewer"',
      'description = "Reviews code"',
      'developer_instructions = "Review code carefully."',
      'model = "gpt-5.5"',
      approvalPolicy ? `approval_policy = "${approvalPolicy}"` : undefined,
      "",
    ].filter((line) => line !== undefined).join("\n"),
  );
}

function read(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("runImport", () => {
  test("imports from codex and writes common layout", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input);

    const result = runImport({ from: "codex", inDir: input, outDir: output });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(fs.existsSync(path.join(output, "agents", "reviewer", "AGENT.md"))).toBe(true);
    expect(fs.existsSync(path.join(output, "agents", "reviewer", "agent.codex.toml"))).toBe(true);
    expect(read(output, "agents/reviewer/AGENT.md")).toContain("Review code carefully.");
    expect(read(output, "agents/reviewer/agent.codex.toml")).toContain('model = "gpt-5.5"');
  });

  test("returns ERR_FILE_EXISTS without overwrite", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input);
    fs.mkdirSync(path.join(output, "agents", "reviewer"), { recursive: true });
    fs.writeFileSync(path.join(output, "agents", "reviewer", "AGENT.md"), "existing");

    const result = runImport({ from: "codex", inDir: input, outDir: output });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ERR_FILE_EXISTS",
      message: expect.stringContaining("already exists"),
      details: { path: path.join(output, "agents", "reviewer", "AGENT.md") },
    });
    expect(read(output, "agents/reviewer/AGENT.md")).toBe("existing");
  });

  test("rewrites codex on-failure to on-request by default", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input, "on-failure");

    const result = runImport({ from: "codex", inDir: input, outDir: output });

    expect(result.exitCode).toBe(2);
    expect(result.diagnostics).toContainEqual({
      severity: "warn",
      code: "codex.approval_policy.on-failure.deprecated",
      message: expect.stringContaining("on-request"),
      details: { id: "reviewer", originalPolicy: "on-failure", rewrittenPolicy: "on-request" },
    });
    expect(read(output, "agents/reviewer/agent.codex.toml")).toContain('approval_policy = "on-request"');
    expect(read(output, "agents/reviewer/agent.codex.toml")).not.toContain("on-failure");
  });

  test("rewrites codex on-failure to never when non-interactive", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input, "on-failure");

    const result = runImport({
      from: "codex",
      inDir: input,
      outDir: output,
      nonInteractive: true,
    });

    expect(result.exitCode).toBe(2);
    expect(read(output, "agents/reviewer/agent.codex.toml")).toContain('approval_policy = "never"');
    expect(read(output, "agents/reviewer/agent.codex.toml")).not.toContain("on-failure");
  });

  test("strict upgrades warnings to errors and json returns structured diagnostics", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input, "on-failure");

    const result = runImport({ from: "codex", inDir: input, outDir: output, strict: true, json: true });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(JSON.parse(result.output)).toEqual({
      diagnostics: result.diagnostics,
      exitCode: 1,
      writtenFiles: result.writtenFiles,
    });
  });

  test("exit codes are 0 clean, 1 error, 2 warn-only", () => {
    const cleanInput = makeSandbox();
    const cleanOutput = makeSandbox();
    writeCodexAgent(cleanInput);
    expect(runImport({ from: "codex", inDir: cleanInput, outDir: cleanOutput }).exitCode).toBe(0);

    const errorInput = makeSandbox();
    const errorOutput = makeSandbox();
    writeCodexAgent(errorInput);
    fs.mkdirSync(path.join(errorOutput, "agents", "reviewer"), { recursive: true });
    fs.writeFileSync(path.join(errorOutput, "agents", "reviewer", "AGENT.md"), "existing");
    expect(runImport({ from: "codex", inDir: errorInput, outDir: errorOutput }).exitCode).toBe(1);

    const warnInput = makeSandbox();
    const warnOutput = makeSandbox();
    writeCodexAgent(warnInput, "on-failure");
    expect(runImport({ from: "codex", inDir: warnInput, outDir: warnOutput }).exitCode).toBe(2);
  });
});
