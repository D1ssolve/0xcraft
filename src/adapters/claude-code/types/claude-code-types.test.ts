import { describe, expect, test } from "bun:test";
import {
  claudeCodeAgentFrontmatterSchema,
  claudeCodeHooksJsonSchema,
  claudeCodeManifestSchema,
  claudeCodeMcpJsonSchema,
  claudeCodeSettingsJsonSchema,
  claudeCodeSkillFrontmatterSchema,
  type ClaudeCodeAgentFrontmatter,
} from "./claude-code-types";

describe("Claude Code adapter artifact schemas", () => {
  test("accepts first-release manifest without compatibility-gated displayName", () => {
    const manifest = claudeCodeManifestSchema.parse({
      name: "0xcraft",
      description: "Agent operations plugin for Claude Code",
      agents: "agents/",
      skills: "skills/",
      hooks: "hooks/hooks.json",
      mcpServers: ".mcp.json",
    });

    expect(manifest.displayName).toBeUndefined();
    expect(manifest.name).toBe("0xcraft");
  });

  test("accepts compatibility-gated displayName when caller opts to emit it", () => {
    expect(
      claudeCodeManifestSchema.parse({
        name: "0xcraft",
        displayName: "0xcraft",
      }),
    ).toEqual({ name: "0xcraft", displayName: "0xcraft" });
  });

  test("rejects manifest missing required name", () => {
    expect(() => claudeCodeManifestSchema.parse({ description: "missing name" })).toThrow();
  });

  test("accepts plugin agent frontmatter with supported fields only", () => {
    const frontmatter = claudeCodeAgentFrontmatterSchema.parse({
      name: "backend-developer",
      description: "Writes production backend code",
      model: "sonnet",
      tools: ["Read", "Grep"],
      disallowedTools: ["Write"],
      skills: ["0xcraft:test-driven-development"],
      maxTurns: 8,
      effort: "high",
      memory: true,
      background: false,
      isolation: true,
    });

    expect(frontmatter.name).toBe("backend-developer");
    expect(frontmatter.disallowedTools).toEqual(["Write"]);
  });

  test("rejects plugin-forbidden agent frontmatter fields", () => {
    expect(() =>
      claudeCodeAgentFrontmatterSchema.parse({
        name: "unsafe-agent",
        description: "Should not parse",
        hooks: {},
      }),
    ).toThrow();
    expect(() =>
      claudeCodeAgentFrontmatterSchema.parse({
        name: "unsafe-agent",
        description: "Should not parse",
        mcpServers: {},
      }),
    ).toThrow();
    expect(() =>
      claudeCodeAgentFrontmatterSchema.parse({
        name: "unsafe-agent",
        description: "Should not parse",
        permissionMode: "acceptEdits",
      }),
    ).toThrow();
  });

  test("agent frontmatter type does not expose plugin-forbidden fields", () => {
    const frontmatter = {
      name: "safe-agent",
      description: "Compile-time shape excludes forbidden plugin-agent fields",
    } satisfies ClaudeCodeAgentFrontmatter;

    expect(frontmatter.name).toBe("safe-agent");
  });

  test("accepts Claude skill frontmatter subset", () => {
    const frontmatter = claudeCodeSkillFrontmatterSchema.parse({
      name: "test-driven-development",
      description: "Write the test first",
      when_to_use: "Use before implementing features or fixes",
      "argument-hint": "optional topic",
      arguments: [{ name: "topic", description: "Work item", required: false }],
      "disable-model-invocation": false,
      "user-invocable": true,
      "allowed-tools": ["Read", "Grep"],
      model: "sonnet",
      effort: "medium",
      context: ["README.md"],
      agent: "backend-developer",
      paths: ["skills/test-driven-development/SKILL.md"],
      shell: false,
    });

    expect(frontmatter.name).toBe("test-driven-development");
    expect(frontmatter["allowed-tools"]).toEqual(["Read", "Grep"]);
  });

  test("accepts hooks JSON with command handlers", () => {
    const hooks = claudeCodeHooksJsonSchema.parse({
      description: "0xcraft hooks",
      hooks: {
        SessionStart: [
          {
            matcher: { sessionStartType: "startup" },
            handlers: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh", timeout: 5 }],
          },
        ],
      },
    });

    expect(hooks.hooks.SessionStart?.[0]?.handlers[0]?.type).toBe("command");
  });

  test("accepts valid local and remote MCP JSON", () => {
    const mcp = claudeCodeMcpJsonSchema.parse({
      mcpServers: {
        local: {
          type: "stdio",
          command: "uvx",
          args: ["--from", "mempalace", "python", "-m", "mempalace.mcp_server"],
          env: { SAFE_PATH: "${CLAUDE_PLUGIN_DATA}" },
        },
        remote: {
          type: "http",
          url: "https://mcp.context7.com/mcp",
          headers: { "X-Plugin": "0xcraft" },
        },
      },
    });

    expect(mcp.mcpServers.local).toMatchObject({ command: "uvx" });
    expect(mcp.mcpServers.remote).toMatchObject({ url: "https://mcp.context7.com/mcp" });
  });

  test("rejects malformed MCP JSON", () => {
    expect(() => claudeCodeMcpJsonSchema.parse({ mcpServers: { broken: { type: "stdio", args: ["no-command"] } } })).toThrow();
    expect(() => claudeCodeMcpJsonSchema.parse({ mcpServers: { broken: { type: "http", command: "not-url" } } })).toThrow();
    expect(() => claudeCodeMcpJsonSchema.parse({ local: { command: "uvx" } })).toThrow();
  });

  test("accepts root plugin settings supported subset only", () => {
    expect(
      claudeCodeSettingsJsonSchema.parse({
        agent: "backend-developer",
        subagentStatusLine: "compact",
      }),
    ).toEqual({ agent: "backend-developer", subagentStatusLine: "compact" });

    expect(() => claudeCodeSettingsJsonSchema.parse({ permissions: { allow: ["Bash(*)"] } })).toThrow();
  });
});
