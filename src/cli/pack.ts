// 0xcraft pack — pack management (add / list installed 0xcraft packs).
// Phase 5 implementation (T-5.6).
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { parseJsonc } from "../core/config/config-loader";
import type { Diagnostic } from "../core/diagnostics";
import { resolvePackResources } from "../adapters/_shared/pack-resolver/resolver";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunPackAddOptions {
  projectDir: string;
  packageName: string;
  version?: string;
  link?: boolean;
}

export interface RunPackAddResult {
  exitCode: 0 | 1 | 2;
  diagnostics: Diagnostic[];
}

export interface RunPackListOptions {
  projectDir: string;
}

export interface RunPackListResult {
  exitCode: 0 | 1 | 2;
  diagnostics: Diagnostic[];
  output: string[];
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export function createPackCommand(): Command {
  const cmd = new Command("pack").description("Manage installed 0xcraft packs");

  cmd
    .command("add <packageName>")
    .description("Add a pack entry to .0xcraft/config")
    .option("--version <version>", "Version to record (default: *)")
    .option("--link", "Record as a file link")
    .action((packageName: string, options: { version?: string; link?: boolean }, command: Command) => {
      const projectDir = process.cwd();
      const result = runPackAdd({ projectDir, packageName, version: options.version, link: options.link });
      for (const d of result.diagnostics) {
        reportDiagnostic(d);
      }
      process.exitCode = result.exitCode;
    });

  cmd
    .command("list")
    .description("List configured packs with version and resource info")
    .action((_options: unknown, command: Command) => {
      const projectDir = process.cwd();
      const result = runPackList({ projectDir });
      for (const line of result.output) {
        console.log(line);
      }
      for (const d of result.diagnostics) {
        reportDiagnostic(d);
      }
      process.exitCode = result.exitCode;
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// runPackAdd
// ---------------------------------------------------------------------------

export function runPackAdd(options: RunPackAddOptions): RunPackAddResult {
  const diagnostics: Diagnostic[] = [];
  const configFile = resolveConfigPath(options.projectDir);
  if (configFile === undefined) {
    diagnostics.push({
      severity: "error",
      code: "ERR_CONFIG_NOT_FOUND",
      message: "No .0xcraft/config.json[c] found in project directory.",
      details: { projectDir: options.projectDir },
    });
    return { exitCode: 1, diagnostics };
  }

  const raw = fs.readFileSync(configFile, "utf8");
  const config = parseJsonc(raw) as Record<string, unknown>;
  const packs = Array.isArray(config.packs) ? (config.packs as Array<{ name: string; version: string }>) : [];

  // Resolve version — if a range like ^x.y.z, look up installed
  const resolvedVersion = resolveVersion(options.packageName, options.version ?? "*", options.projectDir);

  // Check if already configured
  const existing = packs.find((p) => p.name === options.packageName);
  if (existing !== undefined && existing.version === resolvedVersion) {
    diagnostics.push({
      severity: "info",
      code: "INFO_PACK_ALREADY_INSTALLED",
      message: `Pack ${options.packageName}@${resolvedVersion} already configured; no change.`,
      details: { name: options.packageName, version: resolvedVersion },
    });
    return { exitCode: 0, diagnostics };
  }

  // Add or update
  const updatedPacks = existing !== undefined
    ? packs.map((p) => p.name === options.packageName ? { name: options.packageName, version: resolvedVersion } : p)
    : [...packs, { name: options.packageName, version: resolvedVersion }];

  config.packs = updatedPacks;
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return { exitCode: 0, diagnostics };
}

// ---------------------------------------------------------------------------
// runPackList
// ---------------------------------------------------------------------------

export function runPackList(options: RunPackListOptions): RunPackListResult {
  const diagnostics: Diagnostic[] = [];
  const output: string[] = [];

  const configFile = resolveConfigPath(options.projectDir);
  if (configFile === undefined) {
    return { exitCode: 0, diagnostics, output };
  }

  const raw = fs.readFileSync(configFile, "utf8");
  const config = parseJsonc(raw) as Record<string, unknown>;
  const packs = Array.isArray(config.packs) ? (config.packs as Array<{ name: string; version: string }>) : [];

  if (packs.length === 0) {
    return { exitCode: 0, diagnostics, output };
  }

  const nodeModules = path.join(options.projectDir, "node_modules");

  for (const pack of packs) {
    const installedVersion = readInstalledVersion(pack.name, nodeModules);
    const drifted = installedVersion !== undefined && installedVersion !== pack.version;
    const resourceCount = countResources(pack.name, nodeModules);

    output.push(`${pack.name} | ${pack.version} | ${installedVersion ?? "not installed"} | ${resourceCount} | ${drifted ? "yes" : "no"}`);

    if (drifted) {
      diagnostics.push({
        severity: "warn",
        code: "ERR_PACK_VERSION_DRIFT",
        message: `Pack version drift: ${pack.name} installed ${installedVersion}, configured ${pack.version}`,
        details: { name: pack.name, configuredVersion: pack.version, installedVersion },
      });
    }
  }

  const exitCode: 0 | 1 | 2 = diagnostics.some((d) => d.severity === "error")
    ? 1
    : diagnostics.some((d) => d.severity === "warn")
      ? 2
      : 0;

  return { exitCode, diagnostics, output };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConfigPath(projectDir: string): string | undefined {
  const jsonPath = path.join(projectDir, ".0xcraft", "config.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  const jsoncPath = path.join(projectDir, ".0xcraft", "config.jsonc");
  if (fs.existsSync(jsoncPath)) return jsoncPath;
  return undefined;
}

function resolveVersion(packageName: string, version: string, projectDir: string): string {
  // If version looks like a SemVer range (starts with ^, ~, >, <, or has spaces), resolve installed
  if (/^[^0-9*]/.test(version) || version.includes(" ")) {
    const nodeModules = path.join(projectDir, "node_modules");
    const installed = readInstalledVersion(packageName, nodeModules);
    if (installed !== undefined) return installed;
  }
  return version;
}

function readInstalledVersion(packName: string, nodeModules: string): string | undefined {
  const packDir = path.join(nodeModules, ...packName.split("/"));
  const pkgJsonPath = path.join(packDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function countResources(packName: string, nodeModules: string): number {
  try {
    const resources = resolvePackResources(packName, nodeModules);
    return resources.length;
  } catch {
    // Pack not installed or manifest missing
    return 0;
  }
}

function reportDiagnostic(d: Diagnostic): void {
  const line = `[0xcraft] ${d.severity.toUpperCase()} ${d.code} — ${d.message}`;
  if (d.severity === "error" || d.severity === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}
