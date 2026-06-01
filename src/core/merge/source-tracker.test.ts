import { describe, expect, test } from "bun:test";

import { basenameOrigin, createSourceTracker, flattenSourceMap } from "./source-tracker";

describe("source tracker", () => {
  test("uses basename as source origin", () => {
    expect(basenameOrigin("agents/explorer/agent.codex.toml")).toBe("agent.codex.toml");
  });

  test("tracks flattened field paths", () => {
    const tracker = createSourceTracker();

    tracker.recordObject("platform.codex", { model: "sonnet", nested: { value: true } }, "agent.codex.toml");

    expect(tracker.sources()).toEqual({
      "platform.codex.model": "agent.codex.toml",
      "platform.codex.nested.value": "agent.codex.toml",
    });
  });

  test("last writer wins for a tracked field", () => {
    const tracker = createSourceTracker();

    tracker.record("model", "AGENT.md");
    tracker.record("model", "agent.codex.toml");

    expect(tracker.sources()).toEqual({ model: "agent.codex.toml" });
  });

  test("flattenSourceMap ignores arrays as leaf values", () => {
    expect(flattenSourceMap("common", { tags: ["a"], meta: { x: 1 } }, "AGENT.md")).toEqual({
      "common.tags": "AGENT.md",
      "common.meta.x": "AGENT.md",
    });
  });
});
