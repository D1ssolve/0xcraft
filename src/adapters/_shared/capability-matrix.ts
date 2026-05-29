/**
 * Capability matrix — spec §11 / ADR §7. Single source of truth for what
 * each platform supports and how degraded support is surfaced.
 *
 * Types come from `core/diagnostics`:
 *   - `CapabilityFeature` — 37-key taxonomy (spec §11's 36 keys + the
 *     `hooks.shellEnvironment` key added to close adr-review Finding 1
 *     for OpenCode's `shell.environment` hook).
 *   - `CapabilityStatus`  — `full | shim | shell-cmd | drop-warn | experimental`.
 *
 * Cell shape: `{ status, evidence?, diagnostics }`. This module is the
 * single source of truth — no transitional legacy re-exports.
 */

import {
  type CapabilityFeature,
  type CapabilityStatus,
  type CapabilityCell,
  type CapabilityReport,
  type PlatformId,
  CAPABILITY_FEATURES,
} from "../../core/diagnostics";

export {
  type CapabilityFeature,
  type CapabilityStatus,
  type CapabilityCell,
  type CapabilityReport,
  type PlatformId,
};

/* ---------------------------------------------------------------- */
/*  Canonical shapes                                                 */
/* ---------------------------------------------------------------- */

/**
 * Platform capability matrix — every `CapabilityFeature` key MUST have a
 * cell. Enforced at runtime by `assertMatrixComplete` and at the type
 * level by `Record<CapabilityFeature, CapabilityCell>`.
 */
export type PlatformCapabilityMatrix = Record<CapabilityFeature, CapabilityCell>;

/** Concrete tuple — same order as `CapabilityFeature` union. */
export const ALL_CAPABILITY_FEATURES: readonly CapabilityFeature[] = CAPABILITY_FEATURES;

/* ---------------------------------------------------------------- */
/*  Evidence URLs (kept in one place so cells stay legible)          */
/* ---------------------------------------------------------------- */

// Single shared evidence anchor for ADR Rev 2 §4 verification work. Cells
// without a more specific URL reference this as their provenance.
const ADR_REV2 = "ADR Rev 2 §4 (verified 2026-05-28)";

const OPENCODE_PLUGIN_DTS =
  "@opencode-ai/plugin@1.15.11 .d.ts (verified 2026-05-28)";
const OPENCODE_EXPERIMENTAL =
  "@opencode-ai/plugin experimental.chat.messages.transform (verified 2026-05-28)";

const CLAUDE_CODE_HOOKS_DOCS =
  "https://docs.claude.com/en/docs/claude-code/hooks (verified 2026-05-28)";
const CLAUDE_CODE_POSTCOMPACT_DOCS =
  "https://docs.anthropic.com/en/docs/claude-code/hooks#postcompact (verified 2026-05-29)";
const CLAUDE_CODE_PLUGIN_DOCS =
  "https://docs.claude.com/en/docs/claude-code/plugins (verified 2026-05-28)";

const CODEX_CONFIG_DOCS =
  ".ai/research.md §Codex config (verified 2026-05-29); https://developers.openai.com/codex/config-reference";
const CODEX_RESEARCH = ".ai/research.md §Codex (verified 2026-05-29)";
const CODEX_CONFIG_REFERENCE_DOCS =
  ".ai/research.md §Codex (verified 2026-05-29); https://developers.openai.com/codex/config-reference";
const CODEX_HOOKS_DOCS =
  ".ai/research.md §Codex hooks (verified 2026-05-29); https://developers.openai.com/codex/hooks";
const CODEX_SUBAGENTS_DOCS =
  ".ai/research.md §Codex subagents (verified 2026-05-29); https://developers.openai.com/codex/subagents";
const CODEX_SKILLS_DOCS =
  ".ai/research.md §Codex skills (verified 2026-05-29); https://developers.openai.com/codex/skills";
const CODEX_PERMISSIONS_DOCS =
  ".ai/research.md §Codex permissions (verified 2026-05-29); https://developers.openai.com/codex/permissions";
const CODEX_SLASH_COMMANDS_DOCS =
  ".ai/research.md §Codex slash commands (verified 2026-05-29); https://developers.openai.com/codex/cli/slash-commands";
const CODEX_HOOK_TRUST_DIAGNOSTIC = "codex.hooks.trust.required";

/* ---------------------------------------------------------------- */
/*  OpenCode matrix                                                  */
/* ---------------------------------------------------------------- */

