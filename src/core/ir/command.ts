import { z } from "zod";

import { DiagnosticIR, ProvenanceIR } from "./agent";
import { Id, Sources } from "./permission";

export const CommandArgumentIR = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
}).strict();

export const OpenCodeCommandMeta = z.record(z.string(), z.unknown());

export const ClaudeCommandMeta = z.record(z.string(), z.unknown());

export const CodexCommandMeta = z.record(z.string(), z.unknown());

export const CommandCommonIR = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.array(CommandArgumentIR).optional(),
  template: z.string().min(1),
}).strict();

export const CommandIR = z.object({
  id: Id,
  kind: z.literal("command"),
  sourcePath: z.string().min(1),
  common: CommandCommonIR,
  platform: z.object({
    opencode: OpenCodeCommandMeta.optional(),
    claude: ClaudeCommandMeta.optional(),
    codex: CodexCommandMeta.optional(),
  }).strict(),
  diagnostics: z.array(DiagnosticIR).optional(),
  provenance: ProvenanceIR.optional(),
  _sources: Sources,
}).strict();

export type CommandArgumentIR = z.infer<typeof CommandArgumentIR>;
export type OpenCodeCommandMeta = z.infer<typeof OpenCodeCommandMeta>;
export type ClaudeCommandMeta = z.infer<typeof ClaudeCommandMeta>;
export type CodexCommandMeta = z.infer<typeof CodexCommandMeta>;
export type CommandCommonIR = z.infer<typeof CommandCommonIR>;
export type CommandIR = z.infer<typeof CommandIR>;
