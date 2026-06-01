import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emitClaude, type ClaudeEmitMode } from "../adapters/claude/emit";
import { emitCodex } from "../adapters/codex/emit";
import { emitOpenCode } from "../adapters/opencode/emit";
import type { PlatformArtifact } from "../adapters/_shared/artifact";
import { resolveInsideRoot, writeArtifact } from "../adapters/_shared/filesystem";
import { resolvePackResources } from "../adapters/_shared/pack-resolver/resolver";
import { loadConfig, type ZeroxCraftConfig } from "../core/config/config-loader";
import type { Diagnostic } from "../core/diagnostics";
import type { DiagnosticCode } from "../core/diagnostics/codes";
import { loadResourceDirectoryRaw, loadSourceTree, type PlatformId, type RawResourceFile } from "../core/loader/file-loader";
import { mergeAllResources, type IRResource } from "../core/merge/merger";

export type BuildTarget = "opencode" | "claude-code" | "codex" | "all";

export interface BuildCommandOptions {
  target?: string;
  mode?: string;
  out?: string;
  validate?: boolean;
  strict?: boolean;
  json?: boolean;
  force?: boolean;
}

export interface BuildCommandIo {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface BuildCommandResult {
  diagnostics: Diagnostic[];
  exitCode: 0 | 1 | 2;
  artifacts: PlatformArtifact[];
}

interface ArtifactPlan {
  target: Exclude<BuildTarget, "all">;
  artifact: PlatformArtifact;
  outputRoot: string;
}

interface BackupEntry {
  relativePath: string;
  backupPath: string;
  mode?: number;
}

interface BackupManifest {
  outputRoot: string;
  entries: BackupEntry[];
}

const ALL_TARGETS = ["opencode", "claude-code", "codex"] as const;
const LOADER_PLATFORMS: PlatformId[] = ["opencode", "claude", "codex"];

export function createBuildCommand(): Command {
  return new Command("build")
    .description("Build per-target artifacts from .0xcraft/ source")
    .option("--target <id>", "Target: opencode | claude-code | codex | all", "all")
    .option("--mode <mode>", "Claude mode: claude-plugin | claude-subagent", "claude-plugin")
    .option("--out <dir>", "Output root override")
    .option("--validate", "Dry-run, do not write")
    .option("--strict", "Upgrade warn to error")
    .option("--json", "Emit JSON diagnostics")
    .option("--force", "Overwrite existing artifacts")
    .action(async (options: BuildCommandOptions) => {
      const result = await runBuildCommand(process.cwd(), options);
      process.exitCode = result.exitCode;
    });
}

export async function runBuildCommand(
  projectDir: string,
  options: BuildCommandOptions,
  io: BuildCommandIo = {},
): Promise<BuildCommandResult> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const stderr = io.stderr ?? ((line: string) => console.error(line));
  const diagnostics: Diagnostic[] = [];
  const artifacts: PlatformArtifact[] = [];
  const artifactPlans: ArtifactPlan[] = [];

  const target = parseTarget(options.target ?? "all");
  if (target === undefined) {
    const finalDiagnostics = finalizeDiagnostics([
      diagnostic("error", "ERR_UNSUPPORTED_MODE", "Unsupported build target.", { target: options.target }),
    ], options.strict === true);
    report(finalDiagnostics, options.json === true, stdout, stderr);
    return { diagnostics: finalDiagnostics, exitCode: exitFromDiagnostics(finalDiagnostics), artifacts };
  }

  const mode = parseClaudeMode(options.mode ?? "claude-plugin");
  if (mode === undefined) {
    const finalDiagnostics = finalizeDiagnostics([
      diagnostic("error", "ERR_UNSUPPORTED_MODE", "Unsupported Claude build mode.", { mode: options.mode }),
    ], options.strict === true);
    report(finalDiagnostics, options.json === true, stdout, stderr);
    return { diagnostics: finalDiagnostics, exitCode: exitFromDiagnostics(finalDiagnostics), artifacts };
  }

  let config: ZeroxCraftConfig | undefined;
  let ir: IRResource[] = [];

  try {
    config = loadConfig(projectDir);
    const { diagnostics: packDiagnostics, rawFiles: packRawFiles } = loadConfiguredPackResources(
      projectDir,
      config,
      LOADER_PLATFORMS,
    );
    diagnostics.push(...packDiagnostics);
    const sourceRoot = path.resolve(projectDir, config.sourceRoot);
    const localRawFiles = loadSourceTree(sourceRoot, LOADER_PLATFORMS);
    const rawFiles = [...localRawFiles, ...packRawFiles];
    ir = mergeAllResources(rawFiles, config, {});
    diagnostics.push(...ir.flatMap((resource) => resource.diagnostics ?? []));
  } catch (error) {
    diagnostics.push(errorToDiagnostic(error));
  }

