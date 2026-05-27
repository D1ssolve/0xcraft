import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createConfigHandler } from "./config-handler";
import { mergeConfig } from "../../../core/config";

describe("createConfigHandler", () => {
  test("registers built-in agents in OpenCode agent config", async () => {
    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({}),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const agents = inputConfig.agent as Record<string, Record<string, unknown>>;
    expect(agents["team-lead"]?.mode).toBe("primary");
    expect(agents["team-lead"]?.description).toContain("incoming tasks");
    expect(agents["team-lead"]?.prompt).toContain("# Team Lead");
    expect(agents["team-lead"]?.prompt).not.toContain("mode: primary");
    expect(agents["team-lead"]?.permission).toEqual(expect.objectContaining({ question: "allow" }));
    expect(inputConfig.agents).toBeUndefined();
  });

  test("normalizes malformed top-level OpenCode config shapes", async () => {
    const inputConfig: Record<string, unknown> = {
      agent: "not-an-object",
      skills: 42,
      mcp: ["not", "a", "map"],
    };
    const handler = createConfigHandler({
      config: mergeConfig({}),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const agents = inputConfig.agent as Record<string, Record<string, unknown>>;
    const skills = inputConfig.skills as { paths: string[] };
    const mcp = inputConfig.mcp as Record<string, Record<string, unknown>>;
    expect(Array.isArray(inputConfig.agent)).toBe(false);
    expect(Array.isArray(inputConfig.skills)).toBe(false);
    expect(Array.isArray(inputConfig.mcp)).toBe(false);
    expect(agents["team-lead"]?.prompt).toContain("# Team Lead");
    expect(skills.paths).toBeArray();
    expect(skills.paths).toContain(`${process.cwd()}/skills/chatgpt-linkedin-skill`);
    expect(mcp.context7).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
    });
  });

  test("normalizes non-array skills.paths", async () => {
    const inputConfig: Record<string, unknown> = {
      agent: {},
      skills: { paths: "not-an-array" },
      mcp: {},
    };
    const handler = createConfigHandler({
      config: mergeConfig({}),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const skills = inputConfig.skills as { paths: string[] };
    expect(skills.paths).toBeArray();
    expect(skills.paths).toContain(`${process.cwd()}/skills/chatgpt-linkedin-skill`);
  });

  test("mutates an initially empty OpenCode config object", async () => {
    const inputConfig: Record<string, unknown> = {};
    const handler = createConfigHandler({
      config: mergeConfig({}),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    expect(inputConfig.agent).toBeObject();
    expect(inputConfig.skills).toBeObject();
    expect(inputConfig.mcp).toBeObject();
    expect((inputConfig.skills as { paths: string[] }).paths).toBeArray();
    expect(inputConfig.agents).toBeUndefined();
  });

  test("lets user MCP config override built-ins and maps env to environment", async () => {
    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({
        mcpServers: {
          context7: {
            type: "remote",
            url: "https://example.test/mcp",
            headers: { Authorization: "Bearer token" },
          },
          local_custom: {
            type: "local",
            command: ["node", "server.js"],
            env: { NODE_ENV: "test" },
          },
        },
      }),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const mcp = inputConfig.mcp as Record<string, Record<string, unknown>>;
    expect(mcp.context7).toEqual({
      type: "remote",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer token" },
    });
    expect(mcp.local_custom).toEqual({
      type: "local",
      command: ["node", "server.js"],
      environment: { NODE_ENV: "test" },
    });
  });

  test("registers custom markdown agents from configured directories", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-agent-"));
    const agentPath = path.join(tmpDir, "review-helper.md");
    fs.writeFileSync(
      agentPath,
      `---\ndescription: Reviews focused diffs\nmode: subagent\nmodel: github-copilot/gpt-5.5\npermission:\n  edit: deny\n---\n\n# Review Helper\n\nInspect changed files only.\n`,
    );

    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({ customAgentPaths: [tmpDir] }),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const agents = inputConfig.agent as Record<string, Record<string, unknown>>;
    expect(agents["review-helper"]).toEqual({
      description: "Reviews focused diffs",
      mode: "subagent",
      model: "github-copilot/gpt-5.5",
      permission: { edit: "deny" },
      prompt: "# Review Helper\n\nInspect changed files only.\n",
    });
  });

  test("registers all built-in skill directories", async () => {
    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({}),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const skills = inputConfig.skills as { paths: string[] };
    expect(skills.paths).toContain(`${process.cwd()}/skills/chatgpt-linkedin-skill`);
  });

  test("does NOT auto-register skill-embedded MCPs at startup (on-demand invariant)", async () => {
    // nlm-skill has mcpServers: [{ name: "notebooklm-mcp", ... }]
    // Even when enabled, its MCP must NOT be registered here — only via explicit mcpServers config.
    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({ enabledSkills: ["nlm-skill"] }),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const mcp = inputConfig.mcp as Record<string, Record<string, unknown>>;
    expect(mcp["notebooklm-mcp"]).toBeUndefined();
  });

  test("registers skill-embedded MCP when user adds it to mcpServers config", async () => {
    // Users who want notebooklm-mcp at startup opt in via config.mcpServers
    const inputConfig: Record<string, unknown> = { agent: {}, skills: { paths: [] }, mcp: {} };
    const handler = createConfigHandler({
      config: mergeConfig({
        enabledSkills: ["nlm-skill"],
        mcpServers: {
          "notebooklm-mcp": { type: "local", command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"] },
        },
      }),
      projectRoot: "/tmp/project",
      pkgRoot: process.cwd(),
    });

    await handler(inputConfig);

    const mcp = inputConfig.mcp as Record<string, Record<string, unknown>>;
    expect(mcp["notebooklm-mcp"]).toEqual({
      type: "local",
      command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
    });
  });
});
