/**
 * OpenCode hooks mapper — Batch 6 unit tests (T-6.3).
 *
 * Pins:
 *   (1) `emitOpenCodeHookMatrixSweep` emits one `hook.unsupported` warn
 *       per drop-warn cell on OPENCODE_MATRIX (deterministic, sorted).
 *   (2) `routeOpenCodeHooks` routes each HookSpec via the matrix:
 *         - drop-warn → drop + `hook.unsupported` + breadcrumb codes
 *         - experimental → wired onto correct experimental key +
 *           `hook.experimental` info
 *         - full → wired onto correct native key, no diagnostic
 *   (3) Legacy phase fallback resolves when `event` is absent.
 *   (4) `disabledHooks` skips routing entirely.
 *   (5) `eventToFeature` is total over `HOOK_EVENTS`.
 */
import { describe, expect, test } from "bun:test";

import {
  HOOK_EVENTS,
  type HookEvent,
  type HookSpec,
} from "../../../core/hooks";
import {
  OPENCODE_MATRIX,
  type CapabilityFeature,
} from "../../_shared/capability-matrix";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";

import {
  emitOpenCodeHookMatrixSweep,
  eventToFeature,
  routeOpenCodeHooks,
} from "./hooks";

/* ---------------------------------------------------------------- */
/*  Fixtures                                                         */
/* ---------------------------------------------------------------- */

function hookSpec(over: Partial<HookSpec> = {}): HookSpec {
  return {
    id: over.id ?? "test-hook",
    description: over.description ?? "test",
    event: over.event ?? HOOK_EVENTS.SessionStart,
    enabledByDefault: over.enabledByDefault ?? true,
    marker: over.marker ?? "<!-- OC_TEST_MARKER -->",
    handler: over.handler ?? { kind: "context-injection", buildTextId: "x" },
    ...over,
  } as HookSpec;
}

const DROP_WARN_FEATURES = (Object.keys(OPENCODE_MATRIX) as CapabilityFeature[])
  .filter((f) => f.startsWith("hooks."))
  .filter((f) => OPENCODE_MATRIX[f].status === "drop-warn")
  .sort();

const FULL_FEATURES = (Object.keys(OPENCODE_MATRIX) as CapabilityFeature[])
  .filter((f) => f.startsWith("hooks."))
  .filter((f) => OPENCODE_MATRIX[f].status === "full");

const EXPERIMENTAL_FEATURES = (Object.keys(OPENCODE_MATRIX) as CapabilityFeature[])
  .filter((f) => f.startsWith("hooks."))
  .filter((f) => OPENCODE_MATRIX[f].status === "experimental");

/* ---------------------------------------------------------------- */
/*  emitOpenCodeHookMatrixSweep                                      */
/* ---------------------------------------------------------------- */

describe("emitOpenCodeHookMatrixSweep", () => {
  test("emits one hook.unsupported warn per drop-warn cell", () => {
    const collector = new DiagnosticCollector();
    emitOpenCodeHookMatrixSweep(collector);

    const sweep = collector.getAll().filter((d) => d.code === "hook.unsupported");
    expect(sweep.length).toBe(DROP_WARN_FEATURES.length);
    expect(sweep.length).toBeGreaterThan(0);

    for (const d of sweep) {
      expect(d.severity).toBe("warn");
      expect((d.details as { platform?: string }).platform).toBe("opencode");
    }

    const seenFeatures = sweep
      .map((d) => (d.details as { feature?: string }).feature)
      .sort();
    expect(seenFeatures).toEqual([...DROP_WARN_FEATURES]);
  });

  test("emits nothing for full / experimental cells", () => {
    const collector = new DiagnosticCollector();
    emitOpenCodeHookMatrixSweep(collector);
    const offenders = collector.getAll().filter((d) => {
      const f = (d.details as { feature?: string }).feature;
      return f && (FULL_FEATURES.includes(f as CapabilityFeature)
        || EXPERIMENTAL_FEATURES.includes(f as CapabilityFeature));
    });
    expect(offenders).toEqual([]);
  });

  test("is deterministic across invocations (sorted feature order)", () => {
    const a = new DiagnosticCollector();
    const b = new DiagnosticCollector();
    emitOpenCodeHookMatrixSweep(a);
    emitOpenCodeHookMatrixSweep(b);
    expect(a.sorted().map((d) => d.code + ":" + (d.details as { feature?: string }).feature))
      .toEqual(b.sorted().map((d) => d.code + ":" + (d.details as { feature?: string }).feature));
  });
});

