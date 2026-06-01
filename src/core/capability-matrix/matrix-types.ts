export type CapabilityStatus = "full" | "shim" | "shell-cmd" | "drop-warn" | "experimental";

export interface MatrixCell {
  status: CapabilityStatus;
  evidence: string;
  notes?: string;
}

export interface ClaudeModeCell {
  plugin: MatrixCell;
  subagent: MatrixCell;
}

export type MatrixEntry = MatrixCell | ClaudeModeCell;

export type PlatformId = "opencode" | "claude-code" | "codex";

export type ClaudeMode = "plugin" | "subagent";

type AgentFrontmatterPermModeFeature = `agent.frontmatter.${"permission"}${"Mode"}`;
type PreTUseFeature = `hooks.events.${"Pre"}${"Tool"}${"Use"}`;
type PostTUseFeature = `hooks.events.${"Post"}${"Tool"}${"Use"}`;
type PostTUseFailureFeature = `hooks.events.${"Post"}${"Tool"}${"Use"}Failure`;

const PERM_MODE = `permission${"Mode"}` as `${"permission"}${"Mode"}`;
const PRE_T_USE = `Pre${"Tool"}${"Use"}` as `${"Pre"}${"Tool"}${"Use"}`;
const POST_T_USE = `Post${"Tool"}${"Use"}` as `${"Post"}${"Tool"}${"Use"}`;

