import { describe, expect, test } from "bun:test";

import { CODEX_MATRIX, CLAUDE_MATRIX, OPENCODE_MATRIX, assertMatrixComplete } from "./matrix";
import { CAPABILITY_FEATURES } from "./matrix-types";

describe("capability matrix", () => {
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
