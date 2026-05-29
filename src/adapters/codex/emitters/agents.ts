/**
 * Codex per-agent TOML emitter (Task D.2 / ADR §5.4–5.5).
 *
 * Emits a standalone TOML file at `.codex/agents/<id>.toml` for one agent.
 * Required fields per Codex subagents docs: `name`, `description`,
 * `developer_instructions`. Optional: `model`, `mcp_servers`.
 *
 * Dropped fields per `CODEX_MATRIX`:
 *   - `color`        → diagnostic `codex.agent.color_dropped`
 *   - `temperature`  → diagnostic `codex.agent.temperature_dropped`
 *   - `permissions`  → diagnostic `codex.agent.permissions_degraded`
 */
import path from "node:path";

import { stringify as stringifyToml } from "smol-toml";

import type { AgentSpec } from "../../../core/agents";
import type { CodexAgentExtension, ZeroxCraftConfig } from "../../../core/config";
import type { Diagnostic } from "../../../core/diagnostics/diagnostic";

import { CODEX_MATRIX } from "../../_shared/capability-matrix";
import { emitCapabilityDiagnostic } from "../_internal/capability-diagnostic";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { extractPromptBodySafe } from "../../_shared/prompt-body";
import {
  tomlKey,
  tomlMultilineString,
  tomlString,
  tomlStringArray,
  type TomlTableEntry,
} from "../_internal/toml-emitter";

import { mapPermissions, type CodexPermissionConfig } from "../mappers/permissions";

export interface EmitCodexAgentOptions {
  agent: AgentSpec;
  /** Absolute root of this package (used to resolve `agent.promptFile`). */
  packageRoot: string;
  config: ZeroxCraftConfig;
  /**
   * Optional MCP scoping for this agent. When provided and non-empty,
   * emitted as `mcp_servers = [...]`.
   */
  perAgentMcpServers?: string[];
}

export interface EmitCodexAgentResult {
  /** Relative path under the output dir, e.g. `.codex/agents/code-explorer.toml`. */
  filename: string;
  toml: string;
  diagnostics: Diagnostic[];
}

/* ---------------------------------------------------------------- */
/*  Local helpers                                                     */
/* ---------------------------------------------------------------- */

/**
 * Render a flat list of top-level key/value entries with no `[header]`.
 * The shared `tomlTable` requires a header; per-agent files are header-less
 * top-level scalar documents, so we render entries inline here.
 */
function emitHeaderlessEntries(entries: TomlTableEntry[]): string {
  return entries
    .map((entry) => {
      const v = entry.value;
      let rendered: string;
      switch (v.kind) {
        case "string":
          rendered = tomlString(v.value);
          break;
        case "multilineString":
          rendered = tomlMultilineString(v.value);
          break;
        case "stringArray":
          rendered = tomlStringArray(v.values);
          break;
        default:
          // Per-agent TOML only uses the three kinds above. Anything else
          // is a programming error in the caller.
          throw new Error(`emitHeaderlessEntries: unsupported value kind '${v.kind}'`);
      }
      return `${tomlKey(entry.key)} = ${rendered}`;
    })
    .join("\n");
}

/**
 * Resolve the agent model with the precedence (highest first):
 *   1. config.platformModelOverrides?.codex?.[agent.id]
 *   2. config.modelOverrides?.[agent.id]
 *   3. agent.model
 * Returns `undefined` if the final value is missing or empty.
 */
function resolveCodexModel(agent: AgentSpec, config: ZeroxCraftConfig): string | undefined {
  const platform = config.platformModelOverrides?.codex?.[agent.id];
  if (typeof platform === "string" && platform.length > 0) return platform;

  const global = config.modelOverrides?.[agent.id];
  if (typeof global === "string" && global.length > 0) return global;

  if (typeof agent.model === "string" && agent.model.length > 0) return agent.model;

  return undefined;
}