/**
 * OpenCode matrix — derived from installed `@opencode-ai/plugin@1.15.11`
 * `.d.ts`. Session-start / user-prompt injection runs through
 * `experimental.chat.messages.transform` with a comment-marker guard,
 * tracked as `experimental` rather than `full`.
 */
export const OPENCODE_MATRIX: PlatformCapabilityMatrix = {
  // agents
  "agents.primary":      { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.subagent":     { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.perAgentMcp":  { status: "drop-warn", evidence: OPENCODE_PLUGIN_DTS, diagnostics: ["opencode.agents.perAgentMcp.dropped"] },
  "agents.mode":         { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.model":        { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.color":        { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.temperature":  { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.permissions":  { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "agents.maxTurns":     { status: "drop-warn", evidence: OPENCODE_PLUGIN_DTS, diagnostics: ["opencode.agents.maxTurns.dropped"] },
  "agents.memory":       { status: "drop-warn", evidence: OPENCODE_PLUGIN_DTS, diagnostics: ["opencode.agents.memory.dropped"] },

  // skills
  "skills.skillMd":      { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "skills.allowedTools": { status: "shim",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "skills.autoLoad":     { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "skills.mcpScoping":   { status: "drop-warn", evidence: OPENCODE_PLUGIN_DTS, diagnostics: ["opencode.skills.mcpScoping.dropped"] },

  // commands
  "commands.slash":      { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },

  // mcp
  "mcp.stdio":           { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "mcp.http":            { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },

  // hooks
  "hooks.sessionStart":     { status: "experimental", evidence: OPENCODE_EXPERIMENTAL, diagnostics: ["opencode.hooks.sessionStart.experimental"] },
  "hooks.sessionEnd":       { status: "drop-warn",    evidence: OPENCODE_PLUGIN_DTS,   diagnostics: ["opencode.hooks.sessionEnd.dropped"] },
  "hooks.userPromptFirst":  { status: "experimental", evidence: OPENCODE_EXPERIMENTAL, diagnostics: ["opencode.hooks.userPromptFirst.experimental"] },
  "hooks.userPromptEvery":  { status: "experimental", evidence: OPENCODE_EXPERIMENTAL, diagnostics: ["opencode.hooks.userPromptEvery.experimental"] },
  "hooks.messageTransform": { status: "experimental", evidence: OPENCODE_EXPERIMENTAL, diagnostics: ["opencode.hooks.messageTransform.experimental"] },
  "hooks.beforeToolCall":   { status: "full",         evidence: OPENCODE_PLUGIN_DTS,   diagnostics: [] },
  "hooks.afterToolCall":    { status: "full",         evidence: OPENCODE_PLUGIN_DTS,   diagnostics: [] },
  "hooks.afterToolFailure": { status: "full",         evidence: OPENCODE_PLUGIN_DTS,   diagnostics: [] },
  "hooks.agentSpawn":       { status: "drop-warn",    evidence: OPENCODE_PLUGIN_DTS,   diagnostics: ["opencode.hooks.agentSpawn.dropped"] },
  "hooks.agentStop":        { status: "drop-warn",    evidence: OPENCODE_PLUGIN_DTS,   diagnostics: ["opencode.hooks.agentStop.dropped"] },
  "hooks.beforeCompact":    { status: "experimental", evidence: OPENCODE_EXPERIMENTAL, diagnostics: ["opencode.hooks.beforeCompact.experimental"] },
  "hooks.afterCompact":     { status: "drop-warn",    evidence: OPENCODE_PLUGIN_DTS,   diagnostics: ["opencode.hooks.afterCompact.dropped"] },
  "hooks.notification":     { status: "drop-warn",    evidence: OPENCODE_PLUGIN_DTS,   diagnostics: ["opencode.hooks.notification.dropped"] },
  "hooks.permissionRequest":{ status: "full",         evidence: OPENCODE_PLUGIN_DTS,   diagnostics: [] },
  "hooks.shellEnvironment": { status: "full",         evidence: OPENCODE_PLUGIN_DTS,   diagnostics: [] },

  // permissions
  "permissions.perTool":   { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "permissions.bashGlob":  { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "permissions.sandbox":   { status: "shim",      evidence: ADR_REV2,            diagnostics: ["opencode.permissions.sandbox.shim"] },

  // custom tools
  "customTools.inProcess": { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
  "customTools.mcp":       { status: "full",      evidence: OPENCODE_PLUGIN_DTS, diagnostics: [] },
};

/* ---------------------------------------------------------------- */
/*  Claude Code matrix                                               */
/* ---------------------------------------------------------------- */

export const CLAUDE_CODE_MATRIX: PlatformCapabilityMatrix = {
  // agents
  "agents.primary":      { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.subagent":     { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.perAgentMcp":  { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.mode":         { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.model":        { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.color":        { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.temperature":  { status: "drop-warn", evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: ["claude-code.agents.temperature.dropped"] },
  "agents.permissions":  { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "agents.maxTurns":     { status: "drop-warn", evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: ["claude-code.agents.maxTurns.dropped"] },
  "agents.memory":       { status: "drop-warn", evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: ["claude-code.agents.memory.dropped"] },

  // skills
  "skills.skillMd":      { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "skills.allowedTools": { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "skills.autoLoad":     { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "skills.mcpScoping":   { status: "shim",      evidence: ADR_REV2,                diagnostics: ["claude-code.skills.mcpScoping.degraded"] },

  // commands
  "commands.slash":      { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },

  // mcp
  "mcp.stdio":           { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "mcp.http":            { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },

  // hooks
  "hooks.sessionStart":      { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.sessionStart.shell"] },
  "hooks.sessionEnd":        { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.sessionEnd.shell"] },
  "hooks.userPromptFirst":   { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.userPromptFirst.shell"] },
  "hooks.userPromptEvery":   { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.userPromptEvery.shell"] },
  "hooks.messageTransform":  { status: "drop-warn", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.messageTransform.dropped"] },
  "hooks.beforeToolCall":    { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.beforeToolCall.shell"] },
  "hooks.afterToolCall":     { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.afterToolCall.shell"] },
  "hooks.afterToolFailure":  { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.afterToolFailure.shell"] },
  "hooks.agentSpawn":        { status: "drop-warn", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.agentSpawn.dropped"] },
  "hooks.agentStop":         { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.agentStop.shell"] },
  "hooks.beforeCompact":     { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.beforeCompact.shell"] },
  "hooks.afterCompact":      { status: "shell-cmd", evidence: CLAUDE_CODE_POSTCOMPACT_DOCS, diagnostics: ["claude-code.hooks.afterCompact.shell"] },
  "hooks.notification":      { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.notification.shell"] },
  "hooks.permissionRequest": { status: "shell-cmd", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.permissionRequest.shell"] },
  "hooks.shellEnvironment":  { status: "drop-warn", evidence: CLAUDE_CODE_HOOKS_DOCS, diagnostics: ["claude-code.hooks.shellEnvironment.dropped"] },

  // permissions
  "permissions.perTool":   { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "permissions.bashGlob":  { status: "shim",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
  "permissions.sandbox":   { status: "drop-warn", evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: ["claude-code.permissions.sandbox.dropped"] },

  // custom tools
  "customTools.inProcess": { status: "drop-warn", evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: ["claude-code.customTools.inProcess.dropped"] },
  "customTools.mcp":       { status: "full",      evidence: CLAUDE_CODE_PLUGIN_DOCS, diagnostics: [] },
};

/* ---------------------------------------------------------------- */
/*  Codex matrix                                                     */
/* ---------------------------------------------------------------- */

/**
 * Codex matrix — ADR-006 + research.md (verified 2026-05-29). Hooks now
 * model Codex 0.135.0 command-hook support; supported hook cells also carry
 * `codex.hooks.trust.required` because project/plugin hooks require user trust.
 */
export const CODEX_MATRIX: PlatformCapabilityMatrix = {
  // agents
  "agents.primary":      { status: "full",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: [] },
  "agents.subagent":     { status: "full",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: [] },
  "agents.perAgentMcp":  { status: "full",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: [] },
  "agents.mode":         { status: "full",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: [] },
  "agents.model":        { status: "full",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: [] },
  "agents.color":        { status: "drop-warn", evidence: CODEX_SUBAGENTS_DOCS, diagnostics: ["codex.agents.color.dropped"] },
  "agents.temperature":  { status: "drop-warn", evidence: CODEX_SUBAGENTS_DOCS, diagnostics: ["codex.agents.temperature.dropped"] },
  "agents.permissions":  { status: "shim",      evidence: CODEX_SUBAGENTS_DOCS, diagnostics: ["codex.agents.permissions.shim"] },
  "agents.maxTurns":     { status: "drop-warn", evidence: CODEX_SUBAGENTS_DOCS, diagnostics: ["codex.agents.maxTurns.dropped"] },
  "agents.memory":       { status: "drop-warn", evidence: CODEX_SUBAGENTS_DOCS, diagnostics: ["codex.agents.memory.dropped"] },

  // skills
  "skills.skillMd":      { status: "full",      evidence: CODEX_SKILLS_DOCS, diagnostics: [] },
  "skills.allowedTools": { status: "drop-warn", evidence: CODEX_RESEARCH,    diagnostics: ["codex.skills.allowedTools.dropped"] },
  "skills.autoLoad":     { status: "full",      evidence: CODEX_SKILLS_DOCS, diagnostics: [] },
  "skills.mcpScoping":   { status: "drop-warn", evidence: CODEX_SKILLS_DOCS, diagnostics: ["codex.skills.mcpScoping.dropped"] },

  // commands
  "commands.slash":      { status: "drop-warn", evidence: CODEX_SLASH_COMMANDS_DOCS, diagnostics: ["codex.commands.slash.dropped"] },

  // mcp
  "mcp.stdio":           { status: "full",      evidence: CODEX_CONFIG_REFERENCE_DOCS, diagnostics: [] },
  "mcp.http":            { status: "full",      evidence: CODEX_CONFIG_REFERENCE_DOCS, diagnostics: [] },

  // hooks
  "hooks.sessionStart":      { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.sessionEnd":        { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.userPromptFirst":   { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.userPromptEvery":   { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.messageTransform":  { status: "drop-warn",    evidence: CODEX_HOOKS_DOCS, diagnostics: ["codex.hooks.messageTransform.dropped"] },
  "hooks.beforeToolCall":    { status: "experimental", evidence: CODEX_HOOKS_DOCS, diagnostics: ["codex.hooks.beforeToolCall.experimental", CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.afterToolCall":     { status: "experimental", evidence: CODEX_HOOKS_DOCS, diagnostics: ["codex.hooks.afterToolCall.experimental", CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.afterToolFailure":  { status: "shim",         evidence: CODEX_HOOKS_DOCS, diagnostics: ["codex.hooks.afterToolFailure.shim", CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.agentSpawn":        { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.agentStop":         { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.beforeCompact":     { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.afterCompact":      { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.notification":      { status: "drop-warn",    evidence: CODEX_HOOKS_DOCS, diagnostics: ["codex.hooks.notification.dropped"] },
  "hooks.permissionRequest": { status: "full",         evidence: CODEX_HOOKS_DOCS, diagnostics: [CODEX_HOOK_TRUST_DIAGNOSTIC] },
  "hooks.shellEnvironment":  { status: "shim",         evidence: CODEX_CONFIG_REFERENCE_DOCS, diagnostics: ["codex.hooks.shellEnvironment.shim", CODEX_HOOK_TRUST_DIAGNOSTIC] },

  // permissions
  "permissions.perTool":   { status: "shim",      evidence: CODEX_PERMISSIONS_DOCS, diagnostics: ["codex.permissions.perTool.shim"] },
  "permissions.bashGlob":  { status: "drop-warn", evidence: CODEX_PERMISSIONS_DOCS, diagnostics: ["codex.permissions.bashGlob.dropped"] },
  "permissions.sandbox":   { status: "full",      evidence: CODEX_PERMISSIONS_DOCS, diagnostics: [] },

  // custom tools
  "customTools.inProcess": { status: "drop-warn", evidence: CODEX_CONFIG_DOCS, diagnostics: ["codex.customTools.inProcess.dropped"] },
  "customTools.mcp":       { status: "full",      evidence: CODEX_CONFIG_DOCS, diagnostics: [] },
};

/* ---------------------------------------------------------------- */
/*  Helpers                                                          */
/* ---------------------------------------------------------------- */

/** Read a single capability cell. */
export function getCapabilityCell(
  matrix: PlatformCapabilityMatrix,
  feature: CapabilityFeature,
): CapabilityCell {
  return matrix[feature];
}

/**
 * Throws when `matrix` is missing a cell for any `CapabilityFeature`. Used
 * by tests and `doctor` to guarantee every feature is covered.
 */
export function assertMatrixComplete(
  matrix: PlatformCapabilityMatrix,
  name = "matrix",
): void {
  const missing: CapabilityFeature[] = [];
  for (const feature of ALL_CAPABILITY_FEATURES) {
    const cell = matrix[feature];
    if (cell === undefined) missing.push(feature);
  }
  if (missing.length > 0) {
    throw new Error(`Capability ${name} is incomplete; missing: ${missing.join(", ")}`);
  }
}
