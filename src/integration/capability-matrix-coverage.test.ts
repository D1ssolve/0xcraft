import { describe, expect, test } from "bun:test";
import {
  CLAUDE_MATRIX,
  CODEX_MATRIX,
  OPENCODE_MATRIX,
  assertMatrixComplete,
} from "../core/capability-matrix/matrix";
import {
  CAPABILITY_FEATURES,
  CapabilityFeature,
  isClaudeModeCell,
} from "../core/capability-matrix/matrix-types";

// Features whose Claude matrix entry diverges between plugin and subagent modes.
// These are frontmatter fields and agents.color — see claudeStatus() in matrix.ts.
const CLAUDE_DIVERGENT_FEATURES = new Set<CapabilityFeature>(
  CAPABILITY_FEATURES.filter(
    (f) =>
      f.startsWith("agent.frontmatter.") ||
      f === ("agents.color" satisfies CapabilityFeature),
  ),
);

describe("Capability matrix completeness", () => {
  test("assertMatrixComplete passes for all 3 platforms", () => {
    expect(() =>
      assertMatrixComplete({
        opencode: OPENCODE_MATRIX,
        "claude-code": CLAUDE_MATRIX,
        codex: CODEX_MATRIX,
      }),
    ).not.toThrow();
  });

  test("CapabilityFeature enum has >= 64 members", () => {
    expect(CAPABILITY_FEATURES.length).toBeGreaterThanOrEqual(64);
  });

  test("all CapabilityFeature values present in each matrix", () => {
    const features = Object.values(CapabilityFeature) as CapabilityFeature[];

    for (const f of features) {
      expect(OPENCODE_MATRIX[f]).toBeDefined();
      expect(CLAUDE_MATRIX[f]).toBeDefined();
      expect(CODEX_MATRIX[f]).toBeDefined();
    }
  });

  test("matrix key count matches feature count", () => {
    const count = CAPABILITY_FEATURES.length;

    expect(Object.keys(OPENCODE_MATRIX).length).toBe(count);
    expect(Object.keys(CLAUDE_MATRIX).length).toBe(count);
    expect(Object.keys(CODEX_MATRIX).length).toBe(count);
  });

  test("Claude matrix has mode-specific cells for divergent features", () => {
    for (const f of CLAUDE_DIVERGENT_FEATURES) {
      const entry = CLAUDE_MATRIX[f];
      expect(entry).toBeDefined();
      expect(isClaudeModeCell(entry!)).toBe(true);
    }
  });

  test("Claude mode-specific cells have both plugin and subagent fields", () => {
    for (const f of CLAUDE_DIVERGENT_FEATURES) {
      const entry = CLAUDE_MATRIX[f]!;
      expect(isClaudeModeCell(entry)).toBe(true);
      if (isClaudeModeCell(entry)) {
        expect(entry.plugin).toBeDefined();
        expect(entry.subagent).toBeDefined();
        expect(typeof entry.plugin.status).toBe("string");
        expect(typeof entry.subagent.status).toBe("string");
      }
    }
  });

  test("non-divergent Claude entries are plain MatrixCells", () => {
    for (const f of CAPABILITY_FEATURES) {
      if (CLAUDE_DIVERGENT_FEATURES.has(f)) continue;
      const entry = CLAUDE_MATRIX[f]!;
      expect(isClaudeModeCell(entry)).toBe(false);
    }
  });

  test("all matrix entries have required fields", () => {
    const validStatuses = new Set(["full", "shim", "shell-cmd", "drop-warn", "experimental"]);

    function assertCell(cell: { status: string; evidence: string }): void {
      expect(validStatuses.has(cell.status)).toBe(true);
      expect(typeof cell.evidence).toBe("string");
      expect(cell.evidence.length).toBeGreaterThan(0);
    }

    for (const f of CAPABILITY_FEATURES) {
      const oc = OPENCODE_MATRIX[f]!;
      const cc = CLAUDE_MATRIX[f]!;
      const dc = CODEX_MATRIX[f]!;

      if (isClaudeModeCell(oc)) {
        assertCell(oc.plugin);
        assertCell(oc.subagent);
      } else {
        assertCell(oc);
      }

      if (isClaudeModeCell(cc)) {
        assertCell(cc.plugin);
        assertCell(cc.subagent);
      } else {
        assertCell(cc);
      }

      if (isClaudeModeCell(dc)) {
        assertCell(dc.plugin);
        assertCell(dc.subagent);
      } else {
        assertCell(dc);
      }
    }
  });
});
