import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createCodexCommand } from "./codex";
import type { CodexArtifact } from "../adapters/codex";
import type { BuildOptions } from "../adapters/_shared/artifact";
import { CODEX_MATRIX } from "../adapters/_shared/capability-matrix";
import type { Diagnostic } from "../core/diagnostics";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeArtifact(outputPath: string, overrides: Partial<CodexArtifact> = {}): CodexArtifact {
  return {
    platform: "codex",
    kind: "filesystem-tree",
    ok: true,
    files: [],
    diagnostics: [],
    capabilityReport: { platform: "codex", features: CODEX_MATRIX },
    metadata: { deterministic: true },
    outputPath,
    ...overrides,
  };
}

describe("codex CLI", () => {
  test("generate help documents --output, --project, --force", () => {
    const command = createCodexCommand({ setExitCode: () => undefined });
    const generate = command.commands.find((c) => c.name() === "generate");
    expect(generate).toBeDefined();
    const help = generate?.helpInformation() ?? "";
    expect(help).toContain("--output <dir>");
    expect(help).toContain("--project <dir>");
    expect(help).toContain("--force");
  });

  test("generate calls build() with resolved roots and prints success line", async () => {
    const calls: BuildOptions[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const outDir = makeTempDir("0xcraft-codex-cli-out-");
    const projectDir = makeTempDir("0xcraft-codex-cli-proj-");

    const command = createCodexCommand({
      cwd: () => "/should/not/be/used",
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async (options) => {
        calls.push(options);
        return makeArtifact(options.outputRoot ?? "");
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--output", outDir, "--project", projectDir, "--force"],
      { from: "node" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      outputRoot: outDir,
      projectRoot: projectDir,
    });
    expect(typeof calls[0]?.packageRoot).toBe("string");
    expect(stdout[0]).toBe(`[0xcraft] Codex plugin generated at ${outDir}`);
    expect(exitCodes).toEqual([0]);
  });

  test("defaults --output and --project to cwd when omitted", async () => {
    const calls: BuildOptions[] = [];
    const command = createCodexCommand({
      cwd: () => "/tmp/fake-cwd",
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: () => undefined,
      build: async (options) => {
        calls.push(options);
        return makeArtifact(options.outputRoot ?? "");
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(calls[0]).toMatchObject({
      outputRoot: "/tmp/fake-cwd",
      projectRoot: "/tmp/fake-cwd",
    });
  });

  test("force=false is the default (no flag → not forced)", async () => {
    // Smoke check: passes the flag through writeArtifact without error
    // when artifact has no files.
    const outDir = makeTempDir("0xcraft-codex-cli-noforce-");
    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: () => undefined,
      build: async (options) => makeArtifact(options.outputRoot ?? outDir),
    });
    await command.parseAsync(["node", "test", "generate"], { from: "node" });
    // outputRoot must exist after writeArtifact (creates it).
    expect(fs.existsSync(outDir)).toBe(true);
  });

  test("error-severity diagnostics print to stderr with [0xcraft] prefix and set exit 1", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const outDir = makeTempDir("0xcraft-codex-cli-err-");

    const errorDiag: Diagnostic = {
      severity: "error",
      code: "codex.generate.write_failed",
      message: "Failed to write .codex/config.toml: EACCES",
    };
    const warnDiag: Diagnostic = {
      severity: "warn",
      code: "codex.hook.bootstrap.missing",
      message: "No inlinable bootstrap text for hook \"x\"; skipped.",
    };

    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async (options) =>
        makeArtifact(options.outputRoot ?? outDir, {
          ok: false,
          diagnostics: [errorDiag, warnDiag],
        }),
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(stderr).toContain(
      "[0xcraft] ERROR codex.generate.write_failed — Failed to write .codex/config.toml: EACCES",
    );
    expect(stderr).toContain(
      "[0xcraft] WARN codex.hook.bootstrap.missing — No inlinable bootstrap text for hook \"x\"; skipped.",
    );
    expect(exitCodes).toEqual([1]);
  });

  test("build exception is caught and exits 1 with sanitized prefix", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const command = createCodexCommand({
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () => {
        throw new Error("boom");
      },
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(stderr).toEqual(["[0xcraft] ERROR codex.generate.failed — boom"]);
    expect(exitCodes).toEqual([1]);
  });

  test("CRITICAL: invalid flat config exits 1, build NEVER called, no files written", async () => {
    const projectDir = makeTempDir("0xcraft-codex-cli-badcfg-");
    const codexDir = path.join(projectDir, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, "0xcraft.json"), JSON.stringify({ disabledAgents: [] }));

    const outDir = makeTempDir("0xcraft-codex-cli-badcfg-out-");
    const buildCalls: number[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const command = createCodexCommand({
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () => {
        buildCalls.push(1);
        return makeArtifact(outDir);
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--output", outDir, "--project", projectDir],
      { from: "node" },
    );

    expect(buildCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("config.validation.failed");
    // No artifact tree written.
    expect(fs.existsSync(path.join(outDir, ".codex"))).toBe(false);
  });

  test("IMPORTANT: artifact error diagnostics abort BEFORE write — no files persisted", async () => {
    const outDir = makeTempDir("0xcraft-codex-cli-builderr-");
    // Pre-record outDir contents (empty).
    const before = fs.readdirSync(outDir);

    const exitCodes: number[] = [];
    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: (c) => exitCodes.push(c),
      build: async () =>
        makeArtifact(outDir, {
          ok: false,
          files: [{ path: ".codex/config.toml", content: "x = 1" }],
          diagnostics: [{ severity: "error", code: "codex.build.fail", message: "boom" }],
        }),
    });

    await command.parseAsync(["node", "test", "generate"], { from: "node" });

    expect(exitCodes).toEqual([1]);
    // The would-be-written file must not appear on disk.
    const after = fs.readdirSync(outDir);
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(outDir, ".codex", "config.toml"))).toBe(false);
  });
});

describe("codex CLI — T-25 --plugin / --marketplace flags", () => {
  test("help documents --plugin and --marketplace", () => {
    const command = createCodexCommand({ setExitCode: () => undefined });
    const generate = command.commands.find((c) => c.name() === "generate");
    const help = generate?.helpInformation() ?? "";
    expect(help).toContain("--plugin");
    expect(help).toContain("--marketplace");
  });

  test("--marketplace without --plugin → ERR_MARKETPLACE_REQUIRES_PLUGIN, exit 1, build NOT called", async () => {
    const outDir = makeTempDir("0xcraft-codex-cli-mkt-only-");
    const buildCalls: number[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () => {
        buildCalls.push(1);
        return makeArtifact(outDir);
      },
    });

    await command.parseAsync(["node", "test", "generate", "--marketplace"], { from: "node" });

    expect(buildCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("ERR_MARKETPLACE_REQUIRES_PLUGIN");
  });

  test("--plugin sets emitPlugin=true in build() config", async () => {
    const outDir = makeTempDir("0xcraft-codex-cli-plugin-flag-");
    const calls: BuildOptions[] = [];

    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: () => undefined,
      build: async (options) => {
        calls.push(options);
        return makeArtifact(options.outputRoot ?? outDir);
      },
    });

    await command.parseAsync(["node", "test", "generate", "--plugin"], { from: "node" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.config.platforms.codex?.emitPlugin).toBe(true);
    expect(calls[0]!.config.platforms.codex?.emitMarketplace).toBe(false);
  });

  test("--plugin --marketplace sets both flags in build() config", async () => {
    const outDir = makeTempDir("0xcraft-codex-cli-both-flags-");
    const calls: BuildOptions[] = [];

    const command = createCodexCommand({
      cwd: () => outDir,
      stdout: () => undefined,
      stderr: () => undefined,
      setExitCode: () => undefined,
      build: async (options) => {
        calls.push(options);
        return makeArtifact(options.outputRoot ?? outDir);
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--plugin", "--marketplace"],
      { from: "node" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.config.platforms.codex?.emitPlugin).toBe(true);
    expect(calls[0]!.config.platforms.codex?.emitMarketplace).toBe(true);
  });

  test("config emitMarketplace=true without emitPlugin/flag also triggers ERR_MARKETPLACE_REQUIRES_PLUGIN", async () => {
    const projectDir = makeTempDir("0xcraft-codex-cli-cfg-mkt-only-");
    fs.mkdirSync(path.join(projectDir, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".codex", "0xcraft.json"),
      JSON.stringify({ platforms: { codex: { emitMarketplace: true } } }),
    );
    const outDir = makeTempDir("0xcraft-codex-cli-cfg-mkt-out-");

    const buildCalls: number[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const command = createCodexCommand({
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
      setExitCode: (c) => exitCodes.push(c),
      build: async () => {
        buildCalls.push(1);
        return makeArtifact(outDir);
      },
    });

    await command.parseAsync(
      ["node", "test", "generate", "--output", outDir, "--project", projectDir],
      { from: "node" },
    );

    expect(buildCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("ERR_MARKETPLACE_REQUIRES_PLUGIN");
  });
});
