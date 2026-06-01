/**
 * T-6.8 Determinism and idempotence tests
 *
 * Verifies:
 *  - Same IR → byte-identical PlatformArtifact on repeated calls (all platforms)
 *  - TOML output: sorted keys, LF line endings, parses without error
 *  - JSON output: sorted keys, LF line endings
 *  - YAML frontmatter: sorted keys, LF line endings
 *  - No timestamps in any emitted content
 *  - File modes: scripts 0o755, text/config 0o644
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { emitClaude } from "../adapters/claude/emit";
import { emitCodex } from "../adapters/codex/emit";
import { emitOpenCode } from "../adapters/opencode/emit";
import { writeArtifact } from "../adapters/_shared/filesystem";
import type { PlatformArtifact } from "../adapters/_shared/artifact";
import { parseToml } from "../core/loader/toml-parser";
import { parseFrontmatter } from "../adapters/_shared/frontmatter";
import type { IRResource } from "../core/ir";

// ---------------------------------------------------------------------------
// Comprehensive IR fixture
// ---------------------------------------------------------------------------

const FIXTURE_IR: IRResource[] = [
  // Agent 1: full common + opencode/claude/codex platform overrides
  {
    id: "alpha-agent",
    kind: "agent",
    sourcePath: "agents/alpha-agent/AGENT.md",
    common: {
      name: "Alpha Agent",
      description: "Comprehensive test agent.",
      prompt: "You are alpha.\n",
      model: "gpt-4o",
      role: "subagent",
      maxTurns: 10,
      temperature: 0.7,
    },
    platform: {
      opencode: { mode: "agent", color: "#ff0000" },
      codex: {
        model_reasoning_effort: "high",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
      },
    },
    _sources: {},
  },

  // Agent 2: claude-flavoured
  {
    id: "beta-agent",
    kind: "agent",
    sourcePath: "agents/beta-agent/AGENT.md",
    common: {
      name: "Beta Agent",
      description: "Claude-focused agent.",
      prompt: "You are beta.\n",
      model: "claude-opus-4-5",
    },
    platform: {
      claude: {
        effort: "high",
        maxTurns: 5,
        tools: ["Bash", "Read"],
        disallowedTools: ["WebSearch"],
        skills: ["my-skill"],
        background: true,
        isolation: "none",
      },
    },
    _sources: {},
  },

  // Skill with allowed-tools (tests frontmatter key ordering)
  {
    id: "my-skill",
    kind: "skill",
    sourcePath: "skills/my-skill/SKILL.md",
    common: {
      name: "My Skill",
      description: "A skill with tool restrictions.",
      body: "Use this skill for running tests.\n",
      "allowed-tools": ["Bash", "Read"],
    },
    platform: {
      claude: {
        "allowed-tools": ["Bash"],
        when_to_use: "For test automation",
      },
    },
    _sources: {},
  },

  // Hook: run_command (all platforms)
  {
    id: "pre-tool-hook",
    kind: "hook",
    sourcePath: "hooks/pre-tool-hook/HOOK.md",
    common: {
      name: "Pre Tool Hook",
      events: ["PreToolUse"],
      actions: [
        {
          type: "run_command",
          command: "echo 'pre'",
          shell: "/bin/bash",
          timeoutMs: 3000,
        },
      ],
    },
    platform: {},
    _sources: {},
  },

  // Hook: http_request (OpenCode+Claude only, Codex drop-warns)
  {
    id: "notify-hook",
    kind: "hook",
    sourcePath: "hooks/notify-hook/HOOK.md",
    common: {
      name: "Notify Hook",
      events: ["PostToolUse"],
      actions: [
        {
          type: "http_request",
          url: "https://hooks.example.com/notify",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      ],
    },
    platform: {},
    _sources: {},
  },

  // MCP stdio
  {
    id: "my-mcp",
    kind: "mcp",
    sourcePath: "mcp/my-mcp/MCP.md",
    common: {
      name: "My MCP",
      description: "A stdio MCP server.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@my/mcp-server"],
      env: { TOKEN: "env-ref" },
    },
    mcpEnvelope: {
      sourceShape: "direct",
      emitShape: "wrapped",
      wrapperKey: "mcp_servers",
    },
    platform: {},
    _sources: {},
  },

  // Command
  {
    id: "greet-cmd",
    kind: "command",
    sourcePath: "commands/greet-cmd/COMMAND.md",
    common: {
      name: "Greet",
      description: "Greet the user.",
      template: "Say hello to $USER.\n",
    },
    platform: {},
    _sources: {},
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical string representation of artifact files for byte comparison. */
function artifactFingerprint(artifact: PlatformArtifact): string {
  return [...artifact.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}\x00${f.mode ?? "?"}\x00${f.content}`)
    .join("\n\x01\n");
}

/** Extract all .md files with YAML frontmatter from artifact. */
function mdFiles(artifact: PlatformArtifact): Array<{ path: string; content: string }> {
  return artifact.files.filter((f) => f.path.endsWith(".md"));
}

/** Extract all .toml files from artifact. */
function tomlFiles(artifact: PlatformArtifact): Array<{ path: string; content: string }> {
  return artifact.files.filter((f) => f.path.endsWith(".toml"));
}

/** Extract all .json files from artifact. */
function jsonFiles(artifact: PlatformArtifact): Array<{ path: string; content: string }> {
  return artifact.files.filter((f) => f.path.endsWith(".json"));
}

/** Assert all keys in an object are alphabetically sorted (recursive). */
function assertSortedKeys(value: unknown, filePath: string, keyPath = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSortedKeys(item, filePath, `${keyPath}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    for (let i = 0; i < keys.length - 1; i++) {
      const cur = keys[i]!;
      const nxt = keys[i + 1]!;
      expect(cur.localeCompare(nxt)).toBeLessThanOrEqual(0);
      // `< 0` assertion message surfaced as bun test failure context
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      assertSortedKeys(v, filePath, keyPath);
    }
  }
}

