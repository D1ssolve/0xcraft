import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseJsonc } from "../core/config/config-loader";
import { runInit } from "./init";

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-init-"));
}

function configPath(root: string): string {
  return path.join(root, ".0xcraft", "config.jsonc");
}

function readConfig(root: string): Record<string, unknown> {
  return parseJsonc(fs.readFileSync(configPath(root), "utf-8")) as Record<string, unknown>;
}

describe("runInit", () => {
  test("creates config and source directories in the output root", () => {
    const root = makeSandbox();

    const result = runInit({ out: root });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(configPath(root))).toBe(true);
    for (const dir of ["agents", "skills", "hooks", "mcp", "commands"]) {
      expect(fs.statSync(path.join(root, dir)).isDirectory()).toBe(true);
    }
    const config = readConfig(root);
    expect(config.schema).toBe("0xcraft.config.v1");
    expect(config.sourceRoot).toBe(".");
    expect(config.enabled).toEqual({ agents: [], skills: [] });
    expect(config.disabled).toEqual({ agents: [], skills: [], hooks: [], mcpServers: [] });
    expect(config.packs).toEqual([]);
    expect(config.platforms).toEqual({
      codex: {
        agents: {},
        mcpExtensions: {},
        permissionProfiles: {},
        emitPlugin: false,
        emitMarketplace: false,
        emitApps: false,
        permissionsBeta: false,
        hooksEmitMode: "hooks.json",
        mcpEnvelope: "wrapped",
        nonInteractive: false,
      },
      claude: {},
      opencode: {},
    });
    expect(config.diagnostics).toEqual({});
    expect(fs.readFileSync(configPath(root), "utf-8")).toContain("// Schema version");
  });

  test("returns ERR_CONFIG_EXISTS without force and preserves existing config", () => {
    const root = makeSandbox();
    fs.mkdirSync(path.join(root, ".0xcraft"), { recursive: true });
    fs.writeFileSync(configPath(root), "existing");

    const result = runInit({ out: root });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "ERR_CONFIG_EXISTS",
        message: expect.stringContaining("already exists"),
        details: { path: configPath(root) },
      },
    ]);
    expect(fs.readFileSync(configPath(root), "utf-8")).toBe("existing");
  });

  test("force overwrites existing config", () => {
    const root = makeSandbox();
    fs.mkdirSync(path.join(root, ".0xcraft"), { recursive: true });
    fs.writeFileSync(configPath(root), "existing");

    const result = runInit({ out: root, force: true });

    expect(result.exitCode).toBe(0);
    expect(readConfig(root).schema).toBe("0xcraft.config.v1");
    expect(fs.readFileSync(configPath(root), "utf-8")).not.toBe("existing");
  });

  test("withPack adds pack entry using wildcard version", () => {
    const root = makeSandbox();

    const result = runInit({ out: root, withPack: "@0xcraft/agents-pack" });

    expect(result.exitCode).toBe(0);
    expect(readConfig(root).packs).toEqual([{ name: "@0xcraft/agents-pack", version: "*" }]);
  });

  test("out uses custom root", () => {
    const sandbox = makeSandbox();
    const root = path.join(sandbox, "custom-root");

    const result = runInit({ out: root });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(configPath(root))).toBe(true);
    expect(fs.existsSync(configPath(sandbox))).toBe(false);
  });

  test("success result has exit code 0", () => {
    const root = makeSandbox();

    expect(runInit({ out: root }).exitCode).toBe(0);
  });
});
