import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSourceTree, type PlatformId, type ResourceKind } from "./file-loader";

const sandboxes: string[] = [];

function sandbox(): string {
  const directory = mkdtempSync(join(tmpdir(), "0xcraft-file-loader-"));
  sandboxes.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("source file loader", () => {
  test("loads common files and platform siblings for every resource kind", () => {
    const root = sandbox();
    writeResource(root, "agent", "code-explorer", "AGENT.md", commonAgent("Code Explorer"));
    writeResource(root, "agent", "code-explorer", "agent.opencode.md", siblingYaml({ model: "opencode/model" }));
    writeResource(root, "agent", "code-explorer", "agent.claude.md", siblingYaml({ model: "sonnet" }));
    writeResource(root, "agent", "code-explorer", "agent.codex.toml", 'name = "Code Explorer"\n');

    writeResource(root, "skill", "review", "SKILL.md", commonSkill("Review"));
    writeResource(root, "skill", "review", "skill.opencode.md", siblingYaml({ autoload: true }));
    writeResource(root, "skill", "review", "skill.claude.md", siblingYaml({ model: "sonnet" }));
    writeResource(root, "skill", "review", "skill.codex.toml", "autoload = true\n");

    writeResource(root, "hook", "guard", "HOOK.md", commonHook("Guard"));
    writeResource(root, "hook", "guard", "hook.opencode.md", siblingYaml({ runtime: "portable" }));
    writeResource(root, "hook", "guard", "hook.claude.md", siblingYaml({ anything: true }));
    writeResource(root, "hook", "guard", "hook.codex.toml", "anything = true\n");

    writeResource(root, "mcp", "filesystem", "MCP.md", commonMcp("Filesystem"));
    writeResource(root, "mcp", "filesystem", "mcp.opencode.md", siblingYaml({ enabled: true }));
    writeResource(root, "mcp", "filesystem", "mcp.claude.md", siblingYaml({ wrapper: "mcpServers" }));
    writeResource(root, "mcp", "filesystem", "mcp.codex.toml", 'wrapper = "mcp_servers"\n');

    writeResource(root, "command", "plan", "COMMAND.md", commonCommand("Plan"));
    writeResource(root, "command", "plan", "command.opencode.md", siblingYaml({ any: "value" }));
    writeResource(root, "command", "plan", "command.claude.md", siblingYaml({ any: "value" }));
    writeResource(root, "command", "plan", "command.codex.toml", 'any = "value"\n');

    const files = loadSourceTree(root, ["opencode", "claude", "codex"]);

    expect(files).toHaveLength(20);
    expect(files.map((file) => [file.kind, file.id, file.platform])).toContainEqual(["agent", "code-explorer", "common"]);
    expect(files.map((file) => [file.kind, file.id, file.platform])).toContainEqual(["agent", "code-explorer", "codex"]);
    expect(files.find((file) => file.kind === "agent" && file.platform === "common")?.body).toBe("Agent body\n");
    expect(files.filter((file) => file.platform !== "common").every((file) => file.body === "")).toBe(true);
  });

  test("throws ERR_INVALID_RESOURCE_ID for invalid resource directory names", () => {
    const root = sandbox();
    writeResource(root, "agent", "Bad_ID", "AGENT.md", commonAgent("Bad"));

    expect(() => loadSourceTree(root, [])).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_RESOURCE_ID",
        details: expect.objectContaining({ id: "Bad_ID" }),
      }),
    );
  });

  test("allows empty agent.codex.md but rejects active Markdown Codex agent metadata", () => {
    const emptyRoot = sandbox();
    writeResource(emptyRoot, "agent", "empty-codex", "AGENT.md", commonAgent("Empty"));
    writeResource(emptyRoot, "agent", "empty-codex", "agent.codex.md", "\n  \n");
    expect(() => loadSourceTree(emptyRoot, ["codex"])).not.toThrow();

    const activeRoot = sandbox();
    writeResource(activeRoot, "agent", "active-codex", "AGENT.md", commonAgent("Active"));
    writeResource(activeRoot, "agent", "active-codex", "agent.codex.md", "---\nname: Active\n---\n");
    expect(() => loadSourceTree(activeRoot, ["codex"])).toThrow(
      expect.objectContaining({ code: "ERR_CODEX_MARKDOWN_AGENT_META" }),
    );
  });

  test("throws ERR_PLATFORM_BODY_FORBIDDEN when Markdown platform sibling contains body", () => {
    const root = sandbox();
    writeResource(root, "agent", "body-sibling", "AGENT.md", commonAgent("Body"));
    writeResource(root, "agent", "body-sibling", "agent.opencode.md", "---\nmodel: test\n---\nnot allowed\n");

    expect(() => loadSourceTree(root, ["opencode"])).toThrow(
      expect.objectContaining({
        code: "ERR_PLATFORM_BODY_FORBIDDEN",
        details: expect.objectContaining({ field: "body" }),
      }),
    );
  });

  test("throws ERR_UNKNOWN_FRONTMATTER_KEY for unknown YAML frontmatter keys", () => {
    const root = sandbox();
    writeResource(root, "agent", "unknown-yaml", "AGENT.md", "---\nname: Agent\ndescription: Desc\nunknown: true\n---\nBody\n");

    expect(() => loadSourceTree(root, [])).toThrow(
      expect.objectContaining({
        code: "ERR_UNKNOWN_FRONTMATTER_KEY",
        details: expect.objectContaining({ field: "unknown" }),
      }),
    );
  });

  test("throws ERR_UNKNOWN_TOML_KEY for unknown TOML metadata keys", () => {
    const root = sandbox();
    writeResource(root, "agent", "unknown-toml", "AGENT.md", commonAgent("Agent"));
    writeResource(root, "agent", "unknown-toml", "agent.codex.toml", 'name = "Agent"\nunknown = true\n');

    expect(() => loadSourceTree(root, ["codex"])).toThrow(
      expect.objectContaining({
        code: "ERR_UNKNOWN_TOML_KEY",
        details: expect.objectContaining({ field: "unknown" }),
      }),
    );
  });

  test("allows platform sibling merge directives to reach merger", () => {
    const root = sandbox();
    writeResource(root, "agent", "merge-agent", "AGENT.md", commonAgent("Merge Agent"));
    writeResource(root, "agent", "merge-agent", "agent.claude.md", siblingYaml({ tools: ["B"], merge: { tools: "append" } }));

    const files = loadSourceTree(root, ["claude"]);

    expect(files.find((file) => file.platform === "claude")?.frontmatter).toEqual({
      tools: ["B"],
      merge: { tools: "append" },
    });
  });

  test("adds INFO_MISSING_PLATFORM_SIBLING diagnostics for configured platforms without siblings", () => {
    const root = sandbox();
    writeResource(root, "agent", "missing", "AGENT.md", commonAgent("Missing"));

    const files = loadSourceTree(root, ["opencode", "claude", "codex"]);

    expect(files).toHaveLength(1);
    expect(files[0]?.diagnostics).toEqual([
      expect.objectContaining({ code: "INFO_MISSING_PLATFORM_SIBLING", details: expect.objectContaining({ platform: "opencode" }) }),
      expect.objectContaining({ code: "INFO_MISSING_PLATFORM_SIBLING", details: expect.objectContaining({ platform: "claude" }) }),
      expect.objectContaining({ code: "INFO_MISSING_PLATFORM_SIBLING", details: expect.objectContaining({ platform: "codex" }) }),
    ]);
  });

  test("throws ERR_CYCLIC_INCLUDE for include cycles discovered while loading", () => {
    const root = sandbox();
    writeResource(
      root,
      "agent",
      "include-cycle",
      "AGENT.md",
      "---\nname: Agent\ndescription: Desc\ninclude:\n  - partial.md\n---\nBody\n",
    );
    writeResource(root, "agent", "include-cycle", "partial.md", "---\ninclude:\n  - AGENT.md\n---\nPartial\n");

    expect(() => loadSourceTree(root, [])).toThrow(expect.objectContaining({ code: "ERR_CYCLIC_INCLUDE" }));
  });
});

function writeResource(root: string, kind: ResourceKind, id: string, fileName: string, content: string): void {
  const resourceDirectories: Record<ResourceKind, string> = {
    agent: "agents",
    skill: "skills",
    hook: "hooks",
    mcp: "mcp",
    command: "commands",
  };
  const directory = join(root, resourceDirectories[kind], id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), content);
}

function siblingYaml(frontmatter: Record<string, unknown>): string {
  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n`;
}

function commonAgent(name: string): string {
  return `---\nname: ${name}\ndescription: Desc\n---\nAgent body\n`;
}

function commonSkill(name: string): string {
  return `---\nname: ${name}\ndescription: Desc\n---\nSkill body\n`;
}

function commonHook(name: string): string {
  return `---\nname: ${name}\nevents:\n  - PreToolUse\nactions: []\nmodifiers: []\n---\n`;
}

function commonMcp(name: string): string {
  return `---\nname: ${name}\ntransport: stdio\ncommand: node\n---\n`;
}

function commonCommand(name: string): string {
  return `---\nname: ${name}\ndescription: Desc\n---\nCommand template\n`;
}