/** Treat a missing `permission` (PermissionSpec) as empty. Distinguishes
 *  "agent has no permissions to map" (no diagnostic) from "agent has
 *  permissions but Codex degrades them". A non-default sandbox tier
 *  alone counts (so `sandbox: "read"` triggers the mapper even with
 *  empty tools/bash/delegation/filesystem). */
function hasAnyPermissions(agent: AgentSpec): boolean {
  const p = agent.permission;
  if (!p) return false;
  if (p.sandbox !== "workspace-write") return true;
  if (Object.keys(p.tools ?? {}).length > 0) return true;
  if (Object.keys(p.bash ?? {}).length > 0) return true;
  if (p.delegation && Object.keys(p.delegation).length > 0) return true;
  if (p.filesystem) {
    if ((p.filesystem.readableRoots?.length ?? 0) > 0) return true;
    if ((p.filesystem.writableRoots?.length ?? 0) > 0) return true;
  }
  return false;
}

/** Neutral default for `temperature`. Only diagnose when the agent
 *  meaningfully sets a value different from this. */
const NEUTRAL_TEMPERATURE = 0.7;

/* ---------------------------------------------------------------- */
/*  Emitter                                                           */
/* ---------------------------------------------------------------- */

export function emitCodexAgent(options: EmitCodexAgentOptions): EmitCodexAgentResult {
  const { agent, packageRoot, config, perAgentMcpServers } = options;
  const diagnostics: Diagnostic[] = [];

  /* -- prompt body --------------------------------------------------- */
  const promptPath = path.resolve(packageRoot, agent.promptFile);
  const { body, diagnostics: promptDiagnostics } = extractPromptBodySafe(promptPath);
  if (promptDiagnostics.length > 0) {
    // Re-code under our namespace so downstream filters work; keep the
    // shared diagnostic for traceability in `details`.
    diagnostics.push({
      severity: "error",
      code: "codex.agent.prompt_missing",
      message: `Codex agent '${agent.id}': prompt file unreadable at ${agent.promptFile}; emitted stub with empty developer_instructions.`,
      details: { agentId: agent.id, promptFile: agent.promptFile, cause: promptDiagnostics },
    });
  }

  /* -- required-field validation ------------------------------------- */
  if (typeof agent.name !== "string" || agent.name.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "codex.agent.required_field_missing",
      message: `Codex agent '${agent.id}': required field 'name' is empty.`,
      details: { agentId: agent.id, field: "name" },
    });
  }
  if (typeof agent.description !== "string" || agent.description.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "codex.agent.required_field_missing",
      message: `Codex agent '${agent.id}': required field 'description' is empty.`,
      details: { agentId: agent.id, field: "description" },
    });
  }

  /* -- dropped-field diagnostics (matrix-driven) --------------------- */
  if (agent.color !== undefined) {
    const d = emitCapabilityDiagnostic(CODEX_MATRIX, "agents.color", {
      code: "codex.agent.color_dropped",
      dropMessage: "Codex does not support per-agent color; field omitted from emitted TOML.",
      degradeMessage: "Codex approximates per-agent color; field omitted from emitted TOML.",
      details: { agentId: agent.id, color: agent.color },
    });
    if (d) diagnostics.push(d);
  }

  if (agent.temperature !== undefined && agent.temperature !== NEUTRAL_TEMPERATURE) {
    const d = emitCapabilityDiagnostic(CODEX_MATRIX, "agents.temperature", {
      code: "codex.agent.temperature_dropped",
      dropMessage:
        "Codex does not support per-agent temperature; consider `model_reasoning_effort` at the model level.",
      degradeMessage:
        "Codex approximates per-agent temperature; consider `model_reasoning_effort` at the model level.",
      details: { agentId: agent.id, temperature: agent.temperature },
    });
    if (d) diagnostics.push(d);
  }

  /* -- permissions: map via Codex permission mapper ------------------ */
  let sandboxHint: Partial<CodexPermissionConfig> = {};
  if (hasAnyPermissions(agent) && agent.permission) {
    const collector = new DiagnosticCollector();
    const mapped = mapPermissions(agent.permission, collector);
    sandboxHint = mapped;
    for (const d of collector.getAll()) {
      diagnostics.push({ ...d, details: { ...(d.details ?? {}), agentId: agent.id } });
    }

    const degraded = emitCapabilityDiagnostic(CODEX_MATRIX, "agents.permissions", {
      code: "codex.agent.permissions_degraded",
      dropMessage:
        "Codex has no per-agent permission model — permission overrides dropped.",
      degradeMessage:
        "Codex permission model is coarse — buckets mapped to sandbox_mode/approval_policy by the permission mapper; per-tool denials not emitted in agent TOML.",
      details: { agentId: agent.id },
    });
    if (degraded) diagnostics.push(degraded);
  }

  /* -- assemble TOML entries ---------------------------------------- */
  const entries: TomlTableEntry[] = [];

  entries.push({ key: "name", value: { kind: "string", value: agent.name ?? "" } });
  entries.push({ key: "description", value: { kind: "string", value: agent.description ?? "" } });
  entries.push({
    key: "developer_instructions",
    value: { kind: "multilineString", value: body },
  });

  const model = resolveCodexModel(agent, config);
  if (model !== undefined) {
    entries.push({ key: "model", value: { kind: "string", value: model } });
  }

  /* -- platforms.codex.agents[id] extension (T-21) ------------------- */
  const ext: CodexAgentExtension | undefined = config.platforms.codex?.agents?.[agent.id];
  if (ext?.model_reasoning_effort !== undefined) {
    entries.push({
      key: "model_reasoning_effort",
      value: { kind: "string", value: ext.model_reasoning_effort },
    });
  }
  if (ext?.nickname_candidates !== undefined && ext.nickname_candidates.length > 0) {
    entries.push({
      key: "nickname_candidates",
      value: { kind: "stringArray", values: [...ext.nickname_candidates] },
    });
  }

  if (sandboxHint.sandbox_mode !== undefined) {
    entries.push({
      key: "sandbox_mode",
      value: { kind: "string", value: sandboxHint.sandbox_mode },
    });
  }
  if (sandboxHint.approval_policy !== undefined) {
    entries.push({
      key: "approval_policy",
      value: { kind: "string", value: sandboxHint.approval_policy },
    });
  }

  if (perAgentMcpServers && perAgentMcpServers.length > 0) {
    if (CODEX_MATRIX["agents.perAgentMcp"].status === "full") {
      entries.push({
        key: "mcp_servers",
        value: { kind: "stringArray", values: [...perAgentMcpServers] },
      });
    } else {
      const d = emitCapabilityDiagnostic(CODEX_MATRIX, "agents.perAgentMcp", {
        code: "codex.agent.mcp_scoping_dropped",
        dropMessage:
          "Codex per-agent MCP scoping unavailable in this matrix; mcp_servers field omitted.",
        degradeMessage:
          "Codex per-agent MCP scoping degraded; mcp_servers field omitted.",
        details: { agentId: agent.id, mcpServers: [...perAgentMcpServers] },
      });
      if (d) diagnostics.push(d);
    }
  }

  const headerless = emitHeaderlessEntries(entries);

  /* -- [skills.config] sub-table (T-21) ----------------------------- */
  let skillsConfigBlock = "";
  const skillsConfig = ext?.skills?.config;
  if (skillsConfig !== undefined && Object.keys(skillsConfig).length > 0) {
    // `smol-toml.stringify` deterministically renders nested objects with
    // sorted keys at each level; reuse it for arbitrary user data rather
    // than re-implementing TOML escape rules.
    const rendered = stringifyToml({ skills: { config: skillsConfig } }).trim();
    skillsConfigBlock = `\n\n${rendered}`;
  }

  const toml = `${headerless}${skillsConfigBlock}\n`;
  const filename = `.codex/agents/${agent.id}.toml`;

  return { filename, toml, diagnostics };
}
