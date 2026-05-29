/**
 * Install — setup entry point for 0xcraft.
 *
 * `--harness opencode` (default): interactive wizard that registers
 * 0xcraft in the user's opencode.json and seeds a default 0xcraft.json.
 * OpenCode is a RUNTIME PLUGIN — no `writeArtifact()` step; the plugin
 * is loaded by OpenCode at runtime via the `plugin` array.
 *
 * `--harness claude-code`: build a `PlatformArtifact` via the adapter's
 * canonical `build()` entrypoint and persist it via `writeArtifact()`.
 *
 * `--harness codex`: build a `PlatformArtifact` via the adapter's
 * canonical `build()` entrypoint and persist it via `writeArtifact()`.
 *
 * T-12.11: claude-code/codex non-dry-run paths now go through
 * `build()` + `writeArtifact()` only. Raw `generate*Plugin` write paths
 * are no longer used here (they remain available in the adapters
 * themselves for legacy callers / integration tests).
 */

import fs from "fs";
import path from "path";
import os from "os";
import { runDoctor, printDoctorResults } from "./doctor";
import { parseJsonc, loadConfig } from "../core/config/config-loader";
import {
  diagnosticsHaveError,
  printDiagnostic,
  resolvePackageRoot,
  resolveProjectRoot,
  writeArtifact as writeArtifactDefault,
  type PlatformId,
} from "./_shared";
import {
  build as buildClaudeCodeAdapter,
  type ClaudeCodeArtifact,
} from "../adapters/claude-code/build";
import {
  build as buildCodexAdapter,
  type CodexArtifact,
} from "../adapters/codex/build";
import type { BuildOptions, PlatformArtifact } from "../adapters/_shared/artifact";
import type { WriteArtifactOptions, WriteArtifactResult } from "../adapters/_shared/filesystem";

const HOME = os.homedir();
const OPENCODE_CONFIG_DIR = path.join(HOME, ".config", "opencode");
const OPENCODE_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "opencode.json");
const ZEROCRAFT_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "0xcraft.json");

export interface RunInstallDependencies {
  buildClaudeCode?: (options: BuildOptions) => Promise<ClaudeCodeArtifact>;
  buildCodex?: (options: BuildOptions) => Promise<CodexArtifact>;
  writeArtifact?: (
    artifact: PlatformArtifact,
    outputRoot: string,
    options?: WriteArtifactOptions,
  ) => WriteArtifactResult;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  cwd?: () => string;
}

export interface RunInstallOptions {
  harness?: PlatformId;
  /** Output directory for generated artifacts (codex/claude-code only; ignored for opencode). */
  output?: string;
  /** Project root for generators (codex/claude-code only; ignored for opencode). */
  project?: string;
  /** Allow overwriting existing files (codex/claude-code only; ignored for opencode). */
  force?: boolean;
  /** Print planned files + diagnostics; perform no filesystem writes. */
  dryRun?: boolean;
  setExitCode?: (code: number) => void;
  dependencies?: RunInstallDependencies;
}

export async function runInstall(options: RunInstallOptions = {}): Promise<void> {
  const harness: PlatformId = options.harness ?? "opencode";
  const setExitCode = options.setExitCode ?? ((code: number) => { process.exitCode = code; });
  const deps = options.dependencies ?? {};
  const stdout = deps.stdout ?? ((m: string) => console.log(m));
  const stderr = deps.stderr ?? ((m: string) => console.error(m));
  const cwd = deps.cwd?.() ?? process.cwd();

  switch (harness) {
    case "opencode":
      // Runtime plugin — no PlatformArtifact, no writeArtifact step.
      await runOpenCodeInstall();
      return;
    case "claude-code":
      await runClaudeCodeInstall(options, deps, setExitCode, stdout, stderr, cwd);
      return;
    case "codex":
      await runCodexInstall(options, deps, setExitCode, stdout, stderr, cwd);
      return;
    default: {
      stderr(`[0xcraft] ERROR install.invalid_harness — unknown harness "${harness as string}"; expected opencode | claude-code | codex`);
      setExitCode(1);
      return;
    }
  }
}

