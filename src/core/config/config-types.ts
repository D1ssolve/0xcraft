/**
 * 0xcraft configuration shapes — canonical nested form (T-12.8).
 *
 * The legacy flat shape (`disabledHooks`, `customAgentPaths`,
 * `codexHookRuntime`, …) has been removed. There is one shape now:
 * `ZeroxCraftConfig`. Disabling features is done via id lists in
 * `disabled.*`; per-platform settings live under `platforms.*`.
 */

import type { PermissionSpec } from "../permission/permission-spec";
import type { McpServerConfigEntry } from "../mcp/mcp-types";

/* ---------------------------------------------------------------- */
/*  Platform id                                                       */
/* ---------------------------------------------------------------- */

// Re-exported from the canonical `core/platform` module to keep one
// source of truth across `core/config`, `core/hooks`, and
// `core/diagnostics`. Existing imports of `PlatformId`/`PLATFORM_IDS`/
// `isPlatformId` from `core/config` stay working unchanged.
export { PLATFORM_IDS, type PlatformId, isPlatformId } from "../platform/platform-id";
import { PLATFORM_IDS } from "../platform/platform-id";

/* ---------------------------------------------------------------- */
/*  Per-platform sub-config                                           */
/* ---------------------------------------------------------------- */

/**
 * Per-platform settings. Closed-shape — each platform owns its keys.
 * `opencode` currently has no platform-specific knobs.
 */
export interface OpencodePlatformConfig {
  // reserved for future opencode-only settings
}
export interface ClaudeCodePlatformConfig {
  /** Runtime for emitted hook scripts. */
  hookRuntime?: "bun" | "node";
}
export interface CodexAgentExtension {
  /** Codex `model_reasoning_effort`. */
  model_reasoning_effort?: "minimal" | "low" | "medium" | "high";
  /** Free-text alternate names the user can address the agent by. */
  nickname_candidates?: string[];
  /** Forwarded verbatim into the agent TOML `skills.config` table. */
  skills?: {
    config?: Record<string, unknown>;
  };
}

export interface CodexMcpExtension {
  /** stdio `cwd` override. */
  cwd?: string;
  /** Names of host env vars to forward (`env_vars`). */
  env_vars?: string[];
  /** Env var holding the bearer token (http only). */
  bearer_token_env_var?: string;
  /** Header → env-var map for dynamic headers (http only). */
  env_http_headers?: Record<string, string>;
}

export interface CodexPermissionProfile {
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access";
  /** `on-failure` intentionally excluded — deprecated per research. */
  approval_policy?: "never" | "on-request" | "untrusted";
}

export interface CodexPlatformConfig {
  /** Hook script runtime selection (existing if present). */
  hookRuntime?: "bun" | "node";
  /** Output dir for emitted skills (relative to project root). */
  skillsDir?: string;
  /** Emit .codex-plugin/ filesystem plugin bundle. */
  emitPlugin?: boolean;
  /** Emit .agents/plugins/marketplace.json marketplace stub (requires emitPlugin). */
  emitMarketplace?: boolean;
  /** Emit apps section in plugin.json + .codex-plugin/.app.json (beta). */
  emitApps?: boolean;
  /** Use beta [permissions.<name>] profiles instead of sandbox_mode (NOT composable with sandbox_mode). */
  permissionsBeta?: boolean;
  /** Per-agent Codex-only extension fields (agentId → extension). */
  agents?: Record<string, CodexAgentExtension>;
  /** Per-MCP-server Codex-only extension fields (serverId → extension). */
  mcpExtensions?: Record<string, CodexMcpExtension>;
  /** Beta `[permissions.<name>]` profiles. Only emitted when `permissionsBeta === true`. */
  permissionProfiles?: Record<string, CodexPermissionProfile>;
}

export interface ZeroxCraftConfigPlatforms {
  opencode?: OpencodePlatformConfig;
  "claude-code"?: ClaudeCodePlatformConfig;
  codex?: CodexPlatformConfig;
}

export type PlatformsConfig = ZeroxCraftConfigPlatforms;

/* ---------------------------------------------------------------- */
/*  Canonical config shape                                            */
/* ---------------------------------------------------------------- */

export interface ZeroxCraftConfig {
  /** Disabled-by-id buckets. */
  disabled: {
    hooks: string[];
    skills: string[];
    agents: string[];
    commands: string[];
    mcp: string[];
  };
  /** Whitelist buckets (empty array = all enabled). */
  enabled: {
    skills: string[];
    agents: string[];
    commands: string[];
  };
  /** Custom directories scanned in addition to builtins. */
  customPaths: {
    agents: string[];
    skills: string[];
    commands: string[];
  };
  /** Per-agent model overrides applied across all platforms. */
  modelOverrides: Record<string, string>;
  /** Per-platform per-agent model overrides (override `modelOverrides`). */
  platformModelOverrides?: {
    opencode?: Record<string, string>;
    "claude-code"?: Record<string, string>;
    codex?: Record<string, string>;
  };
  /** Per-platform settings. */
  platforms: ZeroxCraftConfigPlatforms;
  /** User-supplied MCP servers, keyed by id. */
  mcpServers: Record<string, McpServerConfigEntry>;
  /** Optional permission overrides (canonical `PermissionSpec`). */
  permissions?: PermissionSpec;
}

