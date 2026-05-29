/**
 * `0xcraft codex generate` — emit Codex plugin artifacts under .codex/.
 *
 * T-12.14 rewrite: routes through canonical `build()` + `writeArtifact()`
 * instead of the legacy on-disk generator write path. The adapter
 * `build()` returns an in-memory `PlatformArtifact`; CLI persists it via
 * the shared `writeArtifact()` writer.
 *
 * Flag parity:
 *   --output   target directory under which .codex/ is written (defaults to cwd)
 *   --project  project root used for config discovery (defaults to --output or cwd)
 *   --force    overwrite existing files
 *
 * Diagnostic output: `[0xcraft]` prefix via shared `printDiagnostic`.
 * Exit code: 0 on success, 1 if any error diagnostic or uncaught
 * exception (parity with previous behavior).
 */
import { Command } from "commander";

import { loadConfig } from "../core/config/config-loader";
import { build as buildCodexAdapter, type CodexArtifact } from "../adapters/codex";
import type { BuildOptions } from "../adapters/_shared/artifact";
import {
  diagnosticsHaveError,
  printDiagnostic,
  resolvePackageRoot,
  writeArtifact,
} from "./_shared";

export interface CodexCliOptions {
  output?: string;
  project?: string;
  force?: boolean;
  plugin?: boolean;
  marketplace?: boolean;
}

export interface CodexCommandDependencies {
  /** Adapter `build()` seam. Defaults to the real Codex adapter. */
  build?: (options: BuildOptions) => Promise<CodexArtifact>;
  cwd?: () => string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export function createCodexCommand(dependencies: CodexCommandDependencies = {}): Command {
  const command = new Command("codex").description(
    "Generate Codex plugin artifacts under .codex/ (config.toml, agents/, hooks/, skills/).",
  );

  command
    .command("generate")
    .description("Generate the 0xcraft Codex plugin tree (.codex/)")
    .option("--output <dir>", "Output directory (where .codex/ is written). Defaults to cwd.")
    .option("--project <dir>", "Project root (used for config discovery). Defaults to cwd.")
    .option("--force", "Overwrite existing generated files")
    .option(
      "--plugin",
      "Also emit the .codex-plugin/ filesystem plugin bundle (forces platforms.codex.emitPlugin=true).",
    )
    .option(
      "--marketplace",
      "Also emit .agents/plugins/marketplace.json stub. Requires --plugin (or platforms.codex.emitPlugin=true in config).",
    )
    .action(async (options: CodexCliOptions) => {
      const stdout = dependencies.stdout ?? ((m: string) => console.log(m));
      const stderr = dependencies.stderr ?? ((m: string) => console.error(m));
      const cwd = dependencies.cwd?.() ?? process.cwd();
      const build = dependencies.build ?? buildCodexAdapter;

      try {
        const outputRoot = options.output ?? cwd;
        const projectRoot = options.project ?? options.output ?? cwd;
        const packageRoot = resolvePackageRoot();

        // Capture loader diagnostics — strict nested-only contract
        // requires we abort BEFORE build()/writeArtifact() when the
        // user's config has unrecognized (e.g. legacy flat) keys.
        const { config, diagnostics: loaderDiagnostics } = loadConfig({
          harness: "codex",
          projectRoot,
        });
        if (diagnosticsHaveError(loaderDiagnostics)) {
          for (const d of loaderDiagnostics) {
            printDiagnostic(d, { stdout, stderr });
          }
          dependencies.setExitCode?.(1);
          return;
        }
        // Print non-error loader diagnostics (info/warn) up-front.
        for (const d of loaderDiagnostics) {
          printDiagnostic(d, { stdout, stderr });
        }

        // T-25: CLI flag → config override. The flags FORCE emission
        // on; they cannot turn off a config-enabled bundle. Config and
        // flag merge with OR semantics so partial CLI invocation still
        // honors user config.
        const emitPlugin =
          options.plugin === true || config.platforms.codex?.emitPlugin === true;
        const emitMarketplace =
          options.marketplace === true || config.platforms.codex?.emitMarketplace === true;

        if (emitMarketplace && !emitPlugin) {
          // ERR_MARKETPLACE_REQUIRES_PLUGIN — hard CLI gate. Mirrors
          // the build-layer `codex.plugin.marketplace_requires_plugin`
          // warn and the doctor failure of the same code; CLI promotes
          // it to a fail-fast error so misconfigured invocations never
          // produce a half-emitted tree.
          stderr(
            "[0xcraft] ERROR ERR_MARKETPLACE_REQUIRES_PLUGIN — --marketplace requires --plugin (or platforms.codex.emitPlugin=true).",
          );
          dependencies.setExitCode?.(1);
          return;
        }

        // Apply CLI-flag overrides to config before build(). Cloning
        // shallowly is sufficient — `platforms.codex` is the only
        // sub-tree we touch.
        const effectiveConfig =
          options.plugin === true || options.marketplace === true
            ? {
                ...config,
                platforms: {
                  ...config.platforms,
                  codex: {
                    ...(config.platforms.codex ?? {}),
                    emitPlugin,
                    emitMarketplace,
                  },
                },
              }
            : config;

        const artifact = await build({
          config: effectiveConfig,
          projectRoot,
          packageRoot,
          outputRoot,
        });

        // Important: inspect artifact diagnostics BEFORE writing.
        // A failed build() must NOT persist partial files.
        if (!artifact.ok || diagnosticsHaveError(artifact.diagnostics)) {
          for (const d of artifact.diagnostics) {
            printDiagnostic(d, { stdout, stderr });
          }
          dependencies.setExitCode?.(1);
          return;
        }

        writeArtifact(artifact, outputRoot, { force: options.force === true });

        stdout(`[0xcraft] Codex plugin generated at ${outputRoot}`);
        for (const d of artifact.diagnostics) {
          printDiagnostic(d, { stdout, stderr });
        }
        const exitCode = diagnosticsHaveError(artifact.diagnostics) ? 1 : 0;
        dependencies.setExitCode?.(exitCode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`[0xcraft] ERROR codex.generate.failed — ${message}`);
        dependencies.setExitCode?.(1);
      }
    });

  return command;
}
