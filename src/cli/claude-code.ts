/**
 * `0xcraft claude-code generate` — emit Claude Code plugin artifacts.
 *
 * T-12.14 rewrite: routes through canonical `build()` + `writeArtifact()`
 * instead of the legacy on-disk generator write path. The adapter
 * `build()` produces an in-memory `PlatformArtifact`; CLI persists it via
 * the shared `writeArtifact()` writer which enforces output-root
 * containment.
 *
 * Flag parity:
 *   --out       output directory (defaults to <packageRoot>/dist/claude-code-plugin/0xcraft)
 *   --force     overwrite existing files
 *   --validate  accepted for backwards compatibility (external CLI
 *               validation removed; capability matrix is single source of
 *               truth per ADR Rev 3)
 *   --strict    accepted for backwards compatibility AND upgrades warn
 *               diagnostics to errors before computing the exit code
 *
 * Diagnostic output: `[0xcraft]` prefix per spec §12 via `printDiagnostic`.
 * Exit code: 0 on success / 1 when any error diagnostic present (or after
 * `--strict` upgrade) / 1 on uncaught generator exception.
 */
import path from "node:path";

import { Command } from "commander";

import { loadConfig } from "../core/config/config-loader";
import { build as buildClaudeCodeAdapter, type ClaudeCodeArtifact } from "../adapters/claude-code";
import type { BuildOptions } from "../adapters/_shared/artifact";
import {
  diagnosticsHaveError,
  printDiagnostic,
  resolvePackageRoot,
  resolveProjectRoot,
  upgradeWarnsToErrors,
  writeArtifact,
} from "./_shared";

const DEFAULT_OUTPUT_REL = "dist/claude-code-plugin/0xcraft";
const DEFAULT_OUTPUT_LABEL = "dist/claude-code-plugin/0xcraft/";

export interface ClaudeCodeCliOptions {
  out?: string;
  force?: boolean;
  validate?: boolean;
  strict?: boolean;
}

export interface ClaudeCodeCommandDependencies {
  /** Adapter `build()` seam. Defaults to the real Claude Code adapter. */
  build?: (options: BuildOptions) => Promise<ClaudeCodeArtifact>;
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
    .option("--validate", "Accepted for backwards compatibility; capability matrix is the single source of truth (no external CLI probe)")
    .option("--strict", "Upgrade warning diagnostics to errors before computing exit code")
    .addHelpText("after", [
      "",
      `When --out is omitted, 0xcraft writes ${DEFAULT_OUTPUT_LABEL} as ephemeral gitignored generated output under dist/.`,
      "Load generated artifacts with `claude --plugin-dir <dir>`; zip loading is not supported.",
      "No interactive prompts are used, so this command is safe for automation.",
    ].join("\n"))
    .action(async (options: ClaudeCodeCliOptions) => {
      const stdout = dependencies.stdout ?? ((m: string) => console.log(m));
      const stderr = dependencies.stderr ?? ((m: string) => console.error(m));
      const cwd = dependencies.cwd?.() ?? process.cwd();
      const build = dependencies.build ?? buildClaudeCodeAdapter;

      try {
        const projectRoot = resolveProjectRoot({ cwd });
        const packageRoot = resolvePackageRoot();

        const outputRoot = path.resolve(
          options.out ?? path.join(packageRoot, DEFAULT_OUTPUT_REL),
        );
        const defaultOutput = options.out === undefined;

        // Capture loader diagnostics — strict nested-only contract
        // requires we abort BEFORE build()/writeArtifact() when the
        // user's config has unrecognized (e.g. legacy flat) keys.
        const { config, diagnostics: loaderDiagnostics } = loadConfig({
          harness: "claude-code",
          projectRoot,
        });
        if (diagnosticsHaveError(loaderDiagnostics)) {
          for (const d of loaderDiagnostics) {
            printDiagnostic(d, { stdout, stderr });
          }
          dependencies.setExitCode?.(1);
          return;
        }
        for (const d of loaderDiagnostics) {
          printDiagnostic(d, { stdout, stderr });
        }

        const artifact = await build({
          config,
          projectRoot,
          packageRoot,
          outputRoot,
        });

        // Important: inspect artifact diagnostics BEFORE writing.
        // Failed build() must not persist partial files.
        const artifactDiagnostics = options.strict === true
          ? upgradeWarnsToErrors(artifact.diagnostics)
          : artifact.diagnostics;
        if (!artifact.ok || diagnosticsHaveError(artifactDiagnostics)) {
          for (const d of artifactDiagnostics) {
            printDiagnostic(d, { stdout, stderr });
          }
          dependencies.setExitCode?.(1);
          return;
        }

        writeArtifact(artifact, outputRoot, { force: options.force === true });

        stdout(`[0xcraft] Claude Code plugin generated at ${outputRoot}`);
        if (defaultOutput) {
          stdout(`[0xcraft] Default output ${DEFAULT_OUTPUT_LABEL} is ephemeral gitignored generated output; regenerate instead of editing it.`);
        }
        stdout(`[0xcraft] Load with: claude --plugin-dir ${outputRoot}`);
        stdout("[0xcraft] Zip loading is not supported by 0xcraft in this release.");

        for (const d of artifactDiagnostics) {
          printDiagnostic(d, { stdout, stderr });
        }

        dependencies.setExitCode?.(diagnosticsHaveError(artifactDiagnostics) ? 1 : 0);
      } catch (error) {
        stderr(`[0xcraft] ERROR claude-code.generate.failed — ${sanitizeErrorMessage(error)}`);
        dependencies.setExitCode?.(1);
      }
    });

  return command;
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\/[^\s:)]*/gu, "<path>")
    .replace(/\b[A-Za-z]:\\[^\s:)]*/gu, "<path>")
    .replace(/token|secret|password|authorization|cookie|credential|api[-_]?key/giu, "[redacted]");
}
