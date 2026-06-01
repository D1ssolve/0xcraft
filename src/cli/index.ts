#!/usr/bin/env node
/**
 * 0xcraft v3 CLI — converter-first.
 *
 * Commands:
 *   init     Scaffold .0xcraft/ config and source layout
 *   build    Build per-target artifacts from .0xcraft/ source
 *   convert  Convert from one platform to another via IR
 *   import   Import existing platform artifacts → .0xcraft/ source
 *   doctor   Run diagnostics + capability matrix checks
 *   pack     Manage installed 0xcraft packs
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitCommand } from "./init";
import { createBuildCommand } from "./build";
import { createConvertCommand } from "./convert";
import { createImportCommand } from "./import";
import { createDoctorCommand } from "./doctor";
import { createPackCommand } from "./pack";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createCliProgram(): Command {
  const program = new Command();
  program
    .name("0xcraft")
    .description("Converter-first CLI between OpenCode, Claude Code, and Codex agent platforms")
    .version(getVersion());

  program.addCommand(createInitCommand());
  program.addCommand(createBuildCommand());
  program.addCommand(createConvertCommand());
  program.addCommand(createImportCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createPackCommand());

  return program;
}

if (import.meta.main) {
  await createCliProgram().parseAsync();
}
