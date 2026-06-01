import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "./config-schema";
import { loadConfig, parseJsonc, stripJsonc } from "./config-loader";

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-config-"));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, JSON.stringify(value));
}

describe("JSONC parsing", () => {
  test("strips line and block comments while preserving comment markers inside strings", () => {
    const parsed = parseJsonc(`{
      // outer comment
      "url": "https://example.com//kept",
      "glob": "/* kept */",
      /* block comment */
      "enabled": { "agents": ["a"] }
    }`);

    expect(parsed).toEqual({
      url: "https://example.com//kept",
      glob: "/* kept */",
      enabled: { agents: ["a"] },
    });
  });

  test("does not strip escaped quotes inside strings", () => {
    const stripped = stripJsonc(`{ "text": "quote: \\\" // still text", // comment\n "x": 1 }`);
    expect(JSON.parse(stripped)).toEqual({ text: 'quote: " // still text', x: 1 });
  });
});

describe("loadConfig", () => {
  test("returns default config when .0xcraft config is missing", () => {
    const projectDir = makeSandbox();

    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });

  test("reads .0xcraft/config.json", () => {
    const projectDir = makeSandbox();
    writeJson(path.join(projectDir, ".0xcraft", "config.json"), {
      sourceRoot: "resources",
      enabled: { agents: ["code-explorer"], skills: ["tdd"] },
      platforms: { codex: { emitPlugin: true } },
    });

    const config = loadConfig(projectDir);

    expect(config.sourceRoot).toBe("resources");
    expect(config.enabled).toEqual({ agents: ["code-explorer"], skills: ["tdd"] });
    expect(config.platforms.codex.emitPlugin).toBe(true);
    expect(config.platforms.codex.emitMarketplace).toBe(false);
  });

  test("reads .0xcraft/config.jsonc when json is absent", () => {
    const projectDir = makeSandbox();
    writeFile(
      path.join(projectDir, ".0xcraft", "config.jsonc"),
      `{
        "schema": "0xcraft.config.v1",
        // JSONC config
        "disabled": { "hooks": ["old-hook"] },
        "packs": [{ "name": "@0xcraft/agents-pack", "version": "1.2.3" }]
      }`,
    );

    const config = loadConfig(projectDir);

    expect(config.disabled.hooks).toEqual(["old-hook"]);
    expect(config.packs).toEqual([{ name: "@0xcraft/agents-pack", version: "1.2.3" }]);
  });

  test("prefers .0xcraft/config.json over .0xcraft/config.jsonc", () => {
    const projectDir = makeSandbox();
    writeJson(path.join(projectDir, ".0xcraft", "config.json"), { sourceRoot: "json" });
    writeFile(path.join(projectDir, ".0xcraft", "config.jsonc"), `{ "sourceRoot": "jsonc" }`);

    expect(loadConfig(projectDir).sourceRoot).toBe("json");
  });

  test("throws Zod validation message for invalid config", () => {
    const projectDir = makeSandbox();
    const flatAlias = `disabled${"Agents"}`;
    writeJson(path.join(projectDir, ".0xcraft", "config.json"), {
      [flatAlias]: ["old-hook"],
    });

    expect(() => loadConfig(projectDir)).toThrow(new RegExp(flatAlias));
  });

  test("throws ERR_MARKETPLACE_REQUIRES_PLUGIN at validation time", () => {
    const projectDir = makeSandbox();
    writeJson(path.join(projectDir, ".0xcraft", "config.json"), {
      platforms: { codex: { emitMarketplace: true } },
    });

    expect(() => loadConfig(projectDir)).toThrow(/ERR_MARKETPLACE_REQUIRES_PLUGIN/);
  });

  test("throws parse error for invalid JSON", () => {
    const projectDir = makeSandbox();
    writeFile(path.join(projectDir, ".0xcraft", "config.json"), `{ invalid json`);

    expect(() => loadConfig(projectDir)).toThrow(SyntaxError);
  });
});
