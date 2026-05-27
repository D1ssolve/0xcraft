/**
 * 0xcraft — Agent Operations Plugin
 *
 * Harness-agnostic core. Zero OpenCode dependencies.
 * The OpenCode adapter imports from here and wraps in plugin API.
 */
export { type AgentDefinition, type AgentPermissions, type TaskPermissions, resolveModel, builtinAgents, dualModeAgents, getAgentById, getPrimaryAgents, getSubagents } from "./agents";
export { type SkillDefinition, type McpServerConfig as SkillMcpServerConfig, builtinSkills, getSkillById, getSkillsByTag, getAutoLoadSkills, getSkillsWithMcp } from "./skills";
export { type ZeroxCraftConfig, type McpServerConfig, defaultConfig, mergeConfig } from "./config";
export { type HookDefinition, type HookType, builtinHooks, getHookById, getEnabledHooks } from "./hooks";
export { type McpRegistryEntry, builtinMcpServers, getMcpByName, getEnabledMcpServers } from "./mcp";