import { describe, expect, test } from "bun:test";

import { defaultConfig, mergeConfig } from "./config-types";

describe("v3 config-types compatibility exports", () => {
  test("defaultConfig aliases DEFAULT_CONFIG", () => {
    expect(defaultConfig.schema).toBe("0xcraft.config.v1");
    expect(defaultConfig.platforms.codex.emitPlugin).toBe(false);
  });

  test("mergeConfig validates and applies v3 defaults", () => {
    const merged = mergeConfig({ platforms: { codex: { emitPlugin: true } } });

    expect(merged.enabled).toEqual({ agents: [], skills: [] });
    expect(merged.platforms.codex.emitPlugin).toBe(true);
    expect(merged.platforms.codex.emitMarketplace).toBe(false);
  });
});
