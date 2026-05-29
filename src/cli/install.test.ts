import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInstall } from "./install";
import type { ClaudeCodeArtifact } from "../adapters/claude-code/build";
import type { CodexArtifact } from "../adapters/codex/build";
import type { BuildOptions, PlatformArtifact } from "../adapters/_shared/artifact";
import type { WriteArtifactOptions, WriteArtifactResult } from "../adapters/_shared/filesystem";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/* ---------------------------------------------------------------- */
/*  Artifact factories                                                */
/* ---------------------------------------------------------------- */

function makeClaudeArtifact(overrides: Partial<ClaudeCodeArtifact> = {}): ClaudeCodeArtifact {
  return {
    platform: "claude-code",
    kind: "filesystem-tree",
    ok: true,
    files: [
      { path: ".claude-plugin/plugin.json", content: "{}" },
      { path: "hooks/foo.mjs", content: "#!/usr/bin/env bun\n" },
    ],
    diagnostics: [],
    capabilityReport: { platform: "claude-code", features: {} as any },
    metadata: { deterministic: true },
    ...overrides,
  };
}

function makeCodexArtifact(overrides: Partial<CodexArtifact> = {}): CodexArtifact {
  return {
    platform: "codex",
    kind: "filesystem-tree",
    ok: true,
    files: [{ path: ".codex/config.toml", content: "" }],
    diagnostics: [],
    capabilityReport: { platform: "codex", features: {} as any },
    metadata: { deterministic: true },
    outputPath: "/tmp/codex-output",
    ...overrides,
  };
}

interface BuildCall {
  options: BuildOptions;
}
interface WriteCall {
  artifact: PlatformArtifact;
  outputRoot: string;
  options: WriteArtifactOptions | undefined;
}

/* ---------------------------------------------------------------- */
/*  Non-dry-run path — build() + writeArtifact()                      */
/* ---------------------------------------------------------------- */

