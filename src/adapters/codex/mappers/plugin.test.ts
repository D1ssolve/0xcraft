import { describe, test, expect } from "bun:test";

import type { McpServerSpec } from "../../../core/mcp/mcp-types";
import type { SkillDefinition } from "../../../core/skills";
import type { CodexHookEntry } from "./hooks";

import { mapCodexPluginManifest } from "./plugin";

const skill = (id: string): SkillDefinition => ({
  id,
  name: id,
  description: `${id} description`,
  skillFile: `skills/${id}/SKILL.md`,
  tags: [],
});

const stdio = (id: string): McpServerSpec => ({
  id,
  description: `${id} mcp`,
  enabledByDefault: true,
  transport: "stdio",
  command: ["node", `${id}.js`, "--flag"],
  env: { TOKEN: "x" },
});

const http = (id: string): McpServerSpec => ({
  id,
  description: `${id} mcp`,
  enabledByDefault: true,
  transport: "http",
  url: `https://${id}.example/mcp`,
  headers: { Authorization: "Bearer y" },
});

const sse = (id: string): McpServerSpec => ({
  id,
  description: `${id} mcp`,
  enabledByDefault: true,
  transport: "sse",
  url: `https://${id}.example/sse`,
});

const hookEntry = (id: string): CodexHookEntry => ({
  hookId: id,
  codexEvent: "SessionStart",
  shim: "none",
  source: {
    id,
    name: id,
    description: `${id} desc`,
    event: "session.start",
    handler: { kind: "context-injection" },
    marker: `<!-- ${id} -->`,
  } as never,
});

describe("mapCodexPluginManifest", () => {
  test("emits minimum manifest with only name from packageMetadata", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: { name: "0xcraft" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
    });
    expect(m).toEqual({ name: "0xcraft" });
  });

  test("emits package metadata fields when present", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: {
        name: "0xcraft",
        version: "2.0.0",
        description: "desc",
        author: "Diss",
        homepage: "https://example.com",
        repository: "git+https://example.com/repo.git",
        license: "MIT",
        keywords: ["codex", "plugin"],
      },
      skills: [],
      mcpServers: [],
      hookEntries: [],
    });
    expect(m).toEqual({
      name: "0xcraft",
      version: "2.0.0",
      description: "desc",
      author: "Diss",
      homepage: "https://example.com",
      repository: "git+https://example.com/repo.git",
      license: "MIT",
      keywords: ["codex", "plugin"],
    });
  });

  test("omits empty keywords array", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: { name: "x", keywords: [] },
      skills: [],
      mcpServers: [],
      hookEntries: [],
    });
    expect(m.keywords).toBeUndefined();
  });

  test("emits sorted skill paths", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [skill("zebra"), skill("alpha"), skill("mike")],
      mcpServers: [],
      hookEntries: [],
    });
    expect(m.skills).toEqual([
      "skills/alpha/SKILL.md",
      "skills/mike/SKILL.md",
      "skills/zebra/SKILL.md",
    ]);
  });

  test("translates stdio mcp server with args + env", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [stdio("local")],
      hookEntries: [],
    });
    expect(m.mcpServers).toEqual({
      local: { type: "stdio", command: "node", args: ["local.js", "--flag"], env: { TOKEN: "x" } },
    });
  });

  test("translates http + sse mcp servers and sorts by id", () => {
    const m = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [sse("z-sse"), http("a-http")],
      hookEntries: [],
    });
    expect(Object.keys(m.mcpServers ?? {})).toEqual(["a-http", "z-sse"]);
    expect(m.mcpServers?.["a-http"]).toEqual({
      type: "http",
      url: "https://a-http.example/mcp",
      headers: { Authorization: "Bearer y" },
    });
    expect(m.mcpServers?.["z-sse"]).toEqual({
      type: "sse",
      url: "https://z-sse.example/sse",
    });
  });

  test("omits hooks key when no entries; emits 'hooks/hooks.json' when present", () => {
    const m1 = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
    });
    expect(m1.hooks).toBeUndefined();

    const m2 = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [hookEntry("greet")],
    });
    expect(m2.hooks).toBe("hooks/hooks.json");
  });

  test("emits interface block only when at least one field present", () => {
    const m1 = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
      interface: {},
    });
    expect(m1.interface).toBeUndefined();

    const m2 = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
      interface: { displayName: "0xcraft", capabilities: ["skills", "hooks"] },
    });
    expect(m2.interface).toEqual({ displayName: "0xcraft", capabilities: ["skills", "hooks"] });
  });

  test("apps gated by emitApps flag", () => {
    const apps = { default: { entrypoint: "main" } };
    const off = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
      apps,
    });
    expect(off.apps).toBeUndefined();

    const on = mapCodexPluginManifest({
      packageMetadata: { name: "x" },
      skills: [],
      mcpServers: [],
      hookEntries: [],
      emitApps: true,
      apps,
    });
    expect(on.apps).toEqual(apps);
  });

  test("deterministic across repeated invocations", () => {
    const opts = {
      packageMetadata: { name: "x", version: "1.0.0" },
      skills: [skill("b"), skill("a")],
      mcpServers: [http("h"), stdio("s")],
      hookEntries: [hookEntry("k")],
    };
    const a = JSON.stringify(mapCodexPluginManifest(opts));
    const b = JSON.stringify(mapCodexPluginManifest(opts));
    expect(a).toBe(b);
  });
});
