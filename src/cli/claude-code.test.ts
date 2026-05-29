import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createCliProgram } from "./index";
import { createClaudeCodeCommand } from "./claude-code";
import type { ClaudeCodeArtifact } from "../adapters/claude-code";
import type { BuildOptions } from "../adapters/_shared/artifact";
import { CLAUDE_CODE_MATRIX } from "../adapters/_shared/capability-matrix";
import type { Diagnostic } from "../core/diagnostics";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeArtifact(overrides: Partial<ClaudeCodeArtifact> = {}): ClaudeCodeArtifact {
  return {
    platform: "claude-code",
    kind: "filesystem-tree",
    ok: true,
    files: [
      {
        path: ".claude-plugin/plugin.json",
        content: JSON.stringify({ name: "0xcraft", agents: "agents/", skills: "skills/" }) + "\n",
      },
    ],
    diagnostics: [],
    capabilityReport: { platform: "claude-code", features: CLAUDE_CODE_MATRIX },
    metadata: { deterministic: true },
    ...overrides,
  };
}

describe("claude-code CLI", () => {
  test("top-level help includes claude-code command and first-release loading limitations", () => {
    const program = createCliProgram({ exit: () => undefined });
    const help = program.helpInformation();

    expect(help).toContain("claude-code");
    expect(help).toContain("Claude Code plugin-dir workflow");
    expect(help).toContain("zip loading is not supported");
  });

  test("generate help documents optional out default as ephemeral gitignored dist output", () => {
    const command = createClaudeCodeCommand({ setExitCode: () => undefined });
    const generate = command.commands.find((subcommand) => subcommand.name() === "generate");

    expect(generate).toBeDefined();
    const help = generate?.helpInformation() ?? "";

    expect(help).toContain("--out <dir>");
    expect(help).toContain("dist/claude-code-plugin/0xcraft/");
    expect(help).toContain("ephemeral gitignored generated output");
    expect(help).toContain("claude --plugin-dir <dir>");
    expect(help).toContain("zip loading is not supported");
  });

  test("generate calls build() with resolved roots and writes artifact to --out", async () => {
    const calls: BuildOptions[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const outDir = path.join(makeTempDir("0xcraft-cli-explicit-out-"), "plugin");
    const projectRoot = makeTempDir("0xcraft-cli-project-");

    const command = createClaudeCodeCommand({
      cwd: () => projectRoot,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async (options) => {
        calls.push(options);
        return makeArtifact();
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--out", outDir, "--force", "--validate", "--strict"],
      { from: "node" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.outputRoot).toBe(path.resolve(outDir));
    expect(calls[0]?.projectRoot).toBe(projectRoot);
    expect(typeof calls[0]?.packageRoot).toBe("string");
    expect(calls[0]?.config).toBeDefined();
    expect(stdout.join("\n")).toContain(`claude --plugin-dir ${path.resolve(outDir)}`);
    // files actually written via writeArtifact
    expect(fs.existsSync(path.join(outDir, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(exitCodes).toEqual([0]);
  });

  test("missing --out resolves package-root default and prints ephemeral output message", async () => {
    const calls: BuildOptions[] = [];
    const stdout: string[] = [];
    // Use an empty artifact (no files) so no real package-root write occurs.
    const command = createClaudeCodeCommand({
      stdout: (m) => stdout.push(m),
      setExitCode: () => undefined,
      build: async (options) => {
        calls.push(options);
        return makeArtifact({ files: [] });
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(calls[0]?.outputRoot).toBeDefined();
    expect(calls[0]?.outputRoot).toContain(path.join("dist", "claude-code-plugin", "0xcraft"));
    expect(stdout.join("\n")).toContain("dist/claude-code-plugin/0xcraft/");
    expect(stdout.join("\n")).toContain("ephemeral gitignored generated output");
  });

  test("generate creates plugin files in a temp output directory via real adapter+writer", async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const outDir = path.join(makeTempDir("0xcraft-cli-real-output-"), "plugin");
    const projectRoot = makeTempDir("0xcraft-cli-real-project-");
    fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".opencode", "0xcraft.json"),
      JSON.stringify({
        enabled: { skills: ["brainstorming"] },
        mcpServers: {},
      }),
    );
    const command = createClaudeCodeCommand({
      cwd: () => projectRoot,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
      setExitCode: (code) => exitCodes.push(code),
    });

    await command.parseAsync(["node", "test", "generate", "--out", outDir, "--force"], { from: "node" });

    expect(fs.existsSync(path.join(outDir, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, ".claude-plugin", "plugin.json"), "utf8"))).toMatchObject({
      name: "0xcraft",
      agents: "agents/",
      skills: "skills/",
    });
    expect(output.join("\n")).toContain(`[0xcraft] Load with: claude --plugin-dir ${outDir}`);
    expect(exitCodes).toEqual([0]);
  });

  test("error diagnostics are printed with 0xcraft prefix and set non-zero exit", async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const errorDiagnostic: Diagnostic = {
      severity: "error",
      code: "claude.something.failed",
      message: "Something failed.",
    };
    const command = createClaudeCodeCommand({
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () =>
        makeArtifact({
          ok: false,
          files: [],
          diagnostics: [errorDiagnostic],
        }),
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(stderr.some((line) => line.includes("[0xcraft] ERROR claude.something.failed"))).toBe(true);
    expect(exitCodes).toEqual([1]);
  });

  test("--strict upgrades warn diagnostics to errors and fails exit code", async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const warnDiagnostic: Diagnostic = {
      severity: "warn",
      code: "claude.mcp.invalid_remote_url",
      message: "Remote MCP server was omitted because it has no valid URL.",
    };
    const command = createClaudeCodeCommand({
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () =>
        makeArtifact({
          files: [],
          diagnostics: [warnDiagnostic],
        }),
    });

    await command.parseAsync(["node", "test", "generate", "--strict"], { from: "node" });

    expect(stderr.some((line) => line.includes("[0xcraft] ERROR claude.mcp.invalid_remote_url"))).toBe(true);
    expect(exitCodes).toEqual([1]);
  });

  test("generate catches build exceptions and prints sanitized message without stack trace", async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const command = createClaudeCodeCommand({
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      setExitCode: (code) => exitCodes.push(code),
      build: async () => {
        throw new Error("Output directory already exists and is not empty: /tmp/private/project/plugin secret-token");
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(stderr).toEqual([
      "[0xcraft] ERROR claude-code.generate.failed — Output directory already exists and is not empty: <path> [redacted]-[redacted]",
    ]);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).not.toContain("/tmp/private");
    expect(stderr.join("\n")).not.toContain("secret-token");
    expect(stderr.join("\n")).not.toContain("Error:");
    expect(stderr.join("\n")).not.toContain(" at ");
    expect(exitCodes).toEqual([1]);
  });

  test("CRITICAL: invalid flat config exits 1, build NEVER called, no files written", async () => {
    const projectRoot = makeTempDir("0xcraft-cc-cli-badcfg-");
    const claudeDir = path.join(projectRoot, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "0xcraft.json"), JSON.stringify({ disabledAgents: [] }));

    const outDir = path.join(makeTempDir("0xcraft-cc-cli-badcfg-out-"), "plugin");
    const buildCalls: number[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const command = createClaudeCodeCommand({
      cwd: () => projectRoot,
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () => {
        buildCalls.push(1);
        return makeArtifact();
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--out", outDir],
      { from: "node" },
    );

    expect(buildCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("config.validation.failed");
    expect(fs.existsSync(path.join(outDir, ".claude-plugin", "plugin.json"))).toBe(false);
  });

  test("IMPORTANT: artifact error diagnostics abort BEFORE write — no files persisted", async () => {
    const outDir = path.join(makeTempDir("0xcraft-cc-cli-builderr-"), "plugin");
    const projectRoot = makeTempDir("0xcraft-cc-cli-builderr-proj-");
    const exitCodes: number[] = [];

    const command = createClaudeCodeCommand({
      cwd: () => projectRoot,
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: (c) => exitCodes.push(c),
      build: async () =>
        makeArtifact({
          ok: false,
          files: [
            { path: ".claude-plugin/plugin.json", content: "{}" },
          ],
          diagnostics: [{ severity: "error", code: "cc.build.fail", message: "boom" }],
        }),
    });

    await command.parseAsync(
      ["node", "test", "generate", "--out", outDir],
      { from: "node" },
    );

    expect(exitCodes).toEqual([1]);
    // The would-be-written file must not appear on disk.
    expect(fs.existsSync(path.join(outDir, ".claude-plugin", "plugin.json"))).toBe(false);
  });
});
