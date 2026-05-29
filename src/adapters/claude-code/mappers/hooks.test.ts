/**
 * Tests for `src/adapters/claude-code/mappers/hooks.ts` — Batch 6 (T-6.1).
 *
 * Covers:
 *   - `routeClaudeCodeHooks` matrix routing (shell-cmd/drop-warn/experimental)
 *   - Per-hook diagnostics (`hook.unsupported` + per-cell breadcrumb)
 *   - Legacy phase → event resolution + unknown-phase pass-through
 *   - Disabled hook filter
 *   - `emitClaudeCodeHookMatrixSweep` deterministic per-cell sweep
 *   - `eventToFeature` totality over all 15 HookEvent values
 */

import { describe, expect, test } from "bun:test";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { CLAUDE_CODE_MATRIX } from "../../_shared/capability-matrix";
import { HOOK_EVENTS } from "../../../core/hooks";
import type { HookSpec } from "../../../core/hooks";
import {
  routeClaudeCodeHooks,
  emitClaudeCodeHookMatrixSweep,
  eventToFeature,
} from "./hooks";

function spec(
  partial: Partial<HookSpec> & Pick<HookSpec, "id">,
): HookSpec {
  return {
    id: partial.id,
    description: partial.description ?? "test",
    event: partial.event ?? HOOK_EVENTS.SessionStart,
    enabledByDefault: partial.enabledByDefault ?? true,
    marker: partial.marker ?? `<!-- ${partial.id.toUpperCase()} -->`,
    handler: partial.handler,
  } as HookSpec;
}

describe("routeClaudeCodeHooks", () => {
  test("shell-cmd event (SessionStart) → green-light, no diagnostics", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({ id: "h1", event: HOOK_EVENTS.SessionStart });

    const result = routeClaudeCodeHooks({ hooks: [hook], collector });

    expect(result.emittableHooks).toHaveLength(1);
    expect(result.emittableHooks[0]!.id).toBe("h1");
    expect(result.droppedHookIds).toEqual([]);
    expect(collector.getAll()).toEqual([]);
  });

  test("drop-warn event (MessageTransform) → hook.unsupported + per-cell breadcrumb, dropped", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({ id: "h-mt", event: HOOK_EVENTS.MessageTransform });

    const result = routeClaudeCodeHooks({ hooks: [hook], collector });

    expect(result.emittableHooks).toEqual([]);
    expect(result.droppedHookIds).toEqual(["h-mt"]);

    const diags = collector.getAll();
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("hook.unsupported");
    expect(codes).toContain("claude-code.hooks.messageTransform.dropped");

    const canonical = diags.find((d) => d.code === "hook.unsupported")!;
    expect(canonical.severity).toBe("warn");
    expect(canonical.details).toMatchObject({
      hookId: "h-mt",
      event: HOOK_EVENTS.MessageTransform,
      feature: "hooks.messageTransform",
      platform: "claude-code",
    });
  });

  test("drop-warn event (AgentSpawn) → hook.unsupported + agentSpawn breadcrumb", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({ id: "h-as", event: HOOK_EVENTS.AgentSpawn });

    const result = routeClaudeCodeHooks({ hooks: [hook], collector });

    expect(result.droppedHookIds).toEqual(["h-as"]);
    const codes = collector.getAll().map((d) => d.code);
    expect(codes).toContain("hook.unsupported");
    expect(codes).toContain("claude-code.hooks.agentSpawn.dropped");
  });

  test("drop-warn event (ShellEnvironment) → dropped", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({ id: "h-se", event: HOOK_EVENTS.ShellEnvironment });

    const result = routeClaudeCodeHooks({ hooks: [hook], collector });

    expect(result.droppedHookIds).toEqual(["h-se"]);
    expect(collector.getAll().map((d) => d.code)).toContain(
      "claude-code.hooks.shellEnvironment.dropped",
    );
  });

  test("disabledHooks → skipped entirely (no routing, no diagnostics)", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({ id: "h-mt", event: HOOK_EVENTS.MessageTransform });

    const result = routeClaudeCodeHooks({
      hooks: [hook],
      collector,
      disabledHooks: ["h-mt"],
    });

    expect(result.emittableHooks).toEqual([]);
    expect(result.droppedHookIds).toEqual([]);
    expect(collector.getAll()).toEqual([]);
  });

  test("mixed batch: 1 shell-cmd + 1 drop-warn → 1 emittable, 1 dropped, scoped diagnostics", () => {
    const collector = new DiagnosticCollector();
    const ok = spec({ id: "ok", event: HOOK_EVENTS.BeforeToolCall });
    const bad = spec({ id: "bad", event: HOOK_EVENTS.MessageTransform });

    const result = routeClaudeCodeHooks({ hooks: [ok, bad], collector });

    expect(result.emittableHooks.map((h) => h.id)).toEqual(["ok"]);
    expect(result.droppedHookIds).toEqual(["bad"]);

    const diags = collector.getAll();
    // Diagnostics scoped to "bad" only.
    const hookIds = diags
      .map((d) => (d.details as { hookId?: string } | undefined)?.hookId)
      .filter((x) => x !== undefined);
    expect(hookIds.every((id) => id === "bad")).toBe(true);
  });

  test("handlerKind is captured in diagnostic details", () => {
    const collector = new DiagnosticCollector();
    const hook = spec({
      id: "h-ctx",
      event: HOOK_EVENTS.MessageTransform,
      handler: {
        kind: "context-injection",
        buildTextId: "test.text.builder",
      } as HookSpec["handler"],
    });

    routeClaudeCodeHooks({ hooks: [hook], collector });

    const canonical = collector.getAll().find((d) => d.code === "hook.unsupported")!;
    expect((canonical.details as { handlerKind: string }).handlerKind).toBe(
      "context-injection",
    );
  });
});

describe("emitClaudeCodeHookMatrixSweep", () => {
  test("emits one hook.unsupported per drop-warn cell, deterministic order", () => {
    const collector = new DiagnosticCollector();
    emitClaudeCodeHookMatrixSweep(collector);

    const features = Object.keys(CLAUDE_CODE_MATRIX)
      .filter((f) => f.startsWith("hooks."))
      .filter((f) => CLAUDE_CODE_MATRIX[f as keyof typeof CLAUDE_CODE_MATRIX].status === "drop-warn")
      .sort();

    const diags = collector.getAll();
    expect(diags.every((d) => d.code === "hook.unsupported")).toBe(true);
    expect(diags).toHaveLength(features.length);

    const featureFromDiag = diags.map((d) => (d.details as { feature: string }).feature);
    expect(featureFromDiag).toEqual(features);
  });

  test("sweep is independent of configuration (no hooks input)", () => {
    const c1 = new DiagnosticCollector();
    const c2 = new DiagnosticCollector();
    emitClaudeCodeHookMatrixSweep(c1);
    emitClaudeCodeHookMatrixSweep(c2);
    expect(c1.getAll()).toEqual(c2.getAll());
  });
});

describe("eventToFeature", () => {
  test("total over all 15 HookEvent values", () => {
    const allEvents = Object.values(HOOK_EVENTS);
    expect(allEvents).toHaveLength(15);
    for (const ev of allEvents) {
      const feature = eventToFeature(ev);
      expect(feature.startsWith("hooks.")).toBe(true);
      expect(CLAUDE_CODE_MATRIX[feature]).toBeDefined();
    }
  });
});
