/**
 * Agent specification — harness-agnostic.
 *
 * Plain data structures. Each platform adapter (OpenCode, Claude Code,
 * Codex) maps these onto its native agent registration API.
 */

import type { PermissionSpec } from "../permission/permission-spec";

/* ---------------------------------------------------------------- */
/*  AgentSpec                                                         */
/* ---------------------------------------------------------------- */

export type AgentMode = "primary" | "subagent" | "all";

export interface AgentSpec {
  /** Unique kebab-case identifier (e.g. "team-lead") */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Short description for agent selection menus */
  description: string;
  /** Agent mode: "primary" | "subagent" | "all". */
  mode: AgentMode;
  /** Default model identifier (harness resolves to concrete provider/model) */
  model: string;
  /** Color theme hint for TUI */
  color: "accent" | "secondary" | "info" | "warning" | "success" | "error";
  /** Temperature for model calls (optional; some harnesses drop) */
  temperature?: number;
  /**
   * Canonical permission shape (singular). Adapters map to native
   * permission systems. See spec §7.
   */
  permission?: PermissionSpec;
  /** Path to the agent prompt file (relative to package root) */
  promptFile: string;
  /**
   * Optional per-agent MCP server scoping. When set, harness adapters
   * with native per-agent MCP scoping (Claude Code, Codex) emit the list;
   * adapters without native support (OpenCode) drop with a diagnostic.
   * Driven by the `perAgentMcpScoping` capability cell.
   */
  mcpServers?: string[];
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

/**
 * Resolve an agent spec to a concrete model string.
 * Harness adapters override this with provider-specific resolution.
 */
export function resolveModel(agent: AgentSpec, overrides?: Record<string, string>): string {
  const override = overrides?.[agent.id];
  if (override !== undefined) return override;
  return agent.model;
}
