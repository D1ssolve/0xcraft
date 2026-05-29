/**
 * Harness-aware 0xcraft config loader — nested-only (T-12.8).
 *
 * Merge order (right wins):
 *   default → globalUnified → globalHarness → localUnified → localHarness
 *   → cliOverrides
 *
 * Per-harness path selection — see `getConfigPaths`:
 *   opencode    : globalUnified, ~/.config/opencode/0xcraft.{json,jsonc},
 *                 <proj>/.0xcraft/config.{json,jsonc} or <proj>/0xcraft.{json,jsonc},
 *                 <proj>/.opencode/0xcraft.{json,jsonc}
 *   claude-code : globalUnified, ~/.claude/0xcraft.{json,jsonc} or ~/.config/claude/0xcraft.{json,jsonc},
 *                 localUnified, <proj>/.claude/0xcraft.{json,jsonc}
 *   codex       : globalUnified, ~/.codex/0xcraft.{json,jsonc},
 *                 localUnified, <proj>/.codex/0xcraft.{json,jsonc}
 *
 * globalUnified = ~/.config/0xcraft/config.{json,jsonc}
 * localUnified  = <proj>/.0xcraft/config.{json,jsonc} or <proj>/0xcraft.{json,jsonc}
 *
 * Both `.json` and `.jsonc` are probed at every candidate location.
 *
 * Diagnostics use the canonical `Diagnostic` shape. No throws. Strict
 * Zod (`.strict()` on every object) rejects legacy flat keys with
 * `unrecognized_keys` issues that surface as `config.validation.failed`
 * diagnostics.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Diagnostic } from "../diagnostics/diagnostic";
import {
  defaultConfig,
  mergeConfig,
  type PlatformId,
  type ZeroxCraftConfig,
  type PartialZeroxCraftConfig,
} from "./config-types";
import { zeroxCraftConfigSchema } from "./config-schema";

/* ------------------------------------------------------------------ */
/*  JSONC parser                                                        */
/* ------------------------------------------------------------------ */

/** Strip JSONC comments and trailing commas for safe `JSON.parse`. */
export function stripJsonc(input: string): string {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // String literal — pass through verbatim
    if (ch === '"') {
      if (inString) {
        let backslashes = 0;
        let k = i - 1;
        while (k >= 0 && input[k] === "\\") { backslashes++; k--; }
        if (backslashes % 2 === 1) {
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
      i += 2;
      continue;
    }

    // Trailing comma
    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && (input[j] === " " || input[j] === "\t" || input[j] === "\n" || input[j] === "\r")) {
        j++;
      }
      if (j < input.length && (input[j] === "}" || input[j] === "]")) {
        i++;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/** Parse JSONC string to object. */
export function parseJsonc(input: string): Record<string, unknown> {
  return JSON.parse(stripJsonc(input));
}

/* ------------------------------------------------------------------ */
/*  Detail sanitization                                                 */
/* ------------------------------------------------------------------ */

const SECRET_KEY_RE = /token|secret|password|authorization|cookie|key/i;

/**
 * Recursively redact diagnostic-detail values whose keys look secret-bearing.
 * Pure: never throws, returns a fresh object.
 */
export function sanitizeDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDetails);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = sanitizeDetails(v);
      }
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/*  Path selection                                                      */
/* ------------------------------------------------------------------ */

export type ConfigSourceKind =
  | "global-unified"
  | "global-harness"
  | "local-unified"
  | "local-harness";

export interface ConfigPathCandidate {
  /** Path stem without extension (we append `.json` / `.jsonc`). */
  stem: string;
  kind: ConfigSourceKind;
}

export function getConfigPaths(
  harness: PlatformId,
  projectRoot: string,
  homeDir: string,
): ConfigPathCandidate[] {
  const globalUnified: ConfigPathCandidate[] = [
    { stem: path.join(homeDir, ".config", "0xcraft", "config"), kind: "global-unified" },
  ];
  const localUnified: ConfigPathCandidate[] = [
    { stem: path.join(projectRoot, ".0xcraft", "config"), kind: "local-unified" },
    { stem: path.join(projectRoot, "0xcraft"), kind: "local-unified" },
  ];

  let globalHarness: ConfigPathCandidate[];
  let localHarness: ConfigPathCandidate[];

  switch (harness) {
    case "opencode":
      globalHarness = [
        { stem: path.join(homeDir, ".config", "opencode", "0xcraft"), kind: "global-harness" },
      ];
      localHarness = [
        { stem: path.join(projectRoot, ".opencode", "0xcraft"), kind: "local-harness" },
      ];
      break;
    case "claude-code":
      globalHarness = [
        { stem: path.join(homeDir, ".claude", "0xcraft"), kind: "global-harness" },
        { stem: path.join(homeDir, ".config", "claude", "0xcraft"), kind: "global-harness" },
      ];
      localHarness = [
        { stem: path.join(projectRoot, ".claude", "0xcraft"), kind: "local-harness" },
      ];
      break;
    case "codex":
      globalHarness = [
        { stem: path.join(homeDir, ".codex", "0xcraft"), kind: "global-harness" },
      ];
      localHarness = [
        { stem: path.join(projectRoot, ".codex", "0xcraft"), kind: "local-harness" },
      ];
      break;
  }

  return [...globalUnified, ...globalHarness, ...localUnified, ...localHarness];
}

/* ------------------------------------------------------------------ */
/*  Env interpolation                                                   */
/* ------------------------------------------------------------------ */

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Recursively interpolate `${VAR}` and `${VAR:-fallback}` placeholders
 * inside string values. Records every unresolved `${VAR}` (no fallback)
 * once as a `config.env.missing` diagnostic.
 */
function interpolateEnv(
  value: unknown,
  env: NodeJS.ProcessEnv,
  diagnostics: Diagnostic[],
  missing: Set<string>,
): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_RE, (_match, name: string, fallback?: string) => {
      const resolved = env[name];
      if (resolved !== undefined) return resolved;
      if (fallback !== undefined) return fallback;
      if (!missing.has(name)) {
        missing.add(name);
        diagnostics.push({
          severity: "warn",
          code: "config.env.missing",
          message: `Environment variable "${name}" referenced in config is not set.`,
          details: { variable: name },
        });
      }
      return "";
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v, env, diagnostics, missing));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateEnv(v, env, diagnostics, missing);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/*  Candidate reader                                                    */
/* ------------------------------------------------------------------ */