/** Canonical defaults. */
export const defaultConfig: ZeroxCraftConfig = {
  disabled: { hooks: [], skills: [], agents: [], commands: [], mcp: [] },
  enabled: { skills: [], agents: [], commands: [] },
  customPaths: { agents: [], skills: [], commands: [] },
  modelOverrides: {},
  platforms: {
    "claude-code": { hookRuntime: "bun" },
    codex: { hookRuntime: "bun" },
  },
  mcpServers: {},
};

/* ---------------------------------------------------------------- */
/*  mergeConfig — nested-only                                         */
/* ---------------------------------------------------------------- */

function unionDedup(a: readonly string[], b: readonly string[] | undefined): string[] {
  return [...new Set([...a, ...(b ?? [])])];
}

/**
 * User-supplied partial config. Sub-shapes under `disabled`, `enabled`,
 * `customPaths`, `platforms`, `platformModelOverrides` are individually
 * partial so callers can pass `{ disabled: { hooks: ["x"] } }` without
 * spelling every bucket.
 */
export type PartialZeroxCraftConfig = {
  disabled?: Partial<ZeroxCraftConfig["disabled"]>;
  enabled?: Partial<ZeroxCraftConfig["enabled"]>;
  customPaths?: Partial<ZeroxCraftConfig["customPaths"]>;
  modelOverrides?: Record<string, string>;
  platformModelOverrides?: ZeroxCraftConfig["platformModelOverrides"];
  platforms?: PlatformsConfig;
  mcpServers?: Record<string, McpServerConfigEntry>;
  permissions?: PermissionSpec;
};

/**
 * Merge a user-supplied partial nested config onto `defaultConfig`.
 *
 * - String arrays are unioned + deduped.
 * - Records are shallow-merged (user wins per key).
 * - Sub-records under `disabled`, `enabled`, `customPaths`, `platforms`,
 *   `platformModelOverrides` are merged per-key.
 */
export function mergeConfig(user: PartialZeroxCraftConfig): ZeroxCraftConfig {
  const merged: ZeroxCraftConfig = {
    disabled: {
      hooks: unionDedup(defaultConfig.disabled.hooks, user.disabled?.hooks),
      skills: unionDedup(defaultConfig.disabled.skills, user.disabled?.skills),
      agents: unionDedup(defaultConfig.disabled.agents, user.disabled?.agents),
      commands: unionDedup(defaultConfig.disabled.commands, user.disabled?.commands),
      mcp: unionDedup(defaultConfig.disabled.mcp, user.disabled?.mcp),
    },
    enabled: {
      skills: unionDedup(defaultConfig.enabled.skills, user.enabled?.skills),
      agents: unionDedup(defaultConfig.enabled.agents, user.enabled?.agents),
      commands: unionDedup(defaultConfig.enabled.commands, user.enabled?.commands),
    },
    customPaths: {
      agents: unionDedup(defaultConfig.customPaths.agents, user.customPaths?.agents),
      skills: unionDedup(defaultConfig.customPaths.skills, user.customPaths?.skills),
      commands: unionDedup(defaultConfig.customPaths.commands, user.customPaths?.commands),
    },
    modelOverrides: { ...defaultConfig.modelOverrides, ...user.modelOverrides },
    platforms: mergePlatforms(defaultConfig.platforms, user.platforms),
    mcpServers: { ...defaultConfig.mcpServers, ...user.mcpServers },
  };

  if (user.platformModelOverrides !== undefined) {
    merged.platformModelOverrides = { ...user.platformModelOverrides };
  }

  if (user.permissions !== undefined) {
    merged.permissions = user.permissions;
  }

  return merged;
}

function mergePlatforms(
  base: PlatformsConfig,
  user: PlatformsConfig | undefined,
): PlatformsConfig {
  if (!user) return { ...base };
  const out: PlatformsConfig = { ...base };
  for (const id of PLATFORM_IDS) {
    const b = base[id];
    const u = user[id];
    if (b === undefined && u === undefined) continue;
    // Each platform sub-shape is a flat record of optional scalars;
    // shallow merge with user-wins semantics.
    out[id] = { ...(b ?? {}), ...(u ?? {}) } as PlatformsConfig[typeof id];
  }
  return out;
}
