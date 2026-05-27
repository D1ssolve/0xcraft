import fs from "fs";
import type { ZeroxCraftConfig } from "../../../core/config";
import { builtinAgents } from "../../../core/agents";
import { builtinSkills } from "../../../core/skills";
import { builtinMcpServers } from "../../../core/mcp";

interface MarkdownAgentConfig {
  description?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  color?: string;
  permission?: Record<string, unknown>;
  prompt: string;
}

function readPrompt(root: string, promptFile: string): string {
  const content = fs.readFileSync(`${root}/${promptFile}`, "utf-8");
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + "\n---".length).trimStart();
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const numberValue = Number(value);
  if (value !== "" && Number.isFinite(numberValue)) return numberValue;
  return value.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  const lines = content.slice(3, end).trim().split("\n");
  let currentObjectKey: string | undefined;

  for (const line of lines) {
    if (line.trim() === "") continue;
    const nestedMatch = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (nestedMatch && currentObjectKey) {
      const nestedObject = frontmatter[currentObjectKey] as Record<string, unknown>;
      const nestedKey = nestedMatch[1];
      const nestedValue = nestedMatch[2];
      if (nestedKey === undefined || nestedValue === undefined) continue;
      nestedObject[nestedKey.trim()] = parseScalar(nestedValue.trim());
      continue;
    }

    const topLevelMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (!topLevelMatch) continue;

    const rawKey = topLevelMatch[1];
    const rawValue = topLevelMatch[2];
    if (rawKey === undefined || rawValue === undefined) continue;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (value === "") {
      frontmatter[key] = {};
      currentObjectKey = key;
      continue;
    }

    frontmatter[key] = parseScalar(value);
    currentObjectKey = undefined;
  }

  return { frontmatter, body: content.slice(end + "\n---".length).trimStart() };
}

function readMarkdownAgent(filePath: string): MarkdownAgentConfig {
  const content = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  return {
    ...(typeof frontmatter.description === "string" ? { description: frontmatter.description } : {}),
    ...(typeof frontmatter.mode === "string" ? { mode: frontmatter.mode } : {}),
    ...(typeof frontmatter.model === "string" ? { model: frontmatter.model } : {}),
    ...(typeof frontmatter.temperature === "number" ? { temperature: frontmatter.temperature } : {}),
    ...(typeof frontmatter.color === "string" ? { color: frontmatter.color } : {}),
    ...(typeof frontmatter.permission === "object" && frontmatter.permission !== null
      ? { permission: frontmatter.permission as Record<string, unknown> }
      : {}),
    prompt: body,
  };
}

function toOpenCodeMcp(server: {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}): Record<string, unknown> | null {
  if (server.type === "local" && server.command) {
    return {
      type: "local",
      command: server.command,
      ...(server.env ? { environment: server.env } : {}),
    };
  }

  if (server.type === "remote" && server.url) {
    return {
      type: "remote",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return null;
}

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

    // Ensure agent object exists
    if (!inputConfig.agent) inputConfig.agent = {};
    const agents = inputConfig.agent as Record<string, Record<string, unknown>>;

    for (const agent of enabledAgents) {
      const modelOverride = config.modelOverrides[agent.id];
      const tempOverride = config.temperatureOverrides[agent.id];

      agents[agent.id] = {
        ...(agents[agent.id] ?? {}),
        description: agent.description,
        mode: agent.mode,
        model: modelOverride ?? agent.model,
        temperature: tempOverride ?? agent.temperature,
        color: agent.color,
        permission: agent.permissions,
        prompt: readPrompt(root, agent.promptFile),
      };
    }

    for (const customPath of config.customAgentPaths) {
      if (!fs.existsSync(customPath)) continue;
      const entries = fs.readdirSync(customPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const agentId = entry.name.replace(/\.md$/, "");
        const agentPath = `${customPath}/${entry.name}`;
        agents[agentId] = {
          ...(agents[agentId] ?? {}),
          ...readMarkdownAgent(agentPath),
        };
      }
    }

    // Register skill paths
    const enabledSkills = builtinSkills.filter((skill) => {
      if (config.disabledSkills.includes(skill.id)) return false;
      if (config.enabledSkills.length > 0 && !config.enabledSkills.includes(skill.id)) return false;
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
      const mcpConfig = toOpenCodeMcp(mcpServer);
      if (mcpConfig) mcp[mcpServer.name] = mcpConfig;
    }
    // NOTE: skill-embedded MCPs (skill.mcpServers) are intentionally NOT registered here.
    // Per AGENTS.md invariant: "MCP on-demand — skill-embedded MCPs start only when
    // the skill is activated." Users who need a skill's MCP at startup should add it
    // explicitly to config.mcpServers.
    // Add user-configured MCP servers
    for (const [name, server] of Object.entries(config.mcpServers)) {
      const mcpConfig = toOpenCodeMcp(server);
      if (mcpConfig) mcp[name] = mcpConfig;
    }
  };
}
