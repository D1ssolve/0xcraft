/**
 * Claude Code hooks mapper — Batch 6 (T-6.1), matrix-driven.
 *
 * Per `CLAUDE_CODE_MATRIX` (capability-matrix.ts §Claude Code):
 *
 *   - `shell-cmd` cells (SessionStart, UserPromptFirst, UserPromptEvery,
 *     BeforeToolCall, AfterToolCall, AfterToolFailure, AgentStop,
 *     BeforeCompact, Notification, PermissionRequest) → green-light:
 *     downstream emitter (`hook-script-emitter.ts`) produces the `.mjs`
 *     shim and `mapHooksToClaudeCode` (legacy mapper) wires it into
 *     `hooks/hooks.json`. No matrix diagnostic emitted (status is the
 *     supported integration shape for Claude Code).
 *
 *   - `drop-warn` cells (MessageTransform, AgentSpawn, AfterCompact,
 *     ShellEnvironment) → emit each of the cell's `diagnostics[]` codes
 *     (per-hook breadcrumb) PLUS the canonical `hook.unsupported` warn,
 *     and SKIP script emission for that hook.
 *
 *   - `experimental` cells → emit `hook.experimental` info, green-light.
 *     (Claude Code has none today; included for completeness.)
 *
 * Per-event matrix sweep (`emitClaudeCodeHookMatrixSweep`) emits ONE
 * `hook.unsupported` warn per drop-warn cell on the matrix, independent
 * of configured hooks. Mirrors the codex mapper (`emitCodexHookMatrixSweep`).
 *
 * This module is purely diagnostic + filtering. It does NOT generate
 * scripts — those remain the responsibility of `hook-script-emitter.ts`.
 *
 * No filesystem side effects.
 */

import {
  CLAUDE_CODE_MATRIX,
  type CapabilityFeature,
} from "../../_shared/capability-matrix";
import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { HookSpec } from "../../../core/hooks";
import {
  HOOK_EVENTS,
  type HookEvent,
} from "../../../core/hooks";
import type { ClaudeCodeHooksJson } from "../types/claude-code-types";

/* ---------------------------------------------------------------- */
/*  Public API                                                       */
/* ---------------------------------------------------------------- */

export interface RouteClaudeCodeHooksOptions {
  hooks: ReadonlyArray<HookSpec>;
  collector: DiagnosticCollector;
  /** Hook ids to skip entirely (no matrix routing, no diagnostics). */
  disabledHooks?: ReadonlyArray<string>;
}

export interface RouteClaudeCodeHooksResult {
  /** Hooks that survived matrix routing — caller emits scripts for these. */
  emittableHooks: Array<HookSpec>;
  /** Hook ids the matrix dropped (drop-warn cells). For test assertions. */
  droppedHookIds: string[];
}

