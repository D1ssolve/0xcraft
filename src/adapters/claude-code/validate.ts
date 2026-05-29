export type ClaudeValidationSeverity = "warning" | "error";

export interface ClaudeValidationDiagnostic {
  severity: ClaudeValidationSeverity;
  code: string;
  message: string;
}

export interface ClaudeProcessResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export type ClaudeProcessRunner = (command: string, args: string[]) => Promise<ClaudeProcessResult>;

export interface ClaudePluginValidateOptions {
  pluginDir: string;
  strict?: boolean;
  failOnMissingClaude?: boolean;
  runner?: ClaudeProcessRunner;
}

export interface ClaudeOutputSummary {
  stdout: string;
  stderr: string;
}

export type ClaudePluginValidateStatus = "passed" | "warning" | "failed";

export interface ClaudePluginValidateResult {
  ok: boolean;
  status: ClaudePluginValidateStatus;
  command: {
    command: "claude";
    args: string[];
  };
  diagnostics: ClaudeValidationDiagnostic[];
  exitCode?: number;
  outputSummary?: ClaudeOutputSummary;
}

const SUMMARY_LIMIT = 1_024;

export async function runClaudePluginValidate(options: ClaudePluginValidateOptions): Promise<ClaudePluginValidateResult> {
  const args = buildValidateArgs(options.pluginDir, options.strict === true);
  const command = { command: "claude" as const, args };
  const runner = options.runner ?? bunSpawnRunner;

  try {
    const processResult = await runner(command.command, command.args);

    if (processResult.exitCode === 0) {
      return {
        ok: true,
        status: "passed",
        command,
        diagnostics: [],
      };
    }

    return {
      ok: false,
      status: "failed",
      command,
      diagnostics: [
        {
          severity: "error",
          code: "claude.validate.non_zero_exit",
          message: `claude plugin validate exited with code ${processResult.exitCode}.`,
        },
      ],
      exitCode: processResult.exitCode,
      outputSummary: summarizeOutput(processResult.stdout, processResult.stderr),
    };
  } catch (error) {
    if (isMissingBinaryError(error)) {
      const severity = options.failOnMissingClaude === true ? "error" : "warning";
      return {
        ok: severity === "warning",
        status: severity === "warning" ? "warning" : "failed",
        command,
        diagnostics: [
          {
            severity,
            code: "claude.validate.binary_missing",
            message: "Claude Code CLI binary `claude` was not found; external plugin validation was skipped.",
          },
        ],
      };
    }

    return {
      ok: false,
      status: "failed",
      command,
      diagnostics: [
        {
          severity: "error",
          code: "claude.validate.runner_failed",
          message: "Unable to run claude plugin validate.",
        },
      ],
    };
  }
}

function buildValidateArgs(pluginDir: string, strict: boolean): string[] {
  const args = ["plugin", "validate", pluginDir];
  if (strict) {
    args.push("--strict");
  }
  return args;
}

async function bunSpawnRunner(command: string, args: string[]): Promise<ClaudeProcessResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function summarizeOutput(stdout?: string, stderr?: string): ClaudeOutputSummary {
  return {
    stdout: truncate(sanitizeOutput(stdout ?? "")),
    stderr: truncate(sanitizeOutput(stderr ?? "")),
  };
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\b(authorization\s*:\s*)(?:bearer\s+)?[^\r\n]+/giu, "$1[redacted]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s\r\n]+/giu, "$1[redacted]");
}

function truncate(value: string): string {
  if (value.length <= SUMMARY_LIMIT) {
    return value;
  }

  return value.slice(0, SUMMARY_LIMIT);
}

function isMissingBinaryError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: unknown; message?: unknown };
  return maybeError.code === "ENOENT"
    || (typeof maybeError.message === "string" && maybeError.message.includes("ENOENT"));
}
