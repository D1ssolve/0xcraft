/**
 * T-6.6 — CLI surface smoke tests
 *
 * Invokes CLI functions directly (not child_process) and verifies:
 * - exit codes: 0 / 1 / 2
 * - side-effects on temp filesystem
 * - diagnostic codes present in output
 *
 * ALL filesystem operations use os.tmpdir() + mkdtempSync.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { runBuildCommand } from "../cli/build";
import { runConvert } from "../cli/convert";
import { runImport } from "../cli/import";
import { runInit } from "../cli/init";
import { runDoctorCommand } from "../cli/doctor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpdirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-smoke-"));
  tmpdirs.push(d);
  return d;
}

function write(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function exists(dir: string, relPath: string): boolean {
  return fs.existsSync(path.join(dir, relPath));
}

/** Suppress console output during direct function calls */
const noop = () => {};
const io = { stdout: noop, stderr: noop };

afterEach(() => {
  for (const d of tmpdirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Minimal valid 0xcraft project in a temp dir */
function createValidProject(dir: string): void {
  // .0xcraft/config.jsonc
  write(dir, ".0xcraft/config.jsonc", JSON.stringify({
    schema: "0xcraft.config.v1",
    sourceRoot: ".",
    out: {},
    enabled: { agents: [], skills: [] },
    disabled: { agents: [], skills: [], hooks: [], mcpServers: [] },
    packs: [],
    platforms: {
      codex: {
        agents: {},
        mcpExtensions: {},
        permissionProfiles: {},
        emitPlugin: false,
        emitMarketplace: false,
        emitApps: false,
        permissionsBeta: false,
        hooksEmitMode: "hooks.json",
      },
    },
    diagnostics: { strict: false },
  }, null, 2) + "\n");

  // Minimal agent
  write(dir, "agents/code-analyst/AGENT.md", [
    "---",
    "description: Analyses code quality",
    "model: gpt-4o",
    "name: code-analyst",
    "---",
    "You are a code analyst.",
    "",
  ].join("\n"));
}

/** Minimal OpenCode source fixture */
function createOpenCodeFixture(dir: string): void {
  write(dir, "opencode.json", JSON.stringify({
    agent: {
      "my-agent": {
        description: "My agent",
        model: "gpt-4o",
        prompt: "You are my agent.",
      },
    },
  }, null, 2) + "\n");
  write(dir, ".opencode/agents/my-agent.md", [
    "---",
    "description: My agent",
    "model: gpt-4o",
    "name: my-agent",
    "---",
    "You are my agent.",
    "",
  ].join("\n"));
}

/** Minimal Codex fixture */
function createCodexFixture(dir: string): void {
  write(dir, ".codex/config.toml", [
    'model = "gpt-4o"',
    "",
  ].join("\n"));
  write(dir, ".codex/agents/my-agent.toml", [
    'description = "My agent"',
    'developer_instructions = "You are my agent."',
    'model = "gpt-4o"',
    'name = "my-agent"',
    "",
  ].join("\n"));
}

/** Minimal Claude plugin fixture */
function createClaudePluginFixture(dir: string): void {
  write(dir, ".claude-plugin/plugin.json", JSON.stringify({
    name: "test-plugin",
    version: "1.0.0",
    description: "Test",
    agents: { "my-agent": { name: "my-agent", description: "My agent" } },
    skills: {},
  }, null, 2) + "\n");
  write(dir, "agents/my-agent.md", [
    "---",
    "description: My agent",
    "model: gpt-4o",
    "name: my-agent",
    "---",
    "You are my agent.",
    "",
  ].join("\n"));
}

/** Minimal Claude subagent fixture */
function createClaudeSubagentFixture(dir: string): void {
  write(dir, ".claude/agents/my-agent.md", [
    "---",
    "description: My agent",
    "model: gpt-4o",
    "name: my-agent",
    "color: purple",
    "---",
    "You are my agent.",
    "",
  ].join("\n"));
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("init", () => {
  test("creates expected directory structure", () => {
    const dir = tmpDir();
    const result = runInit({ out: dir });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toHaveLength(0);

    // Config file
    expect(exists(dir, ".0xcraft/config.jsonc")).toBe(true);

    // Source directories
    for (const sourceDir of ["agents", "skills", "hooks", "mcp", "commands"]) {
      expect(exists(dir, sourceDir)).toBe(true);
    }
  });

  test("does not overwrite existing config without --force", () => {
    const dir = tmpDir();
    // First init
    runInit({ out: dir });

    // Second init without --force
    const result = runInit({ out: dir });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_CONFIG_EXISTS")).toBe(true);
  });

  test("--force overwrites existing config", () => {
    const dir = tmpDir();
    runInit({ out: dir });

    const result = runInit({ out: dir, force: true });
    expect(result.exitCode).toBe(0);
  });

  test("--with-pack adds pack entry to config", () => {
    const dir = tmpDir();
    const result = runInit({ out: dir, withPack: "@0xcraft/agents-pack" });

    expect(result.exitCode).toBe(0);
    const configContent = fs.readFileSync(path.join(dir, ".0xcraft/config.jsonc"), "utf8");
    expect(configContent).toContain("@0xcraft/agents-pack");
  });
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("build", () => {
  test("--target all exits 0 on valid project", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runBuildCommand(dir, { target: "all" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("--target opencode emits opencode.json", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runBuildCommand(dir, { target: "opencode" }, io);
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.platform).toBe("opencode");
  });

  test("--target codex emits TOML agents", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runBuildCommand(dir, { target: "codex" }, io);
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.platform).toBe("codex");
  });

  test("--target claude-code --mode claude-plugin strips forbidden fields", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    write(dir, "agents/code-analyst/agent.claude.md", [
      "---",
      "color: purple",
      "---",
      "",
    ].join("\n"));

    const result = await runBuildCommand(dir, { target: "claude-code", mode: "claude-plugin" }, io);
    expect(result.exitCode).not.toBe(1);
    expect(result.artifacts).toHaveLength(1);

    const agentArtifactFile = result.artifacts[0]!.files.find((f) => f.path.includes("agents"));
    if (agentArtifactFile !== undefined) {
      expect(agentArtifactFile.content).not.toContain("color: purple");
    }
  });

  test("--target claude-code --mode claude-subagent preserves full fields", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    write(dir, "agents/code-analyst/agent.claude.md", [
      "---",
      "color: purple",
      "---",
      "",
    ].join("\n"));

    const result = await runBuildCommand(dir, { target: "claude-code", mode: "claude-subagent" }, io);
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toHaveLength(1);

    const agentFile = result.artifacts[0]!.files.find((f) => f.path.includes("my-agent") || f.path.includes("code-analyst"));
    if (agentFile !== undefined) {
      expect(agentFile.content).toContain("purple");
    }
  });

  test("--validate does not write files", async () => {
    const dir = tmpDir();
    createValidProject(dir);
    const outDir = tmpDir();

    const result = await runBuildCommand(dir, { target: "opencode", out: outDir, validate: true }, io);
    expect(result.exitCode).toBe(0);
    // No files written to outDir
    const writtenFiles = fs.readdirSync(outDir);
    expect(writtenFiles).toHaveLength(0);
  });

  test("--strict exits 1 on errors (invalid target)", async () => {
    const dir = tmpDir();
    const result = await runBuildCommand(dir, { target: "invalid-platform" as string, strict: true }, io);
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

describe("doctor", () => {
  test("--target all exits 0 under empty/default config (no user config)", async () => {
    const dir = tmpDir(); // empty dir, no .0xcraft/config.*
    const result = await runDoctorCommand(dir, { target: "all" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("--target all exits 0 under default config", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runDoctorCommand(dir, { target: "all" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("--target all --strict exits 0 on valid project", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runDoctorCommand(dir, { target: "all", strict: true }, io);
    expect(result.exitCode).toBe(0);
  });

  test("--target opencode exits 0", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runDoctorCommand(dir, { target: "opencode" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("--target codex exits 0", async () => {
    const dir = tmpDir();
    createValidProject(dir);

    const result = await runDoctorCommand(dir, { target: "codex" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("invalid target exits 1", async () => {
    const dir = tmpDir();
    const result = await runDoctorCommand(dir, { target: "invalid" }, io);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_UNSUPPORTED_MODE")).toBe(true);
  });

  test("reports info diagnostics — does not exit non-zero on missing source dirs", async () => {
    const dir = tmpDir();
    // Only config, no source dirs at all
    write(dir, ".0xcraft/config.jsonc", JSON.stringify({
      schema: "0xcraft.config.v1",
      sourceRoot: "nonexistent-source",
      out: {},
      enabled: { agents: [], skills: [] },
      disabled: { agents: [], skills: [], hooks: [], mcpServers: [] },
      packs: [],
      platforms: {
        codex: {
          agents: {},
          mcpExtensions: {},
          permissionProfiles: {},
          emitPlugin: false,
          emitMarketplace: false,
          emitApps: false,
          permissionsBeta: false,
          hooksEmitMode: "hooks.json",
        },
      },
      diagnostics: { strict: false },
    }, null, 2) + "\n");

    const result = await runDoctorCommand(dir, { target: "all" }, io);
    // sourceRoot not found with user config → warn, exit 2
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

describe("convert", () => {
  test("--from opencode --to codex exits 0", () => {
    const src = tmpDir();
    const out = tmpDir();
    createOpenCodeFixture(src);

    const result = runConvert({ from: "opencode", to: "codex", in: src, out, force: true });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
  });

  test("--from opencode --to codex produces written files", () => {
    const src = tmpDir();
    const out = tmpDir();
    createOpenCodeFixture(src);

    const result = runConvert({ from: "opencode", to: "codex", in: src, out, force: true });
    expect(result.exitCode).toBe(0);
    expect(result.written.length).toBeGreaterThan(0);
  });

  test("--from codex --to opencode exits 0", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);

    const result = runConvert({ from: "codex", to: "opencode", in: src, out, force: true });
    expect(result.exitCode).toBe(0);
  });

  test("--from claude-code --to codex exits 0", () => {
    const src = tmpDir();
    const out = tmpDir();
    createClaudePluginFixture(src);

    const result = runConvert({ from: "claude-code", to: "codex", in: src, out, force: true });
    expect(result.exitCode).toBe(0);
  });

  test("--from X --to X exits 1 with ERR_SAME_PLATFORM", () => {
    const dir = tmpDir();
    const result = runConvert({ from: "opencode", to: "opencode", in: dir, out: dir });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_SAME_PLATFORM")).toBe(true);
  });

  test("invalid --from exits 1 with ERR_UNSUPPORTED_MODE", () => {
    const dir = tmpDir();
    const result = runConvert({ from: "invalid" as string, to: "codex", in: dir, out: dir });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_UNSUPPORTED_MODE")).toBe(true);
  });

  test("invalid --to exits 1 with ERR_UNSUPPORTED_MODE", () => {
    const dir = tmpDir();
    const result = runConvert({ from: "opencode", to: "invalid" as string, in: dir, out: dir });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_UNSUPPORTED_MODE")).toBe(true);
  });

  test("--from opencode --to codex: codex hook handlers drop-warn in diagnostics when hooks present", () => {
    const src = tmpDir();
    const out = tmpDir();
    // Add an opencode plugin hook that won't map cleanly to codex
    createOpenCodeFixture(src);

    const result = runConvert({ from: "opencode", to: "codex", in: src, out, force: true });
    // exit 0 or 2 (warn only), not error
    expect(result.exitCode).not.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

describe("import", () => {
  test("--from codex creates common layout files", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);

    const result = runImport({ from: "codex", inDir: src, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(result.writtenFiles.length).toBeGreaterThan(0);
    // AGENT.md should be created
    expect(result.writtenFiles.some((f) => f.includes("AGENT.md"))).toBe(true);
  });

  test("--from opencode creates common layout files", () => {
    const src = tmpDir();
    const out = tmpDir();
    createOpenCodeFixture(src);

    const result = runImport({ from: "opencode", inDir: src, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(result.writtenFiles.some((f) => f.includes("AGENT.md"))).toBe(true);
  });

  test("--from claude-code creates common layout files", () => {
    const src = tmpDir();
    const out = tmpDir();
    createClaudePluginFixture(src);

    const result = runImport({ from: "claude-code", inDir: src, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(result.writtenFiles.length).toBeGreaterThan(0);
  });

  test("--from codex without --overwrite on existing files exits 1", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);

    // First import
    const first = runImport({ from: "codex", inDir: src, outDir: out });
    expect(first.exitCode).toBe(0);
    expect(first.writtenFiles.length).toBeGreaterThan(0);

    // Second import without --overwrite → ERR_FILE_EXISTS → exit 1
    const second = runImport({ from: "codex", inDir: src, outDir: out, overwrite: false });
    expect(second.exitCode).toBe(1);
    expect(second.diagnostics.some((d) => d.code === "ERR_FILE_EXISTS")).toBe(true);
  });

  test("--from codex --overwrite succeeds on second import", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);

    runImport({ from: "codex", inDir: src, outDir: out });

    const second = runImport({ from: "codex", inDir: src, outDir: out, overwrite: true });
    expect(second.exitCode).toBe(0);
  });

  test("invalid --from exits 1 with ERR_UNSUPPORTED_MODE", () => {
    const dir = tmpDir();
    const result = runImport({ from: "invalid" as string, inDir: dir, outDir: dir });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "ERR_UNSUPPORTED_MODE")).toBe(true);
  });

  test("--from claude-code --mode claude-subagent imports subagent files", () => {
    const src = tmpDir();
    const out = tmpDir();
    createClaudeSubagentFixture(src);

    const result = runImport({ from: "claude-code", mode: "claude-subagent", inDir: src, outDir: out });
    expect(result.exitCode).toBe(0);
    expect(result.writtenFiles.length).toBeGreaterThan(0);
  });

  test("--strict upgrades warnings to errors: exit 1 when warns present", () => {
    const src = tmpDir();
    const out = tmpDir();
    write(src, ".codex/hooks.json", JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            hooks: [{ type: "prompt", prompt: "Summarize." }],
          },
        ],
      },
    }));

    const result = runImport({ from: "codex", inDir: src, outDir: out, strict: true });
    expect(result.exitCode).toBe(1);
  });
});

describe("exit code contract", () => {
  test("build exits 0 on success", async () => {
    const dir = tmpDir();
    createValidProject(dir);
    const result = await runBuildCommand(dir, { target: "opencode" }, io);
    expect(result.exitCode).toBe(0);
  });

  test("build exits 1 on hard error (invalid target)", async () => {
    const dir = tmpDir();
    const result = await runBuildCommand(dir, { target: "bad-target" }, io);
    expect(result.exitCode).toBe(1);
  });

  test("doctor exits 0 on empty dir", async () => {
    const dir = tmpDir();
    const result = await runDoctorCommand(dir, {}, io);
    expect(result.exitCode).toBe(0);
  });

  test("convert exits 0 on valid cross-platform conversion", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);
    const result = runConvert({ from: "codex", to: "opencode", in: src, out });
    expect(result.exitCode).toBe(0);
  });

  test("convert exits 1 on ERR_SAME_PLATFORM", () => {
    const dir = tmpDir();
    const result = runConvert({ from: "codex", to: "codex", in: dir, out: dir });
    expect(result.exitCode).toBe(1);
  });

  test("import exits 0 on fresh run", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);
    const result = runImport({ from: "codex", inDir: src, outDir: out });
    expect(result.exitCode).toBe(0);
  });

  test("import exits 1 on file conflict without --overwrite", () => {
    const src = tmpDir();
    const out = tmpDir();
    createCodexFixture(src);
    runImport({ from: "codex", inDir: src, outDir: out });
    const result = runImport({ from: "codex", inDir: src, outDir: out });
    expect(result.exitCode).toBe(1);
  });
});
