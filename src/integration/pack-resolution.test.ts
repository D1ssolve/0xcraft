/**
 * T-6.9 — Pack resolution integration tests
 *
 * Tests pack resolver in context of the full build pipeline:
 * loadConfig → resolvePackResources → loadResourceDirectoryRaw → mergeAllResources → emit
 *
 * ALL filesystem operations use os.tmpdir() + mkdtempSync (sandboxed).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runBuildCommand } from "../cli/build";
import { resetPackResolverStateForTests } from "../adapters/_shared/pack-resolver/resolver";
import type { PlatformArtifact } from "../adapters/_shared/artifact";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpdirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-pack-int-"));
  tmpdirs.push(d);
  return d;
}

function write(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

const noop = () => {};
const io = { stdout: noop, stderr: noop };

/** Config JSON with one or more packs */
function configWithPacks(packs: Array<{ name: string; version: string }>): string {
  return JSON.stringify({
    schema: "0xcraft.config.v1",
    sourceRoot: ".",
    out: {},
    enabled: { agents: [], skills: [] },
    disabled: { agents: [], skills: [], hooks: [], mcpServers: [] },
    packs,
    platforms: {
      codex: {
        agents: {},
        mcpExtensions: {},
        permissionProfiles: {},
        emitPlugin: false,
        emitMarketplace: false,
        emitApps: false,
        permissionsBeta: false,
        hooksEmitMode: "hooks.json",
      },
    },
    diagnostics: {},
  }, null, 2) + "\n";
}

/** Create a mock pack under dir/node_modules/<packName>/ */
function createMockPack(
  dir: string,
  packName: string,
  version: string,
  opts: {
    agentIds?: string[];
    skillIds?: string[];
    hookIds?: string[];
  } = {},
): void {
  const segments = packName.split("/");
  const packDir = path.join(dir, "node_modules", ...segments);
  fs.mkdirSync(packDir, { recursive: true });

  write(path.join(dir, "node_modules", ...segments), "package.json",
    JSON.stringify({ name: packName, version }) + "\n",
  );

  const resources: Record<string, string[]> = {};
  if (opts.agentIds && opts.agentIds.length > 0) resources["agents"] = ["agents/**"];
  if (opts.skillIds && opts.skillIds.length > 0) resources["skills"] = ["skills/**"];
  if (opts.hookIds && opts.hookIds.length > 0) resources["hooks"] = ["hooks/**"];

  write(path.join(dir, "node_modules", ...segments), "0xcraft-pack.json",
    JSON.stringify({ name: packName, version, resources }) + "\n",
  );

  for (const agentId of opts.agentIds ?? []) {
    write(
      path.join(dir, "node_modules", ...segments),
      `agents/${agentId}/AGENT.md`,
      `---\nname: ${agentId}\ndescription: Pack agent ${agentId}\n---\nPack agent body.\n`,
    );
  }

  for (const skillId of opts.skillIds ?? []) {
    write(
      path.join(dir, "node_modules", ...segments),
      `skills/${skillId}/SKILL.md`,
      `---\nname: ${skillId}\ndescription: Pack skill ${skillId}\n---\nPack skill body.\n`,
    );
  }

  for (const hookId of opts.hookIds ?? []) {
    write(
      path.join(dir, "node_modules", ...segments),
      `hooks/${hookId}/HOOK.md`,
      [
        "---",
        `name: ${hookId}`,
        "events:",
        "  - PreToolUse",
        "actions:",
        "  - type: run_command",
        "    command: echo hello",
        "---",
        "",
      ].join("\n"),
    );
  }
}

function artifactFile(artifacts: PlatformArtifact[], filePath: string): string | undefined {
  for (const artifact of artifacts) {
    const found = artifact.files.find((f) => f.path === filePath);
    if (found !== undefined) return found.content;
  }
  return undefined;
}

function allArtifactPaths(artifacts: PlatformArtifact[]): string[] {
  return artifacts.flatMap((a) => a.files.map((f) => f.path));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetPackResolverStateForTests();
});

