import { describe, expect, test } from "bun:test";

import { emitOpenCode } from "../adapters/opencode/emit";
import type { AgentIR, CommandIR, HookIR, IRResource, SkillIR } from "../core/ir";

describe("OpenCode plugin mode integration", () => {
  test("IT-01 emits plugin package, entrypoint, resources, and no opencode.json", () => {
    const artifact = emitOpenCode([
      agentFixture({ id: "reviewer" }),
      skillFixture({ id: "tdd" }),
      commandFixture({ id: "ship" }),
    ], { mode: "plugin" });

    expect(artifact.ok).toBe(true);
    expect(artifact.files.map((file) => file.path)).toEqual([
      ".opencode-plugin/agents/reviewer.md",
      ".opencode-plugin/commands/ship.md",
      ".opencode-plugin/index.js",
      ".opencode-plugin/package.json",
      ".opencode-plugin/skills/tdd/SKILL.md",
    ]);
    expect(artifact.files.some((file) => file.path === "opencode.json")).toBe(false);
  });

  test("IT-02 package.json declares modern plugin package fields", () => {
    const artifact = emitOpenCode([
      commandFixture({ id: "z-ship" }),
      agentFixture({ id: "z-reviewer" }),
      skillFixture({ id: "z-tdd" }),
      commandFixture({ id: "a-ship" }),
      agentFixture({ id: "a-reviewer" }),
      skillFixture({ id: "a-tdd" }),
    ], { mode: "plugin" });

    expect(
      JSON.parse(fileContent(artifact, ".opencode-plugin/package.json")),
    ).toEqual(
      expect.objectContaining({
        exports: "./index.js",
        files: ["index.js", "agents", "commands", "skills", "hooks"],
        main: "index.js",
        type: "module",
        sideEffects: false,
        name: "0xcraft-opencode-plugin",
        dependencies: {},
        version: "0.0.0",
      }),
    );
    expect(JSON.parse(fileContent(artifact, ".opencode-plugin/package.json")).opencode).toBeUndefined();
  });

  test("IT-03 rewrites reference tokens to plugin-relative paths", () => {
    const artifact = emitOpenCode([
      agentFixture({
        id: "reviewer",
        prompt: "Read {{references_dir}}/guide.md before review.",
        references: { "guide.md": "Review guide." },
      }),
      skillFixture({
        id: "tdd",
        body: "Use {{references_dir}}/examples.md first.",
        references: { "examples.md": "Test examples." },
      }),
    ], { mode: "plugin" });

    expect(fileContent(artifact, ".opencode-plugin/agents/reviewer.md")).toContain("Read .opencode-plugin/agents/reviewer/references/guide.md before review.");
    expect(fileContent(artifact, ".opencode-plugin/skills/tdd/SKILL.md")).toContain("Use .opencode-plugin/skills/tdd/references/examples.md first.");
    expect(fileContent(artifact, ".opencode-plugin/agents/reviewer/references/guide.md")).toBe("Review guide.\n");
    expect(fileContent(artifact, ".opencode-plugin/skills/tdd/references/examples.md")).toBe("Test examples.\n");
  });

  test("IT-04 emits byte-identical plugin output for the same IR", () => {
    const ir: IRResource[] = [
      hookFixture({ id: "beta-hook", actions: [{ type: "run_command", command: "printf beta" }] }),
      hookFixture({ id: "alpha-hook", actions: [{ type: "run_exec", command: "node", args: ["hook.js"] }] }),
      agentFixture({ id: "reviewer", references: { "guide.md": "Guide" } }),
      skillFixture({ id: "tdd" }),
      commandFixture({ id: "ship" }),
    ];

    expect(JSON.stringify(emitOpenCode(ir, { mode: "plugin" }))).toBe(JSON.stringify(emitOpenCode(ir, { mode: "plugin" })));
  });

  test("IT-05 sorts hook functions and hook factory registry by hook id in index.js", () => {
    const artifact = emitOpenCode([
      hookFixture({ id: "zeta-hook", actions: [{ type: "run_command", command: "printf z" }] }),
      hookFixture({ id: "alpha-hook", actions: [{ type: "run_command", command: "printf a" }] }),
    ], { mode: "plugin" });

    const index = fileContent(artifact, ".opencode-plugin/index.js");
    expect(index.indexOf("async function hook_alpha_hook(input, options)")).toBeLessThan(index.indexOf("async function hook_zeta_hook(input, options)"));
    expect(index.indexOf('"hook_alpha_hook"')).toBeLessThan(index.indexOf('"hook_zeta_hook"'));
  });

  test("IT-06 emits plugin function with config hook when no runtime hooks exist", () => {
    const artifact = emitOpenCode([agentFixture({ id: "reviewer" })], { mode: "plugin" });

    const index = fileContent(artifact, ".opencode-plugin/index.js");
    expect(index).toContain("export default async function zeroXCraftPlugin(input, options) {");
    expect(index).toContain("config: async (config) => {");
    expect(index).toContain("config.agent = { ...(config.agent ?? {}), ...agents };");
  });

  test("IT-07 reports duplicate hook ids and omits index.js", () => {
    const artifact = emitOpenCode([
      hookFixture({ id: "dup-hook", actions: [{ type: "run_command", command: "printf one" }] }),
      hookFixture({ id: "dup-hook", actions: [{ type: "run_command", command: "printf two" }] }),
    ], { mode: "plugin" });

    expect(artifact.ok).toBe(false);
    expect(artifact.files.some((file) => file.path === ".opencode-plugin/index.js")).toBe(false);
    expect(artifact.files.some((file) => file.path === ".opencode-plugin/package.json")).toBe(false);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "ERR_PLUGIN_DUPLICATE_HOOK_ID",
      details: { hookId: "dup-hook", platform: "opencode" },
    }));
  });

  test("IT-08 emits runtime_code hooks as separate files in plugin mode", () => {
    const runtimeCode = "export default async function plugin() {\n  return { event: async () => console.log('unicode ☃️ Ж') };\n}\n";
    const artifact = emitOpenCode([
      hookFixture({
        id: "unicode-runtime",
        actions: [{ type: "runtime_code", runtime: "opencode", body: runtimeCode }],
      }),
    ], { mode: "plugin" });

    expect(artifact.ok).toBe(true);
    expect(fileContent(artifact, ".opencode-plugin/index.js")).toContain(
      `import(join(__dirname, "hooks", "unicode-runtime.js"))`,
    );
    expect(fileContent(artifact, ".opencode-plugin/hooks/unicode-runtime.js")).toBe(runtimeCode);
  });
});

