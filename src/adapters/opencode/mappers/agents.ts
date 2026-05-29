import fs from "fs";
import path from "path";
import type { AgentSpec } from "../../../core/agents";
import { parseFrontmatter } from "../../_shared/frontmatter";

export const SPEC_TEMPLATE_TOKEN = "{{SPEC_TEMPLATE_PATH}}";

export interface MapAgentToOpencodeInput {
  agent: AgentSpec;
  prompt: string;
  modelOverride?: string;
  permission: Record<string, unknown>;
}

export interface OpencodeAgentEntry {
  description?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  color?: string;
  permission: Record<string, unknown>;
  prompt: string;
}

export interface MarkdownAgentConfig extends Omit<OpencodeAgentEntry, "permission"> {
  permission?: Record<string, unknown>;
}

export function mapAgentToOpencode(input: MapAgentToOpencodeInput): OpencodeAgentEntry {
  const { agent, prompt, modelOverride, permission } = input;

  return {
    ...(agent.description !== undefined ? { description: agent.description } : {}),
    ...(agent.mode !== undefined ? { mode: agent.mode } : {}),
    ...(modelOverride ?? agent.model ? { model: modelOverride ?? agent.model } : {}),
    ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
    ...(agent.color !== undefined ? { color: agent.color } : {}),
    permission,
    prompt,
  };
}

export function readMarkdownAgent(filePath: string): MarkdownAgentConfig {
  const content = fs.readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(content);
  return {
    ...(typeof meta.description === "string" ? { description: meta.description } : {}),
    ...(typeof meta.mode === "string" ? { mode: meta.mode } : {}),
    ...(typeof meta.model === "string" ? { model: meta.model } : {}),
    ...(typeof meta.temperature === "number" ? { temperature: meta.temperature } : {}),
    ...(typeof meta.color === "string" ? { color: meta.color } : {}),
    ...(typeof meta.permission === "object" && meta.permission !== null && !Array.isArray(meta.permission)
      ? { permission: meta.permission as Record<string, unknown> }
      : {}),
    prompt: body,
  };
}

export function resolvePromptTokens(prompt: string, root: string): string {
  if (!prompt.includes(SPEC_TEMPLATE_TOKEN)) return prompt;
  const specTemplatePath = path.resolve(root, "templates", "spec-template.md");
  return prompt.replaceAll(SPEC_TEMPLATE_TOKEN, specTemplatePath);
}

/**
 * Resolve `external_directory` glob patterns against the package root.
 * Patterns starting with `~` or absolute paths are passed through.
 */
export function resolveExternalDirectory(
  permissions: Record<string, unknown>,
  root: string,
): Record<string, unknown> {
  const ext = permissions.external_directory;
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return permissions;

  const resolved: Record<string, "allow" | "deny"> = {};
  for (const [pattern, access] of Object.entries(ext as Record<string, "allow" | "deny">)) {
    const resolvedPattern =
      pattern.startsWith("~") || path.isAbsolute(pattern) ? pattern : path.resolve(root, pattern);
    resolved[resolvedPattern] = access;
  }

  return { ...permissions, external_directory: resolved };
}
