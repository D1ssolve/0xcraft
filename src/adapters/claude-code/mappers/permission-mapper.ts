import type { AgentPermissions, TaskPermissions } from "../../../core/agents/agent-types";

export type ClaudePermissionDiagnosticSeverity = "warning" | "error";

export interface ClaudePermissionDiagnostic {
  severity: ClaudePermissionDiagnosticSeverity;
  code: string;
  permission: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClaudePermissionMappingResult {
  disallowedTools: string[];
  diagnostics: ClaudePermissionDiagnostic[];
}

const unsupportedPermissionNames = new Set(["external_directory", "question", "todowrite", "todoread"]);

const knownPermissionNames = new Set([
  "bash",
  "edit",
  "external_directory",
  "question",
  "task",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
]);

export function mapAgentPermissionsToClaudeDisallowedTools(
  permissions: AgentPermissions | (AgentPermissions & Record<string, unknown>),
): ClaudePermissionMappingResult {
  const disallowedTools: string[] = [];
  const diagnostics: ClaudePermissionDiagnostic[] = [];

  if (permissions.edit === "deny" || permissions.write === "deny") {
    disallowedTools.push("Edit", "MultiEdit", "Write");
  }

  if (permissions.bash === "deny") disallowedTools.push("Bash");
  if (permissions.webfetch === "deny") disallowedTools.push("WebFetch");
  if (permissions.websearch === "deny") disallowedTools.push("WebSearch");

  if (permissions.task !== undefined) {
    mapTaskPermission(permissions.task, disallowedTools, diagnostics);
  }

  for (const permissionName of Object.keys(permissions)) {
    if (unsupportedPermissionNames.has(permissionName) || !knownPermissionNames.has(permissionName)) {
      diagnostics.push(createUnsupportedPermissionDiagnostic(permissionName));
    }
  }

  return { disallowedTools: dedupe(disallowedTools), diagnostics };
}

function mapTaskPermission(
  taskPermission: TaskPermissions,
  disallowedTools: string[],
  diagnostics: ClaudePermissionDiagnostic[],
): void {
  if (taskPermission === "deny") {
    disallowedTools.push("Task");
    return;
  }

  if (taskPermission === "allow") return;

  const entries = Object.entries(taskPermission);
  const allowedAgents = entries.filter(([, value]) => value === "allow").map(([agentId]) => agentId).sort();
  const deniedAgents = entries.filter(([, value]) => value === "deny").map(([agentId]) => agentId).sort();

  if (allowedAgents.length === 0 && deniedAgents.length > 0) {
    disallowedTools.push("Task");
    return;
  }

  diagnostics.push({
    severity: "warning",
    code: "claude-code.permission.task-routing-lossy",
    permission: "task",
    message:
      "Claude Code plugin agents cannot represent per-agent task routing; leaving Task available instead of applying unsafe coarse deny.",
    details: { allowedAgents, deniedAgents },
  });
}

function createUnsupportedPermissionDiagnostic(permissionName: string): ClaudePermissionDiagnostic {
  return {
    severity: "warning",
    code: "claude-code.permission.unsupported",
    permission: permissionName,
    message: `Claude Code permission mapper does not support ${permissionName}; no hidden behavior change applied.`,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
