#!/usr/bin/env node
/**
 * 0xcraft CLI — diagnostics and setup.
 *
 * Usage:
 *   0xcraft doctor    — Run health diagnostics
 *   0xcraft install   — Interactive setup wizard
 *   0xcraft claude-code generate --out <dir> [--force] [--validate] [--strict]
 *   0xcraft codex generate [--output <dir>] [--project <dir>] [--force]
 *   0xcraft version   — Print version
 */
import { Command } from "commander";
import { runDoctor, printDoctorResults, doctorExitCode, type DoctorPlatformOption } from "./doctor";
import { runInstall } from "./install";
import { createClaudeCodeCommand } from "./claude-code";
import { createCodexCommand } from "./codex";
import { createOpenCodeCommand } from "./opencode";
import { isPlatformId, type PlatformId } from "./_shared";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface CliProgramDependencies {
  exit?: (code: number) => void;
}

export function createCliProgram(dependencies: CliProgramDependencies = {}): Command {
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));
  const program = new Command();

  program
    .name("0xcraft")
    .description("Agent operations plugin for OpenCode and Claude Code plugin-dir workflow; zip loading is not supported")
    .version(getVersion())
    .addHelpText("after", [
      "",
      "Claude Code first release supports `claude --plugin-dir <dir>` only; zip loading is not supported.",
    ].join("\n"));

  program
    .command("doctor")
    .description("Run health diagnostics — verify plugin registration, config, agents, skills, and MCPs")
    .option("--json", "Output as JSON")
    .option("--strict", "Upgrade warnings to errors before computing exit code")
    .option("--project <dir>", "Project root (defaults to cwd)")
    .option(
      "--harness <id>",
      "Target harness: opencode | claude-code | codex | all",
      "opencode",
    )
    .action(async (opts) => {
      const harness = opts.harness as string;
      const isAll = harness === "all";
      if (!isAll && !isPlatformId(harness)) {
        console.error(
          `[0xcraft] ERROR doctor.invalid_harness — unknown harness "${harness}"; expected opencode | claude-code | codex | all`,
        );
        exit(1);
        return;
      }
      const harnessOpt: DoctorPlatformOption = (isAll ? "all" : harness) as DoctorPlatformOption;
      const results = await runDoctor({
        harness: harnessOpt,
        projectRoot: opts.project,
        strict: opts.strict === true,
      });
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printDoctorResults(results, { harness: harnessOpt, projectRoot: opts.project });
      }
      exit(doctorExitCode(results));
    });

  program
    .command("install")
    .description("Interactive setup wizard — configure agents, skills, and MCPs")
    .option("--harness <id>", "Target harness: opencode | claude-code | codex", "opencode")
    .option("--output <dir>", "Output directory for generated artifacts (ignored when --harness opencode)")
    .option("--project <dir>", "Project root for generators (ignored when --harness opencode)")
    .option("--force", "Overwrite existing files (ignored when --harness opencode)")
    .option("--dry-run", "Print planned files + diagnostics without writing anything")
    .action(async (opts) => {
      if (!isPlatformId(opts.harness)) {
        console.error(`[0xcraft] ERROR install.invalid_harness — unknown harness "${opts.harness}"; expected opencode | claude-code | codex`);
        exit(1);
        return;
      }
      await runInstall({
        harness: opts.harness as PlatformId,
        output: opts.output,
        project: opts.project,
        force: opts.force === true,
        dryRun: opts.dryRun === true,
        setExitCode: (code) => { process.exitCode = code; },
      });
    });

  program.addCommand(createClaudeCodeCommand({ setExitCode: (code) => { process.exitCode = code; } }));
  program.addCommand(createCodexCommand({ setExitCode: (code) => { process.exitCode = code; } }));
  program.addCommand(createOpenCodeCommand({ setExitCode: (code) => { process.exitCode = code; } }));

  return program;
}

if (import.meta.main) {
  await createCliProgram().parseAsync();
}
