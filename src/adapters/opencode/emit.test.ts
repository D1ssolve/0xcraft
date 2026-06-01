import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentIR, CommandIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { emitOpenCode, emitOpenCodeHooks } from "./emit";

describe("emitOpenCodeHooks", () => {
  test("emits runtime_code body as an OpenCode plugin file", () => {
    const result = emitOpenCodeHooks([
      hookFixture({
        id: "audit-tools",
        actions: [
          {
            type: "runtime_code",
            runtime: "opencode",
            body: "export default async function AuditPlugin() {\n  return { event: async () => {} };\n}\n",
          },
        ],
      }),
    ]);

    expect(result.artifacts).toEqual({
      ".opencode/plugins/audit-tools.js": "export default async function AuditPlugin() {\n  return { event: async () => {} };\n}\n",
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("loads runtime_code file relative to hook source path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "0xcraft-opencode-runtime-"));
    try {
      const hookSourcePath = join(tempDir, "hooks", "audit-tools", "HOOK.md");
      const pluginPath = join(tempDir, "hooks", "audit-tools", "plugin.js");
      mkdirSync(join(tempDir, "hooks", "audit-tools"), { recursive: true });
      writeFileSync(pluginPath, "export default function plugin() { return { event: async () => {} }; }\n", "utf8");

      const result = emitOpenCodeHooks([
        {
          ...hookFixture({
            id: "audit-tools",
            actions: [{ type: "runtime_code", runtime: "opencode", file: "plugin.js" }],
          }),
          sourcePath: hookSourcePath,
        },
      ]);

      expect(result.artifacts).toEqual({
        ".opencode/plugins/audit-tools.js": "export default function plugin() { return { event: async () => {} }; }\n",
      });
      expect(result.diagnostics).toEqual([]);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("emits empty plugin stub and warning when runtime_code has no file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "0xcraft-opencode-runtime-"));
    try {
      const hookDir = join(tempDir, "hooks", "missing-file");
      mkdirSync(hookDir, { recursive: true });

      const result = emitOpenCodeHooks([
        {
          ...hookFixture({
            id: "missing-file",
            actions: [{ type: "runtime_code", runtime: "opencode" }],
          }),
          sourcePath: join(hookDir, "HOOK.md"),
        },
      ]);

      expect(result.artifacts[".opencode/plugins/missing-file.js"]).toContain(
        "// runtime_code file for hook missing-file was not loadable during emit.",
      );
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "warn",
          code: "WARN_LOSSY_CONVERT",
          details: { hookId: "missing-file", file: undefined, platform: "opencode" },
        }),
      ]);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("emits mixed primitives as JS shim plugins with informational OpenCode-only diagnostics", () => {
    const result = emitOpenCodeHooks([
      hookFixture({
        id: "mixed-primitives",
        actions: [
          { type: "run_command", command: "printf ok", shell: "bash", timeoutMs: 500 },
          { type: "run_exec", command: "node", args: ["script.js", "--flag"], timeoutMs: 1000 },
          { type: "run_script", path: "scripts/hook.sh", runner: "bash", args: ["one"] },
          { type: "http_request", url: "https://example.test/hook", method: "POST", body: { ok: true } },
          { type: "call_mcp_tool", server: "filesystem", tool: "read_file", input: { path: "README.md" } },
          { type: "invoke_prompt", prompt: "Summarize this", model: "small" },
          { type: "invoke_agent", agent: "reviewer", prompt: "Review this", model: "large" },
        ],
      }),
    ]);

    expect(Object.keys(result.artifacts)).toEqual([".opencode/plugins/mixed-primitives.js"]);
    expect(Object.keys(result.artifacts).some((path) => path.startsWith(".opencode/hooks/"))).toBe(false);
    expect(result.artifacts[".opencode/plugins/mixed-primitives.js"]).toContain(
      "// 0xcraft-generated OpenCode hook plugin",
    );
    expect(result.artifacts[".opencode/plugins/mixed-primitives.js"]).toContain("export default async function hook(input) {");
    expect(result.artifacts[".opencode/plugins/mixed-primitives.js"]).toContain("\"type\": \"run_command\"");
    expect(result.artifacts[".opencode/plugins/mixed-primitives.js"]).toContain("await runCommand(action.command, { shell: action.shell, timeoutMs: action.timeoutMs });");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "info", code: "INFO_HOOK_OPENCODE_ONLY", details: { hookId: "mixed-primitives", actionType: "http_request", platform: "opencode" } }),
      expect.objectContaining({ severity: "info", code: "INFO_HOOK_OPENCODE_ONLY", details: { hookId: "mixed-primitives", actionType: "call_mcp_tool", platform: "opencode" } }),
      expect.objectContaining({ severity: "info", code: "INFO_HOOK_OPENCODE_ONLY", details: { hookId: "mixed-primitives", actionType: "invoke_prompt", platform: "opencode" } }),
      expect.objectContaining({ severity: "info", code: "INFO_HOOK_OPENCODE_ONLY", details: { hookId: "mixed-primitives", actionType: "invoke_agent", platform: "opencode" } }),
    ]);
  });

  test("emits byte-identical output for the same input", () => {
    const hooks = [
      hookFixture({
        id: "deterministic",
        actions: [
          { type: "run_exec", command: "node", args: ["a.js"] },
          { type: "run_command", command: "printf done" },
        ],
      }),
    ];

    expect(emitOpenCodeHooks(hooks)).toEqual(emitOpenCodeHooks(hooks));
  });
});

