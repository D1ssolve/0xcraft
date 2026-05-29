/**
 * Batch E integration — Codex `.codex-plugin/` bundle + marketplace stub.
 *
 * Drives `buildCodexFiles` end-to-end under three opt-in matrices:
 *   1. Default (no opt-in)            → zero `.codex-plugin/` files,
 *                                       zero `.agents/plugins/...` files.
 *   2. emitPlugin=true                → plugin.json + .mcp.json + skills +
 *                                       hooks/* (when hooks present);
 *                                       no marketplace.
 *   3. emitPlugin=true + emitMarketplace=true → also emits
 *                                       `.agents/plugins/marketplace.json`.
 *   4. emitMarketplace=true alone     → warn diagnostic, no marketplace
 *                                       file emitted.
 *
 * Determinism: identical opts called twice must produce byte-equal
 * `files[]` arrays.
 *
 * Sandboxing: builds in-memory (no disk), so no `os.tmpdir()` needed.
 */

import { describe, expect, test } from "bun:test";

import { buildCodexFiles } from "../adapters/codex";

const baseOpts = {
  packageRoot: undefined as string | undefined,
  projectRoot: "/tmp/0xcraft-codex-plugin-bundle-test",
};

describe("Codex `.codex-plugin/` bundle (Batch E integration)", () => {
  test("default build emits ZERO .codex-plugin/ files", async () => {
    const out = await buildCodexFiles({
      ...baseOpts,
      config: {},
    });
    const bundleFiles = out.files.filter((f) => f.path.startsWith(".codex-plugin/"));
    expect(bundleFiles).toEqual([]);
    const marketplaceFiles = out.files.filter((f) =>
      f.path.startsWith(".agents/plugins/"),
    );
    expect(marketplaceFiles).toEqual([]);
  });

  test("emitPlugin=true emits plugin.json + .mcp.json + skill copies + hook copies", async () => {
    const out = await buildCodexFiles({
      ...baseOpts,
      config: { platforms: { codex: { emitPlugin: true } } },
    });

    const paths = out.files.map((f) => f.path);

    expect(paths).toContain(".codex-plugin/plugin.json");

    // plugin.json content sanity.
    const pluginFile = out.files.find((f) => f.path === ".codex-plugin/plugin.json");
    const manifest = JSON.parse(pluginFile!.content);
    expect(typeof manifest.name).toBe("string");

    // Whenever MCP servers exist, .mcp.json mirrors them.
    if (manifest.mcpServers !== undefined) {
      expect(paths).toContain(".codex-plugin/.mcp.json");
    }

    // Whenever hooks emitted, hooks.json + at least one .sh mirrored.
    if (manifest.hooks !== undefined) {
      expect(paths).toContain(".codex-plugin/hooks/hooks.json");
      expect(paths.some((p) => p.startsWith(".codex-plugin/hooks/") && p.endsWith(".sh"))).toBe(true);
    }

    // Whenever skills emitted, at least one `.codex-plugin/skills/<id>/SKILL.md`.
    if (manifest.skills !== undefined && manifest.skills.length > 0) {
      expect(paths.some((p) => p.startsWith(".codex-plugin/skills/") && p.endsWith("/SKILL.md"))).toBe(true);
    }
  });

  test("apps key omitted by default when emitPlugin=true (emitApps not set)", async () => {
    const out = await buildCodexFiles({
      ...baseOpts,
      config: { platforms: { codex: { emitPlugin: true } } },
    });
    const pluginFile = out.files.find((f) => f.path === ".codex-plugin/plugin.json");
    const manifest = JSON.parse(pluginFile!.content);
    expect(manifest.apps).toBeUndefined();
  });

  test("emitPlugin + emitMarketplace emits .agents/plugins/marketplace.json", async () => {
    const out = await buildCodexFiles({
      ...baseOpts,
      config: { platforms: { codex: { emitPlugin: true, emitMarketplace: true } } },
    });
    const paths = out.files.map((f) => f.path);
    expect(paths).toContain(".agents/plugins/marketplace.json");

    const market = out.files.find((f) => f.path === ".agents/plugins/marketplace.json");
    const parsed = JSON.parse(market!.content);
    expect(parsed.name).toMatch(/-marketplace$/);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].path).toBe("./.codex-plugin");
  });

  test("emitMarketplace without emitPlugin emits warn + no marketplace file", async () => {
    const out = await buildCodexFiles({
      ...baseOpts,
      config: { platforms: { codex: { emitMarketplace: true } } },
    });
    const paths = out.files.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith(".agents/plugins/"))).toEqual([]);

    const warn = out.diagnostics.find(
      (d) => d.code === "codex.plugin.marketplace_requires_plugin",
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  test("byte-identical files[] across two invocations (deterministic)", async () => {
    const opts = {
      ...baseOpts,
      config: { platforms: { codex: { emitPlugin: true, emitMarketplace: true } } },
    };
    const a = await buildCodexFiles(opts);
    const b = await buildCodexFiles(opts);
    const stripMode = (files: typeof a.files) =>
      files.map(({ path, content, mode }) => ({ path, content, mode }));
    expect(JSON.stringify(stripMode(a.files))).toBe(JSON.stringify(stripMode(b.files)));
  });
});
