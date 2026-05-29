/**
 * OpenCode runtime hook bridge — ADR §6 / Batch 6 (T-6.3).
 *
 * This module is the canonical seam between 0xcraft's harness-agnostic
 * `HookSpec` (core/hooks) and `@opencode-ai/plugin`'s `Hooks` runtime
 * record. It splits two concerns:
 *
 *   1. **Built-in transform** (`createHookTransform`) — the legacy
 *      message-transform shim used by the three packaged
 *      context-injection built-ins (caveman / agents-guard /
 *      git-worktree). Preserved byte-identical (opencode snapshot test
 *      depends on it).
 *
 *   2. **Dynamic translator** (`bridgeUserHooks`) — Batch 6 surface
 *      for user-configured custom `HookSpec`s. Routes each through
 *      `OPENCODE_MATRIX` via `mappers/hooks.ts`:
 *
 *        - `drop-warn` cells → drop + `hook.unsupported` warn
 *        - `experimental` cells → wire onto `experimental.chat.
 *          messages.transform` or `experimental.session.compacting` +
 *          `hook.experimental` info
 *        - `full` cells → wire onto the matching native key
 *          (`tool.execute.before`, `tool.execute.after`,
 *          `permission.ask`, `shell.env`)
 *
 * Carve-out rationale: doing matrix routing on built-ins would force a
 * snapshot churn (the built-ins are static and known-good for every
 * matrix cell they touch). User-configured hooks have no snapshot
 * coverage and benefit from the matrix.
 *
 * `@opencode-ai/plugin` types stay scoped to this module subtree per
 * Layer Rules (AGENTS.md).
 */

import type { Hooks } from "@opencode-ai/plugin";

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { HookSpec } from "../../../core/hooks";

import {
  routeOpenCodeHooks,
  type OpenCodeNativeHookKey,
  type OpenCodeExperimentalHookKey,
  type RoutedOpenCodeHook,
} from "../mappers/hooks";

/* ---------------------------------------------------------------- */
/*  Built-in transform (legacy, preserved verbatim)                  */
/* ---------------------------------------------------------------- */

export { createHookTransform } from "../hooks/hook-shim-builder";

/* ---------------------------------------------------------------- */
/*  Dynamic bridge (Batch 6)                                          */
/* ---------------------------------------------------------------- */

export interface BridgeUserHooksOptions {
  /** User-configured `HookSpec`s (excludes built-ins). */
  hooks: ReadonlyArray<HookSpec>;
  /** Diagnostic sink for matrix routing warnings / info. */
  collector: DiagnosticCollector;
  /** Hook ids to skip entirely. */
  disabledHooks?: ReadonlyArray<string>;
}

/**
 * Partial `Hooks` record carrying only the keys that survived matrix
 * routing. Caller is responsible for merging this with built-in hook
 * registrations (e.g. the legacy `experimental.chat.messages.transform`
 * shim from `createHookTransform`). When both the built-in shim and a
 * dynamic experimental hook target the same key, the caller MUST
 * compose them (the bridge does not own that policy).
 */
export type OpenCodeBridgedHooks = Partial<
  Pick<Hooks, OpenCodeNativeHookKey | OpenCodeExperimentalHookKey>
>;

export interface BridgeUserHooksResult {
  /** `Hooks` fragments keyed by their target `Hooks` field. */
  hooks: OpenCodeBridgedHooks;
  /** Hook ids that survived routing (wired into `hooks`). */
  emittedHookIds: string[];
  /** Hook ids dropped by the matrix (drop-warn or unknown). */
  droppedHookIds: string[];
}

/**
 * Translate user-configured `HookSpec`s into `@opencode-ai/plugin`
 * `Hooks` fragments via `OPENCODE_MATRIX`. Diagnostics are emitted on
 * `opts.collector`.
 *
 * NOTE: this bridge does NOT execute hook handlers — it only routes.
 * The current Batch 6 scope is the matrix + diagnostic surface (per
 * `.ai/tasks.md` T-6.3 acceptance). Handler invocation semantics for
 * dynamic OpenCode hooks (translating `HookContext` ↔ each
 * `Hooks[...]` input/output shape) is tracked separately; until that
 * lands, emitted entries are no-op handlers that satisfy the type
 * surface so the matrix decisions are observable end-to-end.
 */
export function bridgeUserHooks(opts: BridgeUserHooksOptions): BridgeUserHooksResult {
  const routed = routeOpenCodeHooks({
    hooks: opts.hooks,
    collector: opts.collector,
    disabledHooks: opts.disabledHooks,
  });

  const hooks: OpenCodeBridgedHooks = {};
  const emittedHookIds: string[] = [];

  for (const entry of routed.emittable) {
    wireRouted(hooks, entry);
    emittedHookIds.push(entry.hook.id);
  }

  return {
    hooks,
    emittedHookIds,
    droppedHookIds: routed.droppedHookIds,
  };
}

/**
 * Install a no-op `Hooks` handler at the routed key. Multiple hooks
 * routed to the same key are chained sequentially (so a future
 * handler-translator can replace each `installed[key]` slot without
 * losing prior registrations).
 */
function wireRouted(
  hooks: OpenCodeBridgedHooks,
  entry: RoutedOpenCodeHook,
): void {
  if (entry.target.kind === "dropped") return;
  const key = entry.target.hooksKey;
  // No-op placeholder handler. Typed as `unknown` then cast because
  // each `Hooks[key]` has its own input/output signature; the chain
  // logic is identical regardless. A future patch will replace this
  // with HookContext-aware handlers.
  const prev = hooks[key] as ((...args: unknown[]) => Promise<void>) | undefined;
  const next = async (...args: unknown[]): Promise<void> => {
    if (prev) await prev(...args);
    // Placeholder: real handler invocation lands with HookContext
    // translation. The matrix decision is already observable via the
    // diagnostics emitted by `routeOpenCodeHooks`.
  };
  // `as never` is required because TS cannot prove the union arm
  // matches `key` at this generic site; the cast is sound because
  // `key` was produced by the mapper from this same union.
  (hooks as Record<string, unknown>)[key] = next as never;
}
