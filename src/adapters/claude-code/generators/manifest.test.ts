import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { claudeCodeManifestSchema } from "../types/claude-code-types";
import { generateClaudeCodeManifest } from "./manifest";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readManifest(outputRoot: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(outputRoot, ".claude-plugin", "plugin.json"), "utf8"));
}

describe("generateClaudeCodeManifest", () => {
  test("writes plugin.json with required name and package metadata", () => {
    const outputRoot = makeTempDir("0xcraft-claude-manifest-basic-");

    const result = generateClaudeCodeManifest({
      outputRoot,
      packageMetadata: {
        name: "0xcraft",
        version: "0.1.0",
        description: "Agent operations plugin",
        author: "diss0x",
        license: "MIT",
        repository: "https://github.com/example/0xcraft",
        homepage: "https://example.test/0xcraft",
        keywords: ["opencode", "agents"],
      },
      emittedComponents: {
        agents: true,
        skills: true,
        hooks: true,
        mcpServers: true,
      },
    });

    expect(result.emittedFiles).toEqual([".claude-plugin/plugin.json"]);
    expect(result.manifest).toEqual({
      name: "0xcraft",
      version: "0.1.0",
      description: "Agent operations plugin",
      author: "diss0x",
      license: "MIT",
      repository: "https://github.com/example/0xcraft",
      homepage: "https://example.test/0xcraft",
      keywords: ["opencode", "agents"],
      agents: "agents/",
      skills: "skills/",
      hooks: "hooks/hooks.json",
      mcpServers: ".mcp.json",
    });
    expect(claudeCodeManifestSchema.parse(readManifest(outputRoot))).toEqual(result.manifest);
  });

  test("includes component path fields only for emitted components", () => {
    const outputRoot = makeTempDir("0xcraft-claude-manifest-components-");

    generateClaudeCodeManifest({
      outputRoot,
      packageMetadata: {
        name: "0xcraft",
        description: "Agent operations plugin",
      },
      emittedComponents: {
        agents: true,
        skills: false,
        hooks: false,
        mcpServers: true,
      },
    });

    expect(readManifest(outputRoot)).toEqual({
      agents: "agents/",
      description: "Agent operations plugin",
      mcpServers: ".mcp.json",
      name: "0xcraft",
    });
  });

  test("omits displayName until Claude Code v2.1.143 or explicit support is confirmed", () => {
    const unknownOutputRoot = makeTempDir("0xcraft-claude-manifest-display-unknown-");
    const oldOutputRoot = makeTempDir("0xcraft-claude-manifest-display-old-");
    const supportedVersionOutputRoot = makeTempDir("0xcraft-claude-manifest-display-version-");
    const explicitOutputRoot = makeTempDir("0xcraft-claude-manifest-display-explicit-");

    const baseOptions = {
      packageMetadata: {
        name: "0xcraft",
        displayName: "0xcraft Agents",
      },
      emittedComponents: {},
    };

    expect(generateClaudeCodeManifest({ ...baseOptions, outputRoot: unknownOutputRoot }).manifest.displayName).toBeUndefined();
    expect(
      generateClaudeCodeManifest({
        ...baseOptions,
        outputRoot: oldOutputRoot,
        compatibility: { claudeCodeVersion: "2.1.142" },
      }).manifest.displayName,
    ).toBeUndefined();
    expect(
      generateClaudeCodeManifest({
        ...baseOptions,
        outputRoot: supportedVersionOutputRoot,
        compatibility: { claudeCodeVersion: "2.1.143" },
      }).manifest.displayName,
    ).toBe("0xcraft Agents");
    expect(
      generateClaudeCodeManifest({
        ...baseOptions,
        outputRoot: explicitOutputRoot,
        compatibility: { supportsDisplayName: true },
      }).manifest.displayName,
    ).toBe("0xcraft Agents");
  });

  test("re-running with the same inputs and force produces deterministic output", () => {
    const outputRoot = makeTempDir("0xcraft-claude-manifest-deterministic-");
    const options = {
      outputRoot,
      force: true,
      packageMetadata: {
        name: "0xcraft",
        version: "0.1.0",
        description: "Agent operations plugin",
        keywords: ["opencode", "agents"],
      },
      emittedComponents: {
        skills: true,
        agents: true,
      },
    };

    generateClaudeCodeManifest(options);
    const first = fs.readFileSync(path.join(outputRoot, ".claude-plugin", "plugin.json"), "utf8");
    generateClaudeCodeManifest(options);
    const second = fs.readFileSync(path.join(outputRoot, ".claude-plugin", "plugin.json"), "utf8");

    expect(second).toBe(first);
    expect(first).toBe(
      '{\n  "agents": "agents/",\n  "description": "Agent operations plugin",\n  "keywords": [\n    "opencode",\n    "agents"\n  ],\n  "name": "0xcraft",\n  "skills": "skills/",\n  "version": "0.1.0"\n}\n',
    );
  });

  test("rejects missing package name before writing invalid manifest", () => {
    const outputRoot = makeTempDir("0xcraft-claude-manifest-invalid-");

    expect(() =>
      generateClaudeCodeManifest({
        outputRoot,
        packageMetadata: {
          description: "Missing package name",
        },
        emittedComponents: {},
      }),
    ).toThrow();
    expect(fs.existsSync(path.join(outputRoot, ".claude-plugin", "plugin.json"))).toBe(false);
  });
});
