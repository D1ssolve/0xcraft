import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBuildCommand, type BuildCommandOptions } from "./build";

const sandboxes: string[] = [];

afterEach(() => {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("0xcraft build", () => {
  test("builds opencode artifacts for a valid project", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "opencode" });

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(existsSync(join(project, "opencode.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode", "agents", "reviewer.md"))).toBe(true);
  });

  test("builds opencode plugin artifacts when --opencode-mode plugin is provided", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "opencode", opencodeMode: "plugin" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, ".opencode-plugin", "package.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode-plugin", "agents", "reviewer.md"))).toBe(true);
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  test("builds opencode filesystem artifacts when --opencode-mode filesystem is provided", async () => {
    const project = createProject({ opencodeMode: "plugin" });

    const result = await runBuildCommand(project, { target: "opencode", opencodeMode: "filesystem" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, "opencode.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode", "agents", "reviewer.md"))).toBe(true);
    expect(existsSync(join(project, ".opencode-plugin", "package.json"))).toBe(false);
  });

  test("uses opencode plugin mode from config when flag is omitted", async () => {
    const project = createProject({ opencodeMode: "plugin" });

    const result = await runBuildCommand(project, { target: "opencode" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, ".opencode-plugin", "package.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode-plugin", "agents", "reviewer.md"))).toBe(true);
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  test("rejects invalid opencode mode", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "opencode", opencodeMode: "subagent" });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "ERR_UNSUPPORTED_MODE" }),
    );
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  test("ignores opencode mode when target is claude-code", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "claude-code", opencodeMode: "subagent" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  test("builds all target artifacts for a valid project", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "all" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, "opencode.json"))).toBe(true);
    expect(existsSync(join(project, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(project, ".codex", "config.toml"))).toBe(true);
  });

  test("applies opencode plugin mode only to opencode when building all targets", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "all", opencodeMode: "plugin" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, ".opencode-plugin", "package.json"))).toBe(true);
    expect(existsSync(join(project, ".opencode-plugin", "agents", "reviewer.md"))).toBe(true);
    expect(existsSync(join(project, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(project, ".codex", "config.toml"))).toBe(true);
  });

  test("validate mode emits diagnostics without writing files", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "all", validate: true });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
    expect(existsSync(join(project, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(existsSync(join(project, ".codex", "config.toml"))).toBe(false);
  });

  test("strict mode upgrades warnings to errors and skips writes", async () => {
    const project = createProject({ claudeSibling: true });

    const result = await runBuildCommand(project, { target: "opencode", strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(existsSync(join(project, "opencode.json"))).toBe(false);
  });

  test("json option returns structured diagnostics", async () => {
    const project = createProject({ claudeSibling: true });
    const output: string[] = [];

    const result = await runBuildCommand(project, { target: "opencode", json: true }, { stdout: (line) => output.push(line) });

    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(output.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((d: {severity: string}) => d.severity === "warn")).toBe(true);
  });

  test("checks ERR_MARKETPLACE_REQUIRES_PLUGIN before writing", async () => {
    const project = createProject({ codexMarketplaceWithoutPlugin: true });

    const result = await runBuildCommand(project, { target: "codex" });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "ERR_MARKETPLACE_REQUIRES_PLUGIN" }),
    );
    expect(existsSync(join(project, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(project, ".agents", "plugins", "marketplace.json"))).toBe(false);
  });

  test("keeps existing claude mode behavior", async () => {
    const project = createProject();

    const result = await runBuildCommand(project, { target: "claude-code", mode: "claude-subagent", opencodeMode: "plugin" });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, ".claude", "agents", "reviewer.md"))).toBe(true);
    expect(existsSync(join(project, ".opencode-plugin", "package.json"))).toBe(false);
  });

  test("exit codes are 0 clean, 1 errors, and 2 warnings only", async () => {
    const clean = await runBuildCommand(createProject(), { target: "opencode", validate: true });
    const warned = await runBuildCommand(createProject({ claudeSibling: true }), { target: "opencode", validate: true });
    const errored = await runBuildCommand(createProject({ codexMarketplaceWithoutPlugin: true }), { target: "codex", validate: true });

    expect(clean.exitCode).toBe(0);
    expect(warned.exitCode).toBe(2);
    expect(errored.exitCode).toBe(1);
  });
});

function createProject(options: { claudeSibling?: boolean; codexMarketplaceWithoutPlugin?: boolean; opencodeMode?: "filesystem" | "plugin" } = {}): string {
  const project = mkdtempSync(join(tmpdir(), "0xcraft-build-"));
  sandboxes.push(project);

  mkdirSync(join(project, ".0xcraft"), { recursive: true });
  writeFileSync(join(project, ".0xcraft", "config.json"), JSON.stringify(config(options), null, 2));
  mkdirSync(join(project, "agents", "reviewer"), { recursive: true });
  writeFileSync(
    join(project, "agents", "reviewer", "AGENT.md"),
    "---\nname: Reviewer\ndescription: Reviews code\n---\nReview code carefully.\n",
  );

  if (options.claudeSibling === true) {
    writeFileSync(join(project, "agents", "reviewer", "agent.claude.md"), "---\neffort: high\n---\n");
  }

  return project;
}

function config(options: { codexMarketplaceWithoutPlugin?: boolean; opencodeMode?: "filesystem" | "plugin" }): Record<string, unknown> {
  return {
    schema: "0xcraft.config.v1",
    sourceRoot: ".",
    platforms: {
      ...(options.opencodeMode === undefined ? {} : { opencode: { mode: options.opencodeMode } }),
      codex: {
        emitMarketplace: options.codexMarketplaceWithoutPlugin === true,
        emitPlugin: false,
      },
    },
  };
}
