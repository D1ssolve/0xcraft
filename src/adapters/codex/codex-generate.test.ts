/**
 * Tests for the Codex generate() orchestrator (Task D.6).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import { builtinAgents } from "../../core/agents";
import { builtinHooks } from "../../core/hooks";
import { builtinSkills } from "../../core/skills";
import { defaultConfig } from "../../core/config";

import { generateCodexPlugin } from "./index";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-generate-"));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function enabledSkillIds(): string[] {
  const disabled = new Set(defaultConfig.disabled.skills);
  const wl = defaultConfig.enabled.skills;
  const useWl = wl.length > 0;
  return builtinSkills
    .filter((s) => !disabled.has(s.id) && (!useWl || wl.includes(s.id)))
    .map((s) => s.id);
}

function enabledHookIds(): string[] {
  const disabled = new Set(defaultConfig.disabled.hooks);
  return builtinHooks.filter((h) => !disabled.has(h.id)).map((h) => h.id);
}

describe("generateCodexPlugin — happy path", () => {
  test("emits .codex/config.toml and it parses as TOML", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    expect(result.ok).toBe(true);
    expect(result.outputPath).toBe(path.resolve(tmpDir));

    const configPath = path.join(tmpDir, ".codex", "config.toml");
    expect(fs.existsSync(configPath)).toBe(true);

    const parsed = parseToml(fs.readFileSync(configPath, "utf-8")) as {
      features: Record<string, unknown>;
    };
    expect(parsed.features.hooks).toBe(true);
    expect(parsed.features.child_agents_md).toBe(true);

    expect(result.emittedFiles).toContain(".codex/config.toml");
  });

  test("emits one .codex/agents/<id>.toml per builtin agent, each parses with required keys", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    for (const agent of builtinAgents) {
      const rel = `.codex/agents/${agent.id}.toml`;
      const abs = path.join(tmpDir, rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(result.emittedFiles).toContain(rel);

      const parsed = parseToml(fs.readFileSync(abs, "utf-8")) as Record<string, unknown>;
      expect(typeof parsed.name).toBe("string");
      expect(typeof parsed.description).toBe("string");
      expect(typeof parsed.developer_instructions).toBe("string");
    }
  });

  test("emits .codex/hooks.json + .codex/hooks/<id>.sh for enabled hooks (Batch D)", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    const hooksJsonRel = ".codex/hooks.json";
    const hooksJsonAbs = path.join(tmpDir, hooksJsonRel);
    expect(fs.existsSync(hooksJsonAbs)).toBe(true);
    expect(result.emittedFiles).toContain(hooksJsonRel);

    // All built-in hooks land on full Codex cells (SessionStart /
    // UserPromptSubmit), so every enabled hook id must produce a `.sh`
    // script.
    for (const id of enabledHookIds()) {
      const rel = `.codex/hooks/${id}.sh`;
      const abs = path.join(tmpDir, rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(result.emittedFiles).toContain(rel);

      const body = fs.readFileSync(abs, "utf-8");
      expect(body.startsWith("#!/bin/sh\n")).toBe(true);
    }

    // hooks.json must parse and reference at least one event.
    const json = JSON.parse(fs.readFileSync(hooksJsonAbs, "utf-8")) as {
      hooks: Record<string, unknown>;
    };
    expect(typeof json.hooks).toBe("object");
    expect(Object.keys(json.hooks).length).toBeGreaterThan(0);
  });

  test("emits SKILL.md for each enabled skill under default `.agents/skills/`", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    for (const id of enabledSkillIds()) {
      const rel = `.agents/skills/${id}/SKILL.md`;
      const abs = path.join(tmpDir, rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(result.emittedFiles).toContain(rel);
    }
  });

  test("honours config.codexSkillsDir override", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
      config: { platforms: { codex: { skillsDir: "custom/skills" } } },
    });

    for (const id of enabledSkillIds()) {
      const rel = `custom/skills/${id}/SKILL.md`;
      const abs = path.join(tmpDir, rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(result.emittedFiles).toContain(rel);
    }
  });

  test("result.ok === true with default registries (no error diagnostics)", async () => {
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("generateCodexPlugin — sandbox guard", () => {
  test("does not write any files outside outputPath", async () => {
    // Sentinel: snapshot tmpDir's parent listing before+after to ensure
    // no sibling files appear.
    const parent = path.dirname(tmpDir);
    const before = new Set(fs.readdirSync(parent));

    await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    const after = new Set(fs.readdirSync(parent));
    // No new siblings beyond tmpDir itself.
    for (const entry of after) {
      if (!before.has(entry)) {
        expect(entry).toBe(path.basename(tmpDir));
      }
    }

    // Every emitted file must be inside outputPath.
    const result = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });
    for (const rel of result.emittedFiles) {
      const abs = path.resolve(tmpDir, rel);
      const r = path.relative(tmpDir, abs);
      expect(r.startsWith("..")).toBe(false);
      expect(path.isAbsolute(r)).toBe(false);
    }
  });
});

describe("generateCodexPlugin — force flag", () => {
  test("second run without force fails with error diagnostics", async () => {
    const first = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });
    expect(first.ok).toBe(true);

    const second = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: false,
    });
    expect(second.ok).toBe(false);
    const writeErrors = second.diagnostics.filter(
      (d) => d.severity === "error" && d.code === "codex.generate.write_failed",
    );
    expect(writeErrors.length).toBeGreaterThan(0);
  });

  test("second run with force overwrites existing files", async () => {
    await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });

    // Mutate config.toml to detect overwrite.
    const configPath = path.join(tmpDir, ".codex", "config.toml");
    fs.writeFileSync(configPath, "# STALE\n");
    expect(fs.readFileSync(configPath, "utf-8")).toBe("# STALE\n");

    const second = await generateCodexPlugin({
      packageRoot,
      projectRoot: tmpDir,
      force: true,
    });
    expect(second.ok).toBe(true);

    const refreshed = fs.readFileSync(configPath, "utf-8");
    expect(refreshed).not.toBe("# STALE\n");
    expect(refreshed).toContain("[features]");
  });
});
