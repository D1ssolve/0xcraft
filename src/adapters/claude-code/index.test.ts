import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateClaudeCodePlugin, type ClaudeCodePluginGeneratorDependencies } from "./index";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makePackageRoot(): string {
  const root = makeTempDir("0xcraft-claude-plugin-package-");
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "sample-skill"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "0xcraft",
    version: "0.1.0",
    description: "Fixture package",
    author: "fixture",
    license: "MIT",
    keywords: ["agents"],
  }));
  fs.writeFileSync(path.join(root, "agents", "sample.agent.md"), "# Sample Agent\n\nPrompt body.");
  fs.writeFileSync(path.join(root, "skills", "sample-skill", "SKILL.md"), "---\nname: sample-skill\ndescription: Sample skill\n---\n\n# Sample Skill");
  return root;
}

function makeDependencies(calls: string[]): ClaudeCodePluginGeneratorDependencies {
  return {
    generateAgents(options) {
      calls.push(`agents:${options.packageRoot}`);
      options.writer.writeMarkdown("agents/mock-agent.md", "---\nname: mock-agent\ndescription: Mock agent\n---\nMock body");
      return { emittedFiles: ["agents/mock-agent.md"], diagnostics: [] };
    },
    generateSkills(options) {
      calls.push(`skills:${options.packageRoot}`);
      options.writer.writeMarkdown("skills/mock-skill/SKILL.md", "---\nname: mock-skill\ndescription: Mock skill\n---\nMock skill");
      return { emittedFiles: ["skills/mock-skill/SKILL.md"], diagnostics: [], skills: [{ id: "mock-skill", namespace: "/0xcraft:mock-skill" }], mcpServers: [] };
    },
    generateHooks(options) {
      calls.push("hooks");
      options.writer.writeJson("hooks/hooks.json", { description: "Mock hooks", hooks: {} });
      return { emittedFiles: ["hooks/hooks.json"], diagnostics: [], scriptFiles: [] };
    },
    generateMcp(options) {
      calls.push("mcp");
      options.writer.writeJson(".mcp.json", { mcpServers: {} });
      return { emittedFiles: [".mcp.json"], diagnostics: [] };
    },
    generateSettings(options) {
      calls.push("settings");
      options.writer.writeJson("settings.json", { agent: "mock-agent" });
      return { emittedFiles: ["settings.json"] };
    },
    generateManifest(options) {
      calls.push(`manifest:${Object.entries(options.emittedComponents).filter(([, emitted]) => emitted).map(([key]) => key).join(",")}`);
      options.writer.writeJson(".claude-plugin/plugin.json", {
        name: options.packageMetadata.name,
        agents: "agents/",
        skills: "skills/",
        hooks: "hooks/hooks.json",
        mcpServers: ".mcp.json",
      });
      return {
        emittedFiles: [".claude-plugin/plugin.json"],
        manifest: {
          name: options.packageMetadata.name ?? "0xcraft",
          agents: "agents/",
          skills: "skills/",
          hooks: "hooks/hooks.json",
          mcpServers: ".mcp.json",
        },
      };
    },
  };
}

