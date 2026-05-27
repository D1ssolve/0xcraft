/**
 * 0xcraft configuration schema — harness-agnostic.
 *
 * The OpenCode adapter maps this to the plugin's JSONC config system.
 * Other adapters (Codex, Claude Code) would map to their own config formats.
 */
export interface ZeroxCraftConfig {
  /** Which agents to enable (default: all) */
  enabledAgents?: string[];
  /** Which agents to disable */
  disabledAgents?: string[];
  /** Which skills to enable (default: all) */
  enabledSkills?: string[];
  /** Which skills to disable */
  disabledSkills?: string[];
  /** Which hooks to disable */
  disabledHooks?: string[];
  /** Model overrides per agent */
  modelOverrides?: Record<string, string>;
  /** Temperature overrides per agent */
  temperatureOverrides?: Record<string, number>;
  /** MCP servers to auto-configure */
  mcpServers?: Record<string, McpServerConfig>;
  /** Whether to inject AGENTS.md guard on session start */
  agentsGuardEnabled?: boolean;
  /** Whether to inject caveman bootstrap on session start */
  cavemanBootstrapEnabled?: boolean;
  /** Whether to inject git-worktree context on session start */
  gitWorktreeBootstrapEnabled?: boolean;
  /** Custom skill directories to scan (in addition to built-in skills) */
  customSkillPaths?: string[];
  /** Custom agent directories to scan */
  customAgentPaths?: string[];
}

export interface McpServerConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Default configuration values */
export const defaultConfig: Required<ZeroxCraftConfig> = {
  enabledAgents: [],
  disabledAgents: [],
  enabledSkills: [],
  disabledSkills: [],
  disabledHooks: [],
  modelOverrides: {},
  temperatureOverrides: {},
  mcpServers: {},
  agentsGuardEnabled: true,
  cavemanBootstrapEnabled: true,
  gitWorktreeBootstrapEnabled: true,
  customSkillPaths: [],
  customAgentPaths: [],
};

/**
 * Merge user config onto defaults.
 * Arrays are unioned (not replaced). Objects are deep-merged.
 */
export function mergeConfig(user: Partial<ZeroxCraftConfig>): Required<ZeroxCraftConfig> {
  return {
    enabledAgents: [...new Set([...defaultConfig.enabledAgents, ...(user.enabledAgents ?? [])])],
    disabledAgents: [...new Set([...defaultConfig.disabledAgents, ...(user.disabledAgents ?? [])])],
    enabledSkills: [...new Set([...defaultConfig.enabledSkills, ...(user.enabledSkills ?? [])])],
    disabledSkills: [...new Set([...defaultConfig.disabledSkills, ...(user.disabledSkills ?? [])])],
    disabledHooks: [...new Set([...defaultConfig.disabledHooks, ...(user.disabledHooks ?? [])])],
    modelOverrides: { ...defaultConfig.modelOverrides, ...user.modelOverrides },
    temperatureOverrides: { ...defaultConfig.temperatureOverrides, ...user.temperatureOverrides },
    mcpServers: { ...defaultConfig.mcpServers, ...user.mcpServers },
    agentsGuardEnabled: user.agentsGuardEnabled ?? defaultConfig.agentsGuardEnabled,
    cavemanBootstrapEnabled: user.cavemanBootstrapEnabled ?? defaultConfig.cavemanBootstrapEnabled,
    gitWorktreeBootstrapEnabled: user.gitWorktreeBootstrapEnabled ?? defaultConfig.gitWorktreeBootstrapEnabled,
    customSkillPaths: [...defaultConfig.customSkillPaths, ...(user.customSkillPaths ?? [])],
    customAgentPaths: [...defaultConfig.customAgentPaths, ...(user.customAgentPaths ?? [])],
  };
}