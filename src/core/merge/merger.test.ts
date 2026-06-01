import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type ZeroxCraftConfig } from "../config/config-schema";
import type { AgentIR } from "../ir";
import type { RawResourceFile } from "../loader/file-loader";
import { mergeResource } from "./merger";

describe("mergeResource", () => {
  test("common name and sibling name with same value records the last writer", () => {
    const resource = mergeResource(
      [commonAgent({ name: "Explorer", model: "haiku" }), codexAgent({ name: "Explorer" })],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.common.name).toBe("Explorer");
    expect(resource.platform.codex?.name).toBe("Explorer");
    expect(resource._sources?.name).toBe("agent.codex.toml");
  });

  test("platform sibling model overrides common model without ambiguity", () => {
    const resource = mergeResource(
      [commonAgent({ model: "haiku" }), codexAgent({ model: "sonnet" })],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.common.model).toBe("haiku");
    expect(resource.platform.codex?.model).toBe("sonnet");
    expect(resource._sources?.model).toBe("agent.codex.toml");
  });

  test("two common files with incompatible same-key values throw ERR_AMBIGUOUS_FRONTMATTER_MERGE", () => {
    expect(() =>
      mergeResource(
        [commonAgent({ model: "haiku", file: "agents/explorer/AGENT.md" }), commonAgent({ model: "sonnet", file: "packs/explorer/AGENT.md" })],
        DEFAULT_CONFIG,
        {},
        "agent",
        "explorer",
      ),
    ).toThrow(expect.objectContaining({ code: "ERR_AMBIGUOUS_FRONTMATTER_MERGE" }));
  });

  test("sibling array replaces common array by default", () => {
    const resource = mergeResource(
      [commonAgent({ tools: ["A"] }), claudeAgent({ tools: ["B"] })],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.platform.claude?.tools).toEqual(["B"]);
  });

  test("sibling merge append directive concatenates array fields", () => {
    const resource = mergeResource(
      [commonAgent({ tools: ["A"] }), claudeAgent({ tools: ["B"], merge: { tools: "append" } })],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.platform.claude?.tools).toEqual(["A", "B"]);
  });

  test("codex config agent override wins over file metadata", () => {
    const config = {
      ...DEFAULT_CONFIG,
      platforms: {
        ...DEFAULT_CONFIG.platforms,
        codex: {
          ...DEFAULT_CONFIG.platforms.codex,
          agents: { explorer: { model: "opus" } },
        },
      },
    } as unknown as ZeroxCraftConfig;

    const resource = mergeResource(
      [commonAgent({ model: "haiku" }), codexAgent({ model: "sonnet" })],
      config,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.platform.codex?.model).toBe("opus");
    expect(resource._sources?.model).toBe(".0xcraft/config.json");
  });

  test("CLI overrides win over files and config", () => {
    const config = {
      ...DEFAULT_CONFIG,
      platforms: {
        ...DEFAULT_CONFIG.platforms,
        codex: {
          ...DEFAULT_CONFIG.platforms.codex,
          agents: { explorer: { model: "opus" } },
        },
      },
    } as unknown as ZeroxCraftConfig;

    const resource = mergeResource(
      [commonAgent({ model: "haiku" }), codexAgent({ model: "sonnet" })],
      config,
      { model: "haiku" },
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.kind).toBe("agent");
    expect(resource.platform.codex?.model).toBe("haiku");
    expect(resource._sources?.model).toBe("<cli>");
  });
});

function commonAgent(overrides: Record<string, unknown> & { file?: string } = {}): RawResourceFile {
  const { file = "agents/explorer/AGENT.md", ...frontmatterOverrides } = overrides;
  return {
    id: "explorer",
    kind: "agent",
    file,
    platform: "common",
    frontmatter: {
      name: "Explorer",
      description: "Explore code.",
      ...frontmatterOverrides,
    },
    body: "Inspect the codebase.",
  };
}

function codexAgent(frontmatter: Record<string, unknown>): RawResourceFile {
  return {
    id: "explorer",
    kind: "agent",
    file: "agents/explorer/agent.codex.toml",
    platform: "codex",
    frontmatter,
    body: "",
  };
}

function claudeAgent(frontmatter: Record<string, unknown>): RawResourceFile {
  return {
    id: "explorer",
    kind: "agent",
    file: "agents/explorer/agent.claude.md",
    platform: "claude",
    frontmatter,
    body: "",
  };
}