  if (config !== undefined) {
    for (const currentTarget of targetsFor(target)) {
      const artifact = emitForTarget(currentTarget, ir, config, mode);
      artifacts.push(artifact);
      diagnostics.push(...artifact.diagnostics);
      artifactPlans.push({
        target: currentTarget,
        artifact,
        outputRoot: outputRootFor(projectDir, currentTarget, config, options.out),
      });
    }
  }

  const finalDiagnostics = finalizeDiagnostics(diagnostics, options.strict === true);
  const exitCode = exitFromDiagnostics(finalDiagnostics);

  if (exitCode !== 1 && options.validate !== true) {
    for (const plan of artifactPlans) {
      try {
        writeArtifactSafely(plan.artifact, plan.outputRoot, options.force === true);
      } catch (error) {
        const writeDiagnostics = finalizeDiagnostics([errorToDiagnostic(error)], options.strict === true);
        finalDiagnostics.push(...writeDiagnostics);
        break;
      }
    }
  }

  const finalExitCode = exitFromDiagnostics(finalDiagnostics);
  report(finalDiagnostics, options.json === true, stdout, stderr);
  return { diagnostics: finalDiagnostics, exitCode: finalExitCode, artifacts };
}

function parseTarget(value: string): BuildTarget | undefined {
  return value === "opencode" || value === "claude-code" || value === "codex" || value === "all" ? value : undefined;
}

function parseClaudeMode(value: string): ClaudeEmitMode | undefined {
  return value === "claude-plugin" || value === "claude-subagent" ? value : undefined;
}

function targetsFor(target: BuildTarget): Array<Exclude<BuildTarget, "all">> {
  return target === "all" ? [...ALL_TARGETS] : [target];
}

function emitForTarget(
  target: Exclude<BuildTarget, "all">,
  ir: IRResource[],
  config: ZeroxCraftConfig,
  mode: ClaudeEmitMode,
): PlatformArtifact {
  if (target === "opencode") {
    return emitOpenCode(ir);
  }
  if (target === "claude-code") {
    return emitClaude(ir, { mode });
  }

  const codex = config.platforms.codex;
  return emitCodex(ir, {
    emitPlugin: codex.emitPlugin,
    emitMarketplace: codex.emitMarketplace,
    hooksEmitMode: codex.hooksEmitMode,
    mcpEnvelope: codex.mcpEnvelope,
    permissionsBeta: codex.permissionsBeta,
  } as Parameters<typeof emitCodex>[1]);
}

function outputRootFor(
  projectDir: string,
  target: Exclude<BuildTarget, "all">,
  config: ZeroxCraftConfig,
  outOverride: string | undefined,
): string {
  if (outOverride !== undefined) return path.resolve(projectDir, outOverride);
  const configured = target === "opencode"
    ? config.out.opencode
    : target === "claude-code"
      ? config.out.claudeCode
      : config.out.codex;
  return path.resolve(projectDir, configured ?? ".");
}

function loadConfiguredPackResources(
  projectDir: string,
  config: ZeroxCraftConfig,
  platforms: PlatformId[],
): { diagnostics: Diagnostic[]; rawFiles: RawResourceFile[] } {
  const diagnostics: Diagnostic[] = [];
  const rawFiles: RawResourceFile[] = [];
  const nodeModules = path.join(projectDir, "node_modules");
  for (const pack of config.packs) {
    try {
      const resolved = resolvePackResources(pack.name, nodeModules, pack.version);
      for (const resource of resolved) {
        rawFiles.push(...loadResourceDirectoryRaw(resource.id, resource.sourcePath, resource.kind, platforms));
      }
    } catch (error) {
      diagnostics.push(errorToDiagnostic(error));
    }
  }
  return { diagnostics, rawFiles };
}

function finalizeDiagnostics(diagnostics: Diagnostic[], strict: boolean): Diagnostic[] {
  return sortDiagnostics(strict ? diagnostics.map(upgradeWarnToError) : diagnostics);
}

function upgradeWarnToError(diagnostic: Diagnostic): Diagnostic {
  return diagnostic.severity === "warn" ? { ...diagnostic, severity: "error" } : diagnostic;
}

function exitFromDiagnostics(diagnostics: Diagnostic[]): 0 | 1 | 2 {
  if (diagnostics.some((entry) => entry.severity === "error")) return 1;
  if (diagnostics.some((entry) => entry.severity === "warn")) return 2;
  return 0;
}

