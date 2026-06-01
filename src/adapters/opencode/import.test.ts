import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { importOpenCode } from "./import";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "opencode-import-"));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("importOpenCode", () => {
  it("imports agents from .opencode/agents/*.md", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".opencode", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "code-explorer.md"), [
        "---",
        "name: code-explorer",
        "description: Read-only codebase discovery",
        "mode: subagent",
        "model: haiku",
        "---",
        "You are a code explorer agent.",
      ].join("\n"));

      const result = importOpenCode(dir);
      const agents = result.ir.filter((r) => r.kind === "agent");
      expect(agents.length).toBe(1);
      const agent = agents[0];
      expect(agent.id).toBe("code-explorer");
      expect(agent.common.name).toBe("code-explorer");
      expect(agent.common.description).toBe("Read-only codebase discovery");
      expect(agent.common.prompt).toBe("You are a code explorer agent.");
      expect(agent.common.role).toBe("subagent");
      expect(agent.provenance?.importedFrom).toBe("opencode");
    } finally {
      cleanup(dir);
    }
  });

  it("imports skills from .opencode/skills/<id>/SKILL.md", () => {
    const dir = createTempDir();
    try {
      const skillDir = join(dir, ".opencode", "skills", "caveman");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), [
        "---",
        "name: caveman",
        "description: Ultra-compressed communication",
        "license: MIT",
        "compatibility: opencode",
        "---",
        "Respond terse like smart caveman.",
      ].join("\n"));

      const result = importOpenCode(dir);
      const skills = result.ir.filter((r) => r.kind === "skill");
      expect(skills.length).toBe(1);
      const skill = skills[0];
      expect(skill.id).toBe("caveman");
      expect(skill.common.name).toBe("caveman");
      expect(skill.common.body).toBe("Respond terse like smart caveman.");
      expect(skill.provenance?.importedFrom).toBe("opencode");
    } finally {
      cleanup(dir);
    }
  });

  it("passes unknown skill frontmatter to platform.opencode", () => {
    const dir = createTempDir();
    try {
      const skillDir = join(dir, ".opencode", "skills", "custom");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), [
        "---",
        "name: custom",
        "description: Custom skill",
        "customField: customValue",
        "---",
        "Body text.",
      ].join("\n"));

      const result = importOpenCode(dir);
      const skill = result.ir.find((r) => r.kind === "skill" && r.id === "custom");
      expect(skill).toBeDefined();
      expect((skill?.platform as Record<string, unknown>)?.opencode).toBeDefined();
      const opencode = (skill?.platform as Record<string, Record<string, unknown>>)?.opencode;
      expect(opencode?.customField).toBe("customValue");
    } finally {
      cleanup(dir);
    }
  });

  it("imports MCP local servers from opencode.json", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "opencode.json"), JSON.stringify({
        mcp: {
          "my-server": {
            type: "local",
            command: ["npx", "-y", "some-package"],
            environment: { API_KEY: "test" },
            enabled: true,
          },
        },
      }));

      const result = importOpenCode(dir);
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      const mcp = mcps[0];
      expect(mcp.id).toBe("my-server");
      expect(mcp.common.transport).toBe("stdio");
      expect(mcp.common.command).toBe("npx");
      expect(mcp.common.args).toEqual(["-y", "some-package"]);
      expect(mcp.common.env).toEqual({ API_KEY: "test" });
    } finally {
      cleanup(dir);
    }
  });

  it("imports MCP remote servers from opencode.json", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "opencode.json"), JSON.stringify({
        mcp: {
          "remote-server": {
            type: "remote",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
            enabled: true,
          },
        },
      }));

      const result = importOpenCode(dir);
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      const mcp = mcps[0];
      expect(mcp.common.transport).toBe("http");
      expect(mcp.common.url).toBe("https://example.com/mcp");
      expect(mcp.common.headers).toEqual({ Authorization: "Bearer token" });
    } finally {
      cleanup(dir);
    }
  });

  it("imports commands from .opencode/commands/<id>.md", () => {
    const dir = createTempDir();
    try {
      const cmdDir = join(dir, ".opencode", "commands");
      mkdirSync(cmdDir, { recursive: true });
      writeFileSync(join(cmdDir, "review.md"), [
        "---",
        "description: Run code review",
        "agent: code-reviewer",
        "---",
        "Review the current changes for production readiness.",
      ].join("\n"));

      const result = importOpenCode(dir);
      const commands = result.ir.filter((r) => r.kind === "command");
      expect(commands.length).toBe(1);
      const cmd = commands[0];
      expect(cmd.id).toBe("review");
      expect(cmd.common.template).toBe("Review the current changes for production readiness.");
      expect(cmd.common.agent).toBe("code-reviewer");
    } finally {
      cleanup(dir);
    }
  });

  it("imports plugins as opaque runtime_code hooks", () => {
    const dir = createTempDir();
    try {
      const pluginDir = join(dir, ".opencode", "plugins");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "my-hook.js"), [
        "export default async function plugin({ project }) {",
        '  return { "tool.execute.before": async (input, output) => {} };',
        "}",
      ].join("\n"));

      const result = importOpenCode(dir);
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBe(1);
      const hook = hooks[0];
      expect(hook.id).toBe("my-hook");
      expect(hook.common.actions[0].type).toBe("runtime_code");
      expect(hook.common.actions[0].runtime).toBe("opencode");
      expect(hook.runtimeFiles?.opencodeJs).toBeDefined();

      // Should have opaque diagnostic
      const opaqueDiag = result.diagnostics.find(
        (d) => d.code === "opencode.hook.runtime_code_opaque",
      );
      expect(opaqueDiag).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  it("maps agent mode 'all' to 'primary' with diagnostic", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".opencode", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "general.md"), [
        "---",
        "name: general",
        "description: General agent",
        "mode: all",
        "---",
        "You are a general agent.",
      ].join("\n"));

      const result = importOpenCode(dir);
      const agent = result.ir.find((r) => r.kind === "agent");
      expect(agent?.common.role).toBe("primary");
      const modeDiag = result.diagnostics.find(
        (d) => d.message.includes("mode 'all'"),
      );
      expect(modeDiag).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  it("handles empty project directory gracefully", () => {
    const dir = createTempDir();
    try {
      const result = importOpenCode(dir);
      expect(result.ir.length).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});
