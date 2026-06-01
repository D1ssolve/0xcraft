import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseJsonc } from "../core/config/config-loader";
import { resetPackResolverStateForTests } from "../adapters/_shared/pack-resolver/resolver";
import { runPackAdd, runPackList } from "./pack";

function makeSandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-pack-cli-"));
  resetPackResolverStateForTests();
  return root;
}

function configPath(root: string, extension = "jsonc"): string {
  return path.join(root, ".0xcraft", `config.${extension}`);
}

function writeConfig(root: string, config: Record<string, unknown>, extension = "jsonc"): void {
  fs.mkdirSync(path.join(root, ".0xcraft"), { recursive: true });
  fs.writeFileSync(configPath(root, extension), JSON.stringify(config, null, 2));
}

function readConfig(root: string): Record<string, unknown> {
  const filePath = fs.existsSync(configPath(root, "json")) ? configPath(root, "json") : configPath(root);
  return parseJsonc(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function writePack(
  root: string,
  packName: string,
  version: string,
  options: { resources?: Record<string, string[]>; files?: string[] } = {},
): void {
  const packDir = path.join(root, "node_modules", ...packName.split("/"));
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, "package.json"), JSON.stringify({ name: packName, version }));
  fs.writeFileSync(
    path.join(packDir, "0xcraft-pack.json"),
    JSON.stringify({
      schema: "0xcraft.pack.v1",
      name: packName,
      version,
      resources: options.resources ?? { agents: ["agents/**"] },
    }),
  );

  for (const relativeFile of options.files ?? ["agents/code-explorer/AGENT.md"]) {
    const filePath = path.join(packDir, relativeFile);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "---\nname: Test\n---\nBody\n");
  }
}

describe("pack CLI helpers", () => {
  test("pack add <pkg> adds an entry to config", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [] });

    const result = runPackAdd({ projectDir: root, packageName: "@0xcraft/agents-pack" });

    expect(result.exitCode).toBe(0);
    expect(readConfig(root).packs).toEqual([{ name: "@0xcraft/agents-pack", version: "*" }]);
  });

  test("pack add <pkg> --version stores exact version", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [] });

    const result = runPackAdd({ projectDir: root, packageName: "@0xcraft/agents-pack", version: "1.2.3" });

    expect(result.exitCode).toBe(0);
    expect(readConfig(root).packs).toEqual([{ name: "@0xcraft/agents-pack", version: "1.2.3" }]);
  });

  test("pack add <pkg> --version with range stores installed exact version", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [] });
    writePack(root, "@0xcraft/agents-pack", "1.4.0");

    const result = runPackAdd({ projectDir: root, packageName: "@0xcraft/agents-pack", version: "^1.0.0" });

    expect(result.exitCode).toBe(0);
    expect(readConfig(root).packs).toEqual([{ name: "@0xcraft/agents-pack", version: "1.4.0" }]);
  });

  test("pack add for existing exact version is a no-op with info diagnostic", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [{ name: "@0xcraft/agents-pack", version: "1.2.3" }] });

    const result = runPackAdd({ projectDir: root, packageName: "@0xcraft/agents-pack", version: "1.2.3" });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([
      {
        severity: "info",
        code: "INFO_PACK_ALREADY_INSTALLED",
        message: expect.stringContaining("already configured"),
        details: { name: "@0xcraft/agents-pack", version: "1.2.3" },
      },
    ]);
    expect(readConfig(root).packs).toEqual([{ name: "@0xcraft/agents-pack", version: "1.2.3" }]);
  });

  test("pack list shows packs with versions and resource counts", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [{ name: "@0xcraft/agents-pack", version: "1.2.3" }] });
    writePack(root, "@0xcraft/agents-pack", "1.2.3", {
      resources: { agents: ["agents/**"], skills: ["skills/**"] },
      files: ["agents/code-explorer/AGENT.md", "agents/reviewer/AGENT.md", "skills/tdd/SKILL.md"],
    });

    const result = runPackList({ projectDir: root });

    expect(result.exitCode).toBe(0);
    expect(result.output.join("\n")).toContain("@0xcraft/agents-pack | 1.2.3 | 1.2.3 | 3 | no");
  });

  test("pack list returns exit 2 and ERR_PACK_VERSION_DRIFT when installed version differs", () => {
    const root = makeSandbox();
    writeConfig(root, { schema: "0xcraft.config.v1", packs: [{ name: "@0xcraft/agents-pack", version: "2.0.0" }] });
    writePack(root, "@0xcraft/agents-pack", "1.2.3");

    const result = runPackList({ projectDir: root });

    expect(result.exitCode).toBe(2);
    expect(result.diagnostics).toEqual([
      {
        severity: "warn",
        code: "ERR_PACK_VERSION_DRIFT",
        message: "Pack version drift: @0xcraft/agents-pack installed 1.2.3, configured 2.0.0",
        details: { name: "@0xcraft/agents-pack", configuredVersion: "2.0.0", installedVersion: "1.2.3" },
      },
    ]);
    expect(result.output.join("\n")).toContain("@0xcraft/agents-pack | 2.0.0 | 1.2.3 | 1 | yes");
  });
});
