#!/usr/bin/env node
/**
 * 0xcraft CLI — diagnostics and setup.
 *
 * Usage:
 *   0xcraft doctor    — Run health diagnostics
 *   0xcraft install   — Interactive setup wizard
 *   0xcraft claude-code generate --out <dir> [--force] [--validate] [--strict]
 *   0xcraft version   — Print version
 */
import { Command } from "commander";
import { runDoctor, printDoctorResults } from "./doctor";
import { runInstall } from "./install";
import { createClaudeCodeCommand } from "./claude-code";
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
    .action(async (opts) => {
      const results = await runDoctor();
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printDoctorResults(results);
      }
      exit(results.ok ? 0 : 1);
    });

  program
    .command("install")
    .description("Interactive setup wizard — configure agents, skills, and MCPs")
    .action(async () => {
      await runInstall();
    });

  program.addCommand(createClaudeCodeCommand({ setExitCode: (code) => { process.exitCode = code; } }));

  return program;
}

if (import.meta.main) {
  await createCliProgram().parseAsync();
}
