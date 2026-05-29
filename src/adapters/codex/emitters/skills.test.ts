/**
 * Tests for the Codex skill emitter (Task D.4).
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultConfig, mergeConfig, type ZeroxCraftConfig, type PartialZeroxCraftConfig } from "../../../core/config";
import { getSkillById, type SkillDefinition } from "../../../core/skills";
import { parseFrontmatter } from "../../_shared/frontmatter";

import { emitCodexSkill } from "./skills";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");

function cloneConfig(overrides: PartialZeroxCraftConfig = {}): ZeroxCraftConfig {
  // Use mergeConfig to get proper sub-shape merging; spreading
  // PartialZeroxCraftConfig directly produces narrowed Partial sub-types
  // that don't satisfy ZeroxCraftConfig.
  return mergeConfig({
    mcpServers: { ...defaultConfig.mcpServers },
    modelOverrides: { ...defaultConfig.modelOverrides },
    ...overrides,
  });
}

function getCaveman(): SkillDefinition {
  const s = getSkillById("caveman");
  if (!s) throw new Error("Fixture missing: caveman skill not registered");
  return s;
}

function getContext7(): SkillDefinition {
  const s = getSkillById("context7");
  if (!s) throw new Error("Fixture missing: context7 skill not registered");
  return s;
}

describe("emitCodexSkill: default path + frontmatter", () => {
  test("emits to .agents/skills/<id>/SKILL.md with registry name+description", () => {
    const skill = getCaveman();
    const result = emitCodexSkill({
      skill,
      packageRoot,
      config: cloneConfig(),
    });

    expect(result).not.toBeNull();
    expect(result!.filename).toBe(".agents/skills/caveman/SKILL.md");

    const { meta, body } = parseFrontmatter(result!.content);
    expect(meta.name).toBe(skill.name);
    expect(meta.description).toBe(skill.description);
    expect(body.length).toBeGreaterThan(0);
    // No mcp/autoLoad keys leaked into frontmatter.
    expect(meta.mcpServers).toBeUndefined();
    expect(meta.autoLoad).toBeUndefined();
  });

  test("body matches the source SKILL.md body (post-frontmatter)", () => {
    const skill = getCaveman();
    const sourcePath = path.join(packageRoot, "skills", skill.id, "SKILL.md");
    const sourceRaw = fs.readFileSync(sourcePath, "utf-8");
    const sourceBody = parseFrontmatter(sourceRaw).body;

    const result = emitCodexSkill({
      skill,
      packageRoot,
      config: cloneConfig(),
    });
    const { body } = parseFrontmatter(result!.content);
    expect(body).toBe(sourceBody);
  });
});

describe("emitCodexSkill: platforms.codex.skillsDir override", () => {
  test("uses override directory when configured", () => {
    const result = emitCodexSkill({
      skill: getCaveman(),
      packageRoot,
      config: cloneConfig({ platforms: { codex: { skillsDir: "custom/path" } } }),
    });
    expect(result!.filename).toBe("custom/path/caveman/SKILL.md");
  });

  test("normalizes backslashes and trailing slashes to POSIX", () => {
    const result = emitCodexSkill({
      skill: getCaveman(),
      packageRoot,
      config: cloneConfig({ platforms: { codex: { skillsDir: "custom\\path/" } } }),
    });
    expect(result!.filename).toBe("custom/path/caveman/SKILL.md");
  });
});

describe("emitCodexSkill: gating", () => {
  test("returns null when skill is in disabled.skills", () => {
    const skill = getCaveman();
    const result = emitCodexSkill({
      skill,
      packageRoot,
      config: cloneConfig({ disabled: { agents: [], skills: [skill.id], hooks: [], commands: [], mcp: [] } }),
    });
    expect(result).toBeNull();
  });

  test("returns null when enabled.skills whitelist excludes the skill", () => {
    const result = emitCodexSkill({
      skill: getCaveman(),
      packageRoot,
      config: cloneConfig({ enabled: { agents: [], skills: ["other-skill"], commands: [] } }),
    });
    expect(result).toBeNull();
  });

  test("emits when enabled.skills explicitly includes the skill", () => {
    const skill = getCaveman();
    const result = emitCodexSkill({
      skill,
      packageRoot,
      config: cloneConfig({ enabled: { agents: [], skills: [skill.id, "other"], commands: [] } }),
    });
    expect(result).not.toBeNull();
  });
});

describe("emitCodexSkill: diagnostics", () => {
  test("emits codex.skill.mcp_scoping_dropped when skill has mcpServers", () => {
    const result = emitCodexSkill({
      skill: getContext7(),
      packageRoot,
      config: cloneConfig(),
    });

    const codes = result!.diagnostics.map((d) => d.code);
    expect(codes).toContain("codex.skill.mcp_scoping_dropped");
    const diag = result!.diagnostics.find((d) => d.code === "codex.skill.mcp_scoping_dropped")!;
    expect(diag.severity).toBe("warn");

    // No mcp keys in frontmatter.
    const { meta } = parseFrontmatter(result!.content);
    expect(meta.mcp).toBeUndefined();
    expect(meta.mcpServers).toBeUndefined();
    expect(meta.mcp_servers).toBeUndefined();
  });

  test("does not emit autoLoad degradation when autoLoad is full", () => {
    // caveman has autoLoad: true in the registry.
    const result = emitCodexSkill({
      skill: getCaveman(),
      packageRoot,
      config: cloneConfig(),
    });

    const codes = result!.diagnostics.map((d) => d.code);
    expect(codes).not.toContain("codex.skill.auto_load_degraded");

    const { meta } = parseFrontmatter(result!.content);
    expect(meta.autoLoad).toBeUndefined();
  });

  test("emits codex.skill.source_missing + minimal SKILL.md when source file absent", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-skill-emit-"));
    try {
      const skill = getCaveman();
      const result = emitCodexSkill({
        skill,
        packageRoot: tmpRoot, // skills/<id>/SKILL.md does not exist here
        config: cloneConfig(),
      });

      expect(result).not.toBeNull();
      const codes = result!.diagnostics.map((d) => d.code);
      expect(codes).toContain("codex.skill.source_missing");
      const errDiag = result!.diagnostics.find((d) => d.code === "codex.skill.source_missing")!;
      expect(errDiag.severity).toBe("error");

      // Minimal SKILL.md: frontmatter only, derived from registry.
      const { meta } = parseFrontmatter(result!.content);
      expect(meta.name).toBe(skill.name);
      expect(meta.description).toBe(skill.description);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("T-22 emits codex.skills.allowedTools.dropped when source frontmatter declares allowed-tools", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-allowed-tools-"));
    try {
      const skillDir = path.join(tmpRoot, "skills", "demo");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: demo
description: demo
allowed-tools: [Bash, Read]
---
demo body
`,
        "utf-8",
      );

      const skill: SkillDefinition = {
        id: "demo",
        name: "demo",
        description: "demo",
        skillFile: "skills/demo/SKILL.md",
        tags: [],
      };

      const result = emitCodexSkill({ skill, packageRoot: tmpRoot, config: cloneConfig() });
      expect(result).not.toBeNull();

      const codes = result!.diagnostics.map((d) => d.code);
      expect(codes).toContain("codex.skills.allowedTools.dropped");
      const drop = result!.diagnostics.find((d) => d.code === "codex.skills.allowedTools.dropped")!;
      expect(drop.severity).toBe("warn");

      // The emitted Codex frontmatter must NOT carry the allowed-tools key.
      const { meta } = parseFrontmatter(result!.content);
      expect((meta as Record<string, unknown>)["allowed-tools"]).toBeUndefined();
      expect((meta as Record<string, unknown>).allowedTools).toBeUndefined();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
