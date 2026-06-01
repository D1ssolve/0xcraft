import { z } from "zod";

const SCHEMA_ID = "0xcraft.config.v1" as const;

const DEFAULT_ENABLED = { agents: [] as string[], skills: [] as string[] };
const DEFAULT_DISABLED = {
  agents: [] as string[],
  skills: [] as string[],
  hooks: [] as string[],
  mcpServers: [] as string[],
};
const DEFAULT_CODEX_PLATFORM = {
  agents: {} as Record<string, z.infer<typeof codexAgentExtensionSchema>>,
  mcpExtensions: {} as Record<string, z.infer<typeof codexMcpExtensionSchema>>,
  permissionProfiles: {} as Record<string, z.infer<typeof codexPermissionProfileSchema>>,
  emitPlugin: false,
  emitMarketplace: false,
  emitApps: false,
  permissionsBeta: false,
  hooksEmitMode: "hooks.json" as const,
  mcpEnvelope: "wrapped" as const,
};
const DEFAULT_PLATFORMS = { codex: DEFAULT_CODEX_PLATFORM, claude: {}, opencode: {} };

const stringArraySchema = z.array(z.string());

const enabledSchema = z
  .object({
    agents: stringArraySchema.default([]),
    skills: stringArraySchema.default([]),
  })
  .strict();

const disabledSchema = z
  .object({
    agents: stringArraySchema.default([]),
    skills: stringArraySchema.default([]),
    hooks: stringArraySchema.default([]),
    mcpServers: stringArraySchema.default([]),
  })
  .strict();

const outSchema = z
  .object({
    opencode: z.string().optional(),
    claudeCode: z.string().optional(),
    codex: z.string().optional(),
  })
  .strict();

const packSchema = z
  .object({
    name: z.string(),
    version: z.string(),
  })
  .strict();

const codexAgentExtensionSchema = z
  .object({
    model: z.string().optional(),
    model_reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    nickname_candidates: z.array(z.string()).optional(),
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
    cwd: z.string().optional(),
    env_vars: z.array(z.union([
      z.string(),
      z.object({
        name: z.string(),
        source: z.string().optional(),
      }).strict(),
    ])).optional(),
    bearer_token_env_var: z.string().optional(),
    env_http_headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const codexPermissionProfileSchema = z
  .object({
    sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    approval_policy: z.enum(["never", "on-request", "untrusted"]).optional(),
  })
  .strict();

const codexPlatformSchema = z
  .object({
    agents: z.record(z.string(), codexAgentExtensionSchema).default({}),
    mcpExtensions: z.record(z.string(), codexMcpExtensionSchema).default({}),
    permissionProfiles: z.record(z.string(), codexPermissionProfileSchema).default({}),
    emitPlugin: z.boolean().default(false),
    emitMarketplace: z.boolean().default(false),
    emitApps: z.boolean().default(false),
    permissionsBeta: z.boolean().default(false),
    hooksEmitMode: z.enum(["hooks.json", "config-inline"]).default("hooks.json"),
    mcpEnvelope: z.enum(["wrapped", "direct"]).default("wrapped"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.emitMarketplace === true && value.emitPlugin !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ERR_MARKETPLACE_REQUIRES_PLUGIN: platforms.codex.emitMarketplace requires platforms.codex.emitPlugin=true",
        path: ["emitMarketplace"],
      });
    }
  });

const platformsSchema = z
  .object({
    codex: codexPlatformSchema.default(DEFAULT_CODEX_PLATFORM),
    claude: z.object({}).strict().default({}),
    opencode: z.object({}).strict().default({}),
  })
  .strict();

const diagnosticsSchema = z
  .object({
    strict: z.boolean().optional(),
    codes: z.record(z.string(), z.enum(["error", "warn", "info", "off"])).optional(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    schema: z.literal(SCHEMA_ID).default(SCHEMA_ID),
    sourceRoot: z.string().default("."),
    out: outSchema.default({}),
    enabled: enabledSchema.default(DEFAULT_ENABLED),
    disabled: disabledSchema.default(DEFAULT_DISABLED),
    packs: z.array(packSchema).default([]),
    platforms: platformsSchema.default(DEFAULT_PLATFORMS),
    diagnostics: diagnosticsSchema.default({}),
  })
  .strict();

export type ZeroxCraftConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: ZeroxCraftConfig = ConfigSchema.parse({});

export const zeroxCraftConfigSchema = ConfigSchema;

export type ZeroxCraftConfigInput = z.input<typeof ConfigSchema>;
export type ZeroxCraftConfigParsed = ZeroxCraftConfig;
export type CodexPlatformConfig = ZeroxCraftConfig["platforms"]["codex"];
export type ClaudePlatformConfig = ZeroxCraftConfig["platforms"]["claude"];
export type OpencodePlatformConfig = ZeroxCraftConfig["platforms"]["opencode"];
