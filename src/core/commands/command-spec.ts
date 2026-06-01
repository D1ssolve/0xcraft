/**
 * Command specification — harness-agnostic (spec §3.5).
 *
 * Plain data + Zod schema. Adapters translate `CommandSpec` to native
 * slash-command surfaces (OpenCode + Claude Code emit native; Codex
 * copies markdown to `${CODEX_HOME}/prompts/` with a degraded warn).
 */

import { z } from "zod";

/* ---------------------------------------------------------------- */
/*  Types                                                             */
/* ---------------------------------------------------------------- */

export interface CommandArgumentSpec {
  name: string;
  description: string;
  required: boolean;
}

export interface CommandSpec {
  /** Unique kebab-case identifier. */
  id: string;
  /** Optional human-readable title. */
  title?: string;
  /** Short description for UI / palette. */
  description: string;
  /**
   * Prompt body (markdown).
   * Supports `{file:./path}` interpolation markers that are preserved
   * verbatim by core — adapters are responsible for resolution.
   */
  prompt: string;
  /** Optional positional arguments. */
  arguments?: CommandArgumentSpec[];
  /** Optional free-form metadata bag. */
  metadata?: Record<string, unknown>;
}

/* ---------------------------------------------------------------- */
/*  Zod schemas                                                       */
/* ---------------------------------------------------------------- */

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const commandArgumentSpecSchema: z.ZodType<CommandArgumentSpec> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
});

export const commandSpecSchema: z.ZodType<CommandSpec> = z.object({
  id: idSchema,
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  prompt: z.string(),
  arguments: z.array(commandArgumentSpecSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
