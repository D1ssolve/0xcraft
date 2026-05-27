import type { Config } from "@opencode-ai/sdk";
import type { ZeroxCraftConfig } from "../../../core/config";
import { builtinAgents } from "../../../core/agents";
import { builtinSkills } from "../../../core/skills";
import { builtinMcpServers } from "../../../core/mcp";
import path from "path";
import fs from "fs";

/**
 * Creates the config hook handler.
 *
 * This hook registers all agents, skills, and MCP servers
 * with OpenCode on startup.
 */
export function createConfigHandler(args: {
  config: Required<ZeroxCraftConfig>;
  projectRoot: string;
}) {
  const { config, projectRoot } = args;

  return async (input: Config): Promise<void> => {
    // Register agents
    const enabledAgents = builtinAgents.filter((agent) => {
      if (config.disabledAgents.includes(agent.id)) return false;
      if (config.enabledAgents.length > 0 && !config.enabledAgents.includes(agent.id)) return false;
      return true;
    });

    for (const agent of enabledAgents) {
      const modelOverride = config.modelOverrides[agent.id];
      const tempOverride = config.temperatureOverrides[agent.id];

      // Resolve prompt file path
      const skillDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../skills");
      const agentDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../agents");

      // Register agent in OpenCode config
      // OpenCode's config hook allows adding agents, skills, and MCPs
      if (input.agents) {
        input.agents[agent.id] = {
          ...input.agents[agent.id],
          model: modelOverride ?? agent.model,
          temperature: tempOverride ?? agent.temperature,
        };
      }
    }

    // Register skill paths
    const enabledSkills = builtinSkills.filter((skill) => {
      if (config.disabledSkills.includes(skill.id)) return false;
      if (config.enabledSkills.length > 0 && !config.enabledSkills.includes(skill.id)) return true;
      return true;
    });

    if (input.skills) {
      input.skills.paths = input.skills.paths || [];
      for (const skill of enabledSkills) {
        const skillPath = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          `../../../../${skill.skillFile}`
        );
        const skillDir = path.dirname(skillPath);
        if (!input.skills.paths.includes(skillDir)) {
          input.skills.paths.push(skillDir);
        }
      }
      // Add custom skill paths
      for (const customPath of config.customSkillPaths) {
        if (!input.skills.paths.includes(customPath)) {
          input.skills.paths.push(customPath);
        }
      }
    }

    // Register MCP servers
    const enabledMcps = builtinMcpServers.filter((mcp) => {
      if (!mcp.enabledByDefault && !config.mcpServers[mcp.name]) return false;
      return true;
    });

    if (input.mcp) {
      for (const mcp of enabledMcps) {
        if (mcp.type === "local" && mcp.command) {
          input.mcp[mcp.name] = {
            type: "local",
            command: mcp.command,
          };
        } else if (mcp.type === "remote" && mcp.url) {
          input.mcp[mcp.name] = {
            type: "remote",
            url: mcp.url,
            ...(mcp.headers ? { headers: mcp.headers } : {}),
          };
        }
      }
      // Add user-configured MCP servers
      for (const [name, server] of Object.entries(config.mcpServers)) {
        if (!input.mcp[name]) {
          input.mcp[name] = server;
        }
      }
    }
  };
}