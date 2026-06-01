import { z } from "zod";

export const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}(\/[a-z0-9][a-z0-9-]{0,62})?$/);

export const Sources = z.record(z.string(), z.string()).optional();

export const PolicyVerdict = z.enum(["allow", "ask", "deny"]);

export const SandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export const CodexApprovalPolicy = z.union([
  z.enum(["untrusted", "on-request", "never"]),
  z.record(z.string(), z.unknown()),
]);

export const BashPermissionIR = z.object({
  allow: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
}).strict();

export const OpenCodePermissionMeta = z.record(z.string(), z.unknown());

export const ClaudePermissionMeta = z.record(z.string(), z.unknown());

export const CodexPermissionMeta = z.object({
  approval_policy: CodexApprovalPolicy.optional(),
  permissions: z.record(z.string(), z.unknown()).optional(),
  profiles: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const PermissionPlatformMeta = z.object({
  opencode: OpenCodePermissionMeta.optional(),
  claude: ClaudePermissionMeta.optional(),
  codex: CodexPermissionMeta.optional(),
}).strict();

export const PermissionIR = z.object({
  id: Id.optional(),
  kind: z.literal("permission").optional(),
  default: PolicyVerdict,
  tools: z.record(z.string(), PolicyVerdict),
  bash: BashPermissionIR,
  sandbox: SandboxMode,
  platform: PermissionPlatformMeta,
  _deprecatedOnFailure: z.boolean(),
  _sources: Sources,
}).strict();

export type BashPermissionIR = z.infer<typeof BashPermissionIR>;
export type OpenCodePermissionMeta = z.infer<typeof OpenCodePermissionMeta>;
export type ClaudePermissionMeta = z.infer<typeof ClaudePermissionMeta>;
export type CodexPermissionMeta = z.infer<typeof CodexPermissionMeta>;
export type PermissionPlatformMeta = z.infer<typeof PermissionPlatformMeta>;
export type PermissionIR = z.infer<typeof PermissionIR>;
