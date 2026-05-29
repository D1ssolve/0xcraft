import { z } from "zod";

const stringArraySchema = z.array(z.string().min(1));
const stringRecordSchema = z.record(z.string(), z.string());
const componentPathSchema = z.union([z.string().min(1), stringArraySchema]);

export const claudeCodeManifestSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    homepage: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    license: z.string().min(1).optional(),
    keywords: stringArraySchema.optional(),
    skills: componentPathSchema.optional(),
    commands: componentPathSchema.optional(),
    agents: componentPathSchema.optional(),
    hooks: componentPathSchema.optional(),
    mcpServers: componentPathSchema.optional(),
    outputStyles: componentPathSchema.optional(),
    lspServers: componentPathSchema.optional(),
    userConfig: z.record(z.string(), z.unknown()).optional(),
    channels: stringArraySchema.optional(),
    dependencies: z.array(z.unknown()).optional(),
  })
  .strict();

export type ClaudeCodeManifest = z.infer<typeof claudeCodeManifestSchema>;

export const claudeCodeAgentFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    model: z.string().min(1).optional(),
    // CLAUDE_CODE_MATRIX.agentColor === "native" — emitted directly from AgentSpec.color.
    color: z.string().min(1).optional(),
    effort: z.enum(["low", "medium", "high"]).or(z.string().min(1)).optional(),
    maxTurns: z.number().int().positive().optional(),
    tools: stringArraySchema.optional(),
    disallowedTools: stringArraySchema.optional(),
    skills: stringArraySchema.optional(),
    // CLAUDE_CODE_MATRIX.perAgentMcpScoping === "native". Plumbing only:
    // AgentSpec does not yet expose `mcpServers`; the mapper reads a
    // forward-compatible `agent.mcpServers?: string[]` via a safe cast. When
    // a future core schema lands, replace the cast with a typed read.
    mcpServers: stringArraySchema.optional(),
    memory: z.boolean().optional(),
    background: z.boolean().optional(),
    isolation: z.boolean().optional(),
  })
  .strict();

export type ClaudeCodeAgentFrontmatter = z.infer<typeof claudeCodeAgentFrontmatterSchema>;

export const claudeCodeSkillFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    when_to_use: z.string().min(1).optional(),
    "argument-hint": z.string().min(1).optional(),
    arguments: z
      .array(
        z
          .object({
            name: z.string().min(1),
            description: z.string().min(1).optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    "disable-model-invocation": z.boolean().optional(),
    "user-invocable": z.boolean().optional(),
    "allowed-tools": stringArraySchema.optional(),
    model: z.string().min(1).optional(),
    effort: z.enum(["low", "medium", "high"]).or(z.string().min(1)).optional(),
    context: stringArraySchema.optional(),
    agent: z.string().min(1).optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    paths: stringArraySchema.optional(),
    shell: z.boolean().optional(),
  })
  .strict();

export type ClaudeCodeSkillFrontmatter = z.infer<typeof claudeCodeSkillFrontmatterSchema>;

export const claudeCodeHookHandlerSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("command"),
      command: z.string().min(1),
      timeout: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("http"),
      url: z.string().url(),
      timeout: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcp_tool"),
      server: z.string().min(1),
      tool: z.string().min(1),
      timeout: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("prompt"),
      prompt: z.string().min(1),
      timeout: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent"),
      agent: z.string().min(1),
      timeout: z.number().positive().optional(),
    })
    .strict(),
]);

export type ClaudeCodeHookHandler = z.infer<typeof claudeCodeHookHandlerSchema>;

export const claudeCodeHookMatcherGroupSchema = z
  .object({
    matcher: z.string().min(1).optional(),
    hooks: z.array(claudeCodeHookHandlerSchema).min(1),
  })
  .strict();

export type ClaudeCodeHookMatcherGroup = z.infer<typeof claudeCodeHookMatcherGroupSchema>;

export const claudeCodeHooksJsonSchema = z
  .object({
    description: z.string().min(1).optional(),
    hooks: z.record(z.string().min(1), z.array(claudeCodeHookMatcherGroupSchema)),
  })
  .strict();

export type ClaudeCodeHooksJson = z.infer<typeof claudeCodeHooksJsonSchema>;

const claudeCodeLocalMcpServerSchema = z
  .object({
    type: z.enum(["stdio", "local"]).optional(),
    command: z.string().min(1),
    args: stringArraySchema.optional(),
    env: stringRecordSchema.optional(),
  })
  .strict();

const claudeCodeRemoteMcpServerSchema = z
  .object({
    type: z.enum(["http", "sse"]).optional(),
    url: z.string().url(),
    headers: stringRecordSchema.optional(),
    env: stringRecordSchema.optional(),
  })
  .strict();

export const claudeCodeMcpServerSchema = z.union([claudeCodeLocalMcpServerSchema, claudeCodeRemoteMcpServerSchema]);

export type ClaudeCodeMcpServer = z.infer<typeof claudeCodeMcpServerSchema>;

export const claudeCodeMcpJsonSchema = z
  .object({
    mcpServers: z.record(z.string().min(1), claudeCodeMcpServerSchema),
  })
  .strict();

export type ClaudeCodeMcpJson = z.infer<typeof claudeCodeMcpJsonSchema>;

export const claudeCodeSettingsJsonSchema = z
  .object({
    agent: z.string().min(1).optional(),
    subagentStatusLine: z.string().min(1).optional(),
  })
  .strict();

export type ClaudeCodeSettingsJson = z.infer<typeof claudeCodeSettingsJsonSchema>;
