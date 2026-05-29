import { describe, expect, test } from "bun:test";
import {
  ALL_CAPABILITY_FEATURES,
  CLAUDE_CODE_MATRIX,
  CODEX_MATRIX,
  OPENCODE_MATRIX,
  assertMatrixComplete,
  getCapabilityCell,
  type PlatformCapabilityMatrix,
} from "./capability-matrix";

const HOOK_FEATURES = ALL_CAPABILITY_FEATURES.filter((f) => f.startsWith("hooks."));

function statusHistogram(matrix: PlatformCapabilityMatrix): Record<string, number> {
  return ALL_CAPABILITY_FEATURES.reduce<Record<string, number>>((counts, feature) => {
    const status = matrix[feature].status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

describe("capability-matrix (spec §11, 37 keys)", () => {
  test("exposes 37 feature keys", () => {
    expect(ALL_CAPABILITY_FEATURES.length).toBe(37);
  });

  test("all 3 matrices are complete", () => {
    expect(() => assertMatrixComplete(OPENCODE_MATRIX, "opencode")).not.toThrow();
    expect(() => assertMatrixComplete(CLAUDE_CODE_MATRIX, "claude-code")).not.toThrow();
    expect(() => assertMatrixComplete(CODEX_MATRIX, "codex")).not.toThrow();
  });

  test("every cell carries a non-empty status from the canonical vocab", () => {
    const allowed = new Set(["full", "shim", "shell-cmd", "drop-warn", "experimental"]);
    for (const [name, matrix] of [
      ["opencode", OPENCODE_MATRIX],
      ["claude-code", CLAUDE_CODE_MATRIX],
      ["codex", CODEX_MATRIX],
    ] as const) {
      for (const feature of ALL_CAPABILITY_FEATURES) {
        const cell = matrix[feature];
        expect(allowed.has(cell.status), `${name}.${feature} status invalid`).toBe(true);
        expect(Array.isArray(cell.diagnostics)).toBe(true);
      }
    }
  });

  test("Codex status histogram matches ADR-006", () => {
    expect(statusHistogram(CODEX_MATRIX)).toEqual({
      full: 20,
      experimental: 2,
      shim: 4,
      "drop-warn": 11,
    });
  });

  test("Codex hook statuses match ADR-006 lifecycle support table", () => {
    expect(CODEX_MATRIX["hooks.sessionStart"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.sessionEnd"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.userPromptFirst"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.userPromptEvery"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.messageTransform"].status).toBe("drop-warn");
    expect(CODEX_MATRIX["hooks.beforeToolCall"].status).toBe("experimental");
    expect(CODEX_MATRIX["hooks.afterToolCall"].status).toBe("experimental");
    expect(CODEX_MATRIX["hooks.afterToolFailure"].status).toBe("shim");
    expect(CODEX_MATRIX["hooks.agentSpawn"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.agentStop"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.beforeCompact"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.afterCompact"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.notification"].status).toBe("drop-warn");
    expect(CODEX_MATRIX["hooks.permissionRequest"].status).toBe("full");
    expect(CODEX_MATRIX["hooks.shellEnvironment"].status).toBe("shim");
  });

  test("Codex supported hook cells carry trust-required secondary diagnostic", () => {
    for (const hook of HOOK_FEATURES) {
      const cell = CODEX_MATRIX[hook];
      if (cell.status !== "drop-warn") {
        expect(
          cell.diagnostics,
          `CODEX_MATRIX.${hook} needs codex.hooks.trust.required`,
        ).toContain("codex.hooks.trust.required");
      }
    }
  });

  test("hooks.shellEnvironment cells closes adr-review Finding 1", () => {
    expect(OPENCODE_MATRIX["hooks.shellEnvironment"].status).toBe("full");
    expect(CLAUDE_CODE_MATRIX["hooks.shellEnvironment"].status).toBe("drop-warn");
    expect(CODEX_MATRIX["hooks.shellEnvironment"].status).toBe("shim");
  });

  test("OpenCode session/userPrompt/messageTransform hooks are experimental (transform shim)", () => {
    expect(OPENCODE_MATRIX["hooks.sessionStart"].status).toBe("experimental");
    expect(OPENCODE_MATRIX["hooks.userPromptFirst"].status).toBe("experimental");
    expect(OPENCODE_MATRIX["hooks.userPromptEvery"].status).toBe("experimental");
    expect(OPENCODE_MATRIX["hooks.messageTransform"].status).toBe("experimental");
  });

  test("Claude Code most hooks are shell-cmd (matchers route to scripts)", () => {
    expect(CLAUDE_CODE_MATRIX["hooks.sessionStart"].status).toBe("shell-cmd");
    expect(CLAUDE_CODE_MATRIX["hooks.userPromptFirst"].status).toBe("shell-cmd");
    expect(CLAUDE_CODE_MATRIX["hooks.beforeToolCall"].status).toBe("shell-cmd");
    expect(CLAUDE_CODE_MATRIX["hooks.afterToolCall"].status).toBe("shell-cmd");
    expect(CLAUDE_CODE_MATRIX["hooks.afterCompact"].status).toBe("shell-cmd");
    expect(CLAUDE_CODE_MATRIX["hooks.afterCompact"].diagnostics).toContain(
      "claude-code.hooks.afterCompact.shell",
    );
  });

  test("Codex non-hook cell changes match ADR-006", () => {
    expect(CODEX_MATRIX["skills.autoLoad"].status).toBe("full");
    expect(CODEX_MATRIX["commands.slash"].status).toBe("drop-warn");
    expect(CODEX_MATRIX["commands.slash"].diagnostics).toContain("codex.commands.slash.dropped");
    expect(CODEX_MATRIX["permissions.perTool"].status).toBe("shim");
    expect(CODEX_MATRIX["permissions.perTool"].diagnostics).toContain(
      "codex.permissions.perTool.shim",
    );
  });

  test("cells with drop-warn or shell-cmd or shim must carry at least one diagnostic code", () => {
    for (const [name, matrix] of [
      ["opencode", OPENCODE_MATRIX],
      ["claude-code", CLAUDE_CODE_MATRIX],
      ["codex", CODEX_MATRIX],
    ] as const) {
      for (const feature of ALL_CAPABILITY_FEATURES) {
        const cell = matrix[feature];
        if (cell.status === "drop-warn" || cell.status === "shell-cmd") {
          expect(
            cell.diagnostics.length,
            `${name}.${feature} (${cell.status}) needs diagnostic code`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  test("getCapabilityCell reads cells", () => {
    expect(getCapabilityCell(OPENCODE_MATRIX, "agents.mode").status).toBe("full");
  });

  test("diagnostic codes follow platform.feature.kind convention", () => {
    const diagnosticCode = /^(opencode|claude-code|codex)\.[A-Za-z]+\.[A-Za-z]+\.[A-Za-z]+$/;
    for (const [name, matrix] of [
      ["opencode", OPENCODE_MATRIX],
      ["claude-code", CLAUDE_CODE_MATRIX],
      ["codex", CODEX_MATRIX],
    ] as const) {
      for (const feature of ALL_CAPABILITY_FEATURES) {
        for (const code of matrix[feature].diagnostics) {
          expect(code, `${name}.${feature} diagnostic ${code}`).toMatch(diagnosticCode);
        }
      }
    }
  });

  test("assertMatrixComplete throws when a cell is missing", () => {
    const broken = { ...OPENCODE_MATRIX } as Partial<PlatformCapabilityMatrix>;
    delete broken["agents.mode"];
    expect(() =>
      assertMatrixComplete(broken as PlatformCapabilityMatrix, "broken"),
    ).toThrow(/agents\.mode/);
  });
});
