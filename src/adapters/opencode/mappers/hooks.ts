/**
 * OpenCode hooks mapper — Batch 6 (T-6.3), matrix-driven.
 *
 * Per `OPENCODE_MATRIX` (capability-matrix.ts §OpenCode):
 *
 *   - `full` cells (BeforeToolCall, AfterToolCall, AfterToolFailure,
 *     PermissionRequest, ShellEnvironment) → green-light: caller wires
 *     hook handlers onto the matching native `Hooks` field (e.g.
 *     `tool.execute.before`). No matrix diagnostic.
 *
 *   - `experimental` cells (SessionStart, UserPromptFirst,
 *     UserPromptEvery, MessageTransform, BeforeCompact) → emit
 *     `hook.experimental` info, green-light onto the experimental
 *     surface (`experimental.chat.messages.transform`, etc.).
 *
 *   - `drop-warn` cells (SessionEnd, AgentSpawn, AgentStop, AfterCompact,
 *     Notification) → emit canonical `hook.unsupported` warn PLUS each of
 *     the cell's `diagnostics[]` breadcrumb codes; SKIP wiring.
 *
 * Per-event matrix sweep (`emitOpenCodeHookMatrixSweep`) emits ONE
 * `hook.unsupported` warn per drop-warn cell on the matrix,
 * configuration-independent. Mirrors codex / claude-code mappers.
 *
 * This module is purely diagnostic + routing decisions. It does NOT
 * register handlers on a `Hooks` record — that's the bridge's
 * responsibility (`runtime/hook-bridge.ts`). It also does NOT import
 * the OpenCode plugin package (keeps cross-layer rules clean: any future
 * direct consumer of the mapper from `core/` or tests need not pull
 * the platform type in).
 *
 * No filesystem side effects, no shared state.
 */

import {
  OPENCODE_MATRIX,
  type CapabilityFeature,
  type CapabilityStatus,
} from "../../_shared/capability-matrix";
import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { HookSpec } from "../../../core/hooks";
import {
  HOOK_EVENTS,
  type HookEvent,
} from "../../../core/hooks";

/* ---------------------------------------------------------------- */
/*  Public API                                                       */
/* ---------------------------------------------------------------- */

/**
 * The wiring target chosen for a single hook, after matrix routing.
 *
 * `native` and `experimental` differ in the resulting target field on
 * the `Hooks` record AND in the diagnostic emitted (info for the latter).
 * `dropped` means the bridge should NOT register the hook at all.
 */
export type OpenCodeHookTarget =
  | { kind: "native"; hooksKey: OpenCodeNativeHookKey }
  | { kind: "experimental"; hooksKey: OpenCodeExperimentalHookKey }
  | { kind: "dropped"; reason: "drop-warn" };

/**
 * Subset of OpenCode plugin `Hooks` keys that correspond to
 * `full`-status cells on `OPENCODE_MATRIX`. Listed here as string
 * literals (not imported) so this module stays platform-type free.
 *
 * Grounded in the OpenCode plugin type declaration (`OPENCODE_PLUGIN_DTS`
 * evidence; ADR §3). `AfterToolCall` and `AfterToolFailure` both target
 * the same `tool.execute.after` key — the plugin runtime does not split
 * success / failure into distinct hooks; the handler inspects `output`
 * to distinguish.
 */
export type OpenCodeNativeHookKey =
  | "tool.execute.before"
  | "tool.execute.after"
  | "permission.ask"
  | "shell.env";

/**
 * Subset of `Hooks` keys for `experimental`-status cells.
 *
 * - SessionStart / UserPromptFirst / UserPromptEvery / MessageTransform
 *   → `experimental.chat.messages.transform` (the only general-purpose
 *   experimental message-time surface OpenCode exposes today).
 * - BeforeCompact → `experimental.session.compacting`.
 */
export type OpenCodeExperimentalHookKey =
  | "experimental.chat.messages.transform"
  | "experimental.session.compacting";

export interface RouteOpenCodeHooksOptions {
  hooks: ReadonlyArray<HookSpec>;
  collector: DiagnosticCollector;
  /** Hook ids to skip entirely (no matrix routing, no diagnostics). */
  disabledHooks?: ReadonlyArray<string>;
}

export interface RoutedOpenCodeHook {
  hook: HookSpec;
  event: HookEvent;
  feature: CapabilityFeature;
  target: OpenCodeHookTarget;
}

