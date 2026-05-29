import type { AgentSpec } from "../../../core/agents";
import type { PermissionSpec } from "../../../core/permission/permission-spec";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { Diagnostic } from "../../../core/diagnostics/diagnostic";
import { CLAUDE_CODE_MATRIX } from "../../_shared/capability-matrix";
import { type ClaudeCodeAgentFrontmatter, claudeCodeAgentFrontmatterSchema } from "../types/claude-code-types";
import { mapPermissions } from "./permissions";

/**
 * Legacy diagnostic shape preserved for downstream consumers
 * (generators/agents.ts re-exports it). Severity uses the legacy
 * "warning" string; canonical `Diagnostic.severity` is "warn".
 */
export type ClaudePermissionDiagnosticSeverity = "warning" | "error";
export interface ClaudePermissionDiagnostic {
  severity: ClaudePermissionDiagnosticSeverity;
  code: string;
  permission: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClaudeCodeAgentMappingResult {
  frontmatter: ClaudeCodeAgentFrontmatter;
  body: string;
  diagnostics: ClaudePermissionDiagnostic[];
}

export interface ClaudeCodeAgentMappingOptions {
  /**
   * Claude Code plugin-mode subagents silently ignore `hooks`, `mcpServers`,
   * and `permissionMode` fields at runtime. The whole `generateClaudeCodePlugin`
   * pipeline emits plugin-mode artifacts, so this flag defaults to `true`.
   * Pass `false` to suppress the silencing diagnostic in tests or in a future
   * non-plugin emission pathway.
   */
  pluginMode?: boolean;
}

/**
 * Forward-compatible view of `AgentSpec` for `mcpServers`,
 * `permissionMode`, `hooks` plumbing (pre core-type-extension).
 */
type AgentSpecForward = AgentSpec & {
  mcpServers?: unknown;
  permissionMode?: string;
  hooks?: Record<string, unknown>;
};

const DEFAULT_PERMISSION_SPEC: PermissionSpec = {
  sandbox: "workspace-write",
  tools: {},
  bash: {},
};

export function mapAgentToClaudeCodeAgent(
  agent: AgentSpec,
  promptBody: string,
  options: ClaudeCodeAgentMappingOptions = {},
): ClaudeCodeAgentMappingResult {
  const pluginMode = options.pluginMode ?? true;
  const forwardAgent = agent as AgentSpecForward;

  const collector = new DiagnosticCollector();
  const spec = agent.permission ?? DEFAULT_PERMISSION_SPEC;
  const permissionResult = mapPermissions(spec, collector);
  const diagnostics: ClaudePermissionDiagnostic[] = [
    ...collector.getAll().map(toLegacyDiagnostic),
  ];

  // agents.temperature: CLAUDE_CODE_MATRIX === "drop-warn" — emit diagnostic, never write field.
  const temperatureStatus = CLAUDE_CODE_MATRIX["agents.temperature"].status;
  if (temperatureStatus === "drop-warn" && typeof agent.temperature === "number") {
    diagnostics.push({
      severity: "warning",
      code: "claude-code.capability.agent_temperature.dropped",
      permission: "agentTemperature",
      message:
        "Claude Code sub-agent frontmatter has no temperature field; AgentSpec.temperature is dropped.",
      details: { temperature: agent.temperature },
    });
  }

  // agents.color: CLAUDE_CODE_MATRIX === "full" — emit when set, no diagnostic.
  const colorStatus = CLAUDE_CODE_MATRIX["agents.color"].status;
  const colorField =
    colorStatus !== "drop-warn" && isNonEmptyString(agent.color) ? { color: agent.color.trim() } : {};

  // agents.perAgentMcp: CLAUDE_CODE_MATRIX === "full" — plumbing only.
  const mcpScopingStatus = CLAUDE_CODE_MATRIX["agents.perAgentMcp"].status;
  const mcpServers = extractMcpServerIds(forwardAgent.mcpServers);
  const mcpServersField =
    mcpScopingStatus !== "drop-warn" && mcpServers.length > 0 ? { mcpServers } : {};
  const mcpServersPresent = forwardAgent.mcpServers !== undefined;

  // Plugin-mode silencing diagnostic.
  if (pluginMode) {
    const silenced: string[] = [];
    if (mcpServersPresent) silenced.push("mcpServers");
    if (forwardAgent.permissionMode !== undefined) silenced.push("permissionMode");
    if (forwardAgent.hooks !== undefined) silenced.push("hooks");
    if (silenced.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "claude-code.capability.plugin_mode_silencing",
        permission: "pluginMode",
        message: `Claude Code plugin-mode sub-agents silently ignore: ${silenced.join(", ")}.`,
        details: { silenced, agentId: agent.id },
      });
    }
  }

  const frontmatter = claudeCodeAgentFrontmatterSchema.parse({
    name: agent.id,
    description: agent.description,
    ...(isNonEmptyString(agent.model) ? { model: agent.model.trim() } : {}),
    ...colorField,
    ...(permissionResult.disallowedTools.length > 0
      ? { disallowedTools: permissionResult.disallowedTools }
      : {}),
    ...mcpServersField,
  });

  return {
    frontmatter,
    body: promptBody,
    diagnostics,
  };
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

/**
 * Adapt a canonical `Diagnostic` to the legacy
 * `ClaudePermissionDiagnostic` shape for downstream consumers.
 * Maps "warn" → "warning", "info" → "warning" (legacy has no info
 * channel; info is preserved as a warning so it surfaces in tooling).
 * The `permission` field is best-effort extracted from `details`.
 */
function toLegacyDiagnostic(d: Diagnostic): ClaudePermissionDiagnostic {
  const severity: ClaudePermissionDiagnosticSeverity = d.severity === "error" ? "error" : "warning";
  const permission =
    typeof d.details?.permission === "string"
      ? (d.details.permission as string)
      : typeof d.details?.tool === "string"
        ? (d.details.tool as string)
        : "";
  return {
    severity,
    code: d.code,
    permission,
    message: d.message,
    ...(d.details ? { details: d.details } : {}),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractMcpServerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
