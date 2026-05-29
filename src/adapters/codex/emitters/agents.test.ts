/**
 * Tests for the Codex per-agent TOML emitter (Task D.2).
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { parse } from "smol-toml";

import { defaultConfig, mergeConfig, type ZeroxCraftConfig, type PartialZeroxCraftConfig } from "../../../core/config";
import { getAgentById } from "../../../core/agents";
import type { AgentSpec } from "../../../core/agents";

import { emitCodexAgent } from "./agents";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");

function cloneConfig(overrides: PartialZeroxCraftConfig = {}): ZeroxCraftConfig {
  return mergeConfig({
    modelOverrides: { ...defaultConfig.modelOverrides },
    ...overrides,
  });
}

function getCodeExplorer(): AgentSpec {
  const agent = getAgentById("code-explorer");
  if (!agent) throw new Error("Fixture missing: code-explorer agent not registered");
  return agent;
}

describe("emitCodexAgent: required fields & parse-ability", () => {
  test("emits standalone TOML with name/description/developer_instructions", () => {
    const agent = getCodeExplorer();
    const { filename, toml, diagnostics } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });

    expect(filename).toBe(".codex/agents/code-explorer.toml");

    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.name).toBe(agent.name);
    expect(parsed.description).toBe(agent.description);
    expect(typeof parsed.developer_instructions).toBe("string");
    expect((parsed.developer_instructions as string).length).toBeGreaterThan(0);
    // multi-line body
    expect((parsed.developer_instructions as string).includes("\n")).toBe(true);

    // Dropped fields must not be present
    expect("color" in parsed).toBe(false);
    expect("temperature" in parsed).toBe(false);

    // Diagnostic for dropped color, since code-explorer has color="info"
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("codex.agent.color_dropped");
  });
});

describe("emitCodexAgent: model override precedence", () => {
  test("no override → uses agent.model", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.model).toBe(agent.model);
  });

  test("modelOverrides[id] wins over agent.model", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        modelOverrides: { [agent.id]: "override/global-model" },
      }),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.model).toBe("override/global-model");
  });

  test("platformModelOverrides.codex[id] wins over both", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        modelOverrides: { [agent.id]: "override/global-model" },
        platformModelOverrides: {
          codex: { [agent.id]: "override/codex-model" },
        },
      }),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.model).toBe("override/codex-model");
  });

  test("empty string override is ignored (falls through)", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        platformModelOverrides: { codex: { [agent.id]: "" } },
        modelOverrides: { [agent.id]: "" },
      }),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.model).toBe(agent.model);
  });
});

describe("emitCodexAgent: mcp_servers scoping", () => {
  test("perAgentMcpServers non-empty → emits mcp_servers array", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
      perAgentMcpServers: ["a", "b"],
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.mcp_servers).toEqual(["a", "b"]);
  });

  test("perAgentMcpServers absent → no mcp_servers key", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect("mcp_servers" in parsed).toBe(false);
  });

  test("perAgentMcpServers empty array → no mcp_servers key", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
      perAgentMcpServers: [],
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect("mcp_servers" in parsed).toBe(false);
  });
});

describe("emitCodexAgent: dropped-field diagnostics", () => {
  test("permissions present → permissions_degraded diagnostic", () => {
    const agent = getCodeExplorer();
    const { diagnostics } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("codex.agent.permissions_degraded");
  });

  test("non-neutral temperature → temperature_dropped diagnostic", () => {
    const agent = getCodeExplorer();
    // code-explorer has temperature: 0.3 (non-neutral)
    expect(agent.temperature).not.toBe(0.7);
    const { diagnostics } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("codex.agent.temperature_dropped");
  });
});

describe("emitCodexAgent: missing prompt file", () => {
  test("emits stub with empty developer_instructions + error diagnostic", () => {
    const agent = getCodeExplorer();
    const broken: AgentSpec = {
      ...agent,
      promptFile: "agents/does-not-exist-xyz.agent.md",
    };
    const { toml, diagnostics } = emitCodexAgent({
      agent: broken,
      packageRoot,
      config: cloneConfig(),
    });

    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("codex.agent.prompt_missing");

    const parsed = parse(toml) as Record<string, unknown>;
    // empty multiline still parses to "" (no crash)
    expect(parsed.developer_instructions).toBe("");
    expect(parsed.name).toBe(agent.name);
  });
});

describe("emitCodexAgent: required-field validation", () => {
  test("empty name and description → required_field_missing diagnostics", () => {
    const agent = getCodeExplorer();
    const broken: AgentSpec = { ...agent, name: "", description: "" };
    const { diagnostics } = emitCodexAgent({
      agent: broken,
      packageRoot,
      config: cloneConfig(),
    });
    const missing = diagnostics.filter((d) => d.code === "codex.agent.required_field_missing");
    expect(missing.length).toBe(2);
    const fields = missing.map((d) => (d.details as { field: string } | undefined)?.field);
    expect(fields).toContain("name");
    expect(fields).toContain("description");
  });
});

describe("emitCodexAgent: permission mapper wired in", () => {
  test("agent with sandbox='read' → emits sandbox_mode='read-only'", () => {
    const agent = getCodeExplorer();
    const withDeny: AgentSpec = {
      ...agent,
      permission: {
        sandbox: "read",
        tools: {},
        bash: {},
      },
    };
    const { toml } = emitCodexAgent({
      agent: withDeny,
      packageRoot,
      config: cloneConfig(),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.sandbox_mode).toBe("read-only");
  });

  test("agent with doom_loop deny → emits approval_policy='on-request'", () => {
    const agent = getCodeExplorer();
    const withSafety: AgentSpec = {
      ...agent,
      permission: {
        sandbox: "workspace-write",
        tools: { "safety.doom_loop": "deny" },
        bash: {},
      },
    };
    const { toml } = emitCodexAgent({
      agent: withSafety,
      packageRoot,
      config: cloneConfig(),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.approval_policy).toBe("on-request");
  });

  test("agent with no permissions → no sandbox_mode / approval_policy keys", () => {
    const agent = getCodeExplorer();
    const noPerms: AgentSpec = { ...agent, permission: undefined };
    const { toml } = emitCodexAgent({
      agent: noPerms,
      packageRoot,
      config: cloneConfig(),
    });
    const parsed = parse(toml) as Record<string, unknown>;
    expect("sandbox_mode" in parsed).toBe(false);
    expect("approval_policy" in parsed).toBe(false);
  });
});

describe("emitCodexAgent: matrix-driven diagnostics", () => {
  test("color diagnostic carries matrix-driven warn severity (drop cell)", () => {
    const agent = getCodeExplorer();
    const { diagnostics } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const diag = diagnostics.find((d) => d.code === "codex.agent.color_dropped");
    expect(diag).toBeDefined();
    // CODEX_MATRIX.agentColor === "drop" → warn.
    expect(diag!.severity).toBe("warn");
  });

  test("temperature diagnostic carries matrix-driven warn severity (drop cell)", () => {
    const agent = getCodeExplorer();
    const { diagnostics } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig(),
    });
    const diag = diagnostics.find((d) => d.code === "codex.agent.temperature_dropped");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warn");
  });
});

describe("emitCodexAgent: T-21 platforms.codex.agents[id] extension", () => {
  test("emits model_reasoning_effort and nickname_candidates from extension", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        platforms: {
          codex: {
            agents: {
              [agent.id]: {
                model_reasoning_effort: "high",
                nickname_candidates: ["explorer", "scout"],
              },
            },
          },
        },
      }),
    });
    const parsed = parse(toml) as {
      model_reasoning_effort: string;
      nickname_candidates: string[];
    };
    expect(parsed.model_reasoning_effort).toBe("high");
    expect(parsed.nickname_candidates).toEqual(["explorer", "scout"]);
  });

  test("emits [skills.config] sub-table when extension provides skills.config", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        platforms: {
          codex: {
            agents: {
              [agent.id]: {
                skills: { config: { max_depth: 5, allow: ["foo", "bar"] } },
              },
            },
          },
        },
      }),
    });
    const parsed = parse(toml) as { skills: { config: { max_depth: number; allow: string[] } } };
    expect(parsed.skills.config.max_depth).toBe(5);
    expect(parsed.skills.config.allow).toEqual(["foo", "bar"]);
  });

  test("omits extension fields when extension is absent or empty", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({ agent, packageRoot, config: cloneConfig() });
    expect(toml.includes("model_reasoning_effort")).toBe(false);
    expect(toml.includes("nickname_candidates")).toBe(false);
    expect(toml.includes("[skills.config]")).toBe(false);
  });

  test("omits [skills.config] when extension provides empty config object", () => {
    const agent = getCodeExplorer();
    const { toml } = emitCodexAgent({
      agent,
      packageRoot,
      config: cloneConfig({
        platforms: { codex: { agents: { [agent.id]: { skills: { config: {} } } } } },
      }),
    });
    expect(toml.includes("[skills.config]")).toBe(false);
  });
});