afterEach(() => {
  resetPackResolverStateForTests();
  for (const d of tmpdirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pack resolution integration", () => {
  test("pack agent appears in build output with namespaced ID", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { agentIds: ["helper"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "1.0.0" }]));

    const result = await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    expect(result.exitCode).not.toBe(1);
    // IR should contain agent with namespaced ID my-pack/helper
    const agentIR = result.artifacts.flatMap((a) => a.files).find((f) => f.path.includes("my-pack/helper"));
    // For opencode target, agent emitted as .md file
    const allPaths = allArtifactPaths(result.artifacts);
    expect(allPaths.some((p) => p.includes("my-pack/helper"))).toBe(true);
  });

  test("pack skill appears in build output with namespaced ID", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { skillIds: ["review"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "1.0.0" }]));

    const result = await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    expect(result.exitCode).not.toBe(1);
    const allPaths = allArtifactPaths(result.artifacts);
    expect(allPaths.some((p) => p.includes("my-pack/review"))).toBe(true);
  });

  test("pack content not copied to source dirs", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { agentIds: ["helper"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "1.0.0" }]));

    await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    // Source tree should NOT have a copy of the pack agent
    expect(fs.existsSync(path.join(dir, "agents", "my-pack"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "agents", "helper"))).toBe(false);
    // Pack source still in node_modules only
    expect(fs.existsSync(path.join(dir, "node_modules", "my-pack", "agents", "helper", "AGENT.md"))).toBe(true);
  });

  test("duplicate ID collision across two packs → ERR_PACK_ID_CONFLICT diagnostic", async () => {
    const dir = tmpDir();
    // Both packs have short name "toolbox", producing the same namespaced id "toolbox/shared"
    createMockPack(dir, "@scope/toolbox", "1.0.0", { agentIds: ["shared"] });
    createMockPack(dir, "toolbox", "1.0.0", { agentIds: ["shared"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([
      { name: "@scope/toolbox", version: "1.0.0" },
      { name: "toolbox", version: "1.0.0" },
    ]));

    const result = await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    expect(result.exitCode).toBe(1);
    const conflict = result.diagnostics.find((d) => d.code === "ERR_PACK_ID_CONFLICT");
    expect(conflict).toBeDefined();
  });

  test("Codex pack agent has .toml sibling file in build output", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { agentIds: ["helper"] });
    // Add a Codex TOML sibling for the pack agent
    write(
      path.join(dir, "node_modules", "my-pack"),
      "agents/helper/agent.codex.toml",
      `name = "helper"\ndescription = "Pack agent helper"\ndeveloper_instructions = "You are a helper."\n`,
    );
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "1.0.0" }]));

    const result = await runBuildCommand(dir, { target: "codex", validate: true }, io);

    expect(result.exitCode).not.toBe(1);
    const allPaths = allArtifactPaths(result.artifacts);
    // Codex emits agents as .toml under .codex/agents/
    expect(allPaths.some((p) => p === ".codex/agents/my-pack/helper.toml")).toBe(true);
  });

  test("pack with hooks works in build output", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { hookIds: ["on-save"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "1.0.0" }]));

    const result = await runBuildCommand(dir, { target: "codex", validate: true }, io);

    // No hard error (warn/info OK for dropped hooks)
    expect(result.exitCode).not.toBe(1);
    const allPaths = allArtifactPaths(result.artifacts);
    // Codex: hooks.json emitted (even if drop-warn, file exists with empty/partial content)
    expect(allPaths.some((p) => p === ".codex/hooks.json" || p === ".codex/config.toml")).toBe(true);
  });

  test("multiple packs resolved — all namespaced IDs appear in build output", async () => {
    const dir = tmpDir();
    createMockPack(dir, "pack-a", "1.0.0", { agentIds: ["agent-alpha"] });
    createMockPack(dir, "pack-b", "2.0.0", { skillIds: ["skill-beta"] });
    write(dir, ".0xcraft/config.jsonc", configWithPacks([
      { name: "pack-a", version: "1.0.0" },
      { name: "pack-b", version: "2.0.0" },
    ]));

    const result = await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    expect(result.exitCode).not.toBe(1);
    const allPaths = allArtifactPaths(result.artifacts);
    expect(allPaths.some((p) => p.includes("pack-a/agent-alpha"))).toBe(true);
    expect(allPaths.some((p) => p.includes("pack-b/skill-beta"))).toBe(true);
  });

  test("pack resolved from node_modules with version check — mismatch → WARN diagnostic, no hard error", async () => {
    const dir = tmpDir();
    createMockPack(dir, "my-pack", "1.0.0", { agentIds: ["helper"] });
    // Config declares a different version
    write(dir, ".0xcraft/config.jsonc", configWithPacks([{ name: "my-pack", version: "2.0.0" }]));

    const result = await runBuildCommand(dir, { target: "opencode", validate: true }, io);

    const versionWarn = result.diagnostics.find((d) => d.code === "WARN_PACK_VERSION_DRIFT");
    expect(versionWarn).toBeDefined();
    // Version drift is a warn not error, so exit should be 0 or 2
    expect(result.exitCode).not.toBe(1);
  });
});
