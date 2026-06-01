import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { assertMatrixComplete, CLAUDE_MATRIX, CODEX_MATRIX, OPENCODE_MATRIX } from "../core/capability-matrix/matrix";
import type { CapabilityStatus, CompletePlatformCapabilityMatrix, MatrixEntry } from "../core/capability-matrix/matrix-types";
import { isClaudeModeCell } from "../core/capability-matrix/matrix-types";
import { loadConfig, type ZeroxCraftConfig } from "../core/config/config-loader";
import type { Diagnostic } from "../core/diagnostics";
import { loadSourceTree, type PlatformId } from "../core/loader/file-loader";
import { mergeAllResources } from "../core/merge/merger";
import { resolvePackResources } from "../adapters/_shared/pack-resolver/resolver";

export type DoctorTarget = "opencode" | "claude-code" | "codex" | "all";
export type ClaudeMode = "claude-plugin" | "claude-subagent";

export interface DoctorCommandOptions {
  target?: string;
  mode?: string;
  strict?: boolean;
  json?: boolean;
}

export interface DoctorCommandIo {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface DoctorCommandResult {
  diagnostics: Diagnostic[];
  exitCode: 0 | 1 | 2;
}

const ALL_TARGETS: Array<Exclude<DoctorTarget, "all">> = ["opencode", "claude-code", "codex"];
const LOADER_PLATFORMS: PlatformId[] = ["opencode", "claude", "codex"];

export function createDoctorCommand(): Command {
  return new Command("doctor")
    .description("Run diagnostics on .0xcraft/ source and emitted artifacts")
    .option("--target <id>", "Target: opencode | claude-code | codex | all", "all")
    .option("--mode <mode>", "Claude mode: claude-plugin | claude-subagent", "claude-plugin")
    .option("--strict", "Upgrade warn to error")
    .option("--json", "Emit JSON diagnostics")
    .action(async (options: DoctorCommandOptions) => {
      const result = await runDoctorCommand(process.cwd(), options);
      process.exitCode = result.exitCode;
    });
}

export async function runDoctorCommand(
  projectDir: string,
  options: DoctorCommandOptions,
  io: DoctorCommandIo = {},
): Promise<DoctorCommandResult> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const stderr = io.stderr ?? ((line: string) => console.error(line));
  const diagnostics: Diagnostic[] = [];

  // Validate target
  const target = parseTarget(options.target ?? "all");
  if (target === undefined) {
    const final = finalize([diag("error", "ERR_UNSUPPORTED_MODE", "Unsupported doctor target.", { target: options.target })], false);
    report(final, options.json === true, stdout, stderr);
    return { diagnostics: final, exitCode: 1 };
  }

  // Validate mode
  const mode = parseMode(options.mode ?? "claude-plugin");
  if (mode === undefined) {
    const final = finalize([diag("error", "ERR_UNSUPPORTED_MODE", "Unsupported Claude mode.", { mode: options.mode })], false);
    report(final, options.json === true, stdout, stderr);
    return { diagnostics: final, exitCode: 1 };
  }

  // Determine if user config exists (default-config-exits-clean rule)
  const hasUserConfig = userConfigExists(projectDir);

  // Load config
  let config: ZeroxCraftConfig;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    const final = finalize([errorToDiag(error)], options.strict === true);
    report(final, options.json === true, stdout, stderr);
    return { diagnostics: final, exitCode: exitCode(final) };
  }

  // If no user config → only info diagnostics allowed
  if (!hasUserConfig) {
    diagnostics.push(diag("info", "INFO_MISSING_PLATFORM_SIBLING", "No .0xcraft/config.json or config.jsonc found; using defaults."));
  }

  // Validate source layout + load IR
  const sourceRoot = path.resolve(projectDir, config.sourceRoot);
  const sourceRootExists = fs.existsSync(sourceRoot);
  if (!sourceRootExists && hasUserConfig) {
    diagnostics.push(diag("warn", "WARN_UNRECOGNIZED_PLATFORM_FIELD", `Source root not found: ${sourceRoot}`));
  }

  if (sourceRootExists) {
    try {
      const rawFiles = loadSourceTree(sourceRoot, LOADER_PLATFORMS);
      const ir = mergeAllResources(rawFiles, config, {});
      diagnostics.push(...ir.flatMap((r) => r.diagnostics ?? []));
    } catch (error) {
      diagnostics.push(errorToDiag(error));
    }
  }

  // Validate pack refs
  const nodeModules = path.join(projectDir, "node_modules");
  for (const pack of config.packs) {
    try {
      resolvePackResources(pack.name, nodeModules, pack.version);
    } catch (error) {
      diagnostics.push(errorToDiag(error));
    }
  }

  // Validate marketplace/plugin dependency
  const codexConfig = config.platforms.codex;
  if (codexConfig.emitMarketplace === true && codexConfig.emitPlugin !== true) {
    diagnostics.push(diag(
      "error",
      "ERR_MARKETPLACE_REQUIRES_PLUGIN",
      "platforms.codex.emitMarketplace requires platforms.codex.emitPlugin=true",
    ));
  }

  // Run assertMatrixComplete for all 3 platforms
  try {
    assertMatrixComplete();
  } catch (error) {
    diagnostics.push(diag("error", "ERR_UNSUPPORTED_MODE", errorMessage(error)));
  }

  // Capability matrix summary per target
  const targets = target === "all" ? ALL_TARGETS : [target];
  for (const t of targets) {
    const summaryLines = matrixSummary(t);
    diagnostics.push(diag("info", "INFO_MISSING_PLATFORM_SIBLING", `capability matrix [${t}]: ${summaryLines}`));
  }

  // Enforce default-config-exits-clean: if no user config, downgrade all non-info to info
  const effectiveDiagnostics = hasUserConfig
    ? diagnostics
    : diagnostics.map((d) => (d.severity !== "info" ? { ...d, severity: "info" as const } : d));

  const final = finalize(effectiveDiagnostics, options.strict === true);
  report(final, options.json === true, stdout, stderr);
  return { diagnostics: final, exitCode: exitCode(final) };
}

