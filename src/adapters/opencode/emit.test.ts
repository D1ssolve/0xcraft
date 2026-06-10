import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

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
  test("explicit filesystem mode matches default output byte-for-byte", () => {
    const ir: IRResource[] = [
      agentFixture({
        id: "reviewer",
        references: { "guide.md": "Use {{references_dir}}/guide.md" },
      }),
      skillFixture({ id: "tdd", references: { "examples.md": "Example" } }),
      commandFixture({ id: "ship" }),
      mcpFixture({ id: "local-fs", transport: "stdio" }),
      hookFixture({ id: "audit-tools", actions: [{ type: "run_command", command: "printf ok" }] }),
    ];

    expect(JSON.stringify(emitOpenCode(ir, { mode: "filesystem" }))).toBe(JSON.stringify(emitOpenCode(ir)));
  });

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

  test("emits agent external_directory inside permission frontmatter", () => {
    const artifact = emitOpenCode([
      agentFixture({
        id: "spec-driven-gpt",
        platform: {
          opencode: {
            permission: {
              question: "allow",
              external_directory: {
                "~/.config/opencode/agents/spec-driven-gpt/references*": "allow",
              },
            },
          },
        },
      }),
    ]);

    const content = fileContent(artifact, ".opencode/agents/spec-driven-gpt.md");
    expect(content).toContain("permission:");
    expect(content).toContain("external_directory");
    expect(content).toContain("references*");
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

  test("emits agent and skill reference files in sorted OpenCode reference directories", () => {
    const artifact = emitOpenCode([
      agentFixture({
        id: "reviewer",
        references: {
          "zeta.txt": "agent zeta\r\n",
          "alpha.md": "agent alpha",
        },
      }),
      skillFixture({
        id: "tdd",
        references: {
          "usage.txt": "skill usage\r\nnext",
          "examples.md": "skill examples",
        },
      }),
    ]);

    expect(artifact.files.map((file) => file.path)).toEqual([
      ".opencode/agents/reviewer.md",
      ".opencode/agents/reviewer/references/alpha.md",
      ".opencode/agents/reviewer/references/zeta.txt",
      ".opencode/skills/tdd/references/examples.md",
      ".opencode/skills/tdd/references/usage.txt",
      ".opencode/skills/tdd/SKILL.md",
      "opencode.json",
    ]);
    expect(fileContent(artifact, ".opencode/agents/reviewer/references/alpha.md")).toBe("agent alpha\n");
    expect(fileContent(artifact, ".opencode/agents/reviewer/references/zeta.txt")).toBe("agent zeta\n");
    expect(fileContent(artifact, ".opencode/skills/tdd/references/examples.md")).toBe("skill examples\n");
    expect(fileContent(artifact, ".opencode/skills/tdd/references/usage.txt")).toBe("skill usage\nnext\n");
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

  test("emits plugin mode package, index, and resource files without opencode.json", () => {
    const artifact = emitOpenCode([
      agentFixture({
        id: "reviewer",
        references: { "guide.md": "Agent reference" },
        prompt: "Read {{references_dir}}/guide.md.",
      }),
      skillFixture({
        id: "tdd",
        common: { body: "Use {{references_dir}}/examples.md." },
        references: { "examples.md": "Skill reference" },
      }),
      commandFixture({ id: "ship" }),
      mcpFixture({ id: "local-fs", transport: "stdio" }),
    ], {
      mode: "plugin",
      plugin: {
        packageName: "@acme/opencode-plugin",
        version: "1.2.3",
        description: "Acme OpenCode plugin",
        license: "MIT",
        author: "Acme",
        homepage: "https://example.test",
        repository: "https://github.com/acme/plugin",
        keywords: ["opencode", "0xcraft"],
      },
    });

    expect(artifact.ok).toBe(true);
    expect(artifact.metadata.deterministic).toBe(true);
    expect(artifact.files.map((file) => file.path)).toEqual([
      ".opencode-plugin/agents/reviewer.md",
      ".opencode-plugin/agents/reviewer/references/guide.md",
      ".opencode-plugin/commands/ship.md",
      ".opencode-plugin/index.js",
      ".opencode-plugin/package.json",
      ".opencode-plugin/skills/tdd/references/examples.md",
      ".opencode-plugin/skills/tdd/SKILL.md",
    ]);
    expect(artifact.files.some((file) => file.path === "opencode.json")).toBe(false);
    expect(fileContent(artifact, ".opencode-plugin/agents/reviewer.md")).toContain("Read .opencode-plugin/agents/reviewer/references/guide.md.");
    expect(fileContent(artifact, ".opencode-plugin/skills/tdd/SKILL.md")).toContain("Use .opencode-plugin/skills/tdd/references/examples.md.");
    expect(fileContent(artifact, ".opencode-plugin/index.js")).toContain("export default async function zeroXCraftPlugin(input, options) {");
    expect(fileContent(artifact, ".opencode-plugin/index.js")).toContain("config: async (config) => {");
    expect(fileContent(artifact, ".opencode-plugin/index.js")).toContain("config.agent = { ...(config.agent ?? {}), ...agents };");

    expect(
      JSON.parse(fileContent(artifact, ".opencode-plugin/package.json")),
    ).toEqual({
      author: "Acme",
      description: "Acme OpenCode plugin",
      exports: "./index.js",
      files: ["index.js", "agents", "commands", "skills", "hooks"],
      homepage: "https://example.test",
      keywords: ["0xcraft", "opencode", "opencode-plugin"],
      license: "MIT",
      main: "index.js",
      name: "@acme/opencode-plugin",
      dependencies: {},
      repository: "https://github.com/acme/plugin",
      sideEffects: false,
      type: "module",
      version: "1.2.3",
    });
  });

  test("filesystem mode does not emit package.json", () => {
    const artifact = emitOpenCode([agentFixture({ id: "reviewer" })], { mode: "filesystem" });

    expect(artifact.files.some((file) => file.path === ".opencode-plugin/package.json")).toBe(false);
    expect(artifact.files.some((file) => file.path === "opencode.json")).toBe(true);
  });

  test("plugin mode consolidates hooks by sorted id", () => {
    const artifact = emitOpenCode([
      hookFixture({ id: "zeta-hook", actions: [{ type: "run_command", command: "printf z" }] }),
      hookFixture({ id: "alpha-hook", actions: [{ type: "run_exec", command: "node", args: ["a.js"] }] }),
    ], { mode: "plugin" });

    expect(artifact.files.map((file) => file.path)).toEqual([".opencode-plugin/index.js", ".opencode-plugin/package.json"]);
    const index = fileContent(artifact, ".opencode-plugin/index.js");
    expect(index).toContain("export default async function zeroXCraftPlugin(input, options) {");
    expect(index.indexOf("async function hook_alpha_hook(input, options)")).toBeLessThan(index.indexOf("async function hook_zeta_hook(input, options)"));
    expect(index).toContain("const hookFactoryNames = [");
    expect(index).toContain("hook_alpha_hook");
    expect(index).toContain("hook_zeta_hook");
  });

  test("plugin mode emits runtime_code hooks as separate files", () => {
    const runtimeCode = "export default async function plugin() {\n  return { event: async () => console.log('snowman ☃️ and cyrillic Ж') };\n}\n";
    const artifact = emitOpenCode([
      hookFixture({
        id: "unicode-runtime",
        actions: [{ type: "runtime_code", runtime: "opencode", body: runtimeCode }],
      }),
    ], { mode: "plugin" });

    const index = fileContent(artifact, ".opencode-plugin/index.js");
    expect(index).toContain(`import(join(__dirname, "hooks", "unicode-runtime.js"))`);
    expect(index).toContain("const hookFactoryNames = [");
    expect(index).toContain("hook_unicode_runtime");
    expect(fileContent(artifact, ".opencode-plugin/hooks/unicode-runtime.js")).toBe(runtimeCode);
    expect(artifact.ok).toBe(true);
  });

  test("plugin mode forwards runtime_code config hook", async () => {
    const runtimeCode = "export default async function plugin() {\n  return { config: async (config) => { config.runtimeHook = true; } };\n}\n";
    const artifact = emitOpenCode([
      hookFixture({
        id: "runtime-config",
        actions: [{ type: "runtime_code", runtime: "opencode", body: runtimeCode }],
      }),
    ], { mode: "plugin" });

    const module = await importGeneratedPlugin(artifact);
    const hooks = await module.default({ directory: "/repo" }, {});
    const config: Record<string, unknown> = {};
    await hooks.config(config);

    expect(config.runtimeHook).toBe(true);
  });

  test("plugin mode config hook mutates OpenCode config with agents, commands, skills path, and mcp", async () => {
    const artifact = emitOpenCode([
      agentFixture({ id: "reviewer", platform: { opencode: { tools: { read: true }, enabled: true } } }),
      skillFixture({ id: "tdd", platform: { opencode: { license: "MIT", metadata: { owner: "qa" } } as never } }),
      commandFixture({ id: "ship" }),
      mcpFixture({ id: "local-fs", transport: "stdio" }),
    ], {
      mode: "plugin",
      plugin: { packageName: "@acme/opencode-plugin" },
    });
    const module = await importGeneratedPlugin(artifact);

    expect(module.default).toEqual(expect.any(Function));

    const hooks = await module.default({ directory: "/repo" }, {});
    const config: Record<string, unknown> = {};
    await hooks.config(config);

    expect((config.agent as Record<string, unknown>).reviewer).toEqual(expect.objectContaining({
      description: "Reviews code.",
      enabled: true,
      mode: "subagent",
      model: "gpt-5.5",
      name: "Reviewer",
      prompt: "Review code carefully.\n",
      temperature: 0.2,
      tools: { read: true },
    }));
    expect((config.skills as { paths: string[] }).paths).toHaveLength(1);
    expect((config.skills as { paths: string[] }).paths[0]).toEndWith(".opencode-plugin/skills");
    expect((config.command as Record<string, unknown>).ship).toEqual(expect.objectContaining({
      agent: "reviewer",
      description: "Prepare release.",
      model: "gpt-5.5",
      name: "Ship",
      template: "Ship {{target}} safely.\n",
    }));
    expect(config.mcp).toEqual({
      "local-fs": {
        command: ["node", "server.js"],
        enabled: true,
        environment: { ROOT: "/repo" },
        timeout: 30,
        type: "local",
      },
    });
  });

  test("plugin mode duplicate hook ids produce error and no index artifact", () => {
    const artifact = emitOpenCode([
      hookFixture({ id: "dup-hook", actions: [{ type: "run_command", command: "printf one" }] }),
      hookFixture({ id: "dup-hook", actions: [{ type: "run_command", command: "printf two" }] }),
    ], { mode: "plugin" });

    expect(artifact.ok).toBe(false);
    expect(artifact.files.map((file) => file.path)).toEqual([]);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "ERR_PLUGIN_DUPLICATE_HOOK_ID",
      details: { hookId: "dup-hook", platform: "opencode" },
    }));
  });

  test("invalid plugin package name produces error diagnostic", () => {
    const artifact = emitOpenCode([agentFixture({ id: "reviewer" })], {
      mode: "plugin",
      plugin: { packageName: "Invalid Package Name" },
    });

    expect(artifact.ok).toBe(false);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "ERR_PLUGIN_INVALID_PACKAGE_NAME",
      details: { packageName: "Invalid Package Name", platform: "opencode" },
    }));
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

async function importGeneratedPlugin(artifact: ReturnType<typeof emitOpenCode>): Promise<{ default: (input: unknown, options: unknown) => Promise<{ config: (ctx: Record<string, unknown>) => Promise<void> }> }> {
  const tempDir = mkdtempSync(join(tmpdir(), "0xcraft-opencode-plugin-"));
  for (const file of artifact.files) {
    const path = join(tempDir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, "utf8");
  }

  return await import(`${pathToFileURL(join(tempDir, ".opencode-plugin", "index.js")).href}?t=${Date.now()}`);
}

function agentFixture(input: {
  id: string;
  platform?: AgentIR["platform"];
  references?: AgentIR["references"];
  prompt?: string;
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
      prompt: input.prompt ?? "Review code carefully.",
    },
    references: input.references,
    platform: input.platform ?? {},
    _sources: {},
  };
}

function skillFixture(input: {
  id: string;
  common?: Partial<SkillIR["common"]>;
  platform?: SkillIR["platform"];
  references?: SkillIR["references"];
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
    references: input.references,
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
