import { z } from "zod";

import { DiagnosticIR, ProvenanceIR } from "./agent";
import { Id, Sources } from "./permission";

export const McpTransport = z.enum(["stdio", "http", "sse"]);

export const McpEnvelopeIR = z.object({
  sourceShape: z.string(),
  emitShape: z.string(),
  wrapperKey: z.string(),
}).strict();

export const OpenCodeMcpMeta = z.record(z.string(), z.unknown());

export const ClaudeMcpMeta = z.object({
  wrapper: z.literal("mcpServers").optional(),
}).strict();

export const CodexMcpMeta = z.object({
  wrapper: z.literal("mcp_servers").optional(),
  cwd: z.string().optional(),
  env_vars: z.array(z.union([
    z.string(),
    z.object({
      name: z.string(),
      source: z.string().optional(),
    }).strict(),
  ])).optional(),
  bearer_token_env_var: z.string().optional(),
  env_http_headers: z.record(z.string(), z.string()).optional(),
}).strict();

export const McpServerCommonIR = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transport: McpTransport,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  wrapper: z.enum(["direct", "wrapped"]).optional(),
}).strict();

export const McpServerIR = z.object({
  id: Id,
  kind: z.literal("mcp"),
  sourcePath: z.string().min(1),
  common: McpServerCommonIR,
  mcpEnvelope: McpEnvelopeIR,
  platform: z.object({
    opencode: OpenCodeMcpMeta.optional(),
    claude: ClaudeMcpMeta.optional(),
    codex: CodexMcpMeta.optional(),
  }).strict(),
  diagnostics: z.array(DiagnosticIR).optional(),
  provenance: ProvenanceIR.optional(),
  _sources: Sources,
}).strict();

export type McpTransport = z.infer<typeof McpTransport>;
export type McpEnvelopeIR = z.infer<typeof McpEnvelopeIR>;
export type OpenCodeMcpMeta = z.infer<typeof OpenCodeMcpMeta>;
export type ClaudeMcpMeta = z.infer<typeof ClaudeMcpMeta>;
export type CodexMcpMeta = z.infer<typeof CodexMcpMeta>;
export type McpServerCommonIR = z.infer<typeof McpServerCommonIR>;
export type McpServerIR = z.infer<typeof McpServerIR>;
