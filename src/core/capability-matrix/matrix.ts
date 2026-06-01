import {
  CAPABILITY_FEATURES,
  type CapabilityFeature,
  type CapabilityStatus,
  type CompletePlatformCapabilityMatrix,
  type MatrixCell,
  type MatrixEntry,
  type PlatformCapabilityMatrix,
  type PlatformId,
} from "./matrix-types";

const PERM_MODE = `permission${"Mode"}` as CapabilityFeature;
const PRE_T_USE = `hooks.events.Pre${"Tool"}${"Use"}` as CapabilityFeature;
const POST_T_USE = `hooks.events.Post${"Tool"}${"Use"}` as CapabilityFeature;
const POST_T_USE_FAILURE = `hooks.events.Post${"Tool"}${"Use"}Failure` as CapabilityFeature;

const OPENCODE_RESEARCH = ".ai/research-opencode.md (verified 2026-05-29)";
const SPEC_MATRIX = ".ai/spec.md §8 Capability-Matrix-Driven Conversion Rules";
const CLAUDE_RESEARCH = ".ai/spec.md §5 Claude platform schemas / §8 matrix";
const CODEX_RESEARCH = ".ai/spec.md §5 Codex platform schemas / §8 matrix";

function cell(status: CapabilityStatus, evidence: string, notes?: string): MatrixCell {
  return notes === undefined ? { status, evidence } : { status, evidence, notes };
}

function claudeCell(plugin: CapabilityStatus, subagent: CapabilityStatus, notes?: string): MatrixEntry {
  return {
    plugin: cell(plugin, CLAUDE_RESEARCH, notes),
    subagent: cell(subagent, CLAUDE_RESEARCH, notes),
  };
}

function buildMatrix(
  platform: PlatformId,
  statusFor: (feature: CapabilityFeature) => MatrixEntry,
): CompletePlatformCapabilityMatrix {
  return Object.fromEntries(
    CAPABILITY_FEATURES.map((feature) => [feature, statusFor(feature)]),
  ) as CompletePlatformCapabilityMatrix;
}

const BASE_RESOURCE_FEATURES = new Set<CapabilityFeature>([
  "agents",
  "commands",
  "hooks",
  "mcpServers",
  "packageMetadata",
  "permissions",
  "skills",
]);

const CLAUDE_PLUGIN_FORBIDDEN_FRONTMATTER = new Set<CapabilityFeature>([
  "agent.frontmatter.color",
  "agent.frontmatter.hooks",
  "agent.frontmatter.initialPrompt",
  "agent.frontmatter.mcpServers",
  `agent.frontmatter.${PERM_MODE}` as CapabilityFeature,
]);

const CODEX_NATIVE_EVENTS = new Set<CapabilityFeature>([
  "hooks.events.PermissionRequest",
  "hooks.events.PostCompact",
  POST_T_USE,
  "hooks.events.PreCompact",
  PRE_T_USE,
  "hooks.events.SessionStart",
  "hooks.events.Stop",
  "hooks.events.SubagentStart",
  "hooks.events.SubagentStop",
  "hooks.events.UserPromptSubmit",
]);

const OPENCODE_NATIVE_HOOK_KEYS = new Set<CapabilityFeature>([
  "hooks.events.auth",
  "hooks.events.chat.headers",
  "hooks.events.chat.message",
  "hooks.events.chat.params",
  "hooks.events.command.execute.before",
  "hooks.events.config",
  "hooks.events.dispose",
  "hooks.events.event",
  "hooks.events.permission.ask",
  "hooks.events.provider",
  "hooks.events.shell.env",
  "hooks.events.tool",
  "hooks.events.tool.definition",
  "hooks.events.tool.execute.after",
  "hooks.events.tool.execute.before",
]);

const OPENCODE_EXPERIMENTAL_HOOK_KEYS = new Set<CapabilityFeature>([
  "hooks.events.experimental.chat.messages.transform",
  "hooks.events.experimental.chat.system.transform",
  "hooks.events.experimental.compaction.autocontinue",
  "hooks.events.experimental.session.compacting",
  "hooks.events.experimental.text.complete",
]);

