import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emitOpenCode } from "../adapters/opencode/emit";
import type { IRResource } from "../core/ir";

const GOLDEN_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/opencode-emit-golden.json", import.meta.url));

const REPRESENTATIVE_IR: IRResource[] = [
  {
    id: "reviewer",
    kind: "agent",
    sourcePath: "agents/reviewer/AGENT.md",
    common: {
      name: "Reviewer",
      description: "Reviews code with project guidance.",
      role: "subagent",
      model: "gpt-5.5",
      temperature: 0.2,
      mcpServers: ["local-fs"],
      prompt: "Review code. Read {{references_dir}}/guide.md first.",
    },
    references: {
      "guide.md": "Check architecture boundaries and tests.\n",
    },
    platform: {
      opencode: {
        color: "blue",
        enabled: true,
        tools: { bash: true, read: true },
      },
    },
    _sources: {},
  },
  {
    id: "tdd",
    kind: "skill",
    sourcePath: "skills/tdd/SKILL.md",
    common: {
      name: "TDD",
      description: "Test-first workflow.",
      tags: ["quality", "testing"],
      body: "Write failing tests before code. See {{references_dir}}/example.md.",
    },
    references: {
      "example.md": "Red, green, refactor.\n",
    },
    platform: {
      opencode: { autoload: true, tags: ["testing"] },
    },
    _sources: {},
  },
  {
    id: "ship",
    kind: "command",
    sourcePath: "commands/ship/COMMAND.md",
    common: {
      name: "Ship",
      description: "Prepare release notes.",
      agent: "reviewer",
      model: "gpt-5.5",
      arguments: [{ name: "target", description: "Release target.", required: true }],
      template: "Ship {{target}} safely.\n",
    },
    platform: {},
    _sources: {},
  },
  {
    id: "local-fs",
    kind: "mcp",
    sourcePath: "mcp/local-fs/MCP.md",
    common: {
      name: "Local FS",
      description: "Local filesystem MCP.",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { ROOT: "/repo" },
      enabled: true,
    },
    mcpEnvelope: { sourceShape: "config", emitShape: "config", wrapperKey: "" },
    platform: { opencode: { timeout: 30 } },
    _sources: {},
  },
  {
    id: "audit-tools",
    kind: "hook",
    sourcePath: "hooks/audit-tools/HOOK.md",
    common: {
      name: "Audit tools",
      description: "Audit tool use.",
      enabled: true,
      events: ["PreToolUse"],
      runtime: "portable",
      actions: [{ type: "run_command", command: "printf audit", shell: "bash", timeoutMs: 1000 }],
    },
    platform: {},
    _sources: {},
  },
];

describe("OpenCode emit golden fixture", () => {
  test("default filesystem emit matches golden fixture", () => {
    expect(emitOpenCode(REPRESENTATIVE_IR)).toEqual(readGoldenFixture());
  });

  test("explicit filesystem emit matches golden fixture", () => {
    expect(emitOpenCode(REPRESENTATIVE_IR, { mode: "filesystem" })).toEqual(readGoldenFixture());
  });
});

function readGoldenFixture(): ReturnType<typeof emitOpenCode> {
  return JSON.parse(readFileSync(GOLDEN_FIXTURE_PATH, "utf8"));
}
