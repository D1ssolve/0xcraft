import { describe, expect, test } from "bun:test";

import { CODEX_MATRIX, CLAUDE_MATRIX, OPENCODE_MATRIX, assertMatrixComplete } from "./matrix";
import { CAPABILITY_FEATURES } from "./matrix-types";

describe("capability matrix", () => {
  test("tracks 109 capability features", () => {
    expect(CAPABILITY_FEATURES.length).toBe(109);
  });

  test("tracks reference feature support by platform", () => {
    expect(OPENCODE_MATRIX["agents.references"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(OPENCODE_MATRIX["skills.references"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(CLAUDE_MATRIX["agents.references"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(CLAUDE_MATRIX["skills.references"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(CODEX_MATRIX["agents.references"]).toEqual(expect.objectContaining({ status: "shim" }));
    expect(CODEX_MATRIX["skills.references"]).toEqual(expect.objectContaining({ status: "shim" }));
  });

  test("tracks OpenCode plugin emit support by platform", () => {
    expect(OPENCODE_MATRIX["opencode.emit.plugin"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(CLAUDE_MATRIX["opencode.emit.plugin"]).toEqual(expect.objectContaining({ status: "drop-warn" }));
    expect(CODEX_MATRIX["opencode.emit.plugin"]).toEqual(expect.objectContaining({ status: "drop-warn" }));
  });

  test("assertMatrixComplete passes for all platform matrices", () => {
    expect(() => assertMatrixComplete()).not.toThrow();
  });

  test("assertMatrixComplete reports missing keys by platform", () => {
    const missingFeature = CAPABILITY_FEATURES[0];
    if (missingFeature === undefined) throw new Error("CAPABILITY_FEATURES must not be empty");

    const incomplete = { ...OPENCODE_MATRIX };
    delete incomplete[missingFeature];

    expect(() =>
      assertMatrixComplete({
        opencode: incomplete,
        "claude-code": CLAUDE_MATRIX,
        codex: CODEX_MATRIX,
      }),
    ).toThrow(`opencode missing: ${missingFeature}`);
  });
});