describe("generateClaudeCodePlugin", () => {
  test("orchestrates generators in dependency-safe order and returns structured result", async () => {
    const packageRoot = makePackageRoot();
    const projectRoot = makeTempDir("0xcraft-claude-plugin-project-");
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-output-parent-"), "plugin");
    const calls: string[] = [];

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot,
      outputPath,
      force: true,
      config: {
        
        disabled: { skills: [] },
        mcpServers: {},
      },
      settings: { agent: "mock-agent" },
      dependencies: makeDependencies(calls),
    });

    expect(calls).toEqual([
      `agents:${packageRoot}`,
      `skills:${packageRoot}`,
      "hooks",
      "mcp",
      "settings",
      "manifest:agents,skills,hooks,mcpServers",
    ]);
    expect(result.ok).toBe(true);
    expect(result.outputPath).toBe(path.resolve(outputPath));
    expect(result.emittedFiles).toEqual([
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "agents/mock-agent.md",
      "hooks/hooks.json",
      "settings.json",
      "skills/mock-skill/SKILL.md",
    ]);
    expect(result.externalValidation).toBeUndefined();
    expect(result.localValidation.ok).toBe(true);
    expect(result.metadata.sourceOwned).toBe(false);
    expect(result.metadata.generated).toBe(true);
  });

  test("marks default dist output as generated and not source-owned", async () => {
    const packageRoot = makePackageRoot();
    const calls: string[] = [];

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-project-default-"),
      force: true,
      dependencies: makeDependencies(calls),
    });

    expect(result.outputPath).toBe(path.join(packageRoot, "dist", "claude-code-plugin", "0xcraft"));
    expect(result.metadata).toMatchObject({
      generated: true,
      sourceOwned: false,
      defaultOutput: true,
      ownership: "ephemeral-generated-artifact",
    });
  });

  test("returns optional external validation result", async () => {
    const packageRoot = makePackageRoot();
    const calls: string[] = [];

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-project-extval-"),
      outputPath: path.join(makeTempDir("0xcraft-claude-plugin-output-extval-"), "plugin"),
      force: true,
      validateExternal: true,
      externalValidationRunner: async () => ({ exitCode: 0 }),
      dependencies: makeDependencies(calls),
    });

    expect(result.ok).toBe(true);
    expect(result.externalValidation?.ok).toBe(true);
    expect(result.externalValidation?.command.args).toContain("plugin");
  });

  test("integration generates a full plugin into a temp directory", async () => {
    const packageRoot = makePackageRoot();
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-integration-output-"), "plugin");

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-integration-project-"),
      outputPath,
      force: true,
      builtInAgents: [{
        id: "sample",
        name: "Sample Agent",
        description: "Sample agent for integration test",
        mode: "subagent",
        model: "sonnet",
        color: "secondary",
        temperature: 0.3,
        promptFile: "agents/sample.agent.md",
        permission: { sandbox: "workspace-write", tools: { edit: "deny" }, bash: {} },
      }],
      builtInSkills: [{
        id: "sample-skill",
        name: "Sample Skill",
        description: "Sample skill for integration test",
        skillFile: "skills/sample-skill/SKILL.md",
        tags: ["fixture"],
      }],
      builtInHooks: [],
      builtInMcpServers: [],
      config: {
        
        enabled: { skills: ["sample-skill"] },
        mcpServers: {},
      },
    });

    expect(result.ok).toBe(true);
    expect(result.localValidation.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, ".claude-plugin", "plugin.json"), "utf8"))).toMatchObject({
      name: "0xcraft",
      agents: "agents/",
      skills: "skills/",
      mcpServers: ".mcp.json",
    });
    expect(fs.readFileSync(path.join(outputPath, "agents", "sample.md"), "utf8")).toContain("disallowedTools:");
    expect(fs.existsSync(path.join(outputPath, "skills", "sample-skill", "SKILL.md"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, ".mcp.json"), "utf8"))).toEqual({ mcpServers: {} });
  });

  test("integration generates into a new output path without force", async () => {
    const packageRoot = makePackageRoot();
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-new-output-"), "plugin");

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-new-project-"),
      outputPath,
      builtInAgents: [{
        id: "sample",
        name: "Sample Agent",
        description: "Sample agent for integration test",
        mode: "subagent",
        model: "sonnet",
        color: "secondary",
        temperature: 0.3,
        promptFile: "agents/sample.agent.md",
        permission: { sandbox: "workspace-write", tools: { edit: "deny" }, bash: {} },
      }],
      builtInSkills: [{
        id: "sample-skill",
        name: "Sample Skill",
        description: "Sample skill for integration test",
        skillFile: "skills/sample-skill/SKILL.md",
        tags: ["fixture"],
      }],
      builtInHooks: [],
      builtInMcpServers: [],
      config: {
        
        enabled: { skills: ["sample-skill"] },
        mcpServers: {},
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(outputPath, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "agents", "sample.md"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "skills", "sample-skill", "SKILL.md"))).toBe(true);
  });

  test("existing non-empty output without force fails before writing plugin artifacts", async () => {
    const packageRoot = makePackageRoot();
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-existing-output-"), "plugin");
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, "keep.txt"), "user content");

    await expect(generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-existing-project-"),
      outputPath,
      builtInAgents: [{
        id: "sample",
        name: "Sample Agent",
        description: "Sample agent for integration test",
        mode: "subagent",
        model: "sonnet",
        color: "secondary",
        temperature: 0.3,
        promptFile: "agents/sample.agent.md",
        permission: { sandbox: "workspace-write", tools: { edit: "deny" }, bash: {} },
      }],
      builtInSkills: [{
        id: "sample-skill",
        name: "Sample Skill",
        description: "Sample skill for integration test",
        skillFile: "skills/sample-skill/SKILL.md",
        tags: ["fixture"],
      }],
      builtInHooks: [],
      builtInMcpServers: [],
      config: {
        
        enabled: { skills: ["sample-skill"] },
        mcpServers: {},
      },
    })).rejects.toThrow("Output directory already exists and is not empty");

    expect(fs.readFileSync(path.join(outputPath, "keep.txt"), "utf8")).toBe("user content");
    expect(fs.existsSync(path.join(outputPath, ".claude-plugin"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "agents"))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, "skills"))).toBe(false);
  });

  test("normalizes real bundled skill frontmatter for Claude Code local validation", async () => {
    const packageRoot = path.resolve(import.meta.dir, "../../..");
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-real-skills-output-"), "plugin");

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-real-skills-project-"),
      outputPath,
      force: true,
      selectedAssets: {
        agents: false,
        skills: true,
        hooks: false,
        mcpServers: false,
        settings: false,
      },
      config: {
        enabled: { skills: [
          "chatgpt-linkedin-skill",
          "efcore-postgres-enum",
          "implementation-patterns",
          "linkedin-article",
          "mempalace",
          "migrate-dotnet9-to-dotnet10",
          "nlm-skill",
          "topaz-js",
        ] },
      },
    });

    expect(result.localValidation.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "claude-code.local_validation.invalid_markdown_frontmatter" }),
    ]));
    expect(result.localValidation.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  test("writes builtin hook shim scripts as executable files into the plugin output", async () => {
    const packageRoot = makePackageRoot();
    const outputPath = path.join(makeTempDir("0xcraft-claude-plugin-hookscripts-"), "plugin");

    const result = await generateClaudeCodePlugin({
      packageRoot,
      projectRoot: makeTempDir("0xcraft-claude-plugin-hookscripts-project-"),
      outputPath,
      force: true,
      builtInAgents: [],
      builtInSkills: [],
      builtInMcpServers: [],
      // builtInHooks defaults to all three bootstrap hooks
    });

    expect(result.ok).toBe(true);

    const expectedScripts = [
      "hooks/agents-guard.mjs",
      "hooks/caveman-bootstrap.mjs",
      "hooks/git-worktree-bootstrap.mjs",
    ];
    for (const rel of expectedScripts) {
      const fullPath = path.join(outputPath, rel);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");
      expect(content.startsWith("#!/usr/bin/env bun\n")).toBe(true);
      expect(result.emittedFiles).toContain(rel);
      if (process.platform !== "win32") {
        const mode = fs.statSync(fullPath).mode & 0o777;
        // Owner must have execute permission.
        expect(mode & 0o100).toBe(0o100);
      }
    }

    // hooks.json references the scripts.
    const hooksJson = JSON.parse(
      fs.readFileSync(path.join(outputPath, "hooks", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(hooksJson.hooks).sort()).toEqual(["SessionStart", "UserPromptSubmit"]);
    const allCommands = Object.values(hooksJson.hooks)
      .flat()
      .flatMap((group) => group.hooks.map((h) => h.command));
    for (const cmd of allCommands) {
      expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}");
      expect(cmd).toMatch(/^bun /);
    }
  });
});
