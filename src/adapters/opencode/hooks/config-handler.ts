import type { ZeroxCraftConfig } from "../../../core/config";
import { builtinAgents } from "../../../core/agents";
import { builtinSkills } from "../../../core/skills";
import { builtinMcpServers } from "../../../core/mcp";

/**
 * Creates the config hook handler.
 *
 * This hook registers all agents, skills, and MCP servers
 * with OpenCode on startup.
 *
 * The OpenCode config hook receives a mutable config object.
 * We mutate it directly to add agents, skills, and MCPs.
 * This matches how oh-my-openagent handles it.
 */
export function createConfigHandler(args: {
  config: Required<ZeroxCraftConfig>;
  projectRoot: string;
  pkgRoot?: string;
}) {
  const { config, projectRoot, pkgRoot } = args;
  const root = pkgRoot ?? projectRoot;

  return async (inputConfig: Record<string, unknown>): Promise<void> => {
    // Register agents
    const enabledAgents = builtinAgents.filter((agent) => {
      if (config.disabledAgents.includes(agent.id)) return false;
      if (config.enabledAgents.length > 0 && !config.enabledAgents.includes(agent.id)) return false;
      return true;
    });

    // Ensure agents object exists
    if (!inputConfig.agents) inputConfig.agents = {};
    const agents = inputConfig.agents as Record<string, Record<string, unknown>>;

    for (const agent of enabledAgents) {
      const modelOverride = config.modelOverrides[agent.id];
      const tempOverride = config.temperatureOverrides[agent.id];

      agents[agent.id] = {
        ...(agents[agent.id] ?? {}),
        model: modelOverride ?? agent.model,
        temperature: tempOverride ?? agent.temperature,
      };
    }

    // Register skill paths
    const enabledSkills = builtinSkills.filter((skill) => {
      if (config.disabledSkills.includes(skill.id)) return false;
      if (config.enabledSkills.length > 0 && !config.enabledSkills.includes(skill.id)) return true;
      return true;
    });

    if (!inputConfig.skills) inputConfig.skills = {};
    const skills = inputConfig.skills as Record<string, unknown>;
    if (!Array.isArray(skills.paths)) skills.paths = [];
    const skillPaths = skills.paths as string[];

    for (const skill of enabledSkills) {
      const skillDir = `${root}/${skill.skillFile.replace(/\/SKILL\.md$/, "")}`;
      if (!skillPaths.includes(skillDir)) {
        skillPaths.push(skillDir);
      }
    }
    // Add custom skill paths
    for (const customPath of config.customSkillPaths) {
      if (!skillPaths.includes(customPath)) {
        skillPaths.push(customPath);
      }
    }

    // Register MCP servers
    const enabledMcps = builtinMcpServers.filter((mcp) => {
      if (!mcp.enabledByDefault && !config.mcpServers[mcp.name]) return false;
      return true;
    });

    if (!inputConfig.mcp) inputConfig.mcp = {};
    const mcp = inputConfig.mcp as Record<string, Record<string, unknown>>;

    for (const mcpServer of enabledMcps) {
      if (mcpServer.type === "local" && mcpServer.command) {
        mcp[mcpServer.name] = {
          type: "local",
          command: mcpServer.command,
        };
      } else if (mcpServer.type === "remote" && mcpServer.url) {
        mcp[mcpServer.name] = {
          type: "remote",
          url: mcpServer.url,
          ...(mcpServer.headers ? { headers: mcpServer.headers } : {}),
        };
      }
    }
    // Add user-configured MCP servers
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (!mcp[name]) {
        mcp[name] = server as unknown as Record<string, unknown>;
      }
    }
  };
}