/* ---------------------------------------------------------------- */
/*  routeOpenCodeHooks — drop-warn                                   */
/* ---------------------------------------------------------------- */

describe("routeOpenCodeHooks — drop-warn cells", () => {
  test("drops the hook AND emits hook.unsupported + breadcrumbs", () => {
    const collector = new DiagnosticCollector();
    const hook = hookSpec({ id: "agent-spawn-hook", event: HOOK_EVENTS.AgentSpawn });
    const result = routeOpenCodeHooks({ hooks: [hook], collector });

    expect(result.droppedHookIds).toEqual(["agent-spawn-hook"]);
    expect(result.emittable).toEqual([]);

    const unsupported = collector
      .getAll()
      .filter((d) => d.code === "hook.unsupported")
      .find((d) => (d.details as { hookId?: string }).hookId === "agent-spawn-hook");
    expect(unsupported).toBeDefined();
    expect(unsupported!.severity).toBe("warn");

    const cell = OPENCODE_MATRIX["hooks.agentSpawn"];
    expect(cell.diagnostics.length).toBeGreaterThan(0);
    for (const code of cell.diagnostics) {
      const match = collector
        .getAll()
        .find(
          (d) =>
            d.code === code
            && (d.details as { hookId?: string }).hookId === "agent-spawn-hook",
        );
      expect(match).toBeDefined();
      expect(match!.severity).toBe("warn");
    }
  });

  test("every drop-warn event drops + emits hook.unsupported", () => {
    for (const feature of DROP_WARN_FEATURES) {
      const event = featureToEvent(feature);
      const collector = new DiagnosticCollector();
      const hook = hookSpec({ id: `h-${feature}`, event });
      const result = routeOpenCodeHooks({ hooks: [hook], collector });

      expect(result.droppedHookIds).toEqual([`h-${feature}`]);
      expect(result.emittable).toEqual([]);
      const unsupported = collector
        .getAll()
        .filter((d) => d.code === "hook.unsupported")
        .find((d) => (d.details as { hookId?: string }).hookId === `h-${feature}`);
      expect(unsupported).toBeDefined();
    }
  });
});

/* ---------------------------------------------------------------- */
/*  routeOpenCodeHooks — experimental                                */
/* ---------------------------------------------------------------- */

describe("routeOpenCodeHooks — experimental cells", () => {
  test("SessionStart routes to experimental.chat.messages.transform + info", () => {
    const collector = new DiagnosticCollector();
    const hook = hookSpec({ id: "ss", event: HOOK_EVENTS.SessionStart });
    const result = routeOpenCodeHooks({ hooks: [hook], collector });

    expect(result.emittable).toHaveLength(1);
    const target = result.emittable[0]!.target;
    expect(target.kind).toBe("experimental");
    if (target.kind === "experimental") {
      expect(target.hooksKey).toBe("experimental.chat.messages.transform");
    }

    const info = collector
      .getAll()
      .filter((d) => d.code === "hook.experimental")
      .find((d) => (d.details as { hookId?: string }).hookId === "ss");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
  });

  test("BeforeCompact routes to experimental.session.compacting", () => {
    const collector = new DiagnosticCollector();
    const hook = hookSpec({ id: "bc", event: HOOK_EVENTS.BeforeCompact });
    const result = routeOpenCodeHooks({ hooks: [hook], collector });

    expect(result.emittable).toHaveLength(1);
    const target = result.emittable[0]!.target;
    expect(target.kind).toBe("experimental");
    if (target.kind === "experimental") {
      expect(target.hooksKey).toBe("experimental.session.compacting");
    }
  });

  test("UserPromptFirst, UserPromptEvery, MessageTransform all route to chat.messages.transform", () => {
    const events: HookEvent[] = [
      HOOK_EVENTS.UserPromptFirst,
      HOOK_EVENTS.UserPromptEvery,
      HOOK_EVENTS.MessageTransform,
    ];
    for (const event of events) {
      const collector = new DiagnosticCollector();
      const hook = hookSpec({ id: `h-${event}`, event });
      const result = routeOpenCodeHooks({ hooks: [hook], collector });
      expect(result.emittable).toHaveLength(1);
      const target = result.emittable[0]!.target;
      expect(target.kind).toBe("experimental");
      if (target.kind === "experimental") {
        expect(target.hooksKey).toBe("experimental.chat.messages.transform");
      }
    }
  });
});

