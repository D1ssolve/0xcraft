import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { importOpenCode } from "../adapters/opencode/import";
import { importClaude } from "../adapters/claude/import";
import { importCodex } from "../adapters/codex/import";
import type { IRResource } from "../core/ir";
import type { AgentIR } from "../core/ir/agent";
import type { SkillIR } from "../core/ir/skill";
import type { HookIR } from "../core/ir/hook";
import type { McpServerIR } from "../core/ir/mcp";
import type { CommandIR } from "../core/ir/command";

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "golden");
const OC_FIXTURE = join(FIXTURE_DIR, "opencode-fixture");
const CP_FIXTURE = join(FIXTURE_DIR, "claude-plugin-fixture");
const CS_FIXTURE = join(FIXTURE_DIR, "claude-subagent-fixture");
const CDX_FIXTURE = join(FIXTURE_DIR, "codex-fixture");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byKind<T extends IRResource>(resources: IRResource[], kind: T["kind"]): T[] {
  return resources.filter((r) => r.kind === kind) as T[];
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// OpenCode import tests
// ---------------------------------------------------------------------------

describe("Golden import tests", () => {
  describe("OpenCode import", () => {
    test("agents import correctly from markdown files", () => {
      const { ir } = importOpenCode(OC_FIXTURE);
      const agents = byKind<AgentIR>(ir, "agent");

      // main-agent.md + sub-agent.md + config-agent
      expect(agents.length).toBeGreaterThanOrEqual(3);

      const mainAgent = agents.find((a) => a.id === "main-agent");
      expect(mainAgent).toBeDefined();
      expect(mainAgent!.common.name).toBe("Main Agent");
      expect(mainAgent!.common.description).toBe("The primary agent for this project");
      expect(mainAgent!.common.role).toBe("primary");
      expect(mainAgent!.common.model).toBe("claude-opus-4");
      expect(mainAgent!.common.prompt).toContain("main agent");
      expect(mainAgent!.platform?.opencode).toBeDefined();
      expect((mainAgent!.platform?.opencode as Record<string, unknown>)?.color).toBe("purple");

      const subAgent = agents.find((a) => a.id === "sub-agent");
      expect(subAgent).toBeDefined();
      expect(subAgent!.common.role).toBe("subagent");

      const configAgent = agents.find((a) => a.id === "config-agent");
      expect(configAgent).toBeDefined();
      expect(configAgent!.common.role).toBe("subagent");
      expect(configAgent!.common.model).toBe("gpt-4o");
    });

    test("skills import correctly", () => {
      const { ir } = importOpenCode(OC_FIXTURE);
      const skills = byKind<SkillIR>(ir, "skill");

      expect(skills.length).toBeGreaterThanOrEqual(1);
      const skill = skills.find((s) => s.id === "my-skill");
      expect(skill).toBeDefined();
      expect(skill!.common.name).toBe("My Skill");
      expect(skill!.common.description).toContain("code review");
      expect(skill!.common.body).toContain("Review the provided code");

      // License and metadata are native fields
      const ocPlatform = skill!.platform?.opencode as Record<string, unknown> | undefined;
      expect(ocPlatform?.license).toBe("MIT");
    });

    test("hooks import as opaque runtime_code", () => {
      const { ir, diagnostics } = importOpenCode(OC_FIXTURE);
      const hooks = byKind<HookIR>(ir, "hook");

      expect(hooks.length).toBeGreaterThanOrEqual(1);
      const hook = hooks.find((h) => h.id === "my-hook");
      expect(hook).toBeDefined();
      expect(hook!.common.actions).toHaveLength(1);
      expect(hook!.common.actions[0]!.type).toBe("runtime_code");
      expect((hook!.common.actions[0] as { type: string; runtime: string }).runtime).toBe("opencode");

      // Opaque import diagnostic
      const opaqueInfo = diagnostics.find((d) => d.code === "opencode.hook.runtime_code_opaque");
      expect(opaqueInfo).toBeDefined();
    });

    test("MCP servers import correctly", () => {
      const { ir } = importOpenCode(OC_FIXTURE);
      const mcps = byKind<McpServerIR>(ir, "mcp");

      expect(mcps.length).toBeGreaterThanOrEqual(2);

      const local = mcps.find((m) => m.id === "local-server");
      expect(local).toBeDefined();
      expect(local!.common.transport).toBe("stdio");
      expect(local!.common.command).toBe("node");

      const remote = mcps.find((m) => m.id === "remote-server");
      expect(remote).toBeDefined();
      expect(remote!.common.transport).toBe("http");
      expect(remote!.common.url).toBe("https://api.example.com/mcp");
    });

    test("commands import correctly", () => {
      const { ir } = importOpenCode(OC_FIXTURE);
      const commands = byKind<CommandIR>(ir, "command");

      // help-cmd.md + config-cmd
      expect(commands.length).toBeGreaterThanOrEqual(2);

      const helpCmd = commands.find((c) => c.id === "help-cmd");
      expect(helpCmd).toBeDefined();
      expect(helpCmd!.common.name).toBe("Help Command");
      expect(helpCmd!.common.template).toContain("helpful summary");

      const configCmd = commands.find((c) => c.id === "config-cmd");
      expect(configCmd).toBeDefined();
      expect(configCmd!.common.template).toContain("Summarize");
      expect(configCmd!.common.agent).toBe("config-agent");
    });

    test("byte-stable: run twice produces identical output", () => {
      const run1 = importOpenCode(OC_FIXTURE);
      const run2 = importOpenCode(OC_FIXTURE);
      expect(stableJson(run1.ir)).toBe(stableJson(run2.ir));
      expect(stableJson(run1.diagnostics)).toBe(stableJson(run2.diagnostics));
    });
  });

  // --------------------------------------------------------------------------
  // Claude plugin import tests
  // --------------------------------------------------------------------------

  describe("Claude plugin import", () => {
    test("agents import correctly in plugin mode", () => {
      const { ir, mode } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      expect(mode).toBe("claude-plugin");

      const agents = byKind<AgentIR>(ir, "agent");
      expect(agents.length).toBeGreaterThanOrEqual(2);

      const pluginAgent = agents.find((a) => a.id === "plugin-agent");
      expect(pluginAgent).toBeDefined();
      expect(pluginAgent!.common.name).toBe("Plugin Agent");
      expect(pluginAgent!.common.model).toBe("claude-sonnet-4-20250514");
      const claudePlatform = pluginAgent!.platform?.claude as Record<string, unknown> | undefined;
      expect(claudePlatform?.effort).toBe("high");
    });

    test("forbidden fields stripped in plugin mode with diagnostics", () => {
      const { ir, diagnostics } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });

      const agents = byKind<AgentIR>(ir, "agent");
      const forbidden = agents.find((a) => a.id === "agent-with-forbidden");
      expect(forbidden).toBeDefined();

      // Forbidden fields preserved in platform.claude for round-trip
      const platform = forbidden!.platform?.claude as Record<string, unknown> | undefined;
      expect(platform?.permissionMode).toBe("acceptEdits");
      expect(platform?.hooks).toBeDefined();
      expect(platform?.mcpServers).toBeDefined();

      // Diagnostics warn about stripped fields
      const stripWarns = diagnostics.filter((d) => d.code === "claude.agent.plugin.field_stripped");
      expect(stripWarns.length).toBeGreaterThanOrEqual(3); // permissionMode, hooks, mcpServers
    });

    test("skills import correctly with hyphenated keys", () => {
      const { ir } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      const skills = byKind<SkillIR>(ir, "skill");

      expect(skills.length).toBeGreaterThanOrEqual(1);
      const skill = skills.find((s) => s.id === "my-skill");
      expect(skill).toBeDefined();
      expect(skill!.common.name).toBe("Claude Skill");
      expect((skill!.common as Record<string, unknown>)["allowed-tools"]).toEqual(["Bash", "Read"]);
      const claudePlatform = skill!.platform?.claude as Record<string, unknown> | undefined;
      expect(claudePlatform?.when_to_use).toBeDefined();
    });

    test("hooks import correctly from hooks.json", () => {
      const { ir } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      const hooks = byKind<HookIR>(ir, "hook");

      expect(hooks.length).toBeGreaterThanOrEqual(2);

      const preHook = hooks.find((h) => h.id === "PreToolUse-1");
      expect(preHook).toBeDefined();
      expect(preHook!.common.events).toContain("PreToolUse");
      expect(preHook!.common.actions[0]!.type).toBe("run_command");

      const postHook = hooks.find((h) => h.id === "PostToolUse-1");
      expect(postHook).toBeDefined();
      expect(postHook!.common.actions[0]!.type).toBe("http_request");
    });

    test("MCP servers import correctly from .mcp.json", () => {
      const { ir } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      const mcps = byKind<McpServerIR>(ir, "mcp");

      expect(mcps.length).toBeGreaterThanOrEqual(2);

      const fs = mcps.find((m) => m.id === "file-system");
      expect(fs).toBeDefined();
      expect(fs!.common.transport).toBe("stdio");
      expect(fs!.mcpEnvelope.wrapperKey).toBe("mcpServers");

      const webSearch = mcps.find((m) => m.id === "web-search");
      expect(webSearch).toBeDefined();
      expect(webSearch!.common.transport).toBe("http");
    });

    test("byte-stable: run twice produces identical output", () => {
      const run1 = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      const run2 = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      expect(stableJson(run1.ir)).toBe(stableJson(run2.ir));
      expect(stableJson(run1.diagnostics)).toBe(stableJson(run2.diagnostics));
    });
  });

  // --------------------------------------------------------------------------
  // Claude subagent import tests
  // --------------------------------------------------------------------------

  describe("Claude subagent import", () => {
    test("agents import correctly in subagent mode", () => {
      const { ir, mode } = importClaude(CS_FIXTURE, { mode: "claude-subagent" });
      expect(mode).toBe("claude-subagent");

      const agents = byKind<AgentIR>(ir, "agent");
      expect(agents.length).toBeGreaterThanOrEqual(2);

      const full = agents.find((a) => a.id === "full-subagent");
      expect(full).toBeDefined();
      expect(full!.common.name).toBe("Full Subagent");
      expect(full!.common.prompt).toContain("full subagent");

      const platform = full!.platform?.claude as Record<string, unknown> | undefined;
      expect(platform?.permissionMode).toBe("acceptEdits");
      expect(platform?.hooks).toBeDefined();
      // String-array mcpServers go to common (not platform)
      expect((full!.common as Record<string, unknown>).mcpServers).toEqual(["local-files", "web-tools"]);
      expect(platform?.color).toBe("blue");
    });

    test("full subagent fields NOT stripped (subagent mode differs from plugin)", () => {
      const { ir, diagnostics } = importClaude(CS_FIXTURE, { mode: "claude-subagent" });

      const agents = byKind<AgentIR>(ir, "agent");
      const full = agents.find((a) => a.id === "full-subagent");
      expect(full).toBeDefined();

      // No strip warnings in subagent mode
      const stripWarns = diagnostics.filter((d) => d.code === "claude.agent.plugin.field_stripped");
      expect(stripWarns.length).toBe(0);
    });

    test("minimal subagent with only required fields", () => {
      const { ir } = importClaude(CS_FIXTURE, { mode: "claude-subagent" });
      const agents = byKind<AgentIR>(ir, "agent");

      const minimal = agents.find((a) => a.id === "minimal-subagent");
      expect(minimal).toBeDefined();
      expect(minimal!.common.prompt).toContain("Execute the assigned task");
    });

    test("auto-detect mode from directory structure", () => {
      const { mode } = importClaude(CS_FIXTURE, { mode: "auto" });
      expect(mode).toBe("claude-subagent");
    });

    test("byte-stable: run twice produces identical output", () => {
      const run1 = importClaude(CS_FIXTURE, { mode: "claude-subagent" });
      const run2 = importClaude(CS_FIXTURE, { mode: "claude-subagent" });
      expect(stableJson(run1.ir)).toBe(stableJson(run2.ir));
      expect(stableJson(run1.diagnostics)).toBe(stableJson(run2.diagnostics));
    });
  });

  // --------------------------------------------------------------------------
  // Codex import tests
  // --------------------------------------------------------------------------

  describe("Codex import", () => {
    test("TOML agents import correctly", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const agents = byKind<AgentIR>(ir, "agent");

      expect(agents.length).toBeGreaterThanOrEqual(2);

      const primary = agents.find((a) => a.id === "primary-agent");
      expect(primary).toBeDefined();
      expect(primary!.common.name).toBe("Primary Codex Agent");
      expect(primary!.common.prompt).toContain("primary agent");
      expect(primary!.common.model).toBe("o4-mini");

      const platform = primary!.platform?.codex as Record<string, unknown> | undefined;
      expect(platform?.nickname_candidates).toEqual(["coder", "dev-agent"]);
      expect(platform?.model_reasoning_effort).toBe("high");
    });

    test("supported approval_policy imports unchanged", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const agents = byKind<AgentIR>(ir, "agent");

      const policyAgent = agents.find((a) => a.id === "request-policy-agent");
      expect(policyAgent).toBeDefined();

      const platform = policyAgent!.platform?.codex as Record<string, unknown> | undefined;
      expect(platform?.approval_policy).toBe("on-request");
    });

    test("hooks import from official event-keyed shape", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const hooks = byKind<HookIR>(ir, "hook");

      expect(hooks.length).toBeGreaterThanOrEqual(1);
    });

    test("hooks: command handler imports as run_command", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const hooks = byKind<HookIR>(ir, "hook");

      const preHook = hooks.find((h) => h.id === "PreToolUse-1");
      expect(preHook).toBeDefined();
      expect(preHook!.common.events).toContain("PreToolUse");
      expect(preHook!.common.actions[0]!.type).toBe("run_command");
    });

    test("hooks: prompt handler imports with drop-warn diagnostic", () => {
      const { diagnostics } = importCodex(CDX_FIXTURE);

      const promptWarn = diagnostics.find(
        (d) => d.code === "codex.hooks.handler.prompt.skipped",
      );
      expect(promptWarn).toBeDefined();
      expect(promptWarn!.severity).toBe("warn");
    });

    test("MCP from .mcp.json imports correctly with wrapped shape", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const mcps = byKind<McpServerIR>(ir, "mcp");

      expect(mcps.length).toBeGreaterThanOrEqual(2);

      const fs = mcps.find((m) => m.id === "filesystem");
      expect(fs).toBeDefined();
      expect(fs!.common.transport).toBe("stdio");
      expect(fs!.mcpEnvelope.sourceShape).toBe("wrapped");
      expect(fs!.mcpEnvelope.wrapperKey).toBe("mcp_servers");

      const remoteApi = mcps.find((m) => m.id === "remote-api");
      expect(remoteApi).toBeDefined();
      expect(remoteApi!.common.transport).toBe("http");
      // Codex-specific fields in platform
      const platform = remoteApi!.platform?.codex as Record<string, unknown> | undefined;
      expect(platform?.bearer_token_env_var).toBe("API_BEARER_TOKEN");
      expect(platform?.env_http_headers).toBeDefined();
    });

    test("byte-stable: run twice produces identical output", () => {
      const run1 = importCodex(CDX_FIXTURE);
      const run2 = importCodex(CDX_FIXTURE);
      expect(stableJson(run1.ir)).toBe(stableJson(run2.ir));
      expect(stableJson(run1.diagnostics)).toBe(stableJson(run2.diagnostics));
    });
  });

  // --------------------------------------------------------------------------
  // Snapshot tests (byte-stable IR representation)
  // --------------------------------------------------------------------------

  describe("IR snapshot stability", () => {
    test("OpenCode fixture → IR snapshot", () => {
      const { ir } = importOpenCode(OC_FIXTURE);
      // Snapshot ids to verify fixture structure is stable
      const ids = ir.map((r) => `${r.kind}:${r.id}`).sort();
      expect(ids).toMatchSnapshot();
    });

    test("Claude plugin fixture → IR snapshot", () => {
      const { ir } = importClaude(CP_FIXTURE, { mode: "claude-plugin" });
      const ids = ir.map((r) => `${r.kind}:${r.id}`).sort();
      expect(ids).toMatchSnapshot();
    });

    test("Claude subagent fixture → IR snapshot", () => {
      const { ir } = importClaude(CS_FIXTURE, { mode: "claude-subagent" });
      const ids = ir.map((r) => `${r.kind}:${r.id}`).sort();
      expect(ids).toMatchSnapshot();
    });

    test("Codex fixture → IR snapshot", () => {
      const { ir } = importCodex(CDX_FIXTURE);
      const ids = ir.map((r) => `${r.kind}:${r.id}`).sort();
      expect(ids).toMatchSnapshot();
    });
  });
});
