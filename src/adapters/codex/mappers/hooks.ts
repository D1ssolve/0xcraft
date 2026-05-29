/**
 * Codex hooks mapper — neutral `HookEvent` → Codex native event.
 *
 * Native Codex events (per https://developers.openai.com/codex/hooks):
 *   SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 *   PermissionRequest, PreCompact, PostCompact, SubagentStart,
 *   SubagentStop, Stop.
 *
 * Capability-matrix-driven semantics (see `_shared/capability-matrix.ts`
 * §Codex, all 15 `hooks.*` cells):
 *
 *   full         → emit native hook entry + script
 *   experimental → emit native hook entry + script + per-hook warn
 *                  (matrix `diagnostics[]` codes)
 *   shim         → emit native hook entry + script with shim logic
 *                  (e.g. AfterToolFailure checks tool exit code in body)
 *   drop-warn    → no entry emitted, per-hook matrix diagnostics fired
 *
 * Per-hook diagnostics still fire for `experimental`/`shim`/`drop-warn`
 * cells so `doctor --harness codex` rolls them up. `full` emits the
 * `codex.hooks.trust.required` info breadcrumb noted in matrix.
 *
 * No filesystem side effects — emitter (`emitters/hooks.ts`) owns disk.
 */

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import {
  CODEX_MATRIX,
  type CapabilityFeature,
  type CapabilityStatus,
} from "../../_shared/capability-matrix";
import type { HookSpec } from "../../../core/hooks";
import { HookEvent } from "../../../core/hooks";

/* ---------------------------------------------------------------- */
/*  Native event union (10 supported events)                          */
/* ---------------------------------------------------------------- */

export type CodexNativeEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "PreCompact"
  | "PostCompact"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

/* ---------------------------------------------------------------- */
/*  Mapper output                                                     */
/* ---------------------------------------------------------------- */

/**
 * Shim flavors recognised by the script emitter (`emitters/hooks.ts`).
 * - `none`         — script runs handler directly.
 * - `failure-only` — script runs only when `tool_response.exit_code != 0`
 *                    (AfterToolFailure shim over PostToolUse).
 * - `first-only`   — script runs only on first user prompt per project
 *                    (UserPromptFirst marker shim over UserPromptSubmit).
 */
export type CodexHookShim = "none" | "failure-only" | "first-only";

export interface CodexHookEntry {
  /** Source neutral hook id (`HookSpec.id`). */
  hookId: string;
  /** Native Codex event the script is wired to. */
  codexEvent: CodexNativeEvent;
  /** Optional regex matcher (tool name / source / trigger / agent type). */
  matcher?: string;
  /** Cosmetic status message shown by Codex when the hook fires. */
  statusMessage?: string;
  /** Hook-handler timeout (seconds). Codex default = 600 when omitted. */
  timeout?: number;
  /** Shim flavour applied by the script body. */
  shim: CodexHookShim;
  /** Source `HookSpec` — kept for the emitter to render the script body. */
  source: HookSpec;
}

export interface MapCodexHooksOptions {
  hooks: ReadonlyArray<HookSpec>;
  collector: DiagnosticCollector;
  /** Hook ids to skip entirely (no per-hook diagnostics, no entry). */
  disabledHooks?: ReadonlyArray<string>;
}

export interface MapCodexHooksResult {
  /** Hooks Codex can run natively (or via in-script shim). */
  entries: CodexHookEntry[];
  /** Hook ids that were dropped (`drop-warn` cells). */
  droppedHookIds: string[];
}

/* ---------------------------------------------------------------- */
/*  Public mapper                                                     */
/* ---------------------------------------------------------------- */

