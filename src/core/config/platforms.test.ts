import { describe, expect, test } from "bun:test";

import { zeroxCraftConfigSchema } from "./config-schema";

describe("platforms.codex config schema", () => {
  test("parses platforms.codex.emitPlugin = true", () => {
    const parsed = zeroxCraftConfigSchema.parse({
      platforms: { codex: { emitPlugin: true } },
    });

    expect(parsed.platforms.codex?.emitPlugin).toBe(true);
  });

  test("parses all optional Codex platform booleans", () => {
    const parsed = zeroxCraftConfigSchema.parse({
      platforms: {
        codex: {
          emitPlugin: true,
          emitMarketplace: true,
          emitApps: true,
          permissionsBeta: true,
        },
      },
    });

    expect(parsed.platforms.codex).toMatchObject({
      emitPlugin: true,
      emitMarketplace: true,
      emitApps: true,
      permissionsBeta: true,
    });
  });

  test("Codex opt-in fields default to undefined", () => {
    const parsed = zeroxCraftConfigSchema.parse({});

    expect(parsed.platforms.codex?.emitPlugin).toBeUndefined();
    expect(parsed.platforms.codex?.emitMarketplace).toBeUndefined();
    expect(parsed.platforms.codex?.emitApps).toBeUndefined();
    expect(parsed.platforms.codex?.permissionsBeta).toBeUndefined();
  });

  test("rejects unknown key in platforms.codex", () => {
    expect(() =>
      zeroxCraftConfigSchema.parse({ platforms: { codex: { foo: 1 } } }),
    ).toThrow();
  });

  test("rejects unknown harness under platforms", () => {
    expect(() =>
      zeroxCraftConfigSchema.parse({ platforms: { unknownHarness: {} } }),
    ).toThrow();
  });

  test("flat-alias rejection unchanged", () => {
    expect(() => zeroxCraftConfigSchema.parse({ disabledAgents: [] })).toThrow();
  });

  test("parses platforms.codex.agents extension fields", () => {
    const parsed = zeroxCraftConfigSchema.parse({
      platforms: {
        codex: {
          agents: {
            "code-explorer": {
              model_reasoning_effort: "high",
              nickname_candidates: ["explorer", "ce"],
              skills: { config: { foo: "bar" } },
            },
          },
        },
      },
    });
    expect(parsed.platforms.codex?.agents?.["code-explorer"]).toMatchObject({
      model_reasoning_effort: "high",
      nickname_candidates: ["explorer", "ce"],
      skills: { config: { foo: "bar" } },
    });
  });

  test("rejects unknown model_reasoning_effort value", () => {
    expect(() =>
      zeroxCraftConfigSchema.parse({
        platforms: { codex: { agents: { x: { model_reasoning_effort: "ultra" } } } },
      }),
    ).toThrow();
  });

  test("parses platforms.codex.mcpExtensions", () => {
    const parsed = zeroxCraftConfigSchema.parse({
      platforms: {
        codex: {
          mcpExtensions: {
            srv: {
              cwd: "/tmp",
              env_vars: ["HOME", "PATH"],
              bearer_token_env_var: "TOKEN",
              env_http_headers: { "X-Trace": "TRACE_ID" },
            },
          },
        },
      },
    });
    expect(parsed.platforms.codex?.mcpExtensions?.srv).toMatchObject({
      cwd: "/tmp",
      env_vars: ["HOME", "PATH"],
      bearer_token_env_var: "TOKEN",
      env_http_headers: { "X-Trace": "TRACE_ID" },
    });
  });

  test("parses platforms.codex.permissionProfiles", () => {
    const parsed = zeroxCraftConfigSchema.parse({
      platforms: {
        codex: {
          permissionProfiles: {
            "read-only-profile": { sandbox_mode: "read-only", approval_policy: "never" },
          },
        },
      },
    });
    expect(parsed.platforms.codex?.permissionProfiles?.["read-only-profile"]).toEqual({
      sandbox_mode: "read-only",
      approval_policy: "never",
    });
  });

  test("rejects approval_policy: 'on-failure' in permission profile", () => {
    expect(() =>
      zeroxCraftConfigSchema.parse({
        platforms: {
          codex: {
            permissionProfiles: { p: { approval_policy: "on-failure" } },
          },
        },
      }),
    ).toThrow();
  });
});
