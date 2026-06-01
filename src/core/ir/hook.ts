import { z } from "zod";

import { HOOK_EVENTS } from "../hook-runtime/events";
import { HookModifierIR } from "../hook-runtime/modifiers";
import { HookActionIR } from "../hook-runtime/primitives";
import { DiagnosticIR, ProvenanceIR } from "./agent";
import { Id, Sources } from "./permission";

const HookEventLiteral = z.enum(HOOK_EVENTS);

export const HookRuntime = z.enum(["portable", "opencode-only"]);

export const OpenCodeHookMeta = z.object({
  schema: z.string().optional(),
  enabled: z.boolean().optional(),
  runtime: HookRuntime.optional(),
  events: z.array(z.string()).optional(),
  factory: z.string().optional(),
  jsFile: z.string().optional(),
  experimental: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClaudeHookMeta = z.record(z.string(), z.unknown());

export const CodexHookMeta = z.record(z.string(), z.unknown());

export const HookCommonIR = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  events: z.array(HookEventLiteral),
  runtime: HookRuntime.optional(),
  actions: z.array(HookActionIR).min(1).max(32),
  modifiers: z.array(HookModifierIR).optional(),
  timeoutMs: z.number().int().optional(),
}).strict();

export const HookIR = z.object({
  id: Id,
  kind: z.literal("hook"),
  sourcePath: z.string().min(1),
  common: HookCommonIR,
  platform: z.object({
    opencode: OpenCodeHookMeta.optional(),
    claude: ClaudeHookMeta.optional(),
    codex: CodexHookMeta.optional(),
  }).strict(),
  runtimeFiles: z.object({
    opencodeJs: z.string().optional(),
  }).strict().optional(),
  diagnostics: z.array(DiagnosticIR).optional(),
  provenance: ProvenanceIR.optional(),
  _sources: Sources,
}).strict();

export type OpenCodeHookMeta = z.infer<typeof OpenCodeHookMeta>;
export type ClaudeHookMeta = z.infer<typeof ClaudeHookMeta>;
export type CodexHookMeta = z.infer<typeof CodexHookMeta>;
export type HookCommonIR = z.infer<typeof HookCommonIR>;
export type HookIR = z.infer<typeof HookIR>;