function report(
  diagnostics: Diagnostic[],
  json: boolean,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): void {
  if (json) {
    stdout(JSON.stringify(diagnostics, null, 2));
    return;
  }

  for (const entry of diagnostics) {
    const details = entry.details === undefined ? "" : ` ${JSON.stringify(entry.details)}`;
    const line = `[0xcraft] ${entry.severity.toUpperCase()} ${entry.code} — ${entry.message}${details}`;
    if (entry.severity === "info") stdout(line);
    else stderr(line);
  }
}

function writeArtifactSafely(artifact: PlatformArtifact, outputRoot: string, force: boolean): void {
  const absoluteRoot = path.resolve(outputRoot);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-build-write-"));
  let manifest: BackupManifest | undefined;

  try {
    writeArtifact(artifact, tempRoot, { force: true });
    manifest = force ? createBackupManifest(artifact, absoluteRoot) : assertNoCollisions(artifact, absoluteRoot);
    moveTempArtifact(artifact, tempRoot, absoluteRoot);
    if (manifest.entries.length > 0) writeBackupManifest(manifest);
  } catch (error) {
    if (manifest !== undefined) restoreBackupManifest(manifest);
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertNoCollisions(artifact: PlatformArtifact, outputRoot: string): BackupManifest {
  for (const file of artifact.files) {
    const destination = resolveInsideRoot(outputRoot, file.path);
    if (fs.existsSync(destination)) {
      throw new Error(`ERR_FILE_EXISTS: refusing to overwrite ${destination} without --force`);
    }
  }
  return { outputRoot, entries: [] };
}

function createBackupManifest(artifact: PlatformArtifact, outputRoot: string): BackupManifest {
  const backupRoot = path.join(outputRoot, ".0xcraft", "backups", "build-latest");
  fs.rmSync(backupRoot, { recursive: true, force: true });
  const entries: BackupEntry[] = [];

  for (const file of artifact.files) {
    const destination = resolveInsideRoot(outputRoot, file.path);
    if (!fs.existsSync(destination)) continue;

    const backupPath = resolveInsideRoot(backupRoot, file.path);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(destination, backupPath);
    entries.push({
      relativePath: file.path,
      backupPath,
      mode: fs.statSync(destination).mode,
    });
  }

  return { outputRoot, entries };
}

function writeBackupManifest(manifest: BackupManifest): void {
  const manifestPath = path.join(manifest.outputRoot, ".0xcraft", "backups", "build-latest", "manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ overwritten: manifest.entries.map((entry) => entry.relativePath).sort() }, null, 2)}\n`,
  );
}

function moveTempArtifact(artifact: PlatformArtifact, tempRoot: string, outputRoot: string): void {
  for (const file of artifact.files) {
    const from = resolveInsideRoot(tempRoot, file.path);
    const to = resolveInsideRoot(outputRoot, file.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
}

function restoreBackupManifest(manifest: BackupManifest): void {
  for (const entry of manifest.entries) {
    const destination = resolveInsideRoot(manifest.outputRoot, entry.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(entry.backupPath, destination);
    if (entry.mode !== undefined) fs.chmodSync(destination, entry.mode);
  }
}

function errorToDiagnostic(error: unknown): Diagnostic {
  const coded = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = typeof coded.message === "string" ? coded.message : String(error);
  const code = typeof coded.code === "string" ? coded.code : codeFromMessage(message);
  return diagnostic(severityForCode(code), code, cleanMessage(message), isRecord(coded.details) ? coded.details : undefined);
}

function codeFromMessage(message: string): DiagnosticCode {
  const match = message.match(/\b(ERR|WARN|INFO)_[A-Z0-9_]+\b/u);
  return (match?.[0] ?? "ERR_FILE_EXISTS") as DiagnosticCode;
}

function cleanMessage(message: string): string {
  return message.replace(/^\b(?:ERR|WARN|INFO)_[A-Z0-9_]+:\s*/u, "");
}

function severityForCode(code: string): Diagnostic["severity"] {
  if (code.startsWith("WARN_")) return "warn";
  if (code.startsWith("INFO_")) return "info";
  return "error";
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Diagnostic {
  return details === undefined ? { severity, code, message } : { severity, code, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const severityRank: Record<Diagnostic["severity"], number> = { error: 0, warn: 1, info: 2 };
  return [...diagnostics].sort((left, right) => {
    const severity = severityRank[left.severity] - severityRank[right.severity];
    if (severity !== 0) return severity;
    const code = left.code.localeCompare(right.code);
    if (code !== 0) return code;
    return left.message.localeCompare(right.message);
  });
}
