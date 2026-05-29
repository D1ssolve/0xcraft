/**
 * 0xcraft — Agent Operations Plugin
 *
 * Harness-agnostic core. Zero OpenCode dependencies.
 * The OpenCode adapter imports from here and wraps in plugin API.
 */

/* -------- diagnostics (canonical) ------------------------------- */
export { type Diagnostic, type DiagnosticSeverity } from "./diagnostics";
export {
  type CapabilityFeature,
  type CapabilityStatus,
  type CapabilityCell,
  type CapabilityReport,
  CAPABILITY_FEATURES,
} from "./diagnostics";

/* -------- permission (canonical) ------------------------------- */
export {
  type SandboxTier,
  type ToolVerdict,
  type PermissionSpec,
  permissionSpecSchema,
} from "./permission";

/* -------- agents ------------------------------------------------ */
export {
  type AgentSpec,
  type AgentMode,
  resolveModel,
  builtinAgents,
  dualModeAgents,
  getAgentById,
  getPrimaryAgents,
  getSubagents,
} from "./agents";

/* -------- skills ------------------------------------------------ */
export { type SkillDefinition, type McpServerConfig as SkillMcpServerConfig, builtinSkills, getSkillById, getSkillsByTag, getAutoLoadSkills, getSkillsWithMcp } from "./skills";

/* -------- config ----------------------------------------------- */
export {
  type ZeroxCraftConfig,
  type PartialZeroxCraftConfig,
  type OpencodePlatformConfig,
  type ClaudeCodePlatformConfig,
  type CodexPlatformConfig,
  type ZeroxCraftConfigPlatforms,
  type PlatformsConfig,
  type PlatformId,
  PLATFORM_IDS,
  isPlatformId,
  defaultConfig,
  mergeConfig,
  zeroxCraftConfigSchema,
  stripJsonc,
  parseJsonc,
  sanitizeDetails,
  loadConfig,
} from "./config";

/* -------- hooks ------------------------------------------------- */
export {
  type HookSpec,
  HookEvent,
  type HookContext,
  type HookHandlerSpec,
  type HookMatchSpec,
  HOOK_EVENTS,
  builtinHooks,
  getHookById,
  getEnabledHooks,
} from "./hooks";

/* -------- commands (canonical) ---------------------------------- */
export {
  type CommandSpec,
  type CommandArgumentSpec,
  type CommandRegistry,
  commandSpecSchema,
  commandArgumentSpecSchema,
  createCommandRegistry,
  builtinCommands,
  getCommandById,
} from "./commands";

/* -------- mcp --------------------------------------------------- */
export {
  type McpServerSpec,
  type McpServerStdioSpec,
  type McpServerHttpSpec,
  type McpServerSseSpec,
  type CustomToolSpec,
  type CustomToolMcpSpec,
  type CustomToolOpenCodeShortCircuitSpec,
  builtinMcpServers,
  getMcpByName,
  getEnabledMcpServers,
} from "./mcp";
