import { Command } from "commander";
import { resolve } from "node:path";

import { writeArtifact } from "../adapters/_shared/filesystem";
import { emitClaude, type ClaudeEmitMode } from "../adapters/claude/emit";
import { importClaude } from "../adapters/claude/import";
import { emitCodex } from "../adapters/codex/emit";
import { importCodex } from "../adapters/codex/import";
import { emitOpenCode } from "../adapters/opencode/emit";
import { importOpenCode } from "../adapters/opencode/import";
import type { PlatformArtifact } from "../adapters/_shared/artifact";
import type { Diagnostic } from "../core/diagnostics";
import type { IRResource } from "../core/ir";
import { isPlatformId, type PlatformId } from "../core/platform/platform-id";

type ExitCode = 0 | 1 | 2;

interface ConvertOptions {
  from?: string;
  to?: string;
  mode?: ClaudeEmitMode;
  in?: string;
  out?: string;
  strict?: boolean;
  json?: boolean;
  force?: boolean;
}

interface ConvertRunResult {
  artifact?: PlatformArtifact;
  diagnostics: Diagnostic[];
  exitCode: ExitCode;
  ok: boolean;
  written: string[];
}

export function createConvertCommand(): Command {
  return new Command("convert")
    .description("Convert from one platform to another via IR")
    .requiredOption("--from <id>", "Source platform: opencode | claude-code | codex")
    .requiredOption("--to <id>", "Target platform: opencode | claude-code | codex")
    .option("--mode <mode>", "Claude mode: claude-plugin | claude-subagent", "claude-plugin")
    .option("--in <dir>", "Input directory", process.cwd())
    .option("--out <dir>", "Output directory", process.cwd())
    .option("--strict", "Upgrade warnings to errors")
    .option("--json", "Emit structured JSON diagnostics")
    .option("--force", "Overwrite existing output files")
    .action((options: ConvertOptions) => {
      const result = runConvert(options);
      reportConvertResult(result, options.json === true);
      process.exitCode = result.exitCode;
    });
}

export function runConvert(options: ConvertOptions): ConvertRunResult {
  const diagnostics: Diagnostic[] = [];
  const from = parsePlatformOption(options.from, "--from", diagnostics);
  const to = parsePlatformOption(options.to, "--to", diagnostics);
  const mode = parseClaudeMode(options.mode ?? "claude-plugin", diagnostics);
  const strict = options.strict === true;
  const outDir = resolve(options.out ?? process.cwd());
  const inDir = resolve(options.in ?? process.cwd());

  if (from !== undefined && to !== undefined && from === to) {
    diagnostics.push({
      severity: "error",
      code: "ERR_SAME_PLATFORM",
      message: "Source and target platforms must differ.",
      details: { from, to },
    });
  }

  if (from === undefined || to === undefined || mode === undefined || hasError(diagnostics)) {
    const finalDiagnostics = sortDiagnostics(upgradeWarnsToErrors(diagnostics, strict));
    return result(undefined, finalDiagnostics, []);
  }

  const importResult = importFrom(from, inDir, mode);
  diagnostics.push(...importResult.diagnostics);

  let artifact: PlatformArtifact | undefined;
  if (!hasError(diagnostics)) {
    artifact = emitTo(to, importResult.ir, mode);
    diagnostics.push(...artifact.diagnostics);
  }

  const finalDiagnostics = sortDiagnostics(upgradeWarnsToErrors(diagnostics, strict));
  if (hasError(finalDiagnostics)) {
    return result(artifact, finalDiagnostics, []);
  }

  let written: string[] = [];
  try {
    if (artifact !== undefined) {
      written = writeArtifact(artifact, outDir, { force: options.force === true }).written;
    }
  } catch (error) {
    const writeDiagnostics = sortDiagnostics([
      ...finalDiagnostics,
      {
        severity: "error",
        code: "ERR_FILE_EXISTS",
        message: error instanceof Error ? error.message : String(error),
        details: { outDir },
      },
    ]);
    return result(artifact, writeDiagnostics, []);
  }

  return result(artifact, finalDiagnostics, written);
}

