/**
 * `0xcraft opencode build` — invoke the OpenCode adapter's canonical
 * `build()` entry and print a summary derived from the resulting
 * `PlatformArtifact`.
 *
 * The OpenCode adapter is a runtime plugin (no files), so the summary
 * focuses on diagnostic counts + capability matrix shape. `--json`
 * prints the structured artifact (without the live `runtimePlugin`
 * function — it cannot be serialized).
 *
 * CLI purity: this file imports `build` from `../adapters/opencode`
 * via a relative path. NO direct `@opencode-ai/*` imports.
 */
import { Command } from "commander";
import { build, type OpenCodeArtifact } from "../adapters/opencode";
import { loadConfig } from "../core/config/config-loader";
import {
  printDiagnostics,
  resolvePackageRoot,
  resolveProjectRoot,
  diagnosticsHaveError,
} from "./_shared";
import type { CapabilityFeature, CapabilityStatus } from "../adapters/_shared/capability-matrix";

export interface OpenCodeCliOptions {
  project?: string;
  json?: boolean;
}

export interface OpenCodeCommandDependencies {
  build?: (
    options: Parameters<typeof build>[0],
  ) => Promise<OpenCodeArtifact>;
  cwd?: () => string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export function createOpenCodeCommand(
  dependencies: OpenCodeCommandDependencies = {},
): Command {
  const command = new Command("opencode").description(
    "OpenCode adapter subcommands (build / introspect).",
  );

  command
    .command("build")
    .description(
      "Invoke the OpenCode adapter build() and print a summary (file count, diagnostic counts, capability report).",
    )
    .option("--project <dir>", "Project root (defaults to cwd)")
    .option("--json", "Emit structured JSON")
    .action(async (options: OpenCodeCliOptions) => {
      const stdout = dependencies.stdout ?? ((m: string) => console.log(m));
      const stderr = dependencies.stderr ?? ((m: string) => console.error(m));
      const cwd = dependencies.cwd?.() ?? process.cwd();
      const setExitCode =
        dependencies.setExitCode ?? ((c: number) => { process.exitCode = c; });
      const doBuild = dependencies.build ?? build;

      try {
        const projectRoot = resolveProjectRoot({ project: options.project, cwd });
        const packageRoot = resolvePackageRoot();
        const { config, diagnostics: loadDiags } = loadConfig({
          harness: "opencode",
          projectRoot,
        });

        const artifact = await doBuild({
          config,
          projectRoot,
          packageRoot,
        });

        const allDiagnostics = [...loadDiags, ...artifact.diagnostics];

        if (options.json) {
          stdout(
            JSON.stringify(
              {
                platform: artifact.platform,
                kind: artifact.kind,
                ok: artifact.ok,
                fileCount: artifact.files.length,
                diagnostics: allDiagnostics,
                capabilityReport: {
                  platform: artifact.capabilityReport.platform,
                  features: artifact.capabilityReport.features,
                },
                metadata: artifact.metadata,
              },
              null,
              2,
            ),
          );
        } else {
          stdout(`[0xcraft] opencode build — platform=${artifact.platform} kind=${artifact.kind} ok=${artifact.ok}`);
          stdout(`[0xcraft] opencode build — files=${artifact.files.length}`);
          const counts = countDiagnostics(allDiagnostics);
          stdout(
            `[0xcraft] opencode build — diagnostics: error=${counts.error} warn=${counts.warn} info=${counts.info}`,
          );
          const featureCounts = summarizeFeatures(artifact.capabilityReport.features);
          stdout(
            `[0xcraft] opencode build — capability matrix: full=${featureCounts.full} shim=${featureCounts.shim} shell-cmd=${featureCounts["shell-cmd"]} drop-warn=${featureCounts["drop-warn"]} experimental=${featureCounts.experimental}`,
          );
          printDiagnostics(allDiagnostics, { stdout, stderr });
        }

        const errored = diagnosticsHaveError(allDiagnostics) || !artifact.ok;
        setExitCode(errored ? 1 : 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`[0xcraft] ERROR opencode.build.failed — ${message}`);
        setExitCode(1);
      }
    });

  return command;
}

function countDiagnostics(
  diagnostics: ReadonlyArray<{ severity: "info" | "warn" | "error" }>,
): { info: number; warn: number; error: number } {
  const out = { info: 0, warn: 0, error: 0 };
  for (const d of diagnostics) out[d.severity]++;
  return out;
}

function summarizeFeatures(
  features: Record<CapabilityFeature, { status: CapabilityStatus }>,
): Record<CapabilityStatus, number> {
  const out: Record<CapabilityStatus, number> = {
    full: 0,
    shim: 0,
    "shell-cmd": 0,
    "drop-warn": 0,
    experimental: 0,
  };
  for (const key of Object.keys(features) as CapabilityFeature[]) {
    out[features[key].status]++;
  }
  return out;
}
