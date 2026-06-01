/**
 * Hook specification — harness-agnostic (spec §5.2).
 */

import type { HookEvent } from "./hook-event";
import type { PlatformId } from "../platform/platform-id";

/* ---------------------------------------------------------------- */
/*  HookContext                                                       */
/* ---------------------------------------------------------------- */

/**
 * Platform id values that may appear in `HookContext.platform`.
 * Canonical definition lives in `core/platform/platform-id.ts`; this
 * module re-exports the type for callers that already import it from
 * `core/hooks`.
 */
export type { PlatformId };

/**
 * Harness-neutral runtime context handed to adapters. Core does not
 * consume this — it is exported so adapters and `_shared` helpers
 * share one shape.
 */
export interface HookContext {
  projectRoot: string;
  /** Canonical neutral platform id (spec §5.2). */
  platform: PlatformId;
}

/* ---------------------------------------------------------------- */
/*  HookHandlerSpec (discriminated union)                             */
/* ---------------------------------------------------------------- */

export type HookHandlerSpec =
  | { kind: "context-injection"; textAsset?: string; buildTextId?: string }
  | { kind: "command"; command: string; args?: string[]; timeoutSeconds?: number }
  | { kind: "mcp-tool"; serverId: string; toolName: string; input?: Record<string, unknown> }
  | { kind: "diagnostic-only"; diagnosticCode: string };

/* ---------------------------------------------------------------- */
/*  HookMatchSpec                                                     */
/* ---------------------------------------------------------------- */

export interface HookMatchSpec {
  toolNames?: string[];
  bashGlobs?: string[];
  fileGlobs?: string[];
  eventSources?: string[];
}

/* ---------------------------------------------------------------- */
/*  HookSpec                                                          */
/* ---------------------------------------------------------------- */

export interface HookSpec {
  /** Unique kebab-case identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Canonical neutral event (spec §5.1). */
  event: HookEvent;
  /** Whether this hook is enabled by default */
  enabledByDefault: boolean;
  /** Unique marker comment used by adapters to guard against double-injection */
  marker: string;
  /** Optional match constraints. */
  match?: HookMatchSpec;
  /** Optional handler descriptor (4-kind discriminated union). */
  handler?: HookHandlerSpec;
  /**
   * Build the bootstrap text for this hook given the runtime context.
   *
   * - Returns the literal text payload to inject (without re-prepending the
   *   marker — the marker is included inside the returned text).
   * - Returns `null` when the hook is a no-op for the current project state.
   */
  buildContext?: (ctx: HookContext) => string | null;
}
