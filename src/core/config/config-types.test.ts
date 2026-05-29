import { describe, expect, it } from "bun:test";
import {
  defaultConfig,
  mergeConfig,
  type PartialZeroxCraftConfig,
  type ZeroxCraftConfig,
} from "./config-types";

describe("defaultConfig (nested-only, T-12.8)", () => {
  it("does not contain any legacy flat keys", () => {
    const cfg = defaultConfig as unknown as Record<string, unknown>;
    expect(cfg).not.toHaveProperty("disabledHooks");
    expect(cfg).not.toHaveProperty("disabledSkills");
    expect(cfg).not.toHaveProperty("enabledSkills");
    expect(cfg).not.toHaveProperty("disabledAgents");
    expect(cfg).not.toHaveProperty("enabledAgents");
    expect(cfg).not.toHaveProperty("customAgentPaths");
    expect(cfg).not.toHaveProperty("agentModelOverrides");
    expect(cfg).not.toHaveProperty("agentModelOverridesByHarness");
    expect(cfg).not.toHaveProperty("codexHookRuntime");
    expect(cfg).not.toHaveProperty("codexSkillsDir");
  });

  it("has empty id-list buckets in disabled/enabled/customPaths", () => {
    expect(defaultConfig.disabled.hooks).toEqual([]);
    expect(defaultConfig.disabled.skills).toEqual([]);
    expect(defaultConfig.disabled.agents).toEqual([]);
    expect(defaultConfig.disabled.mcp).toEqual([]);
    expect(defaultConfig.enabled.skills).toEqual([]);
    expect(defaultConfig.enabled.agents).toEqual([]);
    expect(defaultConfig.customPaths.agents).toEqual([]);
  });

  it("seeds platform hookRuntime defaults to 'bun'", () => {
    expect(defaultConfig.platforms.codex?.hookRuntime).toBe("bun");
    expect(defaultConfig.platforms["claude-code"]?.hookRuntime).toBe("bun");
  });

  it("leaves platforms.codex.skillsDir undefined by default", () => {
    expect(defaultConfig.platforms.codex?.skillsDir).toBeUndefined();
  });
});

describe("mergeConfig (nested-only, T-12.8)", () => {
  it("dedup-unions disabled.hooks", () => {
    const merged = mergeConfig({
      disabled: { agents: [], skills: [], hooks: ["caveman-bootstrap", "caveman-bootstrap"], commands: [], mcp: [] },
    });
    expect(merged.disabled.hooks).toEqual(["caveman-bootstrap"]);
  });

  it("preserves platforms.codex.hookRuntime override", () => {
    const merged = mergeConfig({ platforms: { codex: { hookRuntime: "node" } } });
    expect(merged.platforms.codex?.hookRuntime).toBe("node");
  });

  it("copies platforms.codex.skillsDir when provided", () => {
    const merged = mergeConfig({ platforms: { codex: { skillsDir: "/tmp/skills" } } });
    expect(merged.platforms.codex?.skillsDir).toBe("/tmp/skills");
  });

  it("shallow-merges platformModelOverrides per platform without dropping defaults", () => {
    const user: PartialZeroxCraftConfig = {
      platformModelOverrides: { opencode: { "team-lead": "anthropic/claude-opus-4" } },
    };
    const merged = mergeConfig(user);
    expect(merged.platformModelOverrides?.opencode?.["team-lead"]).toBe(
      "anthropic/claude-opus-4",
    );
  });

  it("shallow-merges platforms per id without dropping defaults", () => {
    const merged = mergeConfig({ platforms: { codex: { hookRuntime: "node" } } });
    expect(merged.platforms.codex?.hookRuntime).toBe("node");
    expect(merged.platforms["claude-code"]?.hookRuntime).toBe("bun");
  });
});
