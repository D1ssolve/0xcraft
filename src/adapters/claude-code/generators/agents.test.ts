import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { AgentDefinition } from "../../../core/agents/agent-types";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { generateClaudeCodeAgents } from "./agents";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function writePrompt(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("generateClaudeCodeAgents", () => {
  test("emits enabled agents with required frontmatter and preserved prompt bodies", () => {
    const packageRoot = makeTempDir("0xcraft-claude-agents-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-output-");
    writePrompt(packageRoot, "agents/alpha.agent.md", "# Alpha\n\nKeep this body exactly.\n");
    writePrompt(packageRoot, "agents/beta.agent.md", "---\nlegacy: ignored\n---\n# Beta\n\nTrim only legacy frontmatter prefix.\n");

    const result = generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [
        createAgent({ id: "beta", description: "Beta description", promptFile: "agents/beta.agent.md" }),
        createAgent({ id: "alpha", description: "Alpha description", promptFile: "agents/alpha.agent.md" }),
      ],
      config: { enabledAgents: ["alpha", "beta"], disabledAgents: [] },
    });

    expect(result.emittedFiles).toEqual(["agents/alpha.md", "agents/beta.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(readText(path.join(outputRoot, "agents", "alpha.md"))).toBe(
      "---\nname: alpha\ndescription: \"Alpha description\"\nmodel: sonnet\n---\n# Alpha\n\nKeep this body exactly.\n",
    );
    expect(readText(path.join(outputRoot, "agents", "beta.md"))).toBe(
      "---\nname: beta\ndescription: \"Beta description\"\nmodel: sonnet\n---\n# Beta\n\nTrim only legacy frontmatter prefix.\n",
    );
  });

  test("omits disabled agents", () => {
    const packageRoot = makeTempDir("0xcraft-claude-agents-disabled-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-disabled-output-");
    writePrompt(packageRoot, "agents/enabled.agent.md", "Enabled body");
    writePrompt(packageRoot, "agents/disabled.agent.md", "Disabled body");

    const result = generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [
        createAgent({ id: "enabled", promptFile: "agents/enabled.agent.md" }),
        createAgent({ id: "disabled", promptFile: "agents/disabled.agent.md" }),
      ],
      config: { enabledAgents: [], disabledAgents: ["disabled"] },
    });

    expect(result.emittedFiles).toEqual(["agents/enabled.md"]);
    expect(fs.existsSync(path.join(outputRoot, "agents", "disabled.md"))).toBe(false);
  });

  test("omits plugin-forbidden frontmatter fields", () => {
    const packageRoot = makeTempDir("0xcraft-claude-agents-forbidden-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-forbidden-output-");
    writePrompt(packageRoot, "agents/restricted.agent.md", "Restricted body");

    generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [
        {
          ...createAgent({ id: "restricted", promptFile: "agents/restricted.agent.md" }),
          permissionMode: "acceptEdits",
          hooks: { UserPromptSubmit: [] },
          mcpServers: { unsafe: { command: "uvx" } },
        } as AgentDefinition & Record<string, unknown>,
      ],
      config: { enabledAgents: [], disabledAgents: [] },
    });

    const content = readText(path.join(outputRoot, "agents", "restricted.md"));
    expect(content).not.toContain("permissionMode:");
    expect(content).not.toContain("hooks:");
    expect(content).not.toContain("mcpServers:");
  });

  test("reports missing prompt files and skips those agents", () => {
    const packageRoot = makeTempDir("0xcraft-claude-agents-missing-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-missing-output-");
    writePrompt(packageRoot, "agents/present.agent.md", "Present body");

    const result = generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [
        createAgent({ id: "missing", promptFile: "agents/missing.agent.md" }),
        createAgent({ id: "present", promptFile: "agents/present.agent.md" }),
      ],
      config: { enabledAgents: [], disabledAgents: [] },
    });

    expect(result.emittedFiles).toEqual(["agents/present.md"]);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.agent.prompt-missing",
        agentId: "missing",
        message: "Claude Code agent `missing` prompt file not found; omitting generated agent.",
        details: { promptFile: "agents/missing.agent.md" },
      },
    ]);
  });

  test("reports name collisions and emits only the first agent for a target file", () => {
    const packageRoot = makeTempDir("0xcraft-claude-agents-collision-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-collision-output-");
    writePrompt(packageRoot, "agents/builtin.agent.md", "Built-in body");
    writePrompt(packageRoot, "custom/colliding.md", "Custom body");

    const result = generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [createAgent({ id: "colliding", promptFile: "agents/builtin.agent.md" })],
      customAgents: [createAgent({ id: "colliding", promptFile: path.join(packageRoot, "custom", "colliding.md") })],
      config: { enabledAgents: [], disabledAgents: [] },
    });

    expect(result.emittedFiles).toEqual(["agents/colliding.md"]);
    expect(readText(path.join(outputRoot, "agents", "colliding.md"))).toContain("Built-in body");
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "claude-code.agent.name-collision",
        agentId: "colliding",
        message: "Claude Code agent `colliding` collides with an already emitted agent; omitting duplicate.",
        details: { outputFile: "agents/colliding.md" },
      },
    ]);
  });
});

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "fixture-agent",
    name: "Fixture Agent",
    description: "Fixture agent",
    mode: "subagent",
    model: "sonnet",
    color: "info",
    temperature: 0.3,
    permissions: {},
    promptFile: "agents/fixture-agent.agent.md",
    ...overrides,
  };
}
