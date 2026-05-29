import { describe, test, expect } from "bun:test";

import { emitCodexPluginBundle } from "./manifest";
import type { CodexPluginManifest } from "../mappers/plugin";
import type { CodexBuiltFile } from "../index";

const baseManifest = (): CodexPluginManifest => ({
  name: "0xcraft",
  version: "2.0.0",
});

describe("emitCodexPluginBundle", () => {
  test("emits only plugin.json for empty inputs", () => {
    const { files } = emitCodexPluginBundle({
      manifest: baseManifest(),
      skillFiles: [],
      hookFiles: [],
      sourceSkillsDir: ".agents/skills",
    });
    expect(files.map((f) => f.path)).toEqual([".codex-plugin/plugin.json"]);
    const parsed = JSON.parse(files[0]!.content);
    expect(parsed).toEqual({ name: "0xcraft", version: "2.0.0" });
    expect(files[0]!.content.endsWith("\n")).toBe(true);
  });

  test("emits .mcp.json when manifest declares mcpServers", () => {
    const manifest: CodexPluginManifest = {
      ...baseManifest(),
      mcpServers: { srv: { type: "stdio", command: "node" } },
    };
    const { files } = emitCodexPluginBundle({
      manifest,
      skillFiles: [],
      hookFiles: [],
      sourceSkillsDir: ".agents/skills",
    });
    const mcp = files.find((f) => f.path === ".codex-plugin/.mcp.json");
    expect(mcp).toBeDefined();
    expect(JSON.parse(mcp!.content)).toEqual({
      mcpServers: { srv: { type: "stdio", command: "node" } },
    });
  });

  test("copies skill files byte-for-byte under skills/<id>/SKILL.md", () => {
    const skillFiles: CodexBuiltFile[] = [
      { path: ".agents/skills/alpha/SKILL.md", content: "alpha-body" },
      { path: ".agents/skills/beta/SKILL.md", content: "beta-body" },
    ];
    const { files } = emitCodexPluginBundle({
      manifest: {
        ...baseManifest(),
        skills: ["skills/alpha/SKILL.md", "skills/beta/SKILL.md"],
      },
      skillFiles,
      hookFiles: [],
      sourceSkillsDir: ".agents/skills",
    });
    const a = files.find((f) => f.path === ".codex-plugin/skills/alpha/SKILL.md");
    const b = files.find((f) => f.path === ".codex-plugin/skills/beta/SKILL.md");
    expect(a?.content).toBe("alpha-body");
    expect(b?.content).toBe("beta-body");
  });

  test("respects custom sourceSkillsDir", () => {
    const skillFiles: CodexBuiltFile[] = [
      { path: "custom/skills/x/SKILL.md", content: "x-body" },
    ];
    const { files } = emitCodexPluginBundle({
      manifest: { ...baseManifest(), skills: ["skills/x/SKILL.md"] },
      skillFiles,
      hookFiles: [],
      sourceSkillsDir: "custom/skills",
    });
    const x = files.find((f) => f.path === ".codex-plugin/skills/x/SKILL.md");
    expect(x?.content).toBe("x-body");
  });

  test("copies hook files only when manifest.hooks set", () => {
    const hookFiles: CodexBuiltFile[] = [
      { path: ".codex/hooks.json", content: "{\"hooks\":{}}" },
      { path: ".codex/hooks/greet.sh", content: "#!/bin/sh\nexit 0\n", mode: 0o755 },
    ];

    const off = emitCodexPluginBundle({
      manifest: baseManifest(),
      skillFiles: [],
      hookFiles,
      sourceSkillsDir: ".agents/skills",
    });
    expect(off.files.some((f) => f.path.startsWith(".codex-plugin/hooks/"))).toBe(false);

    const on = emitCodexPluginBundle({
      manifest: { ...baseManifest(), hooks: "hooks/hooks.json" },
      skillFiles: [],
      hookFiles,
      sourceSkillsDir: ".agents/skills",
    });
    const hooksJson = on.files.find((f) => f.path === ".codex-plugin/hooks/hooks.json");
    const greet = on.files.find((f) => f.path === ".codex-plugin/hooks/greet.sh");
    expect(hooksJson?.content).toBe("{\"hooks\":{}}");
    expect(greet?.content).toBe("#!/bin/sh\nexit 0\n");
    expect(greet?.mode).toBe(0o755);
  });

  test("deterministic across calls", () => {
    const opts = {
      manifest: {
        ...baseManifest(),
        mcpServers: { srv: { type: "stdio" as const, command: "node" } },
        skills: ["skills/x/SKILL.md"],
        hooks: "hooks/hooks.json",
      },
      skillFiles: [{ path: ".agents/skills/x/SKILL.md", content: "x" }],
      hookFiles: [
        { path: ".codex/hooks.json", content: "{}" },
        { path: ".codex/hooks/x.sh", content: "#!/bin/sh\n", mode: 0o755 },
      ],
      sourceSkillsDir: ".agents/skills",
    };
    const a = JSON.stringify(emitCodexPluginBundle(opts));
    const b = JSON.stringify(emitCodexPluginBundle(opts));
    expect(a).toBe(b);
  });
});
