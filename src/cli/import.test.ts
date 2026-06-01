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

function writeCodexPromptHook(root: string): void {
  const codexDir = path.join(root, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, "hooks.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            hooks: [{ type: "prompt", prompt: "Summarize the tool result." }],
          },
        ],
      },
    }),
  );
}

function writeOpenCodeAgentAndSkillReferences(root: string): void {
  const agentsDir = path.join(root, ".opencode", "agents");
  const skillDir = path.join(root, ".opencode", "skills", "caveman");
  fs.mkdirSync(path.join(agentsDir, "reviewer", "references"), { recursive: true });
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "reviewer.md"),
    [
      "---",
      "name: reviewer",
      "description: Reviews code",
      "mode: subagent",
      "---",
      "Review code carefully.",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: caveman",
      "description: Ultra-compressed communication",
      "---",
      "Respond terse like smart caveman.",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(agentsDir, "reviewer", "references", "zeta.txt"), "line one\r\nline two");
  fs.writeFileSync(path.join(agentsDir, "reviewer", "references", "alpha.md"), "agent alpha\n");
  fs.writeFileSync(path.join(skillDir, "references", "usage.txt"), "skill usage\r\nnext");
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

  test("imports agent and skill references into common layout", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeOpenCodeAgentAndSkillReferences(input);

    const result = runImport({ from: "opencode", inDir: input, outDir: output });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(read(output, "agents/reviewer/references/alpha.md")).toBe("agent alpha\n");
    expect(read(output, "agents/reviewer/references/zeta.txt")).toBe("line one\nline two\n");
    expect(read(output, "skills/caveman/references/usage.txt")).toBe("skill usage\nnext\n");
    expect(result.writtenFiles).toEqual(expect.arrayContaining([
      path.join(output, "agents", "reviewer", "references", "alpha.md"),
      path.join(output, "agents", "reviewer", "references", "zeta.txt"),
      path.join(output, "skills", "caveman", "references", "usage.txt"),
    ]));
  });

  test("returns ERR_FILE_EXISTS for existing reference files without overwrite", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeOpenCodeAgentAndSkillReferences(input);
    const existingReference = path.join(output, "agents", "reviewer", "references", "alpha.md");
    fs.mkdirSync(path.dirname(existingReference), { recursive: true });
    fs.writeFileSync(existingReference, "existing");

    const result = runImport({ from: "opencode", inDir: input, outDir: output });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ERR_FILE_EXISTS",
      message: expect.stringContaining("already exists"),
      details: { path: existingReference },
    });
    expect(read(output, "agents/reviewer/references/alpha.md")).toBe("existing");
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

  test("rejects unsupported codex approval policy", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexAgent(input, "on-failure");

    const result = runImport({ from: "codex", inDir: input, outDir: output });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
      message: "Codex approval_policy 'on-failure' is not supported.",
      details: { id: "reviewer", approvalPolicy: "on-failure" },
    });
    expect(fs.existsSync(path.join(output, "agents", "reviewer", "agent.codex.toml"))).toBe(false);
  });

  test("strict upgrades warnings to errors and json returns structured diagnostics", () => {
    const input = makeSandbox();
    const output = makeSandbox();
    writeCodexPromptHook(input);

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
    writeCodexPromptHook(warnInput);
    expect(runImport({ from: "codex", inDir: warnInput, outDir: warnOutput }).exitCode).toBe(2);
  });
});
