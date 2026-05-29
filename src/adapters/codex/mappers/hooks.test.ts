/**
 * Codex hooks mapper — Batch D unit tests (T-12, T-14).
 *
 * Pins:
 *   (1) drop-warn cells emit warn diagnostics and produce no entries
 *   (2) full / experimental / shim cells produce native entries with
 *       matrix breadcrumb diagnostics at the correct severity
 *   (3) shim flavours: AfterToolFailure → failure-only;
 *       UserPromptFirst → first-only
 *   (4) `eventToFeature` is total
 */
import { describe, expect, test } from "bun:test";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { CODEX_MATRIX } from "../../_shared/capability-matrix";
import { HookEvent, type HookSpec } from "../../../core/hooks";
import { mapHooksToCodex, eventToFeature } from "./hooks";

function hookSpec(over: Partial<HookSpec> = {}): HookSpec {
  return {
    id: over.id ?? "test-hook",
    description: over.description ?? "test description",
    event: over.event ?? HookEvent.SessionStart,
    enabledByDefault: over.enabledByDefault ?? true,
    marker: over.marker ?? "<!-- TEST_MARKER -->",
    handler: over.handler ?? { kind: "context-injection", buildTextId: "x" },
    ...over,
  } as HookSpec;
}

describe("mapHooksToCodex — empty / disabled", () => {
  test("emits no diagnostics or entries when given zero hooks", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({ hooks: [], collector });
    expect(collector.getAll()).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.droppedHookIds).toEqual([]);
  });

  test("disabledHooks list is honoured — no entries, no per-hook diagnostics", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "skipme", event: HookEvent.SessionStart })],
      collector,
      disabledHooks: ["skipme"],
    });
    const perHookDiags = collector
      .getAll()
      .filter((d) => (d.details as { hookId?: string } | undefined)?.hookId === "skipme");
    expect(perHookDiags).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.droppedHookIds).toEqual([]);
  });
});

describe("mapHooksToCodex — full cells (native, info breadcrumb)", () => {
  test("SessionStart → SessionStart native, emits info trust breadcrumb", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "h1", event: HookEvent.SessionStart })],
      collector,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.codexEvent).toBe("SessionStart");
    expect(result.entries[0]?.shim).toBe("none");

    const expectedCodes = CODEX_MATRIX["hooks.sessionStart"].diagnostics;
    for (const code of expectedCodes) {
      const match = collector
        .getAll()
        .find((d) => d.code === code && (d.details as { hookId?: string }).hookId === "h1");
      expect(match).toBeDefined();
      expect(match!.severity).toBe("info");
    }
  });

  test("AgentSpawn → SubagentStart native", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "agentspawn", event: HookEvent.AgentSpawn })],
      collector,
    });
    expect(result.entries[0]?.codexEvent).toBe("SubagentStart");
    expect(result.droppedHookIds).toEqual([]);
  });
});

describe("mapHooksToCodex — experimental cells (warn breadcrumb)", () => {
  test("BeforeToolCall → PreToolUse native, warn breadcrumb", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "pretool", event: HookEvent.BeforeToolCall })],
      collector,
    });
    expect(result.entries[0]?.codexEvent).toBe("PreToolUse");
    const exp = CODEX_MATRIX["hooks.beforeToolCall"].diagnostics;
    for (const code of exp) {
      const match = collector.getAll().find(
        (d) => d.code === code && (d.details as { hookId?: string }).hookId === "pretool",
      );
      expect(match).toBeDefined();
    }
    // At least one warn-level breadcrumb.
    const warns = collector
      .getAll()
      .filter((d) => d.severity === "warn" && (d.details as { hookId?: string }).hookId === "pretool");
    expect(warns.length).toBeGreaterThan(0);
  });
});

describe("mapHooksToCodex — shim flavours", () => {
  test("AfterToolFailure → PostToolUse with failure-only shim", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "failhook", event: HookEvent.AfterToolFailure })],
      collector,
    });
    expect(result.entries[0]?.codexEvent).toBe("PostToolUse");
    expect(result.entries[0]?.shim).toBe("failure-only");
  });

  test("UserPromptFirst → UserPromptSubmit with first-only shim", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "first", event: HookEvent.UserPromptFirst })],
      collector,
    });
    expect(result.entries[0]?.codexEvent).toBe("UserPromptSubmit");
    expect(result.entries[0]?.shim).toBe("first-only");
  });
});

describe("mapHooksToCodex — drop-warn cells (no entry, warn breadcrumb)", () => {
  test("MessageTransform is dropped with warn breadcrumb", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [hookSpec({ id: "msgtrans", event: HookEvent.MessageTransform })],
      collector,
    });
    expect(result.entries).toEqual([]);
    expect(result.droppedHookIds).toEqual(["msgtrans"]);

    const expectedCodes = CODEX_MATRIX["hooks.messageTransform"].diagnostics;
    for (const code of expectedCodes) {
      const match = collector
        .getAll()
        .find((d) => d.code === code && (d.details as { hookId?: string }).hookId === "msgtrans");
      expect(match).toBeDefined();
      expect(match!.severity).toBe("warn");
    }
  });

  test("Notification + ShellEnvironment are also dropped", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [
        hookSpec({ id: "n", event: HookEvent.Notification }),
        hookSpec({ id: "s", event: HookEvent.ShellEnvironment }),
      ],
      collector,
    });
    expect(result.entries).toEqual([]);
    expect(result.droppedHookIds.sort()).toEqual(["n", "s"]);
  });
});

describe("mapHooksToCodex — matcher derivation from match.toolNames", () => {
  test("PreToolUse with toolNames=[Bash] → matcher='Bash'", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [
        hookSpec({
          id: "withmatcher",
          event: HookEvent.BeforeToolCall,
          match: { toolNames: ["Bash"] },
        }),
      ],
      collector,
    });
    expect(result.entries[0]?.matcher).toBe("Bash");
  });

  test("PreToolUse with multiple toolNames → alternation regex", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [
        hookSpec({
          id: "multi",
          event: HookEvent.BeforeToolCall,
          match: { toolNames: ["Bash", "apply_patch"] },
        }),
      ],
      collector,
    });
    expect(result.entries[0]?.matcher).toBe("(Bash|apply_patch)");
  });

  test("UserPromptSubmit matcher is always undefined (Codex ignores it)", () => {
    const collector = new DiagnosticCollector();
    const result = mapHooksToCodex({
      hooks: [
        hookSpec({
          id: "up",
          event: HookEvent.UserPromptEvery,
          match: { toolNames: ["ignored"] },
        }),
      ],
      collector,
    });
    expect(result.entries[0]?.matcher).toBeUndefined();
  });
});

describe("eventToFeature — totality", () => {
  test("maps every HookEvent to a CapabilityFeature present in CODEX_MATRIX", () => {
    for (const event of Object.values(HookEvent)) {
      const feature = eventToFeature(event);
      expect(feature.startsWith("hooks.")).toBe(true);
      expect(CODEX_MATRIX[feature]).toBeDefined();
    }
  });
});