/** Sanitize parser error messages — strip quoted content. */
function sanitizeError(err: unknown): string {
  const errorName = err instanceof Error && err.name ? err.name : undefined;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const redacted = rawMessage.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, (_m, quote: string) => {
    return `${quote}[redacted]${quote}`;
  });
  if (!errorName || redacted.startsWith(`${errorName}:`)) return redacted;
  return `${errorName}: ${redacted}`;
}

function readCandidate(
  candidate: ConfigPathCandidate,
  diagnostics: Diagnostic[],
): { config: Record<string, unknown>; sourcePath: string } | null {
  for (const ext of [".jsonc", ".json"]) {
    const fullPath = candidate.stem + ext;
    let exists: boolean;
    try {
      exists = fs.existsSync(fullPath);
    } catch (err) {
      diagnostics.push({
        severity: "warn",
        code: "config.path.unreadable",
        message: `Cannot stat config path "${fullPath}": ${sanitizeError(err)}`,
        details: { path: fullPath, kind: candidate.kind },
      });
      continue;
    }
    if (!exists) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      return { config: parseJsonc(content), sourcePath: fullPath };
    } catch (err) {
      // Distinguish unreadable file from parse failure.
      if (err instanceof Error && /ENOENT|EACCES|EISDIR|EPERM/.test(err.message)) {
        diagnostics.push({
          severity: "warn",
          code: "config.path.unreadable",
          message: `Cannot read config file "${fullPath}": ${sanitizeError(err)}`,
          details: { path: fullPath, kind: candidate.kind },
        });
      } else {
        diagnostics.push({
          severity: "warn",
          code: "config.parse.failed",
          message: `Failed to parse config file "${fullPath}": ${sanitizeError(err)}`,
          details: { path: fullPath, kind: candidate.kind },
        });
      }
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  loadConfig — public, nested-only                                    */
/* ------------------------------------------------------------------ */

export interface LoadConfigOptions {
  harness: PlatformId;
  projectRoot?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  diagnosticSink?: (d: Diagnostic) => void;
  /** Optional CLI overrides applied last (highest priority). */
  cliOverrides?: PartialZeroxCraftConfig;
}

export interface LoadConfigResult {
  /** Canonical nested shape (spec §3, ADR §2). */
  config: ZeroxCraftConfig;
  diagnostics: Diagnostic[];
  sources: string[];
}

/**
 * Load + merge 0xcraft config for a specific harness.
 *
 * Returns the canonical nested `ZeroxCraftConfig`. Unknown / legacy
 * flat keys are rejected by strict Zod and surface as
 * `config.validation.failed` diagnostics; the loader falls back to
 * `mergeConfig({})` (= `defaultConfig`) in that case.
 */
export function loadConfig(options: LoadConfigOptions): LoadConfigResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;

  const diagnostics: Diagnostic[] = [];
  const sources: string[] = [];

  const candidates = getConfigPaths(options.harness, projectRoot, homeDir);

  let accumulator: Record<string, unknown> = {};

  for (const candidate of candidates) {
    const result = readCandidate(candidate, diagnostics);
    if (!result) continue;

    sources.push(result.sourcePath);

    // Env interpolation.
    const missing = new Set<string>();
    const interpolated = interpolateEnv(result.config, env, diagnostics, missing) as Record<
      string,
      unknown
    >;

    accumulator = shallowMerge(accumulator, interpolated);
  }

  // CLI overrides — applied last, must be nested-shaped.
  if (options.cliOverrides !== undefined) {
    accumulator = shallowMerge(accumulator, options.cliOverrides as Record<string, unknown>);
  }

  // Schema validation. Failures become diagnostics; we fall back to
  // `defaultConfig` for any sub-tree that doesn't parse.
  let parsed: ZeroxCraftConfig;
  const validation = zeroxCraftConfigSchema.safeParse(accumulator);
  if (validation.success) {
    parsed = mergeConfig(validation.data as PartialZeroxCraftConfig);
  } else {
    for (const issue of validation.error.issues) {
      diagnostics.push({
        severity: "error",
        code: "config.validation.failed",
        message: `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        details: sanitizeDetails({
          path: issue.path,
          code: issue.code,
        }) as Record<string, unknown>,
      });
    }
    parsed = mergeConfig({});
  }

  if (options.diagnosticSink) {
    for (const d of diagnostics) options.diagnosticSink(d);
  }

  return { config: parsed, diagnostics, sources };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Merge candidate config into the accumulator. Right wins for scalars,
 * arrays union with dedup, plain objects shallow-merge.
 */
function shallowMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    const baseValue = out[key];

    if (Array.isArray(baseValue) && Array.isArray(value)) {
      out[key] = [...new Set([...baseValue, ...value])];
      continue;
    }

    if (
      baseValue !== null &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = shallowMerge(
        baseValue as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Re-exports                                                          */
/* ------------------------------------------------------------------ */

export { defaultConfig };
export type { PlatformId };