export function mapHooksToCodex(opts: MapCodexHooksOptions): MapCodexHooksResult {
  const disabled = new Set(opts.disabledHooks ?? []);
  const entries: CodexHookEntry[] = [];
  const dropped: string[] = [];

  for (const hook of opts.hooks) {
    if (disabled.has(hook.id)) continue;

    const feature = eventToFeature(hook.event);
    const cell = CODEX_MATRIX[feature];

    // Per-hook matrix breadcrumbs (always fired so doctor can roll up).
    emitMatrixDiagnostics(opts.collector, hook, feature, cell.status, cell.diagnostics);

    if (cell.status === "drop-warn") {
      dropped.push(hook.id);
      continue;
    }

    const mapping = mapEvent(hook.event);
    if (mapping === null) {
      // Cell is non-drop-warn but mapper has no native target — guard
      // against matrix/mapper drift.
      opts.collector.warn(
        "codex.hook.mapper.stale",
        `CODEX_MATRIX cell for "${feature}" is "${cell.status}" but Codex mapper has no native event; dropping "${hook.id}".`,
        { hookId: hook.id, event: hook.event, feature, status: cell.status },
      );
      dropped.push(hook.id);
      continue;
    }

    const handlerKind = hook.handler?.kind ?? "context-injection";
    const timeout = extractTimeout(hook);

    entries.push({
      hookId: hook.id,
      codexEvent: mapping.codexEvent,
      matcher: mapping.matcher ?? matcherFromHookSpec(hook, mapping.codexEvent),
      statusMessage: hook.description ?? undefined,
      timeout,
      shim: mapping.shim,
      source: hook,
    });

    // Optional: mcp-tool handlers are not runnable from a Codex hook;
    // emit a warn and skip script-body execution (script still emits
    // additionalContext-only stub when context-injection).
    if (handlerKind === "mcp-tool") {
      opts.collector.warn(
        "codex.hook.handler.mcp_tool_unsupported",
        `Codex hooks cannot invoke MCP tools directly; hook "${hook.id}" handler "${handlerKind}" will emit a no-op script.`,
        { hookId: hook.id, handlerKind },
      );
    }
  }

  return { entries, droppedHookIds: dropped };
}

/* ---------------------------------------------------------------- */
/*  Event mapping                                                     */
/* ---------------------------------------------------------------- */

interface EventMapping {
  codexEvent: CodexNativeEvent;
  /** Explicit override (rare); usually `undefined` and resolved per spec. */
  matcher?: string;
  shim: CodexHookShim;
}

function mapEvent(event: HookEvent): EventMapping | null {
  switch (event) {
    case HookEvent.SessionStart:      return { codexEvent: "SessionStart", shim: "none" };
    case HookEvent.SessionEnd:        return { codexEvent: "Stop", shim: "none" };
    case HookEvent.UserPromptFirst:   return { codexEvent: "UserPromptSubmit", shim: "first-only" };
    case HookEvent.UserPromptEvery:   return { codexEvent: "UserPromptSubmit", shim: "none" };
    case HookEvent.BeforeToolCall:    return { codexEvent: "PreToolUse", shim: "none" };
    case HookEvent.AfterToolCall:     return { codexEvent: "PostToolUse", shim: "none" };
    case HookEvent.AfterToolFailure:  return { codexEvent: "PostToolUse", shim: "failure-only" };
    case HookEvent.PermissionRequest: return { codexEvent: "PermissionRequest", shim: "none" };
    case HookEvent.AgentSpawn:        return { codexEvent: "SubagentStart", shim: "none" };
    case HookEvent.AgentStop:         return { codexEvent: "SubagentStop", shim: "none" };
    case HookEvent.BeforeCompact:     return { codexEvent: "PreCompact", shim: "none" };
    case HookEvent.AfterCompact:      return { codexEvent: "PostCompact", shim: "none" };
    case HookEvent.MessageTransform:
    case HookEvent.Notification:
    case HookEvent.ShellEnvironment:
      return null; // drop-warn cells, handled by caller
  }
}

/* ---------------------------------------------------------------- */
/*  Matcher derivation                                                */
/* ---------------------------------------------------------------- */

