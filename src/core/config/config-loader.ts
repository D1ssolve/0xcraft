import fs from "fs";
import path from "path";
import os from "os";

/**
 * JSONC config loader for 0xcraft.
 *
 * Walks config files from project root up to $HOME, merges onto user config,
 * then merges onto defaults. Supports JSONC (JSON with comments and trailing commas).
 *
 * Config search order (closest wins):
 * 1. Walked: <pwd up to $HOME>/.opencode/0xcraft.json[c]
 * 2. User: ~/.config/opencode/0xcraft.json[c]
 * 3. Defaults from ZeroxCraftConfig
 */

/** Strip JSONC comments and trailing commas for safe JSON.parse */
export function stripJsonc(input: string): string {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // String literal — pass through verbatim
    if (ch === '"') {
      // Check for escaped quote
      if (inString && i > 0 && input[i - 1] === "\\") {
        result += ch;
        i++;
        continue;
      }
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (inString) {
      result += ch;
      i++;
      continue;
    }

    // Single-line comment
    if (ch === "/" && i + 1 < input.length && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    // Multi-line comment
    if (ch === "/" && i + 1 < input.length && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && i + 1 < input.length && input[i + 1] === "/")) {
        i++;
      }
      i += 2; // skip */
      continue;
    }

    result += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, "$1");

  return result;
}

/** Parse JSONC string to object */
export function parseJsonc(input: string): Record<string, unknown> {
  const stripped = stripJsonc(input);
  return JSON.parse(stripped);
}

/** Read and parse a JSONC file, returning null if it doesn't exist */
function readConfigFile(filePath: string): Record<string, unknown> | null {
  for (const ext of [".jsonc", ".json"]) {
    const fullPath = filePath + ext;
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        return parseJsonc(content);
      }
    } catch {
      // Skip unreadable files
    }
  }
  return null;
}

/**
 * Walk from startDir up to stopDir, collecting 0xcraft config files.
 * Closer configs override farther ones.
 */
function walkConfigs(startDir: string, stopDir: string): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  let current = startDir;

  while (current && current !== path.dirname(current)) {
    const configPath = path.join(current, ".opencode", "0xcraft");
    const config = readConfigFile(configPath);
    if (config) {
      configs.push(config);
    }
    if (current === stopDir) break;
    current = path.dirname(current);
  }

  return configs;
}

/** Deep merge two objects. Arrays are concatenated and deduplicated. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (result[key] === undefined) {
      result[key] = value;
      continue;
    }

    const baseValue = result[key];

    // Arrays: concatenate and deduplicate
    if (Array.isArray(baseValue) && Array.isArray(value)) {
      result[key] = [...new Set([...baseValue, ...value])];
      continue;
    }

    // Objects: recurse
    if (
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    // Primitives: override replaces
    result[key] = value;
  }

  return result;
}

/**
 * Load 0xcraft configuration.
 *
 * Resolution order (closest wins):
 * 1. Walked project configs: <pwd up to $HOME>/.opencode/0xcraft.json[c]
 * 2. User config: ~/.config/opencode/0xcraft.json[c]
 * 3. Defaults from ZeroxCraftConfig
 */
export function loadConfig(
  projectDir?: string,
): { config: Record<string, unknown>; sources: string[] } {
  const home = os.homedir();
  const startDir = projectDir || process.cwd();
  const sources: string[] = [];

  // 1. Walked configs (closest wins, so we reverse to merge far-to-near)
  const walkedConfigs = walkConfigs(startDir, home).reverse();
  if (walkedConfigs.length > 0) {
    sources.push(`walked: ${startDir} → ${home}`);
  }

  // 2. User config
  const userConfigPath = path.join(home, ".config", "opencode", "0xcraft");
  const userConfig = readConfigFile(userConfigPath);
  if (userConfig) {
    sources.push(`user: ${userConfigPath}`);
  }

  // Merge: defaults ← walked (far to near) ← user
  let merged: Record<string, unknown> = {};

  for (const walked of walkedConfigs) {
    merged = deepMerge(merged, walked);
  }

  if (userConfig) {
    merged = deepMerge(merged, userConfig);
  }

  return { config: merged, sources };
}

/**
 * Validate config against ZeroxCraftConfig schema.
 * Returns the validated config with defaults applied.
 */
export function validateConfig(raw: Record<string, unknown>): {
  valid: boolean;
  config: Record<string, unknown>;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate enabledAgents / disabledAgents are string arrays
  for (const key of ["enabledAgents", "disabledAgents", "enabledSkills", "disabledSkills", "disabledHooks"]) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      errors.push(`${key} must be an array of strings`);
    }
  }

  // Validate modelOverrides / temperatureOverrides are objects
  for (const key of ["modelOverrides", "temperatureOverrides"]) {
    if (raw[key] !== undefined && (typeof raw[key] !== "object" || Array.isArray(raw[key]))) {
      errors.push(`${key} must be an object`);
    }
  }

  // Validate boolean flags
  for (const key of ["agentsGuardEnabled", "cavemanBootstrapEnabled", "gitWorktreeBootstrapEnabled"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      errors.push(`${key} must be a boolean`);
    }
  }

  // Validate mcpServers is an object
  if (raw.mcpServers !== undefined && (typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers))) {
    errors.push("mcpServers must be an object");
  }

  return {
    valid: errors.length === 0,
    config: raw,
    errors,
  };
}