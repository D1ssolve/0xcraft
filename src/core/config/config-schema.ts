/**
 * Canonical Zod schemas for the nested `ZeroxCraftConfig` shape
 * (spec §3, ADR §2) — strict, unknown-key-rejecting (T-12.8).
 *
 * Pure types + schemas. No platform SDK imports, no filesystem,
 * no logging. Used by the config-loader for shape validation.
 *
 * Every object schema uses `.strict()` so legacy flat keys
 * (`disabledHooks`, `codexSkillsDir`, etc.) parse to `unrecognized_keys`
 * Zod issues rather than silently passing.
 */

import { z } from "zod";

import { permissionSpecSchema } from "../permission/permission-spec";
import { PLATFORM_IDS } from "../platform/platform-id";

/* ---------------------------------------------------------------- */
/*  Platform id                                                       */
/* ---------------------------------------------------------------- */

/**
 * Re-export so existing `config-schema` importers keep working.
 * Canonical definition lives in `core/platform/platform-id.ts`.
 */
export { PLATFORM_IDS };

/** Zod schema for `PlatformId`. */
export const platformIdSchema = z.enum(PLATFORM_IDS);

/* ---------------------------------------------------------------- */
/*  MCP server (canonical, transport-discriminated)                   */
/* ---------------------------------------------------------------- */

const mcpServerBaseFields = {
  id: z.string().optional(),
  description: z.string().optional(),
  enabledByDefault: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
} as const;

const mcpServerStdioSchema = z
  .object({
    ...mcpServerBaseFields,
    transport: z.literal("stdio"),
    command: z.array(z.string()),
  })
  .strict();

const mcpServerHttpSchema = z
  .object({
    ...mcpServerBaseFields,
    transport: z.literal("http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const mcpServerSseSchema = z
  .object({
    ...mcpServerBaseFields,
    transport: z.literal("sse"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const mcpServerSpecSchema = z.discriminatedUnion("transport", [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
  mcpServerSseSchema,
]);

/* ---------------------------------------------------------------- */
/*  Per-platform config (closed harness set)                          */
/* ---------------------------------------------------------------- */

// opencode currently has no platform-specific settings — strict empty
// object rejects any speculative keys until a real knob is added.
const opencodePlatformSchema = z.object({}).strict();

const claudeCodePlatformSchema = z
  .object({
    hookRuntime: z.enum(["bun", "node"]).optional(),
  })
  .strict();

const codexAgentExtensionSchema = z
  .object({
    /** Codex `model_reasoning_effort` — see ADR §3.3. */
    model_reasoning_effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    /** Free-text alternate names users can address the agent by. */
    nickname_candidates: z.array(z.string()).optional(),
    /** Skill-config payload forwarded verbatim into the agent TOML `skills.config` table. */
    skills: z
      .object({
        config: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const codexMcpExtensionSchema = z
  .object({
    /** Codex `cwd` override for stdio servers. */
    cwd: z.string().optional(),
    /** Names of host env vars forwarded to the server (Codex `env_vars`). */
    env_vars: z.array(z.string()).optional(),
    /** Env var holding the bearer token (Codex `bearer_token_env_var`, http only). */
    bearer_token_env_var: z.string().optional(),
    /** Header→env-var map for dynamic headers (Codex `env_http_headers`, http only). */
    env_http_headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const codexPermissionProfileSchema = z
  .object({
    sandbox_mode: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional(),
    /** Approval policy. Note: `on-failure` is intentionally excluded (deprecated per research). */
    approval_policy: z.enum(["never", "on-request", "untrusted"]).optional(),
  })
  .strict();

const codexPlatformSchema = z
  .object({
    skillsDir: z.string().optional(),
    hookRuntime: z.enum(["bun", "node"]).optional(),
    emitPlugin: z.boolean().optional(),
    emitMarketplace: z.boolean().optional(),
    emitApps: z.boolean().optional(),
    permissionsBeta: z.boolean().optional(),
    /** Per-agent Codex-only extension fields (agentId → extension). */
    agents: z.record(z.string(), codexAgentExtensionSchema).optional(),
    /** Per-MCP-server Codex-only extension fields (serverId → extension). */
    mcpExtensions: z.record(z.string(), codexMcpExtensionSchema).optional(),
    /** Beta `[permissions.<name>]` profiles. Only emitted when `permissionsBeta === true`. */
    permissionProfiles: z.record(z.string(), codexPermissionProfileSchema).optional(),
  })
  .strict();

const platformsSchema = z
  .object({
    opencode: opencodePlatformSchema.optional(),
    "claude-code": claudeCodePlatformSchema.optional(),
    codex: codexPlatformSchema.optional(),
  })
  .strict();

const platformModelOverridesSchema = z
  .object({
    opencode: z.record(z.string(), z.string()).optional(),
    "claude-code": z.record(z.string(), z.string()).optional(),
    codex: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/* ---------------------------------------------------------------- */
/*  Top-level nested config                                           */
/* ---------------------------------------------------------------- */

export const zeroxCraftConfigSchema = z
  .object({
    /** Disabled-by-id buckets. */
    disabled: z
      .object({
        hooks: z.array(z.string()).default([]),
        skills: z.array(z.string()).default([]),
        agents: z.array(z.string()).default([]),
        commands: z.array(z.string()).default([]),
        mcp: z.array(z.string()).default([]),
      })
      .strict()
      .default({ hooks: [], skills: [], agents: [], commands: [], mcp: [] }),

    /** Whitelist buckets (empty = all). */
    enabled: z
      .object({
        skills: z.array(z.string()).default([]),
        agents: z.array(z.string()).default([]),
        commands: z.array(z.string()).default([]),
      })
      .strict()
      .default({ skills: [], agents: [], commands: [] }),

    /** Custom directories scanned in addition to builtins. */
    customPaths: z
      .object({
        agents: z.array(z.string()).default([]),
        skills: z.array(z.string()).default([]),
        commands: z.array(z.string()).default([]),
      })
      .strict()
      .default({ agents: [], skills: [], commands: [] }),

    /** Per-agent model overrides applied across all platforms. */
    modelOverrides: z.record(z.string(), z.string()).default({}),

    /** Per-platform per-agent model overrides (override `modelOverrides`). */
    platformModelOverrides: platformModelOverridesSchema.optional(),

    /** Per-platform settings (skillsDir, hookRuntime, ...). */
    platforms: platformsSchema.default({}),

    /** User-supplied MCP servers (id → spec). */
    mcpServers: z.record(z.string(), mcpServerSpecSchema).default({}),

    /** Optional permission overrides (canonical `PermissionSpec`). */
    permissions: permissionSpecSchema.optional(),
  })
  .strict();

export type ZeroxCraftConfigInput = z.input<typeof zeroxCraftConfigSchema>;
export type ZeroxCraftConfigParsed = z.output<typeof zeroxCraftConfigSchema>;