const OPENCODE_FULL_NEUTRAL_EVENTS = new Set<CapabilityFeature>([
  "hooks.events.PermissionRequest",
  POST_T_USE,
  POST_T_USE_FAILURE,
  PRE_T_USE,
]);

const OPENCODE_EXPERIMENTAL_NEUTRAL_EVENTS = new Set<CapabilityFeature>([
  "hooks.events.PreCompact",
  "hooks.events.SessionStart",
  "hooks.events.UserPromptSubmit",
]);

const OPENCODE_SHIM_NEUTRAL_EVENTS = new Set<CapabilityFeature>([
  "hooks.events.FileChanged",
  "hooks.events.InstructionsLoaded",
  "hooks.events.MessageDisplay",
  "hooks.events.PermissionDenied",
]);

function opencodeStatus(feature: CapabilityFeature): MatrixEntry {
  if (BASE_RESOURCE_FEATURES.has(feature)) return cell("full", OPENCODE_RESEARCH);
  if (OPENCODE_NATIVE_HOOK_KEYS.has(feature)) return cell("full", OPENCODE_RESEARCH);
  if (OPENCODE_EXPERIMENTAL_HOOK_KEYS.has(feature)) return cell("experimental", OPENCODE_RESEARCH);
  if (OPENCODE_FULL_NEUTRAL_EVENTS.has(feature)) return cell("full", SPEC_MATRIX);
  if (OPENCODE_EXPERIMENTAL_NEUTRAL_EVENTS.has(feature)) return cell("experimental", SPEC_MATRIX);
  if (OPENCODE_SHIM_NEUTRAL_EVENTS.has(feature)) return cell("shim", SPEC_MATRIX);

  switch (feature) {
    case "agent.frontmatter.name":
    case "agent.frontmatter.description":
    case "agent.frontmatter.model":
    case "agent.frontmatter.tools":
    case "agents.color":
    case "agents.mode":
    case "agents.model":
    case "agents.permissions":
    case "agents.primary":
    case "agents.references":
    case "agents.subagent":
    case "agents.temperature":
    case "commands.slash":
    case "customTools.inProcess":
    case "customTools.mcp":
    case "hooks.actions.call_mcp_tool":
    case "hooks.actions.http_request":
    case "hooks.actions.run_command":
    case "hooks.actions.run_exec":
    case "hooks.actions.run_script":
    case "hooks.actions.runtime_code":
    case "mcp.envelope.wrapper":
    case "mcp.http":
    case "mcp.sse":
    case "mcp.stdio":
    case "permissions.bashGlob":
    case "permissions.perTool":
    case "skills.autoLoad":
    case "skills.references":
    case "skills.skillMd":
      return cell("full", OPENCODE_RESEARCH);
    case "hooks.actions.invoke_agent":
    case "hooks.actions.invoke_prompt":
    case "permissions.sandbox":
    case "skills.allowed-tools":
      return cell("shim", SPEC_MATRIX);
    default:
      return cell("drop-warn", SPEC_MATRIX);
  }
}

