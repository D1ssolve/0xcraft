/**
 * Canonical `PlatformId` — single source of truth.
 *
 * The platform id union and its companion array/guard live here so that
 * `core/config`, `core/hooks`, `core/diagnostics` and adapters all share
 * one definition. Importing from this module avoids the per-module
 * union duplication that previously existed.
 */

/** Canonical list of platform ids — single source of truth. */
export const PLATFORM_IDS = ["opencode", "claude-code", "codex"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Runtime type guard for `PlatformId`. */
export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && (PLATFORM_IDS as readonly string[]).includes(value);
}