function userConfigExists(projectDir: string): boolean {
  return (
    fs.existsSync(path.join(projectDir, ".0xcraft", "config.json")) ||
    fs.existsSync(path.join(projectDir, ".0xcraft", "config.jsonc"))
  );
}

function matrixSummary(target: Exclude<DoctorTarget, "all">): string {
  const matrix: CompletePlatformCapabilityMatrix =
    target === "opencode" ? OPENCODE_MATRIX : target === "claude-code" ? CLAUDE_MATRIX : CODEX_MATRIX;

  const counts: Record<CapabilityStatus, number> = {
    full: 0,
    shim: 0,
    "shell-cmd": 0,
    "drop-warn": 0,
    experimental: 0,
  };

  for (const entry of Object.values(matrix) as MatrixEntry[]) {
    if (isClaudeModeCell(entry)) {
      // For summary, use plugin cell for claude-code, otherwise the single cell
      const cell = target === "claude-code" ? entry.plugin : entry.plugin;
      counts[cell.status]++;
    } else {
      counts[entry.status]++;
    }
  }

  return Object.entries(counts)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
}

function parseTarget(value: string): DoctorTarget | undefined {
  return value === "opencode" || value === "claude-code" || value === "codex" || value === "all"
    ? value
    : undefined;
}

function parseMode(value: string): ClaudeMode | undefined {
  return value === "claude-plugin" || value === "claude-subagent" ? value : undefined;
}

function finalize(diagnostics: Diagnostic[], strict: boolean): Diagnostic[] {
  const upgraded = strict ? diagnostics.map((d) => d.severity === "warn" ? { ...d, severity: "error" as const } : d) : diagnostics;
  return sortDiagnostics(upgraded);
}

function exitCode(diagnostics: Diagnostic[]): 0 | 1 | 2 {
  if (diagnostics.some((d) => d.severity === "error")) return 1;
  if (diagnostics.some((d) => d.severity === "warn")) return 2;
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

function diag(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Diagnostic {
  return details === undefined ? { severity, code, message } : { severity, code, message, details };
}

function errorToDiag(error: unknown): Diagnostic {
  const coded = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = typeof coded.message === "string" ? coded.message : String(error);
  const code = typeof coded.code === "string" ? coded.code : codeFromMessage(message);
  const details = isRecord(coded.details) ? coded.details : undefined;
  return diag(severityForCode(code), code, cleanMessage(message), details);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeFromMessage(message: string): string {
  const match = message.match(/\b(ERR|WARN|INFO)_[A-Z0-9_]+\b/u);
  return match?.[0] ?? "ERR_UNSUPPORTED_MODE";
}

function cleanMessage(message: string): string {
  return message.replace(/^\b(?:ERR|WARN|INFO)_[A-Z0-9_]+:\s*/u, "");
}

function severityForCode(code: string): Diagnostic["severity"] {
  if (code.startsWith("WARN_")) return "warn";
  if (code.startsWith("INFO_")) return "info";
  return "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const rank: Record<Diagnostic["severity"], number> = { error: 0, warn: 1, info: 2 };
  return [...diagnostics].sort((a, b) => {
    const s = rank[a.severity] - rank[b.severity];
    if (s !== 0) return s;
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    return a.message.localeCompare(b.message);
  });
}