function matcherFromHookSpec(hook: HookSpec, codexEvent: CodexNativeEvent): string | undefined {
  // Codex matcher use per native event:
  // - SessionStart       → source (startup|resume|clear|compact)
  // - UserPromptSubmit   → ignored
  // - Stop               → ignored
  // - PreCompact/Post    → trigger (manual|auto)
  // - PreToolUse/Post    → tool name
  // - PermissionRequest  → tool name
  // - SubagentStart/Stop → subagent type
  if (codexEvent === "UserPromptSubmit" || codexEvent === "Stop") return undefined;
  if (codexEvent === "PreCompact" || codexEvent === "PostCompact") return undefined;
  if (codexEvent === "SessionStart") return undefined; // match all sources

  const tools = hook.match?.toolNames ?? [];
  if (tools.length === 0) return undefined; // match all
  if (tools.length === 1) return escapeRegex(tools[0]!);
  return `(${tools.map(escapeRegex).join("|")})`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------------------------------------------------------------- */
/*  Timeout                                                           */
/* ---------------------------------------------------------------- */

function extractTimeout(hook: HookSpec): number | undefined {
  if (hook.handler?.kind === "command" && hook.handler.timeoutSeconds !== undefined) {
    return hook.handler.timeoutSeconds;
  }
  return undefined;
}

/* ---------------------------------------------------------------- */
/*  Per-hook matrix breadcrumbs                                       */
/* ---------------------------------------------------------------- */

function emitMatrixDiagnostics(
  collector: DiagnosticCollector,
  hook: HookSpec,
  feature: CapabilityFeature,
  status: CapabilityStatus,
  codes: ReadonlyArray<string>,
): void {
  if (codes.length === 0) return;

  const severity: "info" | "warn" =
    status === "full" ? "info" : "warn";
  const handlerKind = hook.handler?.kind ?? "context-injection";

  for (const code of codes) {
    const message =
      status === "drop-warn"
        ? `Codex matrix: feature "${feature}" is drop-warn for hook "${hook.id}".`
        : `Codex matrix: feature "${feature}" is ${status} for hook "${hook.id}".`;
    if (severity === "warn") {
      collector.warn(code, message, {
        hookId: hook.id,
        event: hook.event,
        feature,
        handlerKind,
        status,
      });
    } else {
      collector.info(code, message, {
        hookId: hook.id,
        event: hook.event,
        feature,
        handlerKind,
        status,
      });
    }
  }
}

/* ---------------------------------------------------------------- */
/*  HookEvent → CapabilityFeature (total)                             */
/* ---------------------------------------------------------------- */

export function eventToFeature(event: HookEvent): CapabilityFeature {
  switch (event) {
    case HookEvent.SessionStart:      return "hooks.sessionStart";
    case HookEvent.SessionEnd:        return "hooks.sessionEnd";
    case HookEvent.UserPromptFirst:   return "hooks.userPromptFirst";
    case HookEvent.UserPromptEvery:   return "hooks.userPromptEvery";
    case HookEvent.MessageTransform:  return "hooks.messageTransform";
    case HookEvent.BeforeToolCall:    return "hooks.beforeToolCall";
    case HookEvent.AfterToolCall:     return "hooks.afterToolCall";
    case HookEvent.AfterToolFailure:  return "hooks.afterToolFailure";
    case HookEvent.PermissionRequest: return "hooks.permissionRequest";
    case HookEvent.AgentSpawn:        return "hooks.agentSpawn";
    case HookEvent.AgentStop:         return "hooks.agentStop";
    case HookEvent.BeforeCompact:     return "hooks.beforeCompact";
    case HookEvent.AfterCompact:      return "hooks.afterCompact";
    case HookEvent.Notification:      return "hooks.notification";
    case HookEvent.ShellEnvironment:  return "hooks.shellEnvironment";
  }
}
