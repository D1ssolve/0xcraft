import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { importClaude } from "./import";
import type { ClaudeImportMode } from "./import";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "claude-import-"));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("importClaude", () => {
  it("imports plugin agents from agents/*.md", () => {
    const dir = createTempDir();
    try {
      // Create plugin manifest
      const pluginDir = join(dir, ".claude-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        name: "test-plugin",
        version: "1.0.0",
      }));

      // Create plugin agent
      const agentsDir = join(dir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "reviewer.md"), [
        "---",
        "name: reviewer",
        "description: Code review agent",
        "model: sonnet",
        "effort: high",
        "maxTurns: 10",
        "---",
        "You are a code reviewer.",
      ].join("\n"));

      const result = importClaude(dir, { mode: "claude-plugin" });
      expect(result.mode).toBe("claude-plugin");
      const agents = result.ir.filter((r) => r.kind === "agent");
      expect(agents.length).toBe(1);
      const agent = agents[0];
      expect(agent.id).toBe("reviewer");
      expect(agent.common.prompt).toBe("You are a code reviewer.");
      expect(agent.provenance?.importedFrom).toBe("claude-code");
    } finally {
      cleanup(dir);
    }
  });

  it("flags forbidden fields in plugin agents with diagnostic", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "admin.md"), [
        "---",
        "name: admin",
        "description: Admin agent",
        "hooks:",
        "  PreToolUse:",
        "    - type: command",
        "      command: echo hello",
        "mcpServers:",
        "  - my-server",
        "permissionMode: bypassPermissions",
        "---",
        "Admin agent prompt.",
      ].join("\n"));

      const result = importClaude(dir, { mode: "claude-plugin" });
      const strippedDiags = result.diagnostics.filter(
        (d) => d.code === "claude.agent.plugin.field_stripped",
      );
      expect(strippedDiags.length).toBeGreaterThanOrEqual(1);
      const strippedFields = strippedDiags.map((d) => d.details?.field);
      expect(strippedFields).toContain("hooks");
      expect(strippedFields).toContain("mcpServers");
      expect(strippedFields).toContain("permissionMode");
    } finally {
      cleanup(dir);
    }
  });

  it("imports full subagent agents from .claude/agents/*.md", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".claude", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "builder.md"), [
        "---",
        "name: builder",
        "description: Build agent",
        "model: opus",
        "permissionMode: auto",
        "memory: project",
        "background: true",
        "---",
        "You build things.",
      ].join("\n"));

      const result = importClaude(dir, { mode: "claude-subagent" });
      expect(result.mode).toBe("claude-subagent");
      const agents = result.ir.filter((r) => r.kind === "agent");
      expect(agents.length).toBe(1);
      const agent = agents[0];
      expect(agent.common.prompt).toBe("You build things.");
      // permissionMode should be in platform.claude, not stripped
      const claude = (agent.platform as Record<string, Record<string, unknown>>)?.claude;
      expect(claude?.permissionMode).toBe("auto");
    } finally {
      cleanup(dir);
    }
  });

  it("rewrites camelCase allowedTools to allowed-tools with diagnostic", () => {
    const dir = createTempDir();
    try {
      const skillsDir = join(dir, "skills", "my-skill");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(join(skillsDir, "SKILL.md"), [
        "---",
        "name: my-skill",
        "description: Test skill",
        "allowedTools: Read Write",
        "---",
        "Skill body.",
      ].join("\n"));

      const result = importClaude(dir, { mode: "claude-plugin" });
      const deprecatedDiag = result.diagnostics.find(
        (d) => d.code === "skill.frontmatter.camelCase.deprecated",
      );
      expect(deprecatedDiag).toBeDefined();

      const skill = result.ir.find((r) => r.kind === "skill" && r.id === "my-skill");
      expect(skill).toBeDefined();
      expect((skill?.common as Record<string, unknown>)["allowed-tools"]).toEqual(["Read", "Write"]);
    } finally {
      cleanup(dir);
    }
  });

  it("accepts streamable-http as http transport", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify({
        mcpServers: {
          "streaming-server": {
            type: "streamable-http",
            url: "https://example.com/mcp",
          },
        },
      }));

      const result = importClaude(dir, { mode: "claude-plugin" });
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      expect(mcps[0].common.transport).toBe("http");

      const normalizedDiag = result.diagnostics.find(
        (d) => d.code === "mcp.envelope.normalized" && d.details?.originalType === "streamable-http",
      );
      expect(normalizedDiag).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  it("maps hooks.json command handler to run_command HookActionIR", () => {
    const dir = createTempDir();
    try {
      const hooksDir = join(dir, "hooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(join(hooksDir, "hooks.json"), JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "echo 'running'" },
              ],
            },
          ],
        },
      }));

      const result = importClaude(dir, { mode: "claude-plugin" });
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBeGreaterThanOrEqual(1);
      const hook = hooks[0];
      expect(hook.common.actions[0].type).toBe("run_command");
      expect((hook.common.actions[0] as { command: string }).command).toBe("echo 'running'");
    } finally {
      cleanup(dir);
    }
  });

  it("auto-detects plugin mode from .claude-plugin/plugin.json", () => {
    const dir = createTempDir();
    try {
      const pluginDir = join(dir, ".claude-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "auto-plugin" }));

      const result = importClaude(dir, { mode: "auto" });
      expect(result.mode).toBe("claude-plugin");
    } finally {
      cleanup(dir);
    }
  });

  it("auto-detects subagent mode from .claude/agents/", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".claude", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "test.md"), [
        "---",
        "name: test",
        "description: Test",
        "---",
        "Prompt.",
      ].join("\n"));

      const result = importClaude(dir, { mode: "auto" });
      expect(result.mode).toBe("claude-subagent");
    } finally {
      cleanup(dir);
    }
  });
});
