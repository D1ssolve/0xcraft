/**
 * Capability feature taxonomy + report shape (spec §11).
 *
 * The `CapabilityFeature` union enumerates every feature the capability
 * matrix tracks. Each adapter's matrix must cover all 35 keys exactly.
 *
 * `CapabilityStatus` is the canonical status vocabulary used by the
 * matrix. Doctor output is derived from `CapabilityReport`.
 */

import type { Diagnostic } from "./diagnostic";

/* ---------------------------------------------------------------- */
/*  CapabilityFeature — 37 keys (spec §11 + shellEnvironment)         */
/* ---------------------------------------------------------------- */

export type CapabilityFeature =
  // agents — 10
  | "agents.primary"
  | "agents.subagent"
  | "agents.perAgentMcp"
  | "agents.mode"
  | "agents.model"
  | "agents.color"
  | "agents.temperature"
  | "agents.permissions"
  | "agents.maxTurns"
  | "agents.memory"
  // skills — 4
  | "skills.skillMd"
  | "skills.allowedTools"
  | "skills.autoLoad"
  | "skills.mcpScoping"
  // commands — 1
  | "commands.slash"
  // mcp — 2
  | "mcp.stdio"
  | "mcp.http"
  // hooks — 15 (14 from spec §11 + shellEnvironment closes adr-review Finding 1)
  | "hooks.sessionStart"
  | "hooks.sessionEnd"
  | "hooks.userPromptFirst"
  | "hooks.userPromptEvery"
  | "hooks.messageTransform"
  | "hooks.beforeToolCall"
  | "hooks.afterToolCall"
  | "hooks.afterToolFailure"
  | "hooks.agentSpawn"
  | "hooks.agentStop"
  | "hooks.beforeCompact"
  | "hooks.afterCompact"
  | "hooks.notification"
  | "hooks.permissionRequest"
  | "hooks.shellEnvironment"
  // permissions — 3
  | "permissions.perTool"
  | "permissions.bashGlob"
  | "permissions.sandbox"
  // custom tools — 2
  | "customTools.inProcess"
  | "customTools.mcp";

/**
 * Concrete tuple of every `CapabilityFeature` value — used by
 * `assertMatrixComplete` and other exhaustiveness checks.
 *
 * KEEP IN SYNC with the `CapabilityFeature` union above.
 */
export const CAPABILITY_FEATURES = [
  "agents.primary",
  "agents.subagent",
  "agents.perAgentMcp",
  "agents.mode",
  "agents.model",
  "agents.color",
  "agents.temperature",
  "agents.permissions",
  "agents.maxTurns",
  "agents.memory",
  "skills.skillMd",
  "skills.allowedTools",
  "skills.autoLoad",
  "skills.mcpScoping",
  "commands.slash",
  "mcp.stdio",
  "mcp.http",
  "hooks.sessionStart",
  "hooks.sessionEnd",
  "hooks.userPromptFirst",
  "hooks.userPromptEvery",
  "hooks.messageTransform",
  "hooks.beforeToolCall",
  "hooks.afterToolCall",
  "hooks.afterToolFailure",
  "hooks.agentSpawn",
  "hooks.agentStop",
  "hooks.beforeCompact",
  "hooks.afterCompact",
  "hooks.notification",
  "hooks.permissionRequest",
  "hooks.shellEnvironment",
  "permissions.perTool",
  "permissions.bashGlob",
  "permissions.sandbox",
  "customTools.inProcess",
  "customTools.mcp",
] as const satisfies readonly CapabilityFeature[];

/* ---------------------------------------------------------------- */
/*  CapabilityStatus                                                  */
/* ---------------------------------------------------------------- */

export type CapabilityStatus =
  | "full"
  | "shim"
  | "shell-cmd"
  | "drop-warn"
  | "experimental";

/* ---------------------------------------------------------------- */
/*  CapabilityReport                                                  */
/* ---------------------------------------------------------------- */

/**
 * Neutral platform id used in capability reports. Canonical definition
 * lives in `core/platform/platform-id.ts`; re-exported here for the
 * existing `core/diagnostics` import surface.
 */
import type { PlatformId } from "../platform/platform-id";
export type { PlatformId };

export interface CapabilityCell {
  status: CapabilityStatus;
  /** Provenance — URL + access date for non-trivial cells. */
  evidence?: string;
  /** Diagnostic codes emitted when this feature is exercised. */
  diagnostics: string[];
}

export interface CapabilityReport {
  platform: PlatformId;
  features: Record<CapabilityFeature, CapabilityCell>;
  /** Aggregated diagnostics produced during the report's construction. */
  diagnostics?: Diagnostic[];
}