function importFrom(
  platform: PlatformId,
  inDir: string,
  mode: ClaudeEmitMode,
): { ir: IRResource[]; diagnostics: Diagnostic[] } {
  switch (platform) {
    case "opencode":
      return importOpenCode(inDir);
    case "claude-code":
      return importClaude(inDir, { mode });
    case "codex":
      return importCodex(inDir, {});
  }
}

function emitTo(platform: PlatformId, ir: IRResource[], mode: ClaudeEmitMode): PlatformArtifact {
  switch (platform) {
    case "opencode":
      return emitOpenCode(ir, {});
    case "claude-code":
      return emitClaude(ir, { mode });
    case "codex":
      return emitCodex(ir, {});
  }
}

function parsePlatformOption(
  value: string | undefined,
  optionName: string,
  diagnostics: Diagnostic[],
): PlatformId | undefined {
  if (isPlatformId(value)) return value;
  diagnostics.push({
    severity: "error",
    code: "ERR_UNSUPPORTED_MODE",
    message: `${optionName} must be one of: opencode, claude-code, codex.`,
    details: { option: optionName, value },
  });
  return undefined;
}

function parseClaudeMode(
  value: string | undefined,
  diagnostics: Diagnostic[],
): ClaudeEmitMode | undefined {
  if (value === "claude-plugin" || value === "claude-subagent") return value;
  diagnostics.push({
    severity: "error",
    code: "ERR_UNSUPPORTED_MODE",
    message: "--mode must be claude-plugin or claude-subagent.",
    details: { option: "--mode", value },
  });
  return undefined;
}

function result(
  artifact: PlatformArtifact | undefined,
  diagnostics: Diagnostic[],
  written: string[],
): ConvertRunResult {
  const exitCode = exitFromDiagnostics(diagnostics);
  return {
    artifact,
    diagnostics,
    exitCode,
    ok: exitCode !== 1,
    written,
  };
}

function upgradeWarnsToErrors(diagnostics: Diagnostic[], strict: boolean): Diagnostic[] {
  if (!strict) return diagnostics;
  return diagnostics.map((diagnostic) => diagnostic.severity === "warn"
    ? { ...diagnostic, severity: "error" }
    : diagnostic);
}

function exitFromDiagnostics(diagnostics: Diagnostic[]): ExitCode {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return 1;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warn")) return 2;
  return 0;
}

function hasError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function reportConvertResult(result: ConvertRunResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify({
      ok: result.ok,
      exitCode: result.exitCode,
      diagnostics: result.diagnostics,
      written: result.written,
      artifact: result.artifact === undefined
        ? undefined
        : {
          platform: result.artifact.platform,
          kind: result.artifact.kind,
          ok: result.artifact.ok,
          files: result.artifact.files.map((file) => file.path),
        },
    }, null, 2));
    return;
  }

  for (const diagnostic of result.diagnostics) {
    const severity = diagnostic.severity.toUpperCase();
    const details = diagnostic.details === undefined ? "" : ` ${JSON.stringify(diagnostic.details)}`;
    const line = `[0xcraft] ${severity} ${diagnostic.code} — ${diagnostic.message}${details}`;
    if (diagnostic.severity === "info") {
      console.log(line);
    } else {
      console.error(line);
    }
  }
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const severityOrder: Record<Diagnostic["severity"], number> = { error: 0, warn: 1, info: 2 };
  return [...diagnostics].sort((left, right) => {
    const severityDiff = severityOrder[left.severity] - severityOrder[right.severity];
    if (severityDiff !== 0) return severityDiff;
    if (left.code !== right.code) return left.code < right.code ? -1 : 1;
    if (left.message !== right.message) return left.message < right.message ? -1 : 1;
    return 0;
  });
}
