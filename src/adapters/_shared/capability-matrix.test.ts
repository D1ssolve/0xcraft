import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  CAPABILITY_FEATURES,
  CLAUDE_MATRIX,
  CODEX_MATRIX,
  OPENCODE_MATRIX,
  assertMatrixComplete,
  matrixDiagnosticFor,
} from "./capability-matrix";

describe("capability-matrix shared shim", () => {
  test("re-exports the v3 core capability matrix", () => {
    expect(CAPABILITY_FEATURES.length).toBeGreaterThan(37);
    expect(OPENCODE_MATRIX["agents.primary"]).toEqual(
      expect.objectContaining({ status: "full" }),
    );
    expect(CLAUDE_MATRIX["agents.primary"]).toBeDefined();
    expect(CODEX_MATRIX["agents.primary"]).toEqual(expect.objectContaining({ status: "full" }));
    expect(() => assertMatrixComplete()).not.toThrow();
  });

  test("re-exports v3 capability diagnostics", () => {
    const diagnostic = matrixDiagnosticFor("commands.slash", "codex");
    expect(diagnostic?.severity).toBe("warn");
    expect(diagnostic?.details?.platform).toBe("codex");
  });

  test("contains no local matrix definition", () => {
    const content = readFileSync(join(import.meta.dir, "capability-matrix.ts"), "utf8");
    expect(content).toBe('export * from "../../core/capability-matrix";\n');
    expect(content).not.toContain("37");
    expect(content).not.toContain("OPENCODE_MATRIX =");
    expect(content).not.toContain("CODEX_MATRIX =");
  });
});