export interface RouteOpenCodeHooksResult {
  /** Routing decisions for every hook that resolved to a HookEvent. */
  routed: RoutedOpenCodeHook[];
  /** Hooks that survived matrix routing (`native` or `experimental`). */
  emittable: RoutedOpenCodeHook[];
  /** Hook ids the matrix dropped (`drop-warn` cells / unknown event). */
  droppedHookIds: string[];
}

/**
 * Route each `HookSpec` through `OPENCODE_MATRIX`. Emits per-hook
 * diagnostics on `opts.collector`:
 *
 *   - drop-warn cell → `hook.unsupported` (warn) + cell breadcrumb codes
 *   - experimental cell → `hook.experimental` (info)
 *   - full cell → no diagnostic
 *
 * Returns full routing info so callers can wire `emittable[].hook`
 * onto the appropriate `Hooks` field via `emittable[].target.hooksKey`.
 */
export function routeOpenCodeHooks(
  opts: RouteOpenCodeHooksOptions,
): RouteOpenCodeHooksResult {
  const disabled = new Set(opts.disabledHooks ?? []);
  const routed: RoutedOpenCodeHook[] = [];
  const emittable: RoutedOpenCodeHook[] = [];
  const droppedHookIds: string[] = [];

  for (const hook of opts.hooks) {
    if (disabled.has(hook.id)) continue;

    const event = hook.event;
    const feature = eventToFeature(event);
    const cell = OPENCODE_MATRIX[feature];
    const handlerKind = hook.handler?.kind ?? "context-injection";

    const decision = decide(cell.status, event);

    switch (decision.kind) {
      case "drop-warn": {
        opts.collector.warn(
          "hook.unsupported",
          `OpenCode does not support hook capability "${feature}"; hook "${hook.id}" dropped.`,
          {
            hookId: hook.id,
            event,
            feature,
            handlerKind,
            platform: "opencode",
            evidence: cell.evidence,
          },
        );
        for (const code of cell.diagnostics) {
          opts.collector.warn(
            code,
            `OpenCode matrix: feature "${feature}" is drop-warn for hook "${hook.id}".`,
            { hookId: hook.id, event, feature, handlerKind },
          );
        }
        const target: OpenCodeHookTarget = { kind: "dropped", reason: "drop-warn" };
        routed.push({ hook, event, feature, target });
        droppedHookIds.push(hook.id);
        break;
      }
      case "experimental": {
        opts.collector.info(
          "hook.experimental",
          `OpenCode support for "${feature}" is experimental; hook "${hook.id}" relies on a non-stable surface.`,
          {
            hookId: hook.id,
            event,
            feature,
            handlerKind,
            platform: "opencode",
            evidence: cell.evidence,
          },
        );
        const target: OpenCodeHookTarget = { kind: "experimental", hooksKey: decision.hooksKey };
        const entry: RoutedOpenCodeHook = { hook, event, feature, target };
        routed.push(entry);
        emittable.push(entry);
        break;
      }
      case "native": {
        const target: OpenCodeHookTarget = { kind: "native", hooksKey: decision.hooksKey };
        const entry: RoutedOpenCodeHook = { hook, event, feature, target };
        routed.push(entry);
        emittable.push(entry);
        break;
      }
      case "stale": {
        opts.collector.warn(
          "opencode.hook.mapper.stale",
          `OPENCODE_MATRIX cell for "${feature}" has no mapper wiring for status "${cell.status}"; dropping "${hook.id}".`,
          { hookId: hook.id, event, feature, status: cell.status },
        );
        const target: OpenCodeHookTarget = { kind: "dropped", reason: "drop-warn" };
        routed.push({ hook, event, feature, target });
        droppedHookIds.push(hook.id);
      }
    }
  }

  return { routed, emittable, droppedHookIds };
}

/**
 * Emit one `hook.unsupported` warn per `hooks.*` cell on OPENCODE_MATRIX
 * whose status is `drop-warn`. Deterministic (sorted feature iteration);
 * independent of configured hooks.
 */
export function emitOpenCodeHookMatrixSweep(collector: DiagnosticCollector): void {
  const features = (Object.keys(OPENCODE_MATRIX) as CapabilityFeature[])
    .filter((f) => f.startsWith("hooks."))
    .sort();
  for (const feature of features) {
    const cell = OPENCODE_MATRIX[feature];
    if (cell.status !== "drop-warn") continue;
    collector.warn(
      "hook.unsupported",
      `OpenCode does not support hook capability "${feature}"; this hook will be dropped.`,
      { feature, platform: "opencode", evidence: cell.evidence },
    );
  }
}

