import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONFIG, type ZeroxCraftConfig } from "../core/config/config-schema";
import type { Diagnostic } from "../core/diagnostics";

const SOURCE_DIRECTORIES = ["agents", "skills", "hooks", "mcp", "commands"] as const;

export interface InitOptions {
  out?: string;
  withPack?: string;
  force?: boolean;
}

export interface InitResult {
  exitCode: 0 | 1;
  diagnostics: Diagnostic[];
  root: string;
  configPath: string;
}

const SECTION_COMMENTS: Record<keyof ZeroxCraftConfig, string[]> = {
  schema: ["Schema version. Keep this pinned so future 0xcraft releases can migrate safely."],
  sourceRoot: ["Source root for portable 0xcraft resources. Default uses this project root."],
  out: ["Optional per-platform output roots used by build commands."],
  enabled: ["Optional allow-lists. Empty arrays mean all discovered resources are eligible."],
  disabled: ["Optional deny-lists for resources that should be ignored."],
  packs: ["Reusable packs loaded at build time. Example: { \"name\": \"@0xcraft/agents-pack\", \"version\": \"*\" }."],
  platforms: ["Platform-specific options. Keep portable resource definitions in agents/, skills/, hooks/, mcp/, commands/."],
  diagnostics: ["Diagnostic policy overrides. Set strict=true to treat warnings as errors."],
};

export function runInit(options: InitOptions = {}): InitResult {
  const root = path.resolve(options.out ?? process.cwd());
  const configDir = path.join(root, ".0xcraft");
  const configPath = path.join(configDir, "config.jsonc");

  if (fs.existsSync(configPath) && options.force !== true) {
    return {
      exitCode: 1,
      diagnostics: [
        {
          severity: "error",
          code: "ERR_CONFIG_EXISTS",
          message: `Config already exists at ${configPath}. Re-run with --force to overwrite.`,
          details: { path: configPath },
        },
      ],
      root,
      configPath,
    };
  }

  fs.mkdirSync(configDir, { recursive: true });
  for (const dir of SOURCE_DIRECTORIES) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }

  fs.writeFileSync(configPath, createConfigScaffold(options.withPack), "utf-8");

  return { exitCode: 0, diagnostics: [], root, configPath };
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Scaffold .0xcraft/ config and source layout")
    .option("--with-pack <pkg>", "Add a pack dependency to .0xcraft/config.jsonc")
    .option("--out <dir>", "Output root to initialize")
    .option("--force", "Overwrite existing .0xcraft/config.jsonc")
    .action((options: InitOptions) => {
      const result = runInit(options);
      for (const diagnostic of result.diagnostics) {
        console.error(`[0xcraft] ${diagnostic.severity.toUpperCase()} ${diagnostic.code} — ${diagnostic.message}`);
      }
      if (result.exitCode === 0) {
        console.log(`[0xcraft] init — created ${result.configPath}`);
      }
      process.exitCode = result.exitCode;
    });
}

function createConfigScaffold(withPack: string | undefined): string {
  const config: ZeroxCraftConfig = {
    ...DEFAULT_CONFIG,
    packs: withPack === undefined ? [...DEFAULT_CONFIG.packs] : [{ name: withPack, version: "*" }],
  };
  const keys = Object.keys(config) as (keyof ZeroxCraftConfig)[];
  const lines = ["{"];

  keys.forEach((key, index) => {
    if (index > 0) lines.push("");
    for (const comment of SECTION_COMMENTS[key]) {
      lines.push(`  // ${comment}`);
    }
    lines.push(...formatJsoncProperty(key, config[key], index < keys.length - 1));
  });

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function formatJsoncProperty(key: string, value: unknown, trailingComma: boolean): string[] {
  const json = JSON.stringify(value, null, 2).split("\n");
  const lines = [`  ${JSON.stringify(key)}: ${json[0]}`];
  for (const line of json.slice(1)) {
    lines.push(`  ${line}`);
  }
  if (trailingComma) {
    lines[lines.length - 1] = `${lines[lines.length - 1]},`;
  }
  return lines;
}