describe("emitOpenCode", () => {
  test("emits agents as OpenCode markdown files", () => {
    const artifact = emitOpenCode([
      agentFixture({
        id: "reviewer",
        platform: { opencode: { color: "blue" }, claude: { effort: "high" } },
      }),
    ]);

    expect(artifact.platform).toBe("opencode");
    expect(artifact.kind).toBe("filesystem-tree");
    expect(artifact.files.map((file) => file.path)).toEqual([
      ".opencode/agents/reviewer.md",
      "opencode.json",
    ]);
    expect(fileContent(artifact, ".opencode/agents/reviewer.md")).toBe(
      "---\ncolor: blue\ndescription: Reviews code.\nmode: subagent\nmodel: gpt-5.5\nname: Reviewer\ntemperature: 0.2\n---\nReview code carefully.\n",
    );
    expect(artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        details: expect.objectContaining({ platform: "opencode", sourcePlatform: "claude" }),
      }),
    );
  });

  test("emits skills with only native OpenCode frontmatter and diagnoses Claude tool lists", () => {
    const artifact = emitOpenCode([
      skillFixture({
        id: "tdd",
        common: { "allowed-tools": ["Read", "Write"], "disallowed-tools": ["Bash"] },
        platform: { opencode: { license: "MIT", compatibility: ["opencode>=1.0"], metadata: { owner: "qa" } } as never },
      }),
    ]);

    expect(fileContent(artifact, ".opencode/skills/tdd/SKILL.md")).toBe(
      "---\ncompatibility:\n  - opencode>=1.0\ndescription: Test first.\nlicense: MIT\nmetadata: {\"owner\":\"qa\"}\nname: TDD\n---\nWrite failing test first.\n",
    );
    expect(fileContent(artifact, ".opencode/skills/tdd/SKILL.md")).not.toContain("allowed-tools");
    expect(fileContent(artifact, ".opencode/skills/tdd/SKILL.md")).not.toContain("disallowed-tools");
    expect(artifact.diagnostics).toContainEqual(
      expect.objectContaining({ code: "opencode.skill.allowed_tools_no_native_slot" }),
    );
  });

  test("emits commands as OpenCode command markdown files", () => {
    const artifact = emitOpenCode([commandFixture({ id: "ship" })]);

    expect(fileContent(artifact, ".opencode/commands/ship.md")).toBe(
      "---\nagent: reviewer\ndescription: Prepare release.\nmodel: gpt-5.5\nname: Ship\n---\nShip {{target}} safely.\n",
    );
  });

  test("emits stdio and http MCP servers into opencode.json", () => {
    const artifact = emitOpenCode([
      mcpFixture({ id: "local-fs", transport: "stdio" }),
      mcpFixture({ id: "remote-api", transport: "http" }),
    ]);

    expect(JSON.parse(fileContent(artifact, "opencode.json"))).toEqual({
      mcp: {
        "local-fs": {
          command: ["node", "server.js"],
          enabled: true,
          environment: { ROOT: "/repo" },
          timeout: 30,
          type: "local",
        },
        "remote-api": {
          enabled: true,
          headers: { Authorization: "Bearer ${TOKEN}" },
          oauth: { scopes: ["read"] },
          timeout: 30,
          type: "remote",
          url: "https://mcp.example.test",
        },
      },
    });
  });

  test("emits hooks through OpenCode plugin files and opencode plugin config", () => {
    const artifact = emitOpenCode([
      hookFixture({
        id: "audit-tools",
        actions: [{ type: "runtime_code", runtime: "opencode", body: "export default function plugin() { return {}; }\n" }],
      }),
    ]);

    expect(fileContent(artifact, ".opencode/plugins/audit-tools.js")).toBe("export default function plugin() { return {}; }\n");
    expect(JSON.parse(fileContent(artifact, "opencode.json"))).toEqual({
      plugin: ["./.opencode/plugins/audit-tools.js"],
    });
  });

  test("emits byte-identical PlatformArtifact output for same input", () => {
    const ir: IRResource[] = [
      skillFixture({ id: "tdd" }),
      agentFixture({ id: "reviewer" }),
      commandFixture({ id: "ship" }),
      mcpFixture({ id: "local-fs", transport: "stdio" }),
      hookFixture({ id: "audit-tools", actions: [{ type: "run_command", command: "printf ok" }] }),
    ];

    expect(JSON.stringify(emitOpenCode(ir))).toBe(JSON.stringify(emitOpenCode(ir)));
  });
});

