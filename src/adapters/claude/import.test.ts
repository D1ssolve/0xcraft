import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { importClaude } from "./import";
import type { ClaudeImportMode } from "./import";
import type { AgentIR, SkillIR } from "../../core/ir";

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
      const pluginDir = join(dir, ".claude-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        name: "test-plugin",
        version: "1.0.0",
      }));

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
      const agent = agents[0]!;
      expect(agent.id).toBe("reviewer");
      expect(agent.common.prompt).toBe("You are a code reviewer.");
      expect(agent.common.model).toBe("sonnet");
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

  it("loads plugin agent references from agents/<id>/references", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "reviewer.md"), [
        "---",
        "name: reviewer",
        "description: Code review agent",
        "---",
        "Review code.",
      ].join("\n"));

      const referencesDir = join(agentsDir, "reviewer", "references");
      mkdirSync(referencesDir, { recursive: true });
      writeFileSync(join(referencesDir, "guide.md"), "Review guide\n");
      writeFileSync(join(referencesDir, "Bad File.md"), "skip me\n");

      const result = importClaude(dir, { mode: "claude-plugin" });
      const agent = result.ir.find((r): r is AgentIR => r.kind === "agent" && r.id === "reviewer");

      expect(agent?.references).toEqual({ "guide.md": "Review guide\n" });
      expect(agent?.provenance?.sourceFiles).toContain(join(referencesDir, "guide.md"));
    } finally {
      cleanup(dir);
    }
  });

  it("loads plugin skill references from skills/<id>/references", () => {
    const dir = createTempDir();
    try {
      const skillDir = join(dir, "skills", "planner");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), [
        "---",
        "name: planner",
        "description: Planning skill",
        "---",
        "Plan work.",
      ].join("\n"));

      const referencesDir = join(skillDir, "references");
      mkdirSync(referencesDir, { recursive: true });
      writeFileSync(join(referencesDir, "template.txt"), "Plan template\n");

      const result = importClaude(dir, { mode: "claude-plugin" });
      const skill = result.ir.find((r): r is SkillIR => r.kind === "skill" && r.id === "planner");

      expect(skill?.references).toEqual({ "template.txt": "Plan template\n" });
      expect(skill?.provenance?.sourceFiles).toContain(join(referencesDir, "template.txt"));
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
      const agent = agents[0]!;
      expect(agent.common.prompt).toBe("You build things.");
      const claude = (agent.platform as Record<string, Record<string, unknown>>)?.claude;
      expect(claude?.permissionMode).toBe("auto");
    } finally {
      cleanup(dir);
    }
  });

  it("loads subagent references from .claude/agents/<id>/references", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".claude", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "builder.md"), [
        "---",
        "name: builder",
        "description: Build agent",
        "---",
        "Build things.",
      ].join("\n"));

      const referencesDir = join(agentsDir, "builder", "references");
      mkdirSync(referencesDir, { recursive: true });
      writeFileSync(join(referencesDir, "notes.md"), "Build notes\n");

      const result = importClaude(dir, { mode: "claude-subagent" });
      const agent = result.ir.find((r): r is AgentIR => r.kind === "agent" && r.id === "builder");

      expect(agent?.references).toEqual({ "notes.md": "Build notes\n" });
      expect(agent?.provenance?.sourceFiles).toContain(join(referencesDir, "notes.md"));
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
      expect(mcps[0]!.common.transport).toBe("http");

      const normalizedDiag = result.diagnostics.find(
        (d) => d.code === "mcp.envelope.normalized" && d.details?.originalType === "streamable-http",
      );
      expect(normalizedDiag).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  it("infers http transport when mcp server type is omitted but url is present", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify({
        mcpServers: {
          "implicit-http": {
            url: "https://example.com/mcp",
          },
        },
      }));

      const result = importClaude(dir, { mode: "claude-plugin" });
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      expect(mcps[0]!.common.transport).toBe("http");
      expect(mcps[0]!.common.url).toBe("https://example.com/mcp");
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
      const hook = hooks[0]!;
      expect(hook.common.actions[0]!.type).toBe("run_command");
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
