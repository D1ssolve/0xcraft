import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createCliProgram } from "./index";
import { createClaudeCodeCommand } from "./claude-code";
import type { GenerateClaudeCodePluginOptions, GenerateClaudeCodePluginResult } from "../adapters/claude-code";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeResult(overrides: Partial<GenerateClaudeCodePluginResult> = {}): GenerateClaudeCodePluginResult {
  const outputPath = overrides.outputPath ?? path.join(makeTempDir("0xcraft-cli-claude-output-"), "plugin");
  return {
    ok: true,
    outputPath,
    emittedFiles: [".claude-plugin/plugin.json"],
    diagnostics: [],
    compatibilityWarnings: [],
    localValidation: { ok: true, diagnostics: [] },
    metadata: {
      generated: true,
      sourceOwned: false,
      defaultOutput: false,
      ownership: "ephemeral-generated-artifact",
    },
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

  test("generate parses options and passes validate and strict flags to generator", async () => {
    const calls: GenerateClaudeCodePluginOptions[] = [];
    const output: string[] = [];
    const exitCodes: number[] = [];
    const outDir = path.join(makeTempDir("0xcraft-cli-explicit-out-"), "plugin");
    const command = createClaudeCodeCommand({
      cwd: () => "/tmp/project",
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
      setExitCode: (code) => exitCodes.push(code),
      generate: async (options) => {
        calls.push(options);
        return makeResult({ outputPath: outDir });
      },
    });

    await command.parseAsync(["node", "test", "generate", "--out", outDir, "--force", "--validate", "--strict"], { from: "node" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      projectRoot: "/tmp/project",
      outputPath: outDir,
      force: true,
      validateExternal: true,
      strictExternalValidation: true,
    });
    expect(output.join("\n")).toContain(`claude --plugin-dir ${outDir}`);
    expect(exitCodes).toEqual([0]);
  });

  test("missing out uses generator default and reports ephemeral gitignored output", async () => {
    const calls: GenerateClaudeCodePluginOptions[] = [];
    const output: string[] = [];
    const defaultOut = path.join(makeTempDir("0xcraft-package-"), "dist", "claude-code-plugin", "0xcraft");
    const command = createClaudeCodeCommand({
      stdout: (message) => output.push(message),
      setExitCode: () => undefined,
      generate: async (options) => {
        calls.push(options);
        return makeResult({
          outputPath: defaultOut,
          metadata: {
            generated: true,
            sourceOwned: false,
            defaultOutput: true,
            ownership: "ephemeral-generated-artifact",
          },
        });
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(calls[0]?.outputPath).toBeUndefined();
    expect(output.join("\n")).toContain("dist/claude-code-plugin/0xcraft/");
    expect(output.join("\n")).toContain("ephemeral gitignored generated output");
  });

  test("generate creates plugin files in a temp output directory without validation prompts", async () => {
    const output: string[] = [];
    const exitCodes: number[] = [];
    const outDir = path.join(makeTempDir("0xcraft-cli-real-output-"), "plugin");
    const projectRoot = makeTempDir("0xcraft-cli-real-project-");
    fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".opencode", "0xcraft.json"), JSON.stringify({
      enabledSkills: ["brainstorming"],
      mcpServers: {},
    }));
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
    expect(output.join("\n")).toContain("[0xcraft] WARN claude.compat.display_name_unsupported");
    expect(exitCodes).toEqual([0]);
  });

  test("diagnostics are printed with 0xcraft prefix and failed validation sets non-zero exit", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const command = createClaudeCodeCommand({
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
      setExitCode: (code) => exitCodes.push(code),
      generate: async () => makeResult({
        ok: false,
        diagnostics: [{
          severity: "error",
          code: "claude.validate.capability_unsupported",
          message: "Claude Code capability `claude plugin validate` is unsupported by the detected CLI.",
          details: { version: "2.1.120" },
        }],
        externalValidation: {
          ok: false,
          status: "failed",
          command: { command: "claude", args: ["plugin", "validate", "/tmp/plugin", "--strict"] },
          diagnostics: [],
        },
      }),
    });

    await command.parseAsync(["node", "test", "generate", "--strict"], { from: "node" });

    expect(stderr).toContain("[0xcraft] ERROR claude.validate.capability_unsupported: Claude Code capability `claude plugin validate` is unsupported by the detected CLI. (details: version=2.1.120)");
    expect(exitCodes).toEqual([1]);
  });

  test("generate catches generator errors and prints sanitized message without stack trace", async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const command = createClaudeCodeCommand({
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      setExitCode: (code) => exitCodes.push(code),
      generate: async () => {
        throw new Error("Output directory already exists and is not empty: /tmp/private/project/plugin secret-token");
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(stderr).toEqual([
      "[0xcraft] ERROR claude-code.generate.failed: Output directory already exists and is not empty: <path> [redacted]-[redacted]",
    ]);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).not.toContain("/tmp/private");
    expect(stderr.join("\n")).not.toContain("secret-token");
    expect(stderr.join("\n")).not.toContain("Error:");
    expect(stderr.join("\n")).not.toContain(" at ");
    expect(exitCodes).toEqual([1]);
  });

  test("diagnostics are deduplicated and safe details are aggregated without leaking secrets", async () => {
    const stdout: string[] = [];
    const command = createClaudeCodeCommand({
      stdout: (message) => stdout.push(message),
      stderr: (message) => stdout.push(message),
      setExitCode: () => undefined,
      generate: async () => makeResult({
        diagnostics: [
          {
            severity: "warning",
            code: "claude.mcp.invalid_remote_url",
            message: "Remote MCP server was omitted because it has no valid URL.",
            details: { serverName: "one", token: "secret-token", headers: { Authorization: "Bearer secret" } },
          },
          {
            severity: "warning",
            code: "claude.mcp.invalid_remote_url",
            message: "Remote MCP server was omitted because it has no valid URL.",
            details: { serverName: "two", env: { API_TOKEN: "secret-env" } },
          },
        ],
      }),
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    const diagnosticLines = stdout.filter((line) => line.includes("claude.mcp.invalid_remote_url"));
    expect(diagnosticLines).toEqual([
      "[0xcraft] WARN claude.mcp.invalid_remote_url: Remote MCP server was omitted because it has no valid URL. (details: serverName=one, serverName=two; repeated 2 times)",
    ]);
    expect(stdout.join("\n")).not.toContain("secret-token");
    expect(stdout.join("\n")).not.toContain("secret-env");
    expect(stdout.join("\n")).not.toContain("Authorization");
  });
});
