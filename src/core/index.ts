/**
 * 0xcraft v3 core — harness-agnostic domain types and IR primitives.
 *
 * Phase 0: legacy in-tree registries removed. Phase 1 will populate this with
 * IR types (AgentIR, SkillIR, HookIR, McpServerIR), capability matrix v2,
 * config schema v3, diagnostic code registry, and pack schema.
 */

/* -------- diagnostics (kept from v2; refactored in Phase 1) -------- */
export { type Diagnostic, type DiagnosticSeverity } from "./diagnostics";
export {
  type CapabilityFeature,
  type CapabilityStatus,
  type CapabilityCell,
  type CapabilityReport,
  CAPABILITY_FEATURES,
} from "./diagnostics";

/* -------- permission (kept from v2; refactored in Phase 1) --------- */
export {
  type SandboxTier,
  type ToolVerdict,
  type PermissionSpec,
  permissionSpecSchema,
} from "./permission";

/* -------- agents (spec type only; registry removed) ---------------- */
export { type AgentSpec, type AgentMode, resolveModel } from "./agents";

/* -------- config (kept; replaced by v3 schema in Phase 1) ---------- */
export {
  type ZeroxCraftConfig,
  type OpencodePlatformConfig,
  type ClaudePlatformConfig,
  type CodexPlatformConfig,
  ConfigSchema,
  DEFAULT_CONFIG,
  zeroxCraftConfigSchema,
  stripJsonc,
  parseJsonc,
  loadConfig,
} from "./config";

/* -------- hooks (spec type + event enum; registry removed) --------- */
export {
  type HookSpec,
  HookEvent,
  type HookContext,
  type HookHandlerSpec,
  type HookMatchSpec,
  HOOK_EVENTS,
} from "./hooks";

/* -------- commands (spec + registry factory) ---------------------- */
export {
  type CommandSpec,
  type CommandArgumentSpec,
  type CommandRegistry,
  commandSpecSchema,
  commandArgumentSpecSchema,
  createCommandRegistry,
} from "./commands";

/* -------- mcp (spec types only; registry removed) ------------------ */
export {
  type McpServerSpec,
  type McpServerStdioSpec,
  type McpServerHttpSpec,
  type McpServerSseSpec,
  type CustomToolSpec,
  type CustomToolMcpSpec,
  type CustomToolOpenCodeShortCircuitSpec,
} from "./mcp";