/* ---------------------------------------------------------------- */
/*  routeOpenCodeHooks — native (full)                                */
/* ---------------------------------------------------------------- */

describe("routeOpenCodeHooks — full cells (native)", () => {
  const cases: Array<{ event: HookEvent; hooksKey: string }> = [
    { event: HOOK_EVENTS.BeforeToolCall, hooksKey: "tool.execute.before" },
    { event: HOOK_EVENTS.AfterToolCall, hooksKey: "tool.execute.after" },
    { event: HOOK_EVENTS.AfterToolFailure, hooksKey: "tool.execute.after" },
    { event: HOOK_EVENTS.PermissionRequest, hooksKey: "permission.ask" },
    { event: HOOK_EVENTS.ShellEnvironment, hooksKey: "shell.env" },
  ];

  for (const c of cases) {
    test(`${c.event} → ${c.hooksKey}, no matrix diagnostic`, () => {
      const collector = new DiagnosticCollector();
      const hook = hookSpec({ id: `h-${c.event}`, event: c.event });
      const result = routeOpenCodeHooks({ hooks: [hook], collector });

      expect(result.emittable).toHaveLength(1);
      const target = result.emittable[0]!.target;
      expect(target.kind).toBe("native");
      if (target.kind === "native") {
        expect(target.hooksKey).toBe(c.hooksKey as never);
      }
      expect(result.droppedHookIds).toEqual([]);

      const hookOwnedDiags = collector
        .getAll()
        .filter((d) => (d.details as { hookId?: string }).hookId === `h-${c.event}`);
      expect(hookOwnedDiags).toEqual([]);
    });
  }
});

/* ---------------------------------------------------------------- */
/*  Legacy phase fallback + disabled list                            */
/* ---------------------------------------------------------------- */

describe("routeOpenCodeHooks — disabled", () => {
  test("disabledHooks skips routing entirely — no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const hook = hookSpec({ id: "skipme", event: HOOK_EVENTS.AgentSpawn });
    const result = routeOpenCodeHooks({
      hooks: [hook],
      collector,
      disabledHooks: ["skipme"],
    });

    expect(result.routed).toEqual([]);
    expect(result.emittable).toEqual([]);
    expect(result.droppedHookIds).toEqual([]);
    expect(collector.getAll()).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/*  eventToFeature totality                                          */
/* ---------------------------------------------------------------- */

describe("eventToFeature", () => {
  test("is total over HOOK_EVENTS and lands inside OPENCODE_MATRIX", () => {
    const events = Object.values(HOOK_EVENTS) as HookEvent[];
    expect(events.length).toBe(15);
    for (const event of events) {
      const feature = eventToFeature(event);
      expect(feature.startsWith("hooks.")).toBe(true);
      expect(OPENCODE_MATRIX[feature]).toBeDefined();
    }
  });
});

/* ---------------------------------------------------------------- */
/*  Helpers                                                          */
/* ---------------------------------------------------------------- */

function featureToEvent(feature: CapabilityFeature): HookEvent {
  // Inverse of eventToFeature for the `hooks.*` namespace. Only the
  // events that map 1:1 are needed in tests (drop-warn cells).
  const map: Record<string, HookEvent> = {
    "hooks.sessionStart": HOOK_EVENTS.SessionStart,
    "hooks.sessionEnd": HOOK_EVENTS.SessionEnd,
    "hooks.userPromptFirst": HOOK_EVENTS.UserPromptFirst,
    "hooks.userPromptEvery": HOOK_EVENTS.UserPromptEvery,
    "hooks.messageTransform": HOOK_EVENTS.MessageTransform,
    "hooks.beforeToolCall": HOOK_EVENTS.BeforeToolCall,
    "hooks.afterToolCall": HOOK_EVENTS.AfterToolCall,
    "hooks.afterToolFailure": HOOK_EVENTS.AfterToolFailure,
    "hooks.permissionRequest": HOOK_EVENTS.PermissionRequest,
    "hooks.agentSpawn": HOOK_EVENTS.AgentSpawn,
    "hooks.agentStop": HOOK_EVENTS.AgentStop,
    "hooks.beforeCompact": HOOK_EVENTS.BeforeCompact,
    "hooks.afterCompact": HOOK_EVENTS.AfterCompact,
    "hooks.notification": HOOK_EVENTS.Notification,
    "hooks.shellEnvironment": HOOK_EVENTS.ShellEnvironment,
  };
  const e = map[feature];
  if (!e) throw new Error(`no event for feature ${feature}`);
  return e;
}