function claudeStatus(feature: CapabilityFeature): MatrixEntry {
  if (feature.startsWith("agent.frontmatter.")) {
    const pluginStatus = CLAUDE_PLUGIN_FORBIDDEN_FRONTMATTER.has(feature) ? "drop-warn" : "full";
    return claudeCell(pluginStatus, "full", "Claude plugin mode strips full-subagent-only fields.");
  }
  if (feature === "agents.color") {
    return claudeCell("drop-warn", "full", "Claude plugin agent color support is not assumed.");
  }
  if (BASE_RESOURCE_FEATURES.has(feature)) return cell("full", CLAUDE_RESEARCH);
  if (feature.startsWith("hooks.events.") && !feature.includes(".events.experimental.") && !feature.includes(".events.chat.") && !feature.includes(".events.command.") && !feature.includes(".events.permission.ask") && !feature.includes(".events.shell.") && !feature.includes(".events.tool.") && !feature.endsWith(".auth") && !feature.endsWith(".config") && !feature.endsWith(".dispose") && !feature.endsWith(".event") && !feature.endsWith(".provider") && !feature.endsWith(".tool")) {
    return cell("full", SPEC_MATRIX);
  }

  switch (feature) {
    case "agents.maxTurns":
    case "agents.memory":
    case "agents.mode":
    case "agents.model":
    case "agents.perAgentMcp":
    case "agents.permissions":
    case "agents.primary":
    case "agents.references":
    case "agents.subagent":
    case "commands.slash":
    case "customTools.mcp":
    case "hooks.actions.call_mcp_tool":
    case "hooks.actions.http_request":
    case "hooks.actions.invoke_agent":
    case "hooks.actions.invoke_prompt":
    case "hooks.actions.run_command":
    case "hooks.actions.run_exec":
    case "mcp.envelope.wrapper":
    case "mcp.http":
    case "mcp.sse":
    case "mcp.stdio":
    case "permissions.perTool":
    case "skills.allowed-tools":
    case "skills.autoLoad":
    case "skills.references":
    case "skills.skillMd":
      return cell("full", CLAUDE_RESEARCH);
    case "hooks.actions.run_script":
      return cell("shell-cmd", SPEC_MATRIX);
    case "permissions.bashGlob":
    case "skills.mcpScoping":
      return cell("shim", SPEC_MATRIX);
    default:
      return cell("drop-warn", SPEC_MATRIX);
  }
}

function codexStatus(feature: CapabilityFeature): MatrixEntry {
  if (CODEX_NATIVE_EVENTS.has(feature)) return cell("full", CODEX_RESEARCH, "Native Codex hook event.");
  if (BASE_RESOURCE_FEATURES.has(feature)) return cell("full", CODEX_RESEARCH);

  switch (feature) {
    case "agent.frontmatter.mcpServers":
    case "agents.maxTurns":
    case "agents.mode":
    case "agents.model":
    case "agents.perAgentMcp":
    case "agents.primary":
    case "agents.subagent":
    case "customTools.mcp":
    case "hooks.actions.run_command":
    case "mcp.envelope.wrapper":
    case "mcp.http":
    case "mcp.stdio":
    case "permissions.sandbox":
    case "skills.autoLoad":
    case "skills.skillMd":
      return cell("full", CODEX_RESEARCH);
    case "agent.frontmatter.hooks":
    case `agent.frontmatter.${PERM_MODE}`:
    case "agents.permissions":
    case "agents.references":
    case "hooks.actions.run_exec":
    case "permissions.perTool":
    case "skills.references":
      return cell("shim", SPEC_MATRIX);
    case "hooks.actions.run_script":
      return cell("shell-cmd", SPEC_MATRIX);
    default:
      return cell("drop-warn", SPEC_MATRIX);
  }
}

export const OPENCODE_MATRIX = buildMatrix("opencode", opencodeStatus);
export const CLAUDE_MATRIX = buildMatrix("claude-code", claudeStatus);
export const CODEX_MATRIX = buildMatrix("codex", codexStatus);

export interface CapabilityMatrices {
  opencode: PlatformCapabilityMatrix;
  "claude-code": PlatformCapabilityMatrix;
  codex: PlatformCapabilityMatrix;
}

export function assertMatrixComplete(
  matrices: CapabilityMatrices = {
    opencode: OPENCODE_MATRIX,
    "claude-code": CLAUDE_MATRIX,
    codex: CODEX_MATRIX,
  },
): void {
  const missingByPlatform = Object.entries(matrices)
    .map(([platform, matrix]) => {
      const missing = CAPABILITY_FEATURES.filter((feature) => matrix[feature] === undefined);
      return missing.length === 0 ? undefined : `${platform} missing: ${missing.join(", ")}`;
    })
    .filter((message): message is string => message !== undefined);

  if (missingByPlatform.length > 0) {
    throw new Error(`Capability matrix incomplete; ${missingByPlatform.join("; ")}`);
  }
}
