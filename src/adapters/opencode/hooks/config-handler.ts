import fs from "fs";
import type { ZeroxCraftConfig } from "../../../core/config";
import { builtinAgents } from "../../../core/agents";
import { builtinSkills } from "../../../core/skills";
import { builtinMcpServers } from "../../../core/mcp";
import { extractPromptBody } from "../../_shared/prompt-body";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import {
  mapAgentToOpencode,
  readMarkdownAgent,
  resolveExternalDirectory,
  resolvePromptTokens,
} from "../mappers/agents";
import { mapMcpServersToOpencode } from "../mappers/mcp";
import { mapPermissions } from "../mappers/permissions";
import { mapSkillsToOpencode, selectEnabledSkills } from "../mappers/skills";

function ensureRecord(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    config[key] = {};
  }

  return config[key] as Record<string, unknown>;
}

/**
 * Creates the config hook handler.
 *
 * Registers all built-in agents, skills, and MCP servers with OpenCode
 * on startup. Mutates the inputConfig directly.
 *
 * Per-agent model overrides come from `modelOverrides` plus optional
 * platform override `platformModelOverrides.opencode`. Skills are
 * filtered by `disabled.skills`/`enabled.skills`. Agent permissions
 * consume the canonical `PermissionSpec` and are mapped to OpenCode's
 * flat `PermissionConfig` via `mapPermissions` (T-12.6).
 */
export function createConfigHandler(args: {
  config: ZeroxCraftConfig;
  projectRoot: string;
  pkgRoot?: string;
}) {
  const { config, projectRoot, pkgRoot } = args;
  const root = pkgRoot ?? projectRoot;
  const platformOverrides = config.platformModelOverrides?.opencode ?? {};

  return async (inputConfig: Record<string, unknown>): Promise<void> => {
    // Ensure agent object exists (normalises malformed shapes).
    const agents = ensureRecord(inputConfig, "agent") as Record<string, Record<string, unknown>>;

    for (const agent of builtinAgents) {
      const modelOverride = platformOverrides[agent.id] ?? config.modelOverrides[agent.id];
      const prompt = resolvePromptTokens(extractPromptBody(`${root}/${agent.promptFile}`), root);
      const collector = new DiagnosticCollector();
      const mapped = agent.permission
        ? mapPermissions(agent.permission, collector)
        : {};
      const permission = resolveExternalDirectory(mapped, root);

      agents[agent.id] = {
        ...(agents[agent.id] ?? {}),
        ...mapAgentToOpencode({ agent, prompt, modelOverride, permission }),
      };
    }

    for (const customPath of config.customPaths.agents) {
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

    const enabledSkills = selectEnabledSkills(builtinSkills, config);

    const skills = ensureRecord(inputConfig, "skills");
    if (!Array.isArray(skills.paths)) skills.paths = [];
    const skillPaths = skills.paths as string[];

    for (const skillPath of mapSkillsToOpencode({ skills: enabledSkills, packageRoot: root }).paths) {
      if (!skillPaths.includes(skillPath)) {
        skillPaths.push(skillPath);
      }
    }

    const mcp = ensureRecord(inputConfig, "mcp") as Record<string, Record<string, unknown>>;
    for (const [name, mcpConfig] of Object.entries(mapMcpServersToOpencode({ builtins: builtinMcpServers, config }))) {
      mcp[name] = mcpConfig;
    }
  };
}
