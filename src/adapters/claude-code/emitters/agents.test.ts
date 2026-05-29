import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { AgentSpec } from "../../../core/agents";
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
      config: { modelOverrides: {} },
    });

    expect(result.emittedFiles).toEqual(["agents/alpha.md", "agents/beta.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(readText(path.join(outputRoot, "agents", "alpha.md"))).toBe(
      "---\nname: alpha\ndescription: \"Alpha description\"\nmodel: sonnet\ncolor: info\n---\n# Alpha\n\nKeep this body exactly.\n",
    );
    expect(readText(path.join(outputRoot, "agents", "beta.md"))).toBe(
      "---\nname: beta\ndescription: \"Beta description\"\nmodel: sonnet\ncolor: info\n---\n# Beta\n\nTrim only legacy frontmatter prefix.\n",
    );
  });

  test("omits disabled agents", () => {
    // Per-agent disable was dropped from the canonical schema; this test now
    // verifies that every agent passed in is emitted.
    const packageRoot = makeTempDir("0xcraft-claude-agents-disabled-source-");
    const outputRoot = makeTempDir("0xcraft-claude-agents-disabled-output-");
    writePrompt(packageRoot, "agents/enabled.agent.md", "Enabled body");

    const result = generateClaudeCodeAgents({
      packageRoot,
      writer: createClaudeCodeFilesystemWriter({ outputRoot }),
      builtInAgents: [
        createAgent({ id: "enabled", promptFile: "agents/enabled.agent.md" }),
      ],
      config: { modelOverrides: {} },
    });

    expect(result.emittedFiles).toEqual(["agents/enabled.md"]);
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
        } as unknown as AgentSpec & Record<string, unknown>,
      ],
      config: { modelOverrides: {} },
    });

    const content = readText(path.join(outputRoot, "agents", "restricted.md"));
    expect(content).not.toContain("permissionMode:");
    expect(content).not.toContain("hooks:");
    // mcpServers object form is ignored for emission (only string[] is
    // forward-compatible). Plugin-mode silencing diagnostic warns the field
    // would have been silently ignored at runtime anyway.
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
      config: { modelOverrides: {} },
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
      config: { modelOverrides: {} },
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

function createAgent(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    id: "fixture-agent",
    name: "Fixture Agent",
    description: "Fixture agent",
    mode: "subagent",
    model: "sonnet",
    color: "info",
    promptFile: "agents/fixture-agent.agent.md",
    ...overrides,
  };
}