/* ---------------------------------------------------------------- */
/*  claude-code + codex — build() + writeArtifact()                  */
/* ---------------------------------------------------------------- */

async function runClaudeCodeInstall(
  options: RunInstallOptions,
  deps: RunInstallDependencies,
  setExitCode: (code: number) => void,
  stdout: (m: string) => void,
  stderr: (m: string) => void,
  cwd: string,
): Promise<void> {
  const build = deps.buildClaudeCode ?? buildClaudeCodeAdapter;
  const write = deps.writeArtifact ?? writeArtifactDefault;
  try {
    const projectRoot = resolveProjectRoot({ project: options.project, cwd });
    const packageRoot = resolvePackageRoot();

    // Capture loader diagnostics — strict nested-only contract requires
    // we abort BEFORE build()/writeArtifact() (and BEFORE dry-run
    // output) when the user's config has unrecognized (e.g. legacy
    // flat) keys.
    const { config, diagnostics: loaderDiagnostics } = loadConfig({
      harness: "claude-code",
      projectRoot,
    });
    if (diagnosticsHaveError(loaderDiagnostics)) {
      for (const d of loaderDiagnostics) printDiagnostic(d, { stdout, stderr });
      setExitCode(1);
      return;
    }
    for (const d of loaderDiagnostics) printDiagnostic(d, { stdout, stderr });

    const outputRoot =
      options.output ?? path.join(projectRoot, "dist/claude-code-plugin/0xcraft");

    const artifact = await build({ config, projectRoot, packageRoot });

    // Important: inspect artifact diagnostics BEFORE writing (and
    // BEFORE dry-run "would write" output). Failed build() must not
    // persist partial files or pretend success in dry-run.
    if (!artifact.ok || diagnosticsHaveError(artifact.diagnostics)) {
      for (const d of artifact.diagnostics) printDiagnostic(d, { stdout, stderr });
      setExitCode(1);
      return;
    }

    if (options.dryRun === true) {
      stdout(`[0xcraft] DRY-RUN install (claude-code) — would write ${artifact.files.length} files under ${outputRoot}`);
      for (const f of artifact.files) stdout(`[0xcraft] DRY-RUN file: ${f.path}`);
    } else {
      write(artifact, outputRoot, { force: options.force === true });
      stdout(`[0xcraft] Claude Code plugin generated at ${outputRoot}`);
    }

    for (const d of artifact.diagnostics) printDiagnostic(d, { stdout, stderr });
    setExitCode(diagnosticsHaveError(artifact.diagnostics) ? 1 : 0);
  } catch (error) {
    const tag = options.dryRun === true ? "install.claude_code.dry_run.failed" : "install.claude_code.failed";
    stderr(`[0xcraft] ERROR ${tag} — ${error instanceof Error ? error.message : String(error)}`);
    setExitCode(1);
  }
}

