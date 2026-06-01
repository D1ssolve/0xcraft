import { z } from "zod";

import { CodexApprovalPolicy, Id, PermissionIR, Sources } from "./permission";

export const AgentRole = z.enum(["primary", "subagent"]);

export const ClaudeAgentEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const ClaudeAgentMemory = z.enum(["user", "project", "local"]);

export const ClaudeAgentIsolation = z.enum(["worktree"]);

export const ClaudePermissionSetting = z.enum([
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);

export const ClaudeAgentColor = z.enum([
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
]);

export const OpenCodeAgentMeta = z.object({
  schema: z.string().optional(),
  enabled: z.boolean().optional(),
  role: AgentRole.optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  color: z.string().optional(),
  temperature: z.number().optional(),
  tools: z.record(z.string(), z.unknown()).optional(),
  permissions: z.record(z.string(), z.unknown()).optional(),
  mcpServers: z.array(z.string()).optional(),
  plugin: z.object({
    npm: z.string().optional(),
    path: z.string().optional(),
  }).strict().optional(),
  experimental: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClaudeAgentMeta = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  effort: ClaudeAgentEffort.optional(),
  maxTurns: z.number().int().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  memory: ClaudeAgentMemory.optional(),
  background: z.boolean().optional(),
  isolation: ClaudeAgentIsolation.optional(),
  ["permission" + "Mode"]: ClaudePermissionSetting.optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
  mcpServers: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  color: ClaudeAgentColor.optional(),
  initialPrompt: z.string().optional(),
  plugin: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const CodexAgentMeta = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  developer_instructions: z.string().optional(),
  nickname_candidates: z.array(z.string()).optional(),
  model: z.string().optional(),
  model_reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  mcp_servers: z.union([z.record(z.string(), z.unknown()), z.array(z.string())]).optional(),
  skills: z.object({
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  approval_policy: CodexApprovalPolicy.optional(),
  permissionProfiles: z.record(z.string(), z.unknown()).optional(),
  permissions: z.record(z.string(), z.unknown()).optional(),
  agents: z.object({
    max_threads: z.number().int().optional(),
    max_depth: z.number().int().optional(),
    job_max_runtime_seconds: z.number().int().optional(),
  }).strict().optional(),
}).strict();

export const AgentCommonIR = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  role: AgentRole.optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTurns: z.number().int().optional(),
  memory: z.record(z.string(), z.unknown()).optional(),
  permissions: PermissionIR.optional(),
  mcpServers: z.array(z.string()).optional(),
  prompt: z.string().trim().min(1),
}).strict();

export const DiagnosticIR = z.object({
  severity: z.enum(["error", "warn", "info"]),
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ProvenanceIR = z.object({
  importedFrom: z.enum(["opencode", "claude-code", "codex"]).optional(),
  sourceFiles: z.array(z.string()),
}).strict();

export const AgentIR = z.object({
  id: Id,
  kind: z.literal("agent"),
  sourcePath: z.string().min(1),
  common: AgentCommonIR,
  platform: z.object({
    opencode: OpenCodeAgentMeta.optional(),
    claude: ClaudeAgentMeta.optional(),
    codex: CodexAgentMeta.optional(),
  }).strict(),
  diagnostics: z.array(DiagnosticIR).optional(),
  provenance: ProvenanceIR.optional(),
  _sources: Sources,
}).strict();

export type AgentRole = z.infer<typeof AgentRole>;
export type ClaudeAgentMeta = z.infer<typeof ClaudeAgentMeta>;
export type CodexAgentMeta = z.infer<typeof CodexAgentMeta>;
export type OpenCodeAgentMeta = z.infer<typeof OpenCodeAgentMeta>;
export type AgentCommonIR = z.infer<typeof AgentCommonIR>;
export type DiagnosticIR = z.infer<typeof DiagnosticIR>;
export type ProvenanceIR = z.infer<typeof ProvenanceIR>;
export type AgentIR = z.infer<typeof AgentIR>;
