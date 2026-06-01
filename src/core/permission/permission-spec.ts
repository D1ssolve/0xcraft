/**
 * Neutral permission model — shared across all platform adapters.
 *
 * `PermissionSpec` is the canonical, flat, platform-agnostic shape.
 * Each adapter (OpenCode, Claude Code, Codex) maps it onto its native
 * permission/approval/sandbox surface.
 */

import { z } from "zod";

/* ---------------------------------------------------------------- */
/*  Canonical types                                                   */
/* ---------------------------------------------------------------- */

export type SandboxTier = "read" | "workspace-write" | "full";

export type ToolVerdict = "allow" | "deny" | "ask";

export interface PermissionSpec {
  /** Coarse sandbox tier — adapters map to native sandbox mode. */
  sandbox: SandboxTier;
  /** Per-tool verdicts (tool id → verdict). */
  tools: Record<string, ToolVerdict>;
  /** Bash glob → verdict map. */
  bash: Record<string, ToolVerdict>;
  /** Optional filesystem scoping. */
  filesystem?: {
    readableRoots?: string[];
    writableRoots?: string[];
  };
  /** Optional delegation matrix (subagent id or "*" → verdict). */
  delegation?: Record<string, ToolVerdict>;
}

/* ---------------------------------------------------------------- */
/*  Zod schema                                                        */
/* ---------------------------------------------------------------- */

const verdictSchema = z.enum(["allow", "deny", "ask"]);
const sandboxTierSchema = z.enum(["read", "workspace-write", "full"]);

export const permissionSpecSchema = z.object({
  sandbox: sandboxTierSchema.default("workspace-write"),
  tools: z.record(z.string(), verdictSchema).default({}),
  bash: z.record(z.string(), verdictSchema).default({}),
  filesystem: z
    .object({
      readableRoots: z.array(z.string()).default([]),
      writableRoots: z.array(z.string()).default([]),
    })
    .optional(),
  delegation: z.record(z.string(), verdictSchema).optional(),
});
