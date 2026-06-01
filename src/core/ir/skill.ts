import { z } from "zod";

import { DiagnosticIR, ProvenanceIR } from "./agent";
import { Id, Sources } from "./permission";

export const SkillToolList = z.union([z.array(z.string()), z.string()]);

export const OpenCodeSkillMeta = z.object({
  schema: z.string().optional(),
  enabled: z.boolean().optional(),
  autoload: z.boolean().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  "disallowed-tools": z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  experimental: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClaudeSkillMeta = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  when_to_use: z.string().optional(),
  "argument-hint": z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  "allowed-tools": SkillToolList.optional(),
  "disallowed-tools": SkillToolList.optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  context: z.enum(["fork"]).optional(),
  agent: z.string().optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
  paths: z.array(z.string()).optional(),
  shell: z.enum(["bash", "powershell"]).optional(),
}).strict();

export const CodexSkillMeta = z.object({
  enabled: z.boolean().optional(),
  autoload: z.boolean().optional(),
  skills: z.object({
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  cwd: z.string().optional(),
  env_vars: z.record(z.string(), z.string()).optional(),
  bearer_token_env_var: z.string().optional(),
  env_http_headers: z.record(z.string(), z.string()).optional(),
}).strict();

export const SkillCommonIR = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  autoload: z.boolean().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  "disallowed-tools": z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  body: z.string().min(1),
}).strict();

export const SkillIR = z.object({
  id: Id,
  kind: z.literal("skill"),
  sourcePath: z.string().min(1),
  common: SkillCommonIR,
  platform: z.object({
    opencode: OpenCodeSkillMeta.optional(),
    claude: ClaudeSkillMeta.optional(),
    codex: CodexSkillMeta.optional(),
  }).strict(),
  diagnostics: z.array(DiagnosticIR).optional(),
  provenance: ProvenanceIR.optional(),
  _sources: Sources,
}).strict();

export type OpenCodeSkillMeta = z.infer<typeof OpenCodeSkillMeta>;
export type ClaudeSkillMeta = z.infer<typeof ClaudeSkillMeta>;
export type CodexSkillMeta = z.infer<typeof CodexSkillMeta>;
export type SkillCommonIR = z.infer<typeof SkillCommonIR>;
export type SkillIR = z.infer<typeof SkillIR>;
