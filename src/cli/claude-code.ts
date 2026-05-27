import { Command } from "commander";
import {
  generateClaudeCodePlugin,
  type ClaudeCodeGeneratorDiagnostic,
  type GenerateClaudeCodePluginOptions,
  type GenerateClaudeCodePluginResult,
} from "../adapters/claude-code";

const DEFAULT_OUTPUT_LABEL = "dist/claude-code-plugin/0xcraft/";

export interface ClaudeCodeCliOptions {
  out?: string;
  force?: boolean;
  validate?: boolean;
  strict?: boolean;
}

export interface ClaudeCodeCommandDependencies {
  generate?: (options: GenerateClaudeCodePluginOptions) => Promise<GenerateClaudeCodePluginResult>;
  cwd?: () => string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export function createClaudeCodeCommand(dependencies: ClaudeCodeCommandDependencies = {}): Command {
  const command = new Command("claude-code")
    .description("Generate Claude Code plugin artifacts for claude --plugin-dir <dir>; zip loading is not supported")
    .addHelpText("after", [
      "",
      "First release supports local loading with `claude --plugin-dir <dir>` only.",
      "Run `/reload-plugins` in Claude Code after regenerating artifacts.",
      "Zip loading is not supported by 0xcraft in this release.",
    ].join("\n"));

  command
    .command("generate")
    .description("Generate the 0xcraft Claude Code plugin directory for claude --plugin-dir <dir>; zip loading is not supported")
    .option("--out <dir>", `Output directory. Defaults to ${DEFAULT_OUTPUT_LABEL} ephemeral gitignored generated output.`)
    .option("--force", "Overwrite existing generated output")
    .option("--validate", "Run `claude plugin validate <dir>` after generation")
    .option("--strict", "Run validation in strict mode and fail when required Claude Code capabilities are absent")
    .addHelpText("after", [
      "",
      `When --out is omitted, 0xcraft writes ${DEFAULT_OUTPUT_LABEL} as ephemeral gitignored generated output under dist/.`,
      "Load generated artifacts with `claude --plugin-dir <dir>`; zip loading is not supported.",
      "No interactive prompts are used, so this command is safe for automation.",
    ].join("\n"))
    .action(async (options: ClaudeCodeCliOptions) => {
      try {
        const result = await runClaudeCodeGenerate(options, dependencies);
        printClaudeCodeResult(result, dependencies);
        dependencies.setExitCode?.(result.ok ? 0 : 1);
      } catch (error) {
        const stderr = dependencies.stderr ?? console.error;
        stderr(`[0xcraft] ERROR claude-code.generate.failed: ${sanitizeErrorMessage(error)}`);
        dependencies.setExitCode?.(1);
      }
    });

  return command;
}

async function runClaudeCodeGenerate(
  options: ClaudeCodeCliOptions,
  dependencies: ClaudeCodeCommandDependencies,
): Promise<GenerateClaudeCodePluginResult> {
  const generate = dependencies.generate ?? generateClaudeCodePlugin;
  const validateExternal = options.validate === true || options.strict === true;

  return generate({
    projectRoot: dependencies.cwd?.() ?? process.cwd(),
    outputPath: options.out,
    force: options.force === true,
    validateExternal,
    strictExternalValidation: options.strict === true,
  });
}

function printClaudeCodeResult(
  result: GenerateClaudeCodePluginResult,
  dependencies: ClaudeCodeCommandDependencies,
): void {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;

  stdout(`[0xcraft] Claude Code plugin generated at ${result.outputPath}`);
  if (result.metadata.defaultOutput) {
    stdout(`[0xcraft] Default output ${DEFAULT_OUTPUT_LABEL} is ephemeral gitignored generated output; regenerate instead of editing it.`);
  }
  stdout(`[0xcraft] Load with: claude --plugin-dir ${result.outputPath}`);
  stdout("[0xcraft] Zip loading is not supported by 0xcraft in this release.");

  for (const diagnostic of aggregateDiagnostics(result.diagnostics)) {
    printDiagnostic(diagnostic, diagnostic.severity === "error" ? stderr : stdout);
  }
}

interface PrintableDiagnostic extends ClaudeCodeGeneratorDiagnostic {
  repeated?: number;
}

function aggregateDiagnostics(diagnostics: ClaudeCodeGeneratorDiagnostic[]): PrintableDiagnostic[] {
  const groups = new Map<string, { diagnostic: PrintableDiagnostic; detailValues: Map<string, Set<string>> }>();

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}\0${diagnostic.code}\0${diagnostic.message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.diagnostic.repeated = (existing.diagnostic.repeated ?? 1) + 1;
      collectSafeDetails(existing.detailValues, diagnostic.details);
      existing.diagnostic.details = flattenDetailValues(existing.detailValues);
      continue;
    }

    const detailValues = new Map<string, Set<string>>();
    collectSafeDetails(detailValues, diagnostic.details);
    groups.set(key, {
      diagnostic: {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        details: flattenDetailValues(detailValues),
        repeated: 1,
      },
      detailValues,
    });
  }

  return [...groups.values()].map(({ diagnostic }) => diagnostic);
}

function collectSafeDetails(target: Map<string, Set<string>>, details: Record<string, unknown> | undefined): void {
  if (!details) return;

  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveDetailKey(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;

    const values = target.get(key) ?? new Set<string>();
    values.add(String(value));
    target.set(key, values);
  }
}

function flattenDetailValues(detailValues: Map<string, Set<string>>): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  for (const [key, values] of [...detailValues.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    details[key] = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0).join(",");
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function isSensitiveDetailKey(key: string): boolean {
  return /token|secret|password|authorization|header|env|cookie|credential|key/iu.test(key);
}

function printDiagnostic(
  diagnostic: PrintableDiagnostic,
  write: (message: string) => void,
): void {
  const level = diagnostic.severity === "error" ? "ERROR" : "WARN";
  const details = formatSafeDetails(diagnostic.details);
  const repeated = diagnostic.repeated && diagnostic.repeated > 1 ? `; repeated ${diagnostic.repeated} times` : "";
  write(`[0xcraft] ${level} ${diagnostic.code}: ${diagnostic.message}${details || repeated ? ` (${[details, repeated.slice(2)].filter(Boolean).join("; ")})` : ""}`);
}

function formatSafeDetails(details: Record<string, unknown> | undefined): string {
  if (!details) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveDetailKey(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    for (const singleValue of String(value).split(",")) {
      parts.push(`${key}=${singleValue}`);
    }
  }
  return parts.length > 0 ? `details: ${parts.join(", ")}` : "";
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\/[^\s:)]*/gu, "<path>")
    .replace(/\b[A-Za-z]:\\[^\s:)]*/gu, "<path>")
    .replace(/token|secret|password|authorization|cookie|credential|api[-_]?key/giu, "[redacted]");
}
