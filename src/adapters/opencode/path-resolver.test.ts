import { describe, expect, test } from "bun:test";

import { FilesystemPathResolver, PluginPathResolver, createPathResolver } from "./path-resolver";

describe("FilesystemPathResolver", () => {
  const resolver = new FilesystemPathResolver();

  test("returns current filesystem OpenCode paths", () => {
    expect(resolver.mode).toBe("filesystem");
    expect(resolver.agentFile("reviewer")).toBe(".opencode/agents/reviewer.md");
    expect(resolver.agentReferencesDir("reviewer")).toBe(".opencode/agents/reviewer/references");
    expect(resolver.skillFile("tdd")).toBe(".opencode/skills/tdd/SKILL.md");
    expect(resolver.skillReferencesDir("tdd")).toBe(".opencode/skills/tdd/references");
    expect(resolver.commandFile("ship")).toBe(".opencode/commands/ship.md");
    expect(resolver.hookFile("audit-tools")).toBe(".opencode/plugins/audit-tools.js");
    expect(resolver.configFile()).toBe("opencode.json");
  });
});

describe("PluginPathResolver", () => {
  const resolver = new PluginPathResolver();

  test("returns package-relative OpenCode plugin paths", () => {
    expect(resolver.mode).toBe("plugin");
    expect(resolver.agentFile("reviewer")).toBe(".opencode-plugin/agents/reviewer.md");
    expect(resolver.agentReferencesDir("reviewer")).toBe(".opencode-plugin/agents/reviewer/references");
    expect(resolver.skillFile("tdd")).toBe(".opencode-plugin/skills/tdd/SKILL.md");
    expect(resolver.skillReferencesDir("tdd")).toBe(".opencode-plugin/skills/tdd/references");
    expect(resolver.commandFile("ship")).toBe(".opencode-plugin/commands/ship.md");
    expect(resolver.hookFile("audit-tools")).toBe(".opencode-plugin/index.js");
    expect(resolver.hookFile("another-hook")).toBe(".opencode-plugin/index.js");
    expect(resolver.configFile()).toBe(".opencode-plugin/package.json");
  });
});

describe("createPathResolver", () => {
  test("creates resolver for requested OpenCode emit mode", () => {
    expect(createPathResolver("filesystem")).toBeInstanceOf(FilesystemPathResolver);
    expect(createPathResolver("plugin")).toBeInstanceOf(PluginPathResolver);
  });
});
