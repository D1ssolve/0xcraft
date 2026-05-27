#!/usr/bin/env node
/**
 * 0xcraft CLI — diagnostics and setup.
 *
 * Usage:
 *   0xcraft doctor    — Run health diagnostics
 *   0xcraft install   — Interactive setup wizard
 *   0xcraft version   — Print version
 */
import { Command } from "commander";
import { runDoctor } from "./doctor";
import { runInstall } from "./install";
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

const program = new Command();

program
  .name("0xcraft")
  .description("Agent operations plugin for OpenCode")
  .version(getVersion());

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
    process.exit(results.ok ? 0 : 1);
  });

program
  .command("install")
  .description("Interactive setup wizard — configure agents, skills, and MCPs")
  .action(async () => {
    await runInstall();
  });

program.parse();