import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Diagnostic } from "../diagnostics/diagnostic";
import { getConfigPaths, loadConfig, parseJsonc } from "./config-loader";

/* ------------------------------------------------------------------ */
/*  Sandbox helpers                                                     */
/* ------------------------------------------------------------------ */

function makeSandbox(): { home: string; project: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
  const project = path.join(home, "project");
  fs.mkdirSync(project, { recursive: true });
  return { home, project };
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

/* ------------------------------------------------------------------ */
/*  parseJsonc                                                          */
/* ------------------------------------------------------------------ */

describe("parseJsonc", () => {
  test("parses comments and trailing commas (pure JSONC parse)", () => {
    const out = parseJsonc(`{
      // comment
      "disabled": { "skills": ["legacy"] },
    }`);
    expect(out).toEqual({ disabled: { skills: ["legacy"] } });
  });
});

/* ------------------------------------------------------------------ */
/*  getConfigPaths                                                      */
/* ------------------------------------------------------------------ */

describe("getConfigPaths", () => {
  test("opencode includes .opencode/, not .codex/ or .claude/", () => {
    const paths = getConfigPaths("opencode", "/proj", "/home/u");
    const stems = paths.map((p) => p.stem);
    expect(stems.some((s) => s.includes(`${path.sep}.opencode${path.sep}`))).toBe(true);
    expect(stems.some((s) => s.includes(`${path.sep}.codex${path.sep}`))).toBe(false);
    expect(stems.some((s) => s.includes(`${path.sep}.claude${path.sep}`))).toBe(false);
  });

  test("codex includes .codex/, not .opencode/ or .claude/", () => {
    const stems = getConfigPaths("codex", "/proj", "/home/u").map((p) => p.stem);
    expect(stems.some((s) => s.includes(`${path.sep}.codex${path.sep}`))).toBe(true);
    expect(stems.some((s) => s.includes(`${path.sep}.opencode${path.sep}`))).toBe(false);
    expect(stems.some((s) => s.includes(`${path.sep}.claude${path.sep}`))).toBe(false);
  });

  test("claude-code includes .claude/, not .opencode/ or .codex/", () => {
    const stems = getConfigPaths("claude-code", "/proj", "/home/u").map((p) => p.stem);
    expect(stems.some((s) => s.includes(`${path.sep}.claude${path.sep}`))).toBe(true);
    expect(stems.some((s) => s.includes(`${path.sep}.opencode${path.sep}`))).toBe(false);
    expect(stems.some((s) => s.includes(`${path.sep}.codex${path.sep}`))).toBe(false);
  });

  test("merge order: globalUnified → globalHarness → localUnified → localHarness", () => {
    const paths = getConfigPaths("opencode", "/proj", "/home/u");
    const kinds = paths.map((p) => p.kind);
    const firstIdx = (k: string) => kinds.indexOf(k as (typeof kinds)[number]);
    expect(firstIdx("global-unified")).toBeLessThan(firstIdx("global-harness"));
    expect(firstIdx("global-harness")).toBeLessThan(firstIdx("local-unified"));
    expect(firstIdx("local-unified")).toBeLessThan(firstIdx("local-harness"));
  });
});

/* ------------------------------------------------------------------ */
/*  loadConfig — harness-aware path selection (nested only)             */
/* ------------------------------------------------------------------ */

describe("loadConfig — harness path selection", () => {
  test("opencode reads .opencode/0xcraft.json in project", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      disabled: { skills: ["from-opencode"] },
    });

    const { config, sources } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });

    expect(config.disabled.skills).toEqual(["from-opencode"]);
    expect(sources).toEqual([path.join(project, ".opencode", "0xcraft.json")]);
  });

  test("codex reads .codex/0xcraft.json and does NOT read .opencode/", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".codex", "0xcraft.json"), {
      disabled: { skills: ["from-codex"] },
    });
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      disabled: { skills: ["from-opencode-stray"] },
    });

    const { config, sources } = loadConfig({
      harness: "codex",
      projectRoot: project,
      homeDir: home,
    });

    expect(config.disabled.skills).toEqual(["from-codex"]);
    expect(sources).toEqual([path.join(project, ".codex", "0xcraft.json")]);
  });

  test("claude-code reads .claude/0xcraft.json", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".claude", "0xcraft.json"), {
      disabled: { skills: ["from-claude"] },
    });

    const { config, sources } = loadConfig({
      harness: "claude-code",
      projectRoot: project,
      homeDir: home,
    });

    expect(config.disabled.skills).toEqual(["from-claude"]);
    expect(sources).toEqual([path.join(project, ".claude", "0xcraft.json")]);
  });

  test("local unified .0xcraft/config.json wins over global harness-specific", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(home, ".config", "opencode", "0xcraft.json"), {
      modelOverrides: { foo: "global-harness" },
    });
    writeJson(path.join(project, ".0xcraft", "config.json"), {
      modelOverrides: { foo: "local-unified" },
    });

    const { config } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });

    expect(config.modelOverrides.foo).toBe("local-unified");
  });

  test("merge order: default → globalUnified → globalHarness → localUnified → localHarness", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(home, ".config", "0xcraft", "config.json"), {
      modelOverrides: { foo: "global-unified" },
    });
    writeJson(path.join(home, ".config", "opencode", "0xcraft.json"), {
      modelOverrides: { foo: "global-harness" },
    });
    writeJson(path.join(project, ".0xcraft", "config.json"), {
      modelOverrides: { foo: "local-unified" },
    });
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      modelOverrides: { foo: "local-harness" },
    });

    const { config, sources } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });

    expect(config.modelOverrides.foo).toBe("local-harness");
    expect(sources).toEqual([
      path.join(home, ".config", "0xcraft", "config.json"),
      path.join(home, ".config", "opencode", "0xcraft.json"),
      path.join(project, ".0xcraft", "config.json"),
      path.join(project, ".opencode", "0xcraft.json"),
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  loadConfig — robustness                                             */
/* ------------------------------------------------------------------ */

describe("loadConfig — robustness", () => {
  test("invalid project config emits parse diagnostic without throwing", () => {
    const { home, project } = makeSandbox();
    const cfgPath = path.join(project, ".opencode", "0xcraft.json");
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, "{ invalid json");

    const { diagnostics } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });

    const parseDiag = diagnostics.find((d) => d.code === "config.parse.failed");
    expect(parseDiag?.severity).toBe("warn");
    expect(parseDiag?.message).toContain(cfgPath);
  });

  test("redacts quoted excerpts from parse failure messages", () => {
    const { home, project } = makeSandbox();
    const secret = "sk_live_SECRET_123";
    const cfgPath = path.join(project, ".opencode", "0xcraft.json");
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, `{ "apiKey": "${secret}", "broken": }`);

    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw new SyntaxError(`Unexpected token "${secret}" at position 13`);
    }) as typeof JSON.parse;

    let diagnostics: Diagnostic[];
    try {
      ({ diagnostics } = loadConfig({
        harness: "opencode",
        projectRoot: project,
        homeDir: home,
      }));
    } finally {
      JSON.parse = originalParse;
    }

    const parseDiag = diagnostics.find((d) => d.code === "config.parse.failed");
    expect(parseDiag).toBeDefined();
    expect(JSON.stringify(parseDiag)).not.toContain(secret);
  });

  test("valid global-harness config kept when local-harness parse fails", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(home, ".config", "opencode", "0xcraft.json"), {
      disabled: { skills: ["from-global"] },
    });
    const localCfg = path.join(project, ".opencode", "0xcraft.json");
    fs.mkdirSync(path.dirname(localCfg), { recursive: true });
    fs.writeFileSync(localCfg, "{ invalid");

    const { config } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
      diagnosticSink: () => undefined,
    });

    expect(config.disabled.skills).toEqual(["from-global"]);
  });

  test("defaults injected when no config files exist", () => {
    const { home, project } = makeSandbox();
    const { config, sources } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });
    expect(sources).toEqual([]);
    expect(config.disabled.hooks).toEqual([]);
    expect(config.platforms.codex?.hookRuntime).toBe("bun");
  });

  test("homeDir and env injectable; no real home dir touched", () => {
    const { home, project } = makeSandbox();
    const result = loadConfig({
      harness: "codex",
      projectRoot: project,
      homeDir: home,
      env: { CODEX_HOME: "/somewhere" },
    });
    expect(result.config).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Strict-mode validation: legacy flat keys are rejected (T-12.8)      */
/* ------------------------------------------------------------------ */

describe("loadConfig — strict Zod rejects legacy flat shape (T-12.8)", () => {
  test("legacy `disabledAgents` triggers config.validation.failed and falls back to defaults", () => {
    const { home, project } = makeSandbox();
    // Intentional legacy field — must be rejected by `.strict()` Zod.
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      disabledAgents: [],
    });

    const { config, diagnostics } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });

    const validation = diagnostics.find((d) => d.code === "config.validation.failed");
    expect(validation).toBeDefined();
    expect(validation!.severity).toBe("error");
    // Zod's unrecognized_keys error must name the offending field.
    expect(validation!.message + JSON.stringify(validation!.details ?? {})).toContain("disabledAgents");
    // Fallback to nested defaults.
    expect(config.disabled.agents).toEqual([]);
    expect(config.platforms.codex?.hookRuntime).toBe("bun");
  });

  test.each([
    "disabledSkills",
    "disabledHooks",
    "disabledMcpServers",
    "enabledAgents",
    "enabledSkills",
    "customAgentPaths",
    "agentModelOverrides",
    "agentModelOverridesByHarness",
    "codexHookRuntime",
    "codexSkillsDir",
  ])("legacy flat key %s is rejected", (legacyKey) => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      [legacyKey]: legacyKey.includes("Overrides") ? {} : [],
    });
    const { diagnostics } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
    });
    const validation = diagnostics.find((d) => d.code === "config.validation.failed");
    expect(validation).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Env interpolation + unknown-key diagnostics                         */
/* ------------------------------------------------------------------ */

describe("loadConfig — env interpolation", () => {
  test("emits config.env.missing for unresolved ${VAR}", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      mcpServers: {
        custom: { transport: "http", url: "https://${MISSING_VAR}/mcp" },
      },
    });
    const { diagnostics } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
      env: {},
    });
    const envDiags = diagnostics.filter((d) => d.code === "config.env.missing");
    expect(envDiags.length).toBe(1);
    expect(envDiags[0]!.details?.variable).toBe("MISSING_VAR");
  });

  test("${VAR:-fallback} resolves to fallback without diagnostic", () => {
    const { home, project } = makeSandbox();
    writeJson(path.join(project, ".opencode", "0xcraft.json"), {
      mcpServers: {
        custom: { transport: "http", url: "https://${MISSING_VAR:-default.example.com}/mcp" },
      },
    });
    const { diagnostics, config } = loadConfig({
      harness: "opencode",
      projectRoot: project,
      homeDir: home,
      env: {},
    });
    expect(diagnostics.find((d) => d.code === "config.env.missing")).toBeUndefined();
    const server = config.mcpServers.custom;
    expect(server && "url" in server ? server.url : undefined).toBe("https://default.example.com/mcp");
  });
});
