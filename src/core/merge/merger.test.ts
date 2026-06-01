import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type ZeroxCraftConfig } from "../config/config-schema";
import type { AgentIR, SkillIR } from "../ir";
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

  test("agent references from common files are sorted, last-write-wins, and added to provenance", () => {
    const resource = mergeResource(
      [
        commonAgent({
          file: "packs/base/AGENT.md",
          references: [
            { filename: "zeta.md", content: "base zeta", filePath: "packs/base/references/zeta.md" },
            { filename: "alpha.txt", content: "base alpha", filePath: "packs/base/references/alpha.txt" },
          ],
        }),
        commonAgent({
          file: "agents/explorer/AGENT.md",
          references: [
            { filename: "zeta.md", content: "local zeta", filePath: "agents/explorer/references/zeta.md" },
          ],
        }),
      ],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.references).toEqual({
      "alpha.txt": "base alpha",
      "zeta.md": "local zeta",
    });
    expect(Object.keys(resource.references ?? {})).toEqual(["alpha.txt", "zeta.md"]);
    expect(resource.provenance?.sourceFiles).toEqual([
      "agents/explorer/AGENT.md",
      "agents/explorer/references/zeta.md",
      "packs/base/AGENT.md",
      "packs/base/references/alpha.txt",
      "packs/base/references/zeta.md",
    ]);
  });

  test("skill references from common files are converted to IR", () => {
    const resource = mergeResource(
      [commonSkill({
        references: [
          { filename: "example.md", content: "Example", filePath: "skills/reviewer/references/example.md" },
        ],
      })],
      DEFAULT_CONFIG,
      {},
      "skill",
      "reviewer",
    ) as SkillIR;

    expect(resource.references).toEqual({ "example.md": "Example" });
    expect(resource.provenance?.sourceFiles).toEqual([
      "skills/reviewer/references/example.md",
      "skills/reviewer/SKILL.md",
    ]);
  });

  test("resources without references keep references absent", () => {
    const resource = mergeResource(
      [commonAgent()],
      DEFAULT_CONFIG,
      {},
      "agent",
      "explorer",
    ) as AgentIR;

    expect(resource.references).toBeUndefined();
  });
});

function commonAgent(overrides: Record<string, unknown> & Pick<Partial<RawResourceFile>, "file" | "references"> = {}): RawResourceFile {
  const { file = "agents/explorer/AGENT.md", references, ...frontmatterOverrides } = overrides;
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
    references,
  };
}

function commonSkill(overrides: Record<string, unknown> & Pick<Partial<RawResourceFile>, "file" | "references"> = {}): RawResourceFile {
  const { file = "skills/reviewer/SKILL.md", references, ...frontmatterOverrides } = overrides;
  return {
    id: "reviewer",
    kind: "skill",
    file,
    platform: "common",
    frontmatter: {
      name: "Reviewer",
      description: "Review code.",
      ...frontmatterOverrides,
    },
    body: "Review changes.",
    references,
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