describe("install CLI — harness routing (non-dry-run)", () => {
  test("--harness claude-code calls build() then writeArtifact()", async () => {
    const buildCalls: BuildCall[] = [];
    const writeCalls: WriteCall[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "claude-code",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectA",
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        buildClaudeCode: async (options) => {
          buildCalls.push({ options });
          return makeClaudeArtifact();
        },
        writeArtifact: (artifact, outputRoot, options): WriteArtifactResult => {
          writeCalls.push({ artifact, outputRoot, options });
          return { written: artifact.files.map((f) => path.join(outputRoot, f.path)) };
        },
      },
    });

    expect(buildCalls).toHaveLength(1);
    expect(buildCalls[0]?.options.projectRoot).toBe("/tmp/projectA");
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.outputRoot).toBe(
      path.join("/tmp/projectA", "dist/claude-code-plugin/0xcraft"),
    );
    expect(writeCalls[0]?.options?.force).toBe(false);
    expect(stdout.join("\n")).toContain("[0xcraft] Claude Code plugin generated");
    expect(exitCodes).toEqual([0]);
  });

  test("--harness codex calls build() then writeArtifact() (cwd as default outputRoot)", async () => {
    const buildCalls: BuildCall[] = [];
    const writeCalls: WriteCall[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];

    await runInstall({
      harness: "codex",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectB",
        stdout: (m) => stdout.push(m),
        buildCodex: async (options) => {
          buildCalls.push({ options });
          return makeCodexArtifact({ outputPath: "/tmp/projectB" });
        },
        writeArtifact: (artifact, outputRoot, options) => {
          writeCalls.push({ artifact, outputRoot, options });
          return { written: [] };
        },
      },
    });

    expect(buildCalls).toHaveLength(1);
    expect(buildCalls[0]?.options.projectRoot).toBe("/tmp/projectB");
    expect(buildCalls[0]?.options.outputRoot).toBe("/tmp/projectB");
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.outputRoot).toBe("/tmp/projectB");
    expect(stdout.join("\n")).toContain("[0xcraft] Codex plugin generated");
    expect(exitCodes).toEqual([0]);
  });

  test("codex install with error diagnostic exits 1", async () => {
    const exitCodes: number[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "codex",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectC",
        stdout: () => undefined,
        stderr: (m) => stderr.push(m),
        buildCodex: async () =>
          makeCodexArtifact({
            ok: false,
            diagnostics: [
              { severity: "error", code: "codex.write.failed", message: "boom" },
            ],
          }),
        writeArtifact: () => ({ written: [] }),
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("[0xcraft] ERROR codex.write.failed — boom");
  });

  test("claude-code install: writeArtifact throw → install.claude_code.failed exit 1", async () => {
    const exitCodes: number[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "claude-code",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectD",
        stdout: () => undefined,
        stderr: (m) => stderr.push(m),
        buildClaudeCode: async () => makeClaudeArtifact(),
        writeArtifact: () => {
          throw new Error("disk full");
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("[0xcraft] ERROR install.claude_code.failed — disk full");
  });

  test("--harness codex with --output writes to output dir, not cwd", async () => {
    const writeCalls: WriteCall[] = [];

    await runInstall({
      harness: "codex",
      output: "/tmp/explicit-output",
      setExitCode: () => undefined,
      dependencies: {
        cwd: () => "/tmp/projectE-cwd",
        stdout: () => undefined,
        buildCodex: async () => makeCodexArtifact(),
        writeArtifact: (artifact, outputRoot, options) => {
          writeCalls.push({ artifact, outputRoot, options });
          return { written: [] };
        },
      },
    });

    expect(writeCalls[0]?.outputRoot).toBe("/tmp/explicit-output");
  });

  test("--harness codex with --project and --force forwards to build + writeArtifact", async () => {
    const buildCalls: BuildCall[] = [];
    const writeCalls: WriteCall[] = [];

    await runInstall({
      harness: "codex",
      project: "/tmp/explicit-project",
      force: true,
      setExitCode: () => undefined,
      dependencies: {
        cwd: () => "/tmp/cwd",
        stdout: () => undefined,
        buildCodex: async (options) => {
          buildCalls.push({ options });
          return makeCodexArtifact();
        },
        writeArtifact: (artifact, outputRoot, options) => {
          writeCalls.push({ artifact, outputRoot, options });
          return { written: [] };
        },
      },
    });

    expect(buildCalls[0]?.options.projectRoot).toBe("/tmp/explicit-project");
    // outputRoot defaults to options.output ?? options.project ?? cwd
    expect(writeCalls[0]?.outputRoot).toBe("/tmp/explicit-project");
    expect(writeCalls[0]?.options?.force).toBe(true);
  });

  test("--harness claude-code forwards --output, --project, --force", async () => {
    const buildCalls: BuildCall[] = [];
    const writeCalls: WriteCall[] = [];

    await runInstall({
      harness: "claude-code",
      output: "/tmp/cc-output",
      project: "/tmp/cc-project",
      force: true,
      setExitCode: () => undefined,
      dependencies: {
        cwd: () => "/tmp/cwd",
        stdout: () => undefined,
        buildClaudeCode: async (options) => {
          buildCalls.push({ options });
          return makeClaudeArtifact();
        },
        writeArtifact: (artifact, outputRoot, options) => {
          writeCalls.push({ artifact, outputRoot, options });
          return { written: [] };
        },
      },
    });

    expect(buildCalls[0]?.options.projectRoot).toBe("/tmp/cc-project");
    expect(writeCalls[0]?.outputRoot).toBe("/tmp/cc-output");
    expect(writeCalls[0]?.options?.force).toBe(true);
  });

  test("unknown harness emits install.invalid_harness and exits 1", async () => {
    const exitCodes: number[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "fake" as unknown as "codex",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/x",
        stdout: () => undefined,
        stderr: (m) => stderr.push(m),
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("[0xcraft] ERROR install.invalid_harness");
  });
});

/* ---------------------------------------------------------------- */
/*  Dry-run — build() only, never writeArtifact()                     */
/* ---------------------------------------------------------------- */

describe("install CLI — dry-run (--dry-run)", () => {
  test("--harness claude-code --dry-run calls build but NOT writeArtifact", async () => {
    const buildCalls: number[] = [];
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];

    await runInstall({
      harness: "claude-code",
      dryRun: true,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectDR",
        stdout: (m) => stdout.push(m),
        stderr: () => undefined,
        buildClaudeCode: async () => {
          buildCalls.push(1);
          return makeClaudeArtifact();
        },
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(buildCalls).toEqual([1]);
    expect(writeCalls).toEqual([]);
    expect(stdout.some((m) => m.includes("DRY-RUN install (claude-code)"))).toBe(true);
    expect(stdout.some((m) => m.includes(".claude-plugin/plugin.json"))).toBe(true);
    expect(exitCodes).toEqual([0]);
  });

  test("--harness codex --dry-run calls build but NOT writeArtifact", async () => {
    const buildCalls: number[] = [];
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];

    await runInstall({
      harness: "codex",
      dryRun: true,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectDRCodex",
        stdout: (m) => stdout.push(m),
        stderr: () => undefined,
        buildCodex: async () => {
          buildCalls.push(1);
          return makeCodexArtifact();
        },
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(buildCalls).toEqual([1]);
    expect(writeCalls).toEqual([]);
    expect(stdout.some((m) => m.includes("DRY-RUN install (codex)"))).toBe(true);
    expect(exitCodes).toEqual([0]);
  });

  test("dry-run propagates build error diagnostic → exit 1", async () => {
    const exitCodes: number[] = [];
    const writeCalls: number[] = [];
    await runInstall({
      harness: "codex",
      dryRun: true,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectDRErr",
        stdout: () => undefined,
        stderr: () => undefined,
        buildCodex: async () =>
          makeCodexArtifact({
            ok: false,
            diagnostics: [{ severity: "error", code: "x.fail", message: "boom" }],
          }),
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });
    expect(exitCodes).toEqual([1]);
    // IMPORTANT 1: write must NOT happen when build returns error diagnostics.
    expect(writeCalls).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/*  IMPORTANT 1 — write-before-error-check                            */
/* ---------------------------------------------------------------- */

describe("install CLI — artifact error diagnostics abort BEFORE write", () => {
  test("claude-code: build returns error diagnostic → no writeArtifact, exit 1", async () => {
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];

    await runInstall({
      harness: "claude-code",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectCCErr",
        stdout: () => undefined,
        stderr: () => undefined,
        buildClaudeCode: async () =>
          makeClaudeArtifact({
            ok: false,
            diagnostics: [{ severity: "error", code: "cc.fail", message: "boom" }],
          }),
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(writeCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
  });

  test("codex: build returns error diagnostic → no writeArtifact, exit 1", async () => {
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];

    await runInstall({
      harness: "codex",
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => "/tmp/projectCXErr",
        stdout: () => undefined,
        stderr: () => undefined,
        buildCodex: async () =>
          makeCodexArtifact({
            ok: false,
            diagnostics: [{ severity: "error", code: "cx.fail", message: "boom" }],
          }),
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(writeCalls).toEqual([]);
    expect(exitCodes).toEqual([1]);
  });
});

/* ---------------------------------------------------------------- */
/*  CRITICAL — invalid (flat) config aborts BEFORE build + write      */
/* ---------------------------------------------------------------- */

describe("install CLI — invalid (legacy flat) config aborts before build/write", () => {
  function seedFlatConfig(projectRoot: string, harnessDir: string): void {
    const dir = path.join(projectRoot, harnessDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "0xcraft.json"), JSON.stringify({ disabledAgents: [] }));
  }

  test("claude-code (non-dry-run): flat config exits 1, build never called, no writes", async () => {
    const projectRoot = makeTempDir("0xcraft-cli-bad-cc-");
    seedFlatConfig(projectRoot, ".claude");
    const buildCalls: number[] = [];
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "claude-code",
      project: projectRoot,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => projectRoot,
        stdout: () => undefined,
        stderr: (m) => stderr.push(m),
        buildClaudeCode: async () => {
          buildCalls.push(1);
          return makeClaudeArtifact();
        },
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(buildCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
    expect(stderr.join("\n")).toContain("config.validation.failed");
  });

  test("codex (non-dry-run): flat config exits 1, build never called, no writes", async () => {
    const projectRoot = makeTempDir("0xcraft-cli-bad-cx-");
    seedFlatConfig(projectRoot, ".codex");
    const buildCalls: number[] = [];
    const writeCalls: number[] = [];
    const exitCodes: number[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "codex",
      project: projectRoot,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => projectRoot,
        stdout: () => undefined,
        stderr: (m) => stderr.push(m),
        buildCodex: async () => {
          buildCalls.push(1);
          return makeCodexArtifact();
        },
        writeArtifact: () => {
          writeCalls.push(1);
          return { written: [] };
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(buildCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
    expect(stderr.join("\n")).toContain("config.validation.failed");
  });

  test("claude-code --dry-run: flat config exits 1, no dry-run intent printed", async () => {
    const projectRoot = makeTempDir("0xcraft-cli-bad-cc-dry-");
    seedFlatConfig(projectRoot, ".claude");
    const buildCalls: number[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "claude-code",
      project: projectRoot,
      dryRun: true,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => projectRoot,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        buildClaudeCode: async () => {
          buildCalls.push(1);
          return makeClaudeArtifact();
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(buildCalls).toEqual([]);
    expect(stdout.join("\n")).not.toContain("DRY-RUN install");
    expect(stderr.join("\n")).toContain("config.validation.failed");
  });

  test("codex --dry-run: flat config exits 1, no dry-run intent printed", async () => {
    const projectRoot = makeTempDir("0xcraft-cli-bad-cx-dry-");
    seedFlatConfig(projectRoot, ".codex");
    const buildCalls: number[] = [];
    const exitCodes: number[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];

    await runInstall({
      harness: "codex",
      project: projectRoot,
      dryRun: true,
      setExitCode: (c) => exitCodes.push(c),
      dependencies: {
        cwd: () => projectRoot,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        buildCodex: async () => {
          buildCalls.push(1);
          return makeCodexArtifact();
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(buildCalls).toEqual([]);
    expect(stdout.join("\n")).not.toContain("DRY-RUN install");
    expect(stderr.join("\n")).toContain("config.validation.failed");
  });
});

/* ---------------------------------------------------------------- */
/*  OpenCode seed — nested-only, no flat keys                         */
/* ---------------------------------------------------------------- */

const FLAT_KEYS = [
  "disabledAgents",
  "disabledSkills",
  "disabledHooks",
  "disabledMcpServers",
  "enabledAgents",
  "enabledSkills",
] as const;

describe("install CLI — OpenCode (runtime plugin) seed config", () => {
  // OpenCode is runtime-plugin-only. No PlatformArtifact, no writeArtifact.
  // The wizard seeds `~/.config/opencode/0xcraft.json` with a default
  // config object that MUST use the canonical nested shape and contain
  // ZERO flat keys. We assert this statically against install.ts source
  // to avoid HOME-capture-at-module-load fragility.
  test("seeded default config in install.ts has nested shape and no flat keys", () => {
    const installSrc = fs.readFileSync(
      path.join(import.meta.dir, "install.ts"),
      "utf-8",
    );

    // Canonical nested keys present.
    expect(installSrc).toContain("disabled:");
    expect(installSrc).toContain("enabled:");

    // No flat keys anywhere in install.ts.
    for (const flat of FLAT_KEYS) {
      expect(installSrc.includes(flat)).toBe(false);
    }
  });
});
