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
export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

export type DiagnosticSink = (event: DiagnosticEvent) => void;

export interface LoadConfigOptions {
  diagnosticSink?: DiagnosticSink;
}

export function stripJsonc(input: string): string {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // String literal — pass through verbatim
    if (ch === '"') {
      // Check for escaped quote (but not an escaped backslash before the quote)
      if (inString) {
        let backslashes = 0;
        let k = i - 1;
        while (k >= 0 && input[k] === "\\") { backslashes++; k--; }
        if (backslashes % 2 === 1) {
          // Odd number of backslashes → quote is escaped, stay in string
          result += ch;
          i++;
          continue;
        }
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

    // Trailing comma: skip if next non-whitespace is } or ]
    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && (input[j] === " " || input[j] === "\t" || input[j] === "\n" || input[j] === "\r")) {
        j++;
      }
      if (j < input.length && (input[j] === "}" || input[j] === "]")) {
        i++; // skip the comma
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/** Parse JSONC string to object */
export function parseJsonc(input: string): Record<string, unknown> {
  const stripped = stripJsonc(input);
  return JSON.parse(stripped);
}

function sanitizeConfigErrorMessage(err: unknown): string {
  const errorName = err instanceof Error && err.name ? err.name : undefined;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const redactedMessage = rawMessage.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, (_match, quote: string) => {
    return `${quote}[redacted]${quote}`;
  });

  if (!errorName || redactedMessage.startsWith(`${errorName}:`)) {
    return redactedMessage;
  }

  return `${errorName}: ${redactedMessage}`;
}

function reportConfigParseFailure(
  fullPath: string,
  err: unknown,
  diagnosticSink?: DiagnosticSink,
): void {
  const errorMessage = sanitizeConfigErrorMessage(err);
  const message = `Failed to parse config file "${fullPath}"`;

  if (diagnosticSink) {
    diagnosticSink({
      level: "warn",
      code: "config.parse.failed",
      message,
      extra: {
        path: fullPath,
        errorMessage,
      },
    });
    return;
  }

  console.warn(`[0xcraft] ${message}: ${errorMessage}`);
}

/** Read and parse a JSONC file, returning null if it doesn't exist */
function readConfigFile(filePath: string, options: LoadConfigOptions = {}): Record<string, unknown> | null {
  for (const ext of [".jsonc", ".json"]) {
    const fullPath = filePath + ext;
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        return parseJsonc(content);
      }
    } catch (err) {
      reportConfigParseFailure(fullPath, err, options.diagnosticSink);
    }
  }
  return null;
}

/**
 * Walk from startDir up to stopDir, collecting 0xcraft config files.
 * Closer configs override farther ones.
 */
function walkConfigs(startDir: string, stopDir: string, options: LoadConfigOptions = {}): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  let current = startDir;

  while (current && current !== path.dirname(current)) {
    const configPath = path.join(current, ".opencode", "0xcraft");
    const config = readConfigFile(configPath, options);
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
  homeDir?: string,
  options: LoadConfigOptions = {},
): { config: Record<string, unknown>; sources: string[] } {
  const home = homeDir ?? os.homedir();
  const startDir = projectDir || process.cwd();
  const sources: string[] = [];

  // 1. Walked configs (closest wins, so we reverse to merge far-to-near)
  const walkedConfigs = walkConfigs(startDir, home, options).reverse();
  if (walkedConfigs.length > 0) {
    sources.push(`walked: ${startDir} → ${home}`);
  }

  // 2. User config
  const userConfigPath = path.join(home, ".config", "opencode", "0xcraft");
  const userConfig = readConfigFile(userConfigPath, options);
  if (userConfig) {
    sources.push(`user: ${userConfigPath}`);
  }

  // Merge: defaults ← user ← walked (far to near). Project-local config wins.
  let merged: Record<string, unknown> = {};

  if (userConfig) {
    merged = deepMerge(merged, userConfig);
  }

  for (const walked of walkedConfigs) {
    merged = deepMerge(merged, walked);
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
