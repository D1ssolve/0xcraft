// 0xcraft — Agent Operations Plugin
// Main entry point. Exports the OpenCode adapter as default.
// Core types are also exported for external consumers.

export { createPlugin } from "./adapters/opencode/index.js";

// Core types (harness-agnostic)
export type { AgentDefinition, AgentPermissions, TaskPermissions } from "./core/agents/agent-types.js";
export type { SkillDefinition } from "./core/skills/skill-types.js";
export type { ZeroxCraftConfig, McpServerConfig } from "./core/config/config-types.js";
export type { HookDefinition, HookType } from "./core/hooks/hook-types.js";
export type { McpRegistryEntry } from "./core/mcp/mcp-registry.js";

// Core registries and utilities
export { builtinAgents, dualModeAgents, getAgentById, getPrimaryAgents, getSubagents } from "./core/agents/builtin-agents.js";
export { builtinSkills, getSkillById, getSkillsByTag, getAutoLoadSkills, getSkillsWithMcp } from "./core/skills/skill-types.js";
export { defaultConfig, mergeConfig } from "./core/config/config-types.js";
export { stripJsonc, parseJsonc, loadConfig, validateConfig } from "./core/config/config-loader.js";
export { builtinHooks, getHookById, getEnabledHooks } from "./core/hooks/hook-types.js";
export { builtinMcpServers, getMcpByName, getEnabledMcpServers } from "./core/mcp/mcp-registry.js";