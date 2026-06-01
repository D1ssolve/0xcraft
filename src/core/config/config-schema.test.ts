import { describe, expect, test } from "bun:test";

import { ConfigSchema, DEFAULT_CONFIG, zeroxCraftConfigSchema } from "./config-schema";

describe("ConfigSchema", () => {
  test("parses the v3 default config", () => {
    const parsed = ConfigSchema.parse({});

    expect(parsed).toEqual(DEFAULT_CONFIG);
    expect(parsed.schema).toBe("0xcraft.config.v1");
    expect(parsed.sourceRoot).toBe(".");
    expect(parsed.enabled).toEqual({ agents: [], skills: [] });
    expect(parsed.disabled).toEqual({ agents: [], skills: [], hooks: [], mcpServers: [] });
    expect(parsed.packs).toEqual([]);
    expect(parsed.platforms).toEqual({
      codex: {
        agents: {},
        mcpExtensions: {},
        permissionProfiles: {},
        emitPlugin: false,
        emitMarketplace: false,
        emitApps: false,
        permissionsBeta: false,
        hooksEmitMode: "hooks.json",
        mcpEnvelope: "wrapped",
        nonInteractive: false,
      },
      claude: {},
      opencode: {},
    });
  });

  test("keeps the v2 schema export alias during the v3 swap", () => {
    expect(zeroxCraftConfigSchema).toBe(ConfigSchema);
  });

  test("parses all accepted top-level v3 keys", () => {
    const parsed = ConfigSchema.parse({
      schema: "0xcraft.config.v1",
      sourceRoot: "src/agents",
      out: { opencode: "dist/opencode", claudeCode: "dist/claude", codex: "dist/codex" },
      enabled: { agents: ["code-explorer"], skills: ["tdd"] },
      disabled: {
        agents: ["legacy-agent"],
        skills: ["legacy-skill"],
        hooks: ["legacy-hook"],
        mcpServers: ["legacy-mcp"],
      },
      packs: [{ name: "@0xcraft/agents-pack", version: "1.0.0" }],
      platforms: {
        opencode: {},
        claude: {},
        codex: {
          agents: {
            explorer: {
              model: "opus",
              model_reasoning_effort: "high",
              nickname_candidates: ["explorer"],
              skills: { config: { compact: true } },
            },
          },
          mcpExtensions: {
            docs: {
              cwd: "/tmp",
              env_vars: ["HOME"],
              bearer_token_env_var: "DOCS_TOKEN",
              env_http_headers: { Authorization: "DOCS_AUTH" },
            },
          },
          permissionProfiles: {
            readonly: { sandbox_mode: "read-only", approval_policy: "never" },
          },
          emitPlugin: true,
          emitMarketplace: true,
          emitApps: true,
          permissionsBeta: true,
          hooksEmitMode: "config-inline",
          mcpEnvelope: "direct",
          nonInteractive: true,
        },
      },
      diagnostics: {
        strict: true,
        codes: {
          ERR_UNKNOWN_TOML_KEY: "error",
          INFO_MISSING_PLATFORM_SIBLING: "off",
        },
      },
    });

    expect(parsed.sourceRoot).toBe("src/agents");
    expect(parsed.out.codex).toBe("dist/codex");
    expect(parsed.packs).toEqual([{ name: "@0xcraft/agents-pack", version: "1.0.0" }]);
    expect(parsed.platforms.codex.emitMarketplace).toBe(true);
    expect(parsed.platforms.codex.agents.explorer?.model).toBe("opus");
    expect(parsed.platforms.codex.hooksEmitMode).toBe("config-inline");
    expect(parsed.platforms.codex.mcpEnvelope).toBe("direct");
    expect(parsed.diagnostics.codes?.ERR_UNKNOWN_TOML_KEY).toBe("error");
  });

  test("rejects emitMarketplace without emitPlugin", () => {
    expect(() =>
      ConfigSchema.parse({ platforms: { codex: { emitMarketplace: true, emitPlugin: false } } }),
    ).toThrow(/ERR_MARKETPLACE_REQUIRES_PLUGIN/);
  });

  test("rejects flat aliases and unknown top-level keys", () => {
    const firstAgentFlatAlias = `disabled${"Agents"}`;
    const secondAgentFlatAlias = `enabled${"Agents"}`;
    for (const key of [
      firstAgentFlatAlias,
      "disabledSkills",
      "disabledHooks",
      "disabledMcpServers",
      secondAgentFlatAlias,
      "enabledSkills",
      "customPaths",
    ]) {
      expect(() => ConfigSchema.parse({ [key]: [] })).toThrow();
    }
  });

  test("rejects unknown nested keys in strict objects", () => {
    expect(() => ConfigSchema.parse({ enabled: { agents: [], hooks: [] } })).toThrow();
    expect(() => ConfigSchema.parse({ disabled: { commands: [] } })).toThrow();
    expect(() => ConfigSchema.parse({ packs: [{ name: "x", version: "1", source: "npm" }] })).toThrow();
    expect(() => ConfigSchema.parse({ platforms: { codex: { skillsDir: "skills" } } })).toThrow();
    expect(() => ConfigSchema.parse({ platforms: { claude: { mode: "plugin" } } })).toThrow();
    expect(() => ConfigSchema.parse({ platforms: { opencode: { plugin: true } } })).toThrow();
    expect(() => ConfigSchema.parse({ diagnostics: { json: true } })).toThrow();
  });
});