async function runCodexInstall(
  options: RunInstallOptions,
  deps: RunInstallDependencies,
  setExitCode: (code: number) => void,
  stdout: (m: string) => void,
  stderr: (m: string) => void,
  cwd: string,
): Promise<void> {
  const build = deps.buildCodex ?? buildCodexAdapter;
  const write = deps.writeArtifact ?? writeArtifactDefault;
  try {
    const projectRoot = resolveProjectRoot({ project: options.project, cwd });
    const packageRoot = resolvePackageRoot();

    const { config, diagnostics: loaderDiagnostics } = loadConfig({
      harness: "codex",
      projectRoot,
    });
    if (diagnosticsHaveError(loaderDiagnostics)) {
      for (const d of loaderDiagnostics) printDiagnostic(d, { stdout, stderr });
      setExitCode(1);
      return;
    }
    for (const d of loaderDiagnostics) printDiagnostic(d, { stdout, stderr });

    const outputRoot = options.output ?? options.project ?? cwd;

    const artifact = await build({ config, projectRoot, packageRoot, outputRoot });

    if (!artifact.ok || diagnosticsHaveError(artifact.diagnostics)) {
      for (const d of artifact.diagnostics) printDiagnostic(d, { stdout, stderr });
      setExitCode(1);
      return;
    }

    if (options.dryRun === true) {
      stdout(`[0xcraft] DRY-RUN install (codex) — would write ${artifact.files.length} files under ${outputRoot}`);
      for (const f of artifact.files) stdout(`[0xcraft] DRY-RUN file: ${f.path}`);
    } else {
      write(artifact, outputRoot, { force: options.force === true });
      stdout(`[0xcraft] Codex plugin generated at ${outputRoot}`);
    }

    for (const d of artifact.diagnostics) printDiagnostic(d, { stdout, stderr });
    setExitCode(diagnosticsHaveError(artifact.diagnostics) ? 1 : 0);
  } catch (error) {
    const tag = options.dryRun === true ? "install.codex.dry_run.failed" : "install.codex.failed";
    stderr(`[0xcraft] ERROR ${tag} — ${error instanceof Error ? error.message : String(error)}`);
    setExitCode(1);
  }
}

/* ---------------------------------------------------------------- */
/*  OpenCode — runtime plugin wizard                                  */
/* ---------------------------------------------------------------- */

async function runOpenCodeInstall(): Promise<void> {
  console.log("\n  0xcraft — Agent Operations Plugin\n");
  console.log("  This wizard will:\n");
  console.log("  1. Register 0xcraft in your OpenCode config");
  console.log("  2. Create a default 0xcraft.json config (optional)");
  console.log("  3. Run health diagnostics\n");

  await registerPlugin();
  await createConfig();

  console.log("\n  Running diagnostics...\n");
  const result = await runDoctor();
  printDoctorResults(result);

  console.log("\n  Setup complete! Restart OpenCode to activate 0xcraft.\n");
}

async function registerPlugin(): Promise<void> {
  if (!fs.existsSync(OPENCODE_CONFIG_DIR)) {
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
  }

  let config: Record<string, unknown> = {};

  if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
    try {
      config = parseJsonc(fs.readFileSync(OPENCODE_CONFIG_PATH, "utf-8"));
    } catch {
      console.log("  ⚠ Could not parse opencode.json — creating backup and starting fresh");
      const backup = OPENCODE_CONFIG_PATH + ".backup";
      fs.copyFileSync(OPENCODE_CONFIG_PATH, backup);
      console.log(`  Backup saved to: ${backup}`);
    }
  }

  const plugins = (config.plugin ?? []) as string[];
  if (plugins.includes("0xcraft")) {
    console.log("  ✓ 0xcraft is already registered in opencode.json");
    return;
  }

  config.plugin = [...plugins, "0xcraft"];

  fs.writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log("  ✓ Added 0xcraft to opencode.json plugin array");
}

async function createConfig(): Promise<void> {
  if (fs.existsSync(ZEROCRAFT_CONFIG_PATH)) {
    console.log("  ✓ 0xcraft.json config already exists");
    return;
  }

  // Canonical nested-only shape — matches `defaultConfig` in
  // src/core/config/config-types.ts. Flat legacy keys (the old
  // `disabled*`/`enabled*` aliases) MUST NOT appear here; an explicit
  // test in install.test.ts greps this file to enforce that.
  const defaultConfig = {
    "// 0xcraft config": "See README.md for all options",
    disabled: { agents: [], skills: [], hooks: [], commands: [], mcp: [] },
    enabled: { agents: [], skills: [], commands: [] },
    customPaths: { agents: [], skills: [], commands: [] },
    modelOverrides: {},
    platforms: {},
    mcpServers: {},
  };

  fs.writeFileSync(ZEROCRAFT_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2) + "\n");
  console.log(`  ✓ Created default config at ${ZEROCRAFT_CONFIG_PATH}`);
}