/* ---------------------------------------------------------------- */
/*  Routing decision (status × event → wiring target)               */
/* ---------------------------------------------------------------- */

type RoutingDecision =
  | { kind: "native"; hooksKey: OpenCodeNativeHookKey }
  | { kind: "experimental"; hooksKey: OpenCodeExperimentalHookKey }
  | { kind: "drop-warn" }
  | { kind: "stale" };

function decide(status: CapabilityStatus, event: HookEvent): RoutingDecision {
  switch (status) {
    case "drop-warn":
      return { kind: "drop-warn" };
    case "experimental": {
      // BeforeCompact routes to `experimental.session.compacting`;
      // SessionStart / UserPromptFirst / UserPromptEvery /
      // MessageTransform all route to
      // `experimental.chat.messages.transform`. Per OPENCODE_MATRIX
      // evidence (OPENCODE_EXPERIMENTAL) + plugin .d.ts.
      const hooksKey: OpenCodeExperimentalHookKey =
        event === HOOK_EVENTS.BeforeCompact
          ? "experimental.session.compacting"
          : "experimental.chat.messages.transform";
      return { kind: "experimental", hooksKey };
    }
    case "full": {
      const hooksKey = nativeKeyForEvent(event);
      if (hooksKey === null) return { kind: "stale" };
      return { kind: "native", hooksKey };
    }
    // `shim` and `shell-cmd` are not used by OPENCODE_MATRIX today.
    case "shim":
    case "shell-cmd":
    default:
      return { kind: "stale" };
  }
}

/**
 * Map `full`-status `HookEvent`s to the `Hooks` record key. Returns
 * `null` for any event whose feature is not `full` on OPENCODE_MATRIX.
 *
 * Mapping is grounded in the OpenCode plugin `Hooks` type (see
 * `OPENCODE_PLUGIN_DTS` evidence; ADR §3):
 *
 *   - BeforeToolCall    → "tool.execute.before"
 *   - AfterToolCall     → "tool.execute.after"
 *   - AfterToolFailure  → "tool.execute.after"  (carries failure info)
 *   - PermissionRequest → "permission.ask"
 *   - ShellEnvironment  → "shell.env"
 */
function nativeKeyForEvent(event: HookEvent): OpenCodeNativeHookKey | null {
  switch (event) {
    case HOOK_EVENTS.BeforeToolCall:    return "tool.execute.before";
    case HOOK_EVENTS.AfterToolCall:     return "tool.execute.after";
    case HOOK_EVENTS.AfterToolFailure:  return "tool.execute.after";
    case HOOK_EVENTS.PermissionRequest: return "permission.ask";
    case HOOK_EVENTS.ShellEnvironment:  return "shell.env";
    default: return null;
  }
}

/* ---------------------------------------------------------------- */
/*  HookEvent → CapabilityFeature                                    */
/* ---------------------------------------------------------------- */

/** Total over all 15 `HookEvent` values. Mirrors codex/claude-code mappers. */
export function eventToFeature(event: HookEvent): CapabilityFeature {
  switch (event) {
    case HOOK_EVENTS.SessionStart:      return "hooks.sessionStart";
    case HOOK_EVENTS.SessionEnd:        return "hooks.sessionEnd";
    case HOOK_EVENTS.UserPromptFirst:   return "hooks.userPromptFirst";
    case HOOK_EVENTS.UserPromptEvery:   return "hooks.userPromptEvery";
    case HOOK_EVENTS.MessageTransform:  return "hooks.messageTransform";
    case HOOK_EVENTS.BeforeToolCall:    return "hooks.beforeToolCall";
    case HOOK_EVENTS.AfterToolCall:     return "hooks.afterToolCall";
    case HOOK_EVENTS.AfterToolFailure:  return "hooks.afterToolFailure";
    case HOOK_EVENTS.PermissionRequest: return "hooks.permissionRequest";
    case HOOK_EVENTS.AgentSpawn:        return "hooks.agentSpawn";
    case HOOK_EVENTS.AgentStop:         return "hooks.agentStop";
    case HOOK_EVENTS.BeforeCompact:     return "hooks.beforeCompact";
    case HOOK_EVENTS.AfterCompact:      return "hooks.afterCompact";
    case HOOK_EVENTS.Notification:      return "hooks.notification";
    case HOOK_EVENTS.ShellEnvironment:  return "hooks.shellEnvironment";
  }
}
