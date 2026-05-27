/**
 * Agent definition — harness-agnostic.
 *
 * Every field here is a plain data structure. The OpenCode adapter
 * (or a future Codex/Claude Code adapter) maps these to the
 * harness-specific agent registration API.
 */
export interface AgentDefinition {
  /** Unique kebab-case identifier (e.g. "team-lead") */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Short description for agent selection menus */
  description: string;
  /** Agent mode: "primary" | "subagent" | "all" */
  mode: "primary" | "subagent" | "all";
  /** Default model identifier (harness resolves to concrete provider/model) */
  model: string;
  /** Color theme hint for TUI */
  color: "accent" | "secondary" | "info" | "warning" | "success" | "error";
  /** Temperature for model calls */
  temperature: number;
  /** Permission overrides — harness maps to its own permission system */
  permissions: AgentPermissions;
  /** Path to the agent prompt file (relative to package root) */
  promptFile: string;
}

export interface AgentPermissions {
  question?: "allow" | "deny";
  websearch?: "allow" | "deny";
  webfetch?: "allow" | "deny";
  edit?: "allow" | "deny";
  write?: "allow" | "deny";
  bash?: "allow" | "deny";
  todowrite?: "allow" | "deny";
  todoread?: "allow" | "deny";
  task?: TaskPermissions;
  external_directory?: Record<string, "allow" | "deny">;
}

export type TaskPermissions =
  | "allow"
  | "deny"
  | { [agentId: string]: "allow" | "deny"; "*": "allow" | "deny" };

/**
 * Resolve an agent definition to a concrete model string.
 * Harness adapters override this with provider-specific resolution.
 */
export function resolveModel(agent: AgentDefinition, overrides?: Record<string, string>): string {
  if (overrides?.[agent.id]) return overrides[agent.id];
  return agent.model;
}