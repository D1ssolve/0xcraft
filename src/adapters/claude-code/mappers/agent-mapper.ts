import type { AgentDefinition } from "../../../core/agents/agent-types";
import { type ClaudeCodeAgentFrontmatter, claudeCodeAgentFrontmatterSchema } from "../types/claude-code-types";
import {
  mapAgentPermissionsToClaudeDisallowedTools,
  type ClaudePermissionDiagnostic,
} from "./permission-mapper";

export interface ClaudeCodeAgentMappingResult {
  frontmatter: ClaudeCodeAgentFrontmatter;
  body: string;
  diagnostics: ClaudePermissionDiagnostic[];
}

export function mapAgentToClaudeCodeAgent(agent: AgentDefinition, promptBody: string): ClaudeCodeAgentMappingResult {
  const permissionResult = mapAgentPermissionsToClaudeDisallowedTools(agent.permissions);
  const frontmatter = claudeCodeAgentFrontmatterSchema.parse({
    name: agent.id,
    description: agent.description,
    ...(isNonEmptyString(agent.model) ? { model: agent.model.trim() } : {}),
    ...(permissionResult.disallowedTools.length > 0 ? { disallowedTools: permissionResult.disallowedTools } : {}),
  });

  return {
    frontmatter,
    body: promptBody,
    diagnostics: permissionResult.diagnostics,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