function agentFixture(input: {
  id: string;
  prompt?: string;
  references?: AgentIR["references"];
}): AgentIR {
  return {
    id: input.id,
    kind: "agent",
    sourcePath: `agents/${input.id}/AGENT.md`,
    common: {
      name: input.id,
      description: `Agent ${input.id}.`,
      role: "subagent",
      model: "gpt-5.5",
      prompt: input.prompt ?? "Review code carefully.",
    },
    references: input.references,
    platform: {},
    _sources: {},
  };
}

function skillFixture(input: {
  id: string;
  body?: string;
  references?: SkillIR["references"];
}): SkillIR {
  return {
    id: input.id,
    kind: "skill",
    sourcePath: `skills/${input.id}/SKILL.md`,
    common: {
      name: input.id,
      description: `Skill ${input.id}.`,
      body: input.body ?? "Write failing test first.",
    },
    references: input.references,
    platform: {},
    _sources: {},
  };
}

function commandFixture(input: { id: string }): CommandIR {
  return {
    id: input.id,
    kind: "command",
    sourcePath: `commands/${input.id}/COMMAND.md`,
    common: {
      name: input.id,
      description: `Command ${input.id}.`,
      template: "Ship safely.",
    },
    platform: {},
    _sources: {},
  };
}

function hookFixture(input: { id: string; actions: HookIR["common"]["actions"] }): HookIR {
  return {
    id: input.id,
    kind: "hook",
    sourcePath: `hooks/${input.id}/HOOK.md`,
    common: {
      name: input.id,
      events: ["PreToolUse"],
      runtime: "portable",
      actions: input.actions,
    },
    platform: {},
    _sources: {},
  };
}

function fileContent(artifact: ReturnType<typeof emitOpenCode>, path: string): string {
  const file = artifact.files.find((candidate) => candidate.path === path);
  expect(file).toBeDefined();
  return file?.content ?? "";
}