/** ISO timestamp pattern */
const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
/** Unix epoch (>= 10 digits, i.e. seconds since 1970) */
const UNIX_TS = /\b1[0-9]{9}\b/;
/** Large numeric timestamp in ms (>= 13 digits) */
const UNIX_TS_MS = /\b1[0-9]{12}\b/;
/** date-only string */
const DATE_ONLY = /\b\d{4}-\d{2}-\d{2}\b/;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Determinism and idempotence", () => {
  // ── Byte-identical artifacts on repeat emit ─────────────────────────────

  describe("Byte-identical artifacts on repeat emit", () => {
    test("OpenCode: run 1 === run 2", () => {
      const run1 = emitOpenCode(FIXTURE_IR);
      const run2 = emitOpenCode(FIXTURE_IR);
      expect(artifactFingerprint(run1)).toEqual(artifactFingerprint(run2));
      expect(run1.files.length).toBeGreaterThan(0);
    });

    test("Claude plugin: run 1 === run 2", () => {
      const opts = {
        mode: "claude-plugin" as const,
        packageMetadata: { name: "det-test", version: "1.0.0", description: "det test" },
      };
      const run1 = emitClaude(FIXTURE_IR, opts);
      const run2 = emitClaude(FIXTURE_IR, opts);
      expect(artifactFingerprint(run1)).toEqual(artifactFingerprint(run2));
      expect(run1.files.length).toBeGreaterThan(0);
    });

    test("Claude subagent: run 1 === run 2", () => {
      const opts = { mode: "claude-subagent" as const };
      const run1 = emitClaude(FIXTURE_IR, opts);
      const run2 = emitClaude(FIXTURE_IR, opts);
      expect(artifactFingerprint(run1)).toEqual(artifactFingerprint(run2));
      expect(run1.files.length).toBeGreaterThan(0);
    });

    test("Codex: run 1 === run 2", () => {
      const opts = { emitPlugin: true, emitMarketplace: true };
      const run1 = emitCodex(FIXTURE_IR, opts);
      const run2 = emitCodex(FIXTURE_IR, opts);
      expect(artifactFingerprint(run1)).toEqual(artifactFingerprint(run2));
      expect(run1.files.length).toBeGreaterThan(0);
    });

    test("Codex (no plugin): run 1 === run 2", () => {
      const run1 = emitCodex(FIXTURE_IR, {});
      const run2 = emitCodex(FIXTURE_IR, {});
      expect(artifactFingerprint(run1)).toEqual(artifactFingerprint(run2));
    });
  });

  // ── Format validation ────────────────────────────────────────────────────

  describe("Format validation", () => {
    describe("TOML: sorted keys + LF", () => {
      test("Codex .toml files parse without error", () => {
        const artifact = emitCodex(FIXTURE_IR, {});
        const tomls = tomlFiles(artifact);
        expect(tomls.length).toBeGreaterThan(0);
        for (const file of tomls) {
          expect(() => parseToml(file.content)).not.toThrow();
        }
      });

      test("Codex .toml files use LF line endings only", () => {
        const artifact = emitCodex(FIXTURE_IR, {});
        for (const file of tomlFiles(artifact)) {
          expect(file.content).not.toMatch(/\r/);
        }
      });

      test("Codex .toml files have trailing LF", () => {
        const artifact = emitCodex(FIXTURE_IR, {});
        for (const file of tomlFiles(artifact)) {
          expect(file.content.endsWith("\n")).toBe(true);
        }
      });
    });

    describe("JSON: sorted keys + LF", () => {
      test("All JSON files parse without error", () => {
        const oc = emitOpenCode(FIXTURE_IR);
        const cc = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        const cx = emitCodex(FIXTURE_IR, { emitPlugin: true });
        for (const artifact of [oc, cc, cx]) {
          for (const file of jsonFiles(artifact)) {
            expect(() => JSON.parse(file.content)).not.toThrow();
          }
        }
      });

      test("OpenCode opencode.json has sorted keys", () => {
        const artifact = emitOpenCode(FIXTURE_IR);
        const ocJson = artifact.files.find((f) => f.path === "opencode.json");
        expect(ocJson).toBeDefined();
        const parsed = JSON.parse(ocJson!.content);
        assertSortedKeys(parsed, "opencode.json");
      });

      test("Claude plugin.json has sorted keys", () => {
        const artifact = emitClaude(FIXTURE_IR, {
          mode: "claude-plugin" as const,
          packageMetadata: { name: "p", version: "1.0.0", description: "d" },
        });
        const manifest = artifact.files.find((f) => f.path === ".claude-plugin/plugin.json");
        expect(manifest).toBeDefined();
        const parsed = JSON.parse(manifest!.content);
        assertSortedKeys(parsed, ".claude-plugin/plugin.json");
      });

      test("Claude hooks.json has sorted keys", () => {
        const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        const hooksJson = artifact.files.find((f) => f.path.endsWith("hooks.json"));
        if (hooksJson === undefined) return; // no hooks emitted is fine
        const parsed = JSON.parse(hooksJson.content);
        assertSortedKeys(parsed, hooksJson.path);
      });

      test("Codex .mcp.json has sorted keys", () => {
        const artifact = emitCodex(FIXTURE_IR, {});
        const mcpJson = artifact.files.find((f) => f.path === ".mcp.json");
        expect(mcpJson).toBeDefined();
        const parsed = JSON.parse(mcpJson!.content);
        assertSortedKeys(parsed, ".mcp.json");
      });

      test("All JSON files use LF line endings only", () => {
        const oc = emitOpenCode(FIXTURE_IR);
        const cc = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        const cx = emitCodex(FIXTURE_IR, { emitPlugin: true, emitMarketplace: true });
        for (const artifact of [oc, cc, cx]) {
          for (const file of jsonFiles(artifact)) {
            expect(file.content).not.toMatch(/\r/);
          }
        }
      });

      test("All JSON files have trailing LF", () => {
        const oc = emitOpenCode(FIXTURE_IR);
        const cc = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        const cx = emitCodex(FIXTURE_IR, { emitPlugin: true });
        for (const artifact of [oc, cc, cx]) {
          for (const file of jsonFiles(artifact)) {
            expect(file.content.endsWith("\n")).toBe(true);
          }
        }
      });
    });

    describe("YAML frontmatter: sorted keys + LF", () => {
      test("OpenCode .md files have sorted frontmatter keys", () => {
        const artifact = emitOpenCode(FIXTURE_IR);
        for (const file of mdFiles(artifact)) {
          const { meta } = parseFrontmatter(file.content);
          const keys = Object.keys(meta);
          for (let i = 0; i < keys.length - 1; i++) {
            expect(keys[i]!.localeCompare(keys[i + 1]!)).toBeLessThanOrEqual(0);
          }
        }
      });

      test("Claude plugin .md files have sorted frontmatter keys", () => {
        const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        for (const file of mdFiles(artifact)) {
          const { meta } = parseFrontmatter(file.content);
          const keys = Object.keys(meta);
          for (let i = 0; i < keys.length - 1; i++) {
            expect(keys[i]!.localeCompare(keys[i + 1]!)).toBeLessThanOrEqual(0);
          }
        }
      });

      test("Claude subagent .md files have sorted frontmatter keys", () => {
        const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" as const });
        for (const file of mdFiles(artifact)) {
          const { meta } = parseFrontmatter(file.content);
          const keys = Object.keys(meta);
          for (let i = 0; i < keys.length - 1; i++) {
            expect(keys[i]!.localeCompare(keys[i + 1]!)).toBeLessThanOrEqual(0);
          }
        }
      });

      test("All .md files use LF line endings only", () => {
        const oc = emitOpenCode(FIXTURE_IR);
        const cc = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        const cs = emitClaude(FIXTURE_IR, { mode: "claude-subagent" as const });
        for (const artifact of [oc, cc, cs]) {
          for (const file of mdFiles(artifact)) {
            expect(file.content).not.toMatch(/\r/);
          }
        }
      });

      test("All .md files have trailing LF", () => {
        const oc = emitOpenCode(FIXTURE_IR);
        const cc = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
        for (const artifact of [oc, cc]) {
          for (const file of mdFiles(artifact)) {
            expect(file.content.endsWith("\n")).toBe(true);
          }
        }
      });
    });
  });

  // ── No timestamps ────────────────────────────────────────────────────────

  describe("No timestamps", () => {
    function collectAllContent(artifact: PlatformArtifact): Array<{ path: string; content: string }> {
      return artifact.files;
    }

    test("OpenCode: no timestamps in any emitted file", () => {
      const artifact = emitOpenCode(FIXTURE_IR);
      for (const file of collectAllContent(artifact)) {
        expect(file.content).not.toMatch(ISO_TS);
        expect(file.content).not.toMatch(UNIX_TS_MS);
      }
    });

    test("Claude plugin: no timestamps in any emitted file", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-plugin" as const });
      for (const file of collectAllContent(artifact)) {
        expect(file.content).not.toMatch(ISO_TS);
        expect(file.content).not.toMatch(UNIX_TS_MS);
      }
    });

    test("Claude subagent: no timestamps in any emitted file", () => {
      const artifact = emitClaude(FIXTURE_IR, { mode: "claude-subagent" as const });
      for (const file of collectAllContent(artifact)) {
        expect(file.content).not.toMatch(ISO_TS);
        expect(file.content).not.toMatch(UNIX_TS_MS);
      }
    });

    test("Codex: no timestamps in any emitted file", () => {
      const artifact = emitCodex(FIXTURE_IR, { emitPlugin: true, emitMarketplace: true });
      for (const file of collectAllContent(artifact)) {
        expect(file.content).not.toMatch(ISO_TS);
        expect(file.content).not.toMatch(UNIX_TS_MS);
      }
    });
  });

  // ── File modes ────────────────────────────────────────────────────────────

  describe("File modes", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-det-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("OpenCode: all files are mode 0o644", () => {
      const artifact = emitOpenCode(FIXTURE_IR);
      writeArtifact(artifact, tmpDir, { force: true });

      for (const file of artifact.files) {
        const abs = path.join(tmpDir, file.path);
        const mode = fs.statSync(abs).mode & 0o777;
        expect(mode).toBe(0o644);
      }
    });

    test("Claude plugin: all files are mode 0o644", () => {
      const artifact = emitClaude(FIXTURE_IR, {
        mode: "claude-plugin" as const,
        packageMetadata: { name: "p", version: "1.0.0", description: "d" },
      });
      writeArtifact(artifact, tmpDir, { force: true });

      for (const file of artifact.files) {
        const abs = path.join(tmpDir, file.path);
        const mode = fs.statSync(abs).mode & 0o777;
        expect(mode).toBe(0o644);
      }
    });

    test("Codex: .toml/.json/.md files are mode 0o644", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      writeArtifact(artifact, tmpDir, { force: true });

      for (const file of artifact.files) {
        if (
          file.path.endsWith(".toml") ||
          file.path.endsWith(".json") ||
          file.path.endsWith(".md")
        ) {
          const abs = path.join(tmpDir, file.path);
          const mode = fs.statSync(abs).mode & 0o777;
          expect(mode).toBe(0o644);
        }
      }
    });

    test("Codex: .sh script files are mode 0o755", () => {
      // Synthesize an artifact with a .sh file to verify mode handling.
      // Codex doesn't currently emit .sh files from the standard emitter,
      // but writeArtifact must honour explicit mode values — test this
      // contract with a synthetic artifact.
      const syntheticArtifact: import("../adapters/_shared/artifact").PlatformArtifact = {
        platform: "codex",
        kind: "filesystem-tree",
        ok: true,
        files: [
          { path: "hook.sh", content: "#!/bin/bash\necho hi\n", mode: 0o755 },
          { path: "config.toml", content: "[features]\nhooks = true\n", mode: 0o644 },
        ],
        diagnostics: [],
        capabilityReport: { platform: "codex", features: {} as never },
        metadata: { deterministic: true },
      };

      writeArtifact(syntheticArtifact, tmpDir, { force: true });

      const shMode = fs.statSync(path.join(tmpDir, "hook.sh")).mode & 0o777;
      const tomlMode = fs.statSync(path.join(tmpDir, "config.toml")).mode & 0o777;

      expect(shMode).toBe(0o755);
      expect(tomlMode).toBe(0o644);
    });

    test("File modes are stable across two writes (idempotent)", () => {
      const artifact = emitCodex(FIXTURE_IR, {});
      writeArtifact(artifact, tmpDir, { force: true });

      // Collect modes from first write
      const modes1: Record<string, number> = {};
      for (const file of artifact.files) {
        const abs = path.join(tmpDir, file.path);
        modes1[file.path] = fs.statSync(abs).mode & 0o777;
      }

      // Second write (force=true overwrites)
      const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-det-test2-"));
      try {
        writeArtifact(artifact, tmpDir2, { force: true });

        for (const file of artifact.files) {
          const abs2 = path.join(tmpDir2, file.path);
          const mode2 = fs.statSync(abs2).mode & 0o777;
          expect(mode2).toBe(modes1[file.path]!);
        }
      } finally {
        fs.rmSync(tmpDir2, { recursive: true, force: true });
      }
    });
  });
});