export type ClaudeCodeHookDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeHookMappingDiagnostic {
  severity: ClaudeCodeHookDiagnosticSeverity;
  code: string;
  hookId: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ClaudeCodeHookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse";

export interface ClaudeCodeMappedHookScriptRef {
  hookId: string;
  hookEventName: ClaudeCodeHookEventName;
  /** Path relative to the plugin output root (e.g. `hooks/<id>.mjs`). */
  scriptPath: string;
  /**
   * Optional matcher string for events that support filtering.
   * `SessionStart` uses `"startup|resume|clear"` to fire on all
   * relevant source variants (research §Q5).
   */
  matcher?: string;
}

export interface ClaudeCodeHookMapperOptions {
  hooks: HookSpec[];
  /** Script refs produced by the emitter for hooks that mapped successfully. */
  scriptRefs: ClaudeCodeMappedHookScriptRef[];
  disabledHooks?: string[];
  /** Runtime invocation prefix for the emitted script commands. */
  runtime?: "bun" | "node";
}

export interface ClaudeCodeHookMapperResult {
  hooksJson?: ClaudeCodeHooksJson;
  diagnostics: ClaudeCodeHookMappingDiagnostic[];
}

const SAFE_HOOK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Default matcher per event. `SessionStart` benefits from triggering on
 * all source variants so the bootstrap also fires on `--resume`/`--clear`.
 */
function defaultMatcherForEvent(event: ClaudeCodeHookEventName): string | undefined {
  switch (event) {
    case "SessionStart":
      return "startup|resume|clear";
    default:
      return undefined;
  }
}

/**
 * Maps a canonical HookEvent to a Claude Code native event name.
 * Returns null when no mapping exists.
 */
export function mapEventToClaudeCodeEvent(event: HookEvent): ClaudeCodeHookEventName | null {
  switch (event) {
    case HOOK_EVENTS.SessionStart:
      return "SessionStart";
    case HOOK_EVENTS.UserPromptFirst:
    case HOOK_EVENTS.UserPromptEvery:
      return "UserPromptSubmit";
    case HOOK_EVENTS.BeforeToolCall:
      return "PreToolUse";
    case HOOK_EVENTS.AfterToolCall:
      return "PostToolUse";
    default:
      return null;
  }
}

export function mapHooksToClaudeCode(options: ClaudeCodeHookMapperOptions): ClaudeCodeHookMapperResult {
  const disabledHooks = new Set(options.disabledHooks ?? []);
  const diagnostics: ClaudeCodeHookMappingDiagnostic[] = [];
  const runtime = options.runtime ?? "bun";
  const scriptRefById = new Map(options.scriptRefs.map((ref) => [ref.hookId, ref]));

  const hooks: ClaudeCodeHooksJson["hooks"] = {};

  for (const hook of options.hooks) {
    if (disabledHooks.has(hook.id)) {
      continue;
    }

    if (!SAFE_HOOK_ID_PATTERN.test(hook.id)) {
      diagnostics.push({
        severity: "error",
        code: "claude.hook.invalid_id",
        hookId: hook.id,
        message: `Hook \`${hook.id}\` has an unsafe id for Claude Code hook mapping.`,
      });
      continue;
    }

    const event = mapEventToClaudeCodeEvent(hook.event);
    if (!event) {
      diagnostics.push({
        severity: "warning",
        code: "claude.hook.unsupported_event",
        hookId: hook.id,
        message: `Hook \`${hook.id}\` with event \`${hook.event}\` has no supported Claude Code event mapping and was omitted.`,
      });
      continue;
    }

    const scriptRef = scriptRefById.get(hook.id);
    if (!scriptRef) {
      diagnostics.push({
        severity: "warning",
        code: "claude.hook.no_script",
        hookId: hook.id,
        message: `Hook \`${hook.id}\` has no generated script (no inlinable bootstrap text); mapping skipped.`,
      });
      continue;
    }

    const matcher = scriptRef.matcher ?? defaultMatcherForEvent(event);
    const eventName = scriptRef.hookEventName;

    const command = buildCommand(runtime, scriptRef.scriptPath);
    const group: ClaudeCodeHooksJson["hooks"][string][number] = {
      hooks: [{ type: "command", command }],
    };
    if (matcher !== undefined) {
      group.matcher = matcher;
    }

    if (!hooks[eventName]) {
      hooks[eventName] = [];
    }
    hooks[eventName]!.push(group);
  }

  if (Object.keys(hooks).length === 0) {
    return { diagnostics };
  }

  return {
    hooksJson: {
      description: "0xcraft Claude Code hooks",
      hooks,
    },
    diagnostics,
  };
}

/**
 * Route each `HookSpec` through `CLAUDE_CODE_MATRIX`. Returns the
 * subset of hooks that downstream emitters should still process.
 *
 * Side effects: emits per-hook diagnostics on `opts.collector`.
 */
export function routeClaudeCodeHooks(
  opts: RouteClaudeCodeHooksOptions,
): RouteClaudeCodeHooksResult {
  const disabled = new Set(opts.disabledHooks ?? []);
  const emittableHooks: Array<HookSpec> = [];
  const droppedHookIds: string[] = [];

  for (const hook of opts.hooks) {
    if (disabled.has(hook.id)) continue;

    const event = hook.event;
    const feature = eventToFeature(event);
    const cell = CLAUDE_CODE_MATRIX[feature];
    const handlerKind = hook.handler?.kind ?? "context-injection";

    switch (cell.status) {
      case "drop-warn": {
        // Canonical warn first, then per-cell breadcrumbs.
        opts.collector.warn(
          "hook.unsupported",
          `Claude Code does not support hook capability "${feature}"; hook "${hook.id}" dropped.`,
          { hookId: hook.id, event, feature, handlerKind, platform: "claude-code", evidence: cell.evidence },
        );
        for (const code of cell.diagnostics) {
          opts.collector.warn(
            code,
            `Claude Code matrix: feature "${feature}" is drop-warn for hook "${hook.id}".`,
            { hookId: hook.id, event, feature, handlerKind },
          );
        }
        droppedHookIds.push(hook.id);
        break;
      }
      case "experimental": {
        opts.collector.info(
          "hook.experimental",
          `Claude Code support for "${feature}" is experimental; hook "${hook.id}" relies on a non-stable surface.`,
          { hookId: hook.id, event, feature, handlerKind, platform: "claude-code", evidence: cell.evidence },
        );
        emittableHooks.push(hook);
        break;
      }
      case "shim":
      case "shell-cmd":
      case "full": {
        // Supported integration shape for Claude Code hooks — no diagnostic.
        emittableHooks.push(hook);
        break;
      }
      default: {
        // Unreachable; future-proof guard.
        opts.collector.warn(
          "claude-code.hook.mapper.stale",
          `CLAUDE_CODE_MATRIX cell for "${feature}" has unrecognised status "${cell.status}"; dropping hook "${hook.id}".`,
          { hookId: hook.id, event, feature, status: cell.status },
        );
        droppedHookIds.push(hook.id);
      }
    }
  }

  return { emittableHooks, droppedHookIds };
}

/**
 * Emit one `hook.unsupported` warn per `hooks.*` cell on CLAUDE_CODE_MATRIX
 * whose status is `drop-warn`. Deterministic (sorted feature iteration);
 * independent of configured hooks.
 */
export function emitClaudeCodeHookMatrixSweep(collector: DiagnosticCollector): void {
  const features = (Object.keys(CLAUDE_CODE_MATRIX) as CapabilityFeature[])
    .filter((f) => f.startsWith("hooks."))
    .sort();
  for (const feature of features) {
    const cell = CLAUDE_CODE_MATRIX[feature];
    if (cell.status !== "drop-warn") continue;
    collector.warn(
      "hook.unsupported",
      `Claude Code does not support hook capability "${feature}"; this hook will be dropped.`,
      { feature, platform: "claude-code", evidence: cell.evidence },
    );
  }
}

/* ---------------------------------------------------------------- */
/*  HookEvent → CapabilityFeature                                    */
/* ---------------------------------------------------------------- */

/** Total over all 15 `HookEvent` values. Shared shape with codex mapper. */
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

function buildCommand(runtime: "bun" | "node", scriptPath: string): string {
  // ${CLAUDE_PLUGIN_ROOT} is the canonical placeholder Claude Code
  // substitutes with the plugin's installed root at hook invocation.
  // Using a relative path keeps the command portable; the plugin
  // root is supplied by Claude Code.
  return `${runtime} \${CLAUDE_PLUGIN_ROOT}/${scriptPath}`;
}