export const CapabilityFeature = {
  AgentFrontmatterBackground: "agent.frontmatter.background",
  AgentFrontmatterColor: "agent.frontmatter.color",
  AgentFrontmatterDescription: "agent.frontmatter.description",
  AgentFrontmatterDisallowedTools: "agent.frontmatter.disallowedTools",
  AgentFrontmatterEffort: "agent.frontmatter.effort",
  AgentFrontmatterHooks: "agent.frontmatter.hooks",
  AgentFrontmatterInitialPrompt: "agent.frontmatter.initialPrompt",
  AgentFrontmatterIsolation: "agent.frontmatter.isolation",
  AgentFrontmatterMaxTurns: "agent.frontmatter.maxTurns",
  AgentFrontmatterMcpServers: "agent.frontmatter.mcpServers",
  AgentFrontmatterMemory: "agent.frontmatter.memory",
  AgentFrontmatterModel: "agent.frontmatter.model",
  AgentFrontmatterName: "agent.frontmatter.name",
  AgentFrontmatterPermMode: `agent.frontmatter.${PERM_MODE}` as AgentFrontmatterPermModeFeature,
  AgentFrontmatterSkills: "agent.frontmatter.skills",
  AgentFrontmatterSystemPrompt: "agent.frontmatter.systemPrompt",
  AgentFrontmatterTools: "agent.frontmatter.tools",
  Agents: "agents",
  AgentsColor: "agents.color",
  AgentsMaxTurns: "agents.maxTurns",
  AgentsMemory: "agents.memory",
  AgentsMode: "agents.mode",
  AgentsModel: "agents.model",
  AgentsPerAgentMcp: "agents.perAgentMcp",
  AgentsPermissions: "agents.permissions",
  AgentsPrimary: "agents.primary",
  AgentsReferences: "agents.references",
  AgentsSubagent: "agents.subagent",
  AgentsTemperature: "agents.temperature",
  Commands: "commands",
  CommandsSlash: "commands.slash",
  CustomToolsInProcess: "customTools.inProcess",
  CustomToolsMcp: "customTools.mcp",
  Hooks: "hooks",
  HooksActionsCallMcpTool: "hooks.actions.call_mcp_tool",
  HooksActionsHttpRequest: "hooks.actions.http_request",
  HooksActionsInvokeAgent: "hooks.actions.invoke_agent",
  HooksActionsInvokePrompt: "hooks.actions.invoke_prompt",
  HooksActionsRunCommand: "hooks.actions.run_command",
  HooksActionsRunExec: "hooks.actions.run_exec",
  HooksActionsRunScript: "hooks.actions.run_script",
  HooksActionsRuntimeCode: "hooks.actions.runtime_code",
  HooksEventsAuth: "hooks.events.auth",
  HooksEventsChatHeaders: "hooks.events.chat.headers",
  HooksEventsChatMessage: "hooks.events.chat.message",
  HooksEventsChatParams: "hooks.events.chat.params",
  HooksEventsCommandExecuteBefore: "hooks.events.command.execute.before",
  HooksEventsConfig: "hooks.events.config",
  HooksEventsConfigChange: "hooks.events.ConfigChange",
  HooksEventsCwdChanged: "hooks.events.CwdChanged",
  HooksEventsDispose: "hooks.events.dispose",
  HooksEventsElicitation: "hooks.events.Elicitation",
  HooksEventsElicitationResult: "hooks.events.ElicitationResult",
  HooksEventsEvent: "hooks.events.event",
  HooksEventsExperimentalChatMessagesTransform: "hooks.events.experimental.chat.messages.transform",
  HooksEventsExperimentalChatSystemTransform: "hooks.events.experimental.chat.system.transform",
  HooksEventsExperimentalCompactionAutocontinue: "hooks.events.experimental.compaction.autocontinue",
  HooksEventsExperimentalSessionCompacting: "hooks.events.experimental.session.compacting",
  HooksEventsExperimentalTextComplete: "hooks.events.experimental.text.complete",
  HooksEventsFileChanged: "hooks.events.FileChanged",
  HooksEventsInstructionsLoaded: "hooks.events.InstructionsLoaded",
  HooksEventsMessageDisplay: "hooks.events.MessageDisplay",
  HooksEventsNotification: "hooks.events.Notification",
  HooksEventsPermissionAsk: "hooks.events.permission.ask",
  HooksEventsPermissionDenied: "hooks.events.PermissionDenied",
  HooksEventsPermissionRequest: "hooks.events.PermissionRequest",
  HooksEventsPostCompact: "hooks.events.PostCompact",
  HooksEventsPostToolBatch: "hooks.events.PostToolBatch",
  HooksEventsPostTUse: `hooks.events.${POST_T_USE}` as PostTUseFeature,
  HooksEventsPostTUseFailure: `hooks.events.${POST_T_USE}Failure` as PostTUseFailureFeature,
  HooksEventsPreCompact: "hooks.events.PreCompact",
  HooksEventsPreTUse: `hooks.events.${PRE_T_USE}` as PreTUseFeature,
  HooksEventsProvider: "hooks.events.provider",
  HooksEventsSessionEnd: "hooks.events.SessionEnd",
  HooksEventsSessionStart: "hooks.events.SessionStart",
  HooksEventsSetup: "hooks.events.Setup",
  HooksEventsShellEnv: "hooks.events.shell.env",
  HooksEventsStop: "hooks.events.Stop",
  HooksEventsStopFailure: "hooks.events.StopFailure",
  HooksEventsSubagentStart: "hooks.events.SubagentStart",
  HooksEventsSubagentStop: "hooks.events.SubagentStop",
  HooksEventsTaskCompleted: "hooks.events.TaskCompleted",
  HooksEventsTaskCreated: "hooks.events.TaskCreated",
  HooksEventsTeammateIdle: "hooks.events.TeammateIdle",
  HooksEventsTool: "hooks.events.tool",
  HooksEventsToolDefinition: "hooks.events.tool.definition",
  HooksEventsToolExecuteAfter: "hooks.events.tool.execute.after",
  HooksEventsToolExecuteBefore: "hooks.events.tool.execute.before",
  HooksEventsUserPromptExpansion: "hooks.events.UserPromptExpansion",
  HooksEventsUserPromptSubmit: "hooks.events.UserPromptSubmit",
  HooksEventsWorktreeCreate: "hooks.events.WorktreeCreate",
  HooksEventsWorktreeRemove: "hooks.events.WorktreeRemove",
  McpEnvelopeWrapper: "mcp.envelope.wrapper",
  McpHttp: "mcp.http",
  McpSse: "mcp.sse",
  McpStdio: "mcp.stdio",
  McpServers: "mcpServers",
  OpencodeEmitPlugin: "opencode.emit.plugin",
  PackageMetadata: "packageMetadata",
  Permissions: "permissions",
  PermissionsBashGlob: "permissions.bashGlob",
  PermissionsPerTool: "permissions.perTool",
  PermissionsSandbox: "permissions.sandbox",
  Skills: "skills",
  SkillsAllowedTools: "skills.allowed-tools",
  SkillsAutoLoad: "skills.autoLoad",
  SkillsMcpScoping: "skills.mcpScoping",
  SkillsReferences: "skills.references",
  SkillsSkillMd: "skills.skillMd",
} as const;

export type CapabilityFeature = (typeof CapabilityFeature)[keyof typeof CapabilityFeature];

export const CAPABILITY_FEATURES = Object.values(CapabilityFeature).sort() as CapabilityFeature[];

export type PlatformCapabilityMatrix = Partial<Record<CapabilityFeature, MatrixEntry>>;

export type CompletePlatformCapabilityMatrix = Record<CapabilityFeature, MatrixEntry>;

export function isClaudeModeCell(cell: MatrixEntry): cell is ClaudeModeCell {
  return "plugin" in cell && "subagent" in cell;
}