function hookFixture(input: {
  id: string;
  actions: HookIR["common"]["actions"];
}): HookIR {
  return {
    id: input.id,
    kind: "hook",
    sourcePath: `hooks/${input.id}/HOOK.md`,
    common: {
      name: input.id,
      description: "Test hook.",
      enabled: true,
      events: ["PreToolUse"],
      runtime: "portable",
      actions: input.actions,
    },
    platform: {},
    _sources: { "common.actions": `hooks/${input.id}/HOOK.md` },
  };
}

function fileContent(artifact: ReturnType<typeof emitOpenCode>, path: string): string {
  const file = artifact.files.find((candidate) => candidate.path === path);
  expect(file).toBeDefined();
  return file?.content ?? "";
}

function agentFixture(input: {
  id: string;
  platform?: AgentIR["platform"];
}): AgentIR {
  return {
    id: input.id,
    kind: "agent",
    sourcePath: `agents/${input.id}/AGENT.md`,
    common: {
      name: "Reviewer",
      description: "Reviews code.",
      role: "subagent",
      model: "gpt-5.5",
      temperature: 0.2,
      prompt: "Review code carefully.",
    },
    platform: input.platform ?? {},
    _sources: {},
  };
}

function skillFixture(input: {
  id: string;
  common?: Partial<SkillIR["common"]>;
  platform?: SkillIR["platform"];
}): SkillIR {
  return {
    id: input.id,
    kind: "skill",
    sourcePath: `skills/${input.id}/SKILL.md`,
    common: {
      name: "TDD",
      description: "Test first.",
      body: "Write failing test first.",
      ...input.common,
    },
    platform: input.platform ?? {},
    _sources: {},
  };
}

function commandFixture(input: { id: string }): CommandIR {
  return {
    id: input.id,
    kind: "command",
    sourcePath: `commands/${input.id}/COMMAND.md`,
    common: {
      name: "Ship",
      description: "Prepare release.",
      agent: "reviewer",
      model: "gpt-5.5",
      template: "Ship {{target}} safely.",
    },
    platform: {},
    _sources: {},
  };
}

function mcpFixture(input: { id: string; transport: "stdio" | "http" }): McpServerIR {
  return {
    id: input.id,
    kind: "mcp",
    sourcePath: `mcp/${input.id}/MCP.md`,
    common: input.transport === "stdio"
      ? {
          name: input.id,
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: { ROOT: "/repo" },
          enabled: true,
        }
      : {
          name: input.id,
          transport: "http",
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer ${TOKEN}" },
          enabled: true,
        },
    mcpEnvelope: { sourceShape: "config", emitShape: "config", wrapperKey: "" },
    platform: { opencode: { timeout: 30, oauth: { scopes: ["read"] } } },
    _sources: {},
  };
}
