import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Diagnostic } from "../../core/diagnostics";
import type {
  AgentIR,
  CommandIR,
  HookIR,
  IRResource,
  McpServerIR,
  SkillIR,
} from "../../core/ir";
import type { HookEvent } from "../../core/hook-runtime/events";
import { HOOK_EVENTS } from "../../core/hook-runtime/events";
import type { HookActionIR } from "../../core/hook-runtime/primitives";
import { parseYamlFrontmatter } from "../../core/loader/yaml-parser";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClaudeImportMode = "claude-plugin" | "claude-subagent" | "auto";

export interface ClaudeImportOptions {
  mode?: ClaudeImportMode;
}

export interface ClaudeImportResult {
  ir: IRResource[];
  diagnostics: Diagnostic[];
  mode: "claude-plugin" | "claude-subagent";
}

// ---------------------------------------------------------------------------
// Claude plugin manifest shape
// ---------------------------------------------------------------------------

interface ClaudePluginManifest {
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  defaultEnabled?: boolean;
  skills?: Record<string, unknown>;
  commands?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Claude agent frontmatter shapes
// ---------------------------------------------------------------------------

interface ClaudeAgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  tools?: string | string[];
  disallowedTools?: string | string[];
  skills?: string[];
  memory?: "user" | "project" | "local";
  background?: boolean;
  isolation?: "worktree";
  permissionMode?: "default" | "acceptEdits" | "auto" | "dontAsk" | "bypassPermissions" | "plan";
  hooks?: Record<string, unknown>;
  mcpServers?: string[] | Record<string, unknown>;
  color?: "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan";
  initialPrompt?: string;
}

/** Fields allowed in plugin-shipped agents */
const PLUGIN_AGENT_ALLOWED = new Set([
  "name", "description", "model", "effort", "maxTurns",
  "tools", "disallowedTools", "skills", "memory", "background", "isolation",
]);

/** Fields forbidden in plugin-shipped agents (preserved in platform.claude with diagnostic) */
const PLUGIN_AGENT_FORBIDDEN = new Set([
  "hooks", "mcpServers", "permissionMode",
]);

// ---------------------------------------------------------------------------
// Claude skill frontmatter
// ---------------------------------------------------------------------------

interface ClaudeSkillFrontmatter {
  name?: string;
  description?: string;
  when_to_use?: string;
  "argument-hint"?: string;
  arguments?: Record<string, unknown>;
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
  "allowed-tools"?: string | string[];
  "disallowed-tools"?: string | string[];
  allowedTools?: string | string[];  // deprecated camelCase
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  context?: "fork";
  agent?: string;
  hooks?: Record<string, unknown>;
  paths?: string[];
  shell?: "bash" | "powershell";
}

// ---------------------------------------------------------------------------
// Claude hooks.json shape
// ---------------------------------------------------------------------------

interface ClaudeHooksJson {
  description?: string;
  hooks: Record<string, ClaudeHookGroup[]>;
}

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookHandler[];
}

interface ClaudeHookHandler {
  type: "command" | "http" | "mcp_tool" | "prompt" | "agent";
  // command handler
  command?: string;
  args?: string[];
  shell?: string;
  async?: boolean;
  asyncRewake?: boolean;
  // http handler
  url?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  // mcp_tool handler
  server?: string;
  tool?: string;
  input?: Record<string, unknown>;
  // prompt/agent handler
  prompt?: string;
  model?: string;
  // common
  if?: string;
  timeout?: number;
  statusMessage?: string;
  once?: boolean;
}

// ---------------------------------------------------------------------------
// Claude .mcp.json shape
// ---------------------------------------------------------------------------

interface ClaudeMcpJson {
  mcpServers: Record<string, ClaudeMcpServerDef>;
}

interface ClaudeMcpServerDef {
  type?: "stdio" | "http" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  oauth?: Record<string, unknown>;
  alwaysLoad?: boolean;
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

export function importClaude(
  projectDir: string,
  options?: ClaudeImportOptions,
): ClaudeImportResult {
  const absDir = resolve(projectDir);
  const diagnostics: Diagnostic[] = [];
  const ir: IRResource[] = [];

  // Detect mode
  const mode = detectMode(absDir, options?.mode);
  diagnostics.push({
    severity: "info",
    code: "mcp.envelope.normalized",
    message: `Claude import mode: ${mode}`,
    details: { mode },
  });

  if (mode === "claude-plugin") {
    importPluginMode(absDir, ir, diagnostics);
  } else {
    importSubagentMode(absDir, ir, diagnostics);
  }

  return { ir, diagnostics, mode };
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

function detectMode(
  absDir: string,
  requested?: ClaudeImportMode,
): "claude-plugin" | "claude-subagent" {
  if (requested === "claude-plugin") return "claude-plugin";
  if (requested === "claude-subagent") return "claude-subagent";

  // auto: detect from directory structure
  const pluginManifest = join(absDir, ".claude-plugin", "plugin.json");
  if (existsSync(pluginManifest)) return "claude-plugin";

  const subagentDir = join(absDir, ".claude", "agents");
  if (existsSync(subagentDir)) return "claude-subagent";

  // Default to plugin mode
  return "claude-plugin";
}

// ---------------------------------------------------------------------------
// Plugin mode import
// ---------------------------------------------------------------------------

function importPluginMode(
  absDir: string,
  ir: IRResource[],
  diagnostics: Diagnostic[],
): void {
  // 1. Plugin manifest
  const manifestPath = join(absDir, ".claude-plugin", "plugin.json");
  if (existsSync(manifestPath)) {
    const manifest = readJsonFile<ClaudePluginManifest>(manifestPath, diagnostics);
    if (manifest !== undefined) {
      // Store manifest metadata as a diagnostic note (not an IR resource)
      diagnostics.push({
        severity: "info",
        code: "mcp.envelope.normalized",
        message: `Claude plugin manifest loaded: ${manifest.name ?? "unnamed"}`,
        details: { file: manifestPath, name: manifest.name },
      });
    }
  }

  // 2. Plugin agents (restricted subset)
  const agentsDir = join(absDir, "agents");
  if (existsSync(agentsDir)) {
    for (const entry of sortedReaddir(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.replace(/\.md$/, "");
      const filePath = join(agentsDir, entry);
      const agent = importClaudeAgent(id, filePath, diagnostics, true);
      if (agent !== undefined) ir.push(agent);
    }
  }

  // 3. Skills
  const skillsDir = join(absDir, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of sortedReaddir(skillsDir)) {
      const skillPath = join(skillsDir, entry, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const skill = importClaudeSkill(entry, skillPath, diagnostics);
      if (skill !== undefined) ir.push(skill);
    }
  }

  // 4. Hooks
  const hooksPath = join(absDir, "hooks", "hooks.json");
  if (existsSync(hooksPath)) {
    const hooks = importClaudeHooks(hooksPath, diagnostics);
    ir.push(...hooks);
  }

  // 5. MCP
  const mcpPath = join(absDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const mcps = importClaudeMcp(mcpPath, diagnostics);
    ir.push(...mcps);
  }
}

// ---------------------------------------------------------------------------
// Subagent mode import
// ---------------------------------------------------------------------------

function importSubagentMode(
  absDir: string,
  ir: IRResource[],
  diagnostics: Diagnostic[],
): void {
  const agentsDir = join(absDir, ".claude", "agents");
  if (existsSync(agentsDir)) {
    for (const entry of sortedReaddir(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.replace(/\.md$/, "");
      const filePath = join(agentsDir, entry);
      const agent = importClaudeAgent(id, filePath, diagnostics, false);
      if (agent !== undefined) ir.push(agent);
    }
  }

  // Also check for .mcp.json at project root
  const mcpPath = join(absDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const mcps = importClaudeMcp(mcpPath, diagnostics);
    ir.push(...mcps);
  }
}

// ---------------------------------------------------------------------------
// Agent importer
// ---------------------------------------------------------------------------

function importClaudeAgent(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
  isPluginMode: boolean,
): AgentIR | undefined {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseYamlFrontmatter(content);
  const fm = parsed.frontmatter as unknown as ClaudeAgentFrontmatter;

  const prompt = parsed.body.trim();
  const platform: Record<string, unknown> = {};

  // Map common fields
  const common: Record<string, unknown> = {
    name: fm.name ?? id,
    description: fm.description ?? "",
    prompt,
  };

  if (fm.model !== undefined) common.model = resolveModelAlias(fm.model);
  if (fm.maxTurns !== undefined) common.maxTurns = fm.maxTurns;
  if (fm.memory !== undefined) common.memory = { type: fm.memory };

  // Map platform.claude fields
  if (fm.effort !== undefined) platform.effort = fm.effort;
  if (fm.background !== undefined) platform.background = fm.background;
  if (fm.isolation !== undefined) platform.isolation = fm.isolation;
  if (fm.color !== undefined) platform.color = fm.color;
  if (fm.initialPrompt !== undefined) platform.initialPrompt = fm.initialPrompt;

  // Tools: comma-separated string or YAML list → array
  if (fm.tools !== undefined) platform.tools = normalizeToolList(fm.tools);
  if (fm.disallowedTools !== undefined) platform.disallowedTools = normalizeToolList(fm.disallowedTools);
  if (fm.skills !== undefined) platform.skills = fm.skills;

  // Forbidden fields in plugin mode
  if (isPluginMode) {
    for (const field of PLUGIN_AGENT_FORBIDDEN) {
      const value = (fm as Record<string, unknown>)[field];
      if (value !== undefined) {
        diagnostics.push({
          severity: "warn",
          code: "claude.agent.plugin.field_stripped",
          message: `Plugin agent ${id} has forbidden field '${field}'; preserved in platform.claude for round-trip but will be stripped on emit.`,
          details: { id, field, platform: "claude" },
        });
        platform[field] = value;
      }
    }
  } else {
    // Full subagent mode: import all fields
    if (fm.permissionMode !== undefined) platform.permissionMode = fm.permissionMode;
    if (fm.hooks !== undefined) platform.hooks = fm.hooks;
    if (fm.mcpServers !== undefined) {
      if (Array.isArray(fm.mcpServers) && fm.mcpServers.every((s) => typeof s === "string")) {
        common.mcpServers = fm.mcpServers;
      } else {
        platform.mcpServers = fm.mcpServers;
      }
    }
  }

  return {
    id,
    kind: "agent",
    sourcePath: filePath,
    common,
    platform: { claude: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "claude-code", sourceFiles: [filePath] },
    _sources: {},
  } as AgentIR;
}

// ---------------------------------------------------------------------------
// Skill importer
// ---------------------------------------------------------------------------

function importClaudeSkill(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
): SkillIR | undefined {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseYamlFrontmatter(content);
  const fm = parsed.frontmatter as unknown as ClaudeSkillFrontmatter;

  // Check for deprecated camelCase allowedTools
  if (fm.allowedTools !== undefined) {
    diagnostics.push({
      severity: "warn",
      code: "skill.frontmatter.camelCase.deprecated",
      message: `Skill ${id} uses deprecated camelCase 'allowedTools'; rewriting to 'allowed-tools'.`,
      details: { id, field: "allowedTools", platform: "claude" },
    });
    // Rewrite to hyphenated
    (fm as Record<string, unknown>)["allowed-tools"] = fm.allowedTools;
    delete (fm as Record<string, unknown>).allowedTools;
  }

  const platform: Record<string, unknown> = {};
  if (fm.when_to_use !== undefined) platform.when_to_use = fm.when_to_use;
  if (fm["argument-hint"] !== undefined) platform["argument-hint"] = fm["argument-hint"];
  if (fm.arguments !== undefined) platform.arguments = fm.arguments;
  if (fm["disable-model-invocation"] !== undefined) platform["disable-model-invocation"] = fm["disable-model-invocation"];
  if (fm["user-invocable"] !== undefined) platform["user-invocable"] = fm["user-invocable"];
  if (fm.model !== undefined) platform.model = fm.model;
  if (fm.effort !== undefined) platform.effort = fm.effort;
  if (fm.context !== undefined) platform.context = fm.context;
  if (fm.agent !== undefined) platform.agent = fm.agent;
  if (fm.hooks !== undefined) platform.hooks = fm.hooks;
  if (fm.paths !== undefined) platform.paths = fm.paths;
  if (fm.shell !== undefined) platform.shell = fm.shell;

  const common: Record<string, unknown> = {
    name: fm.name ?? id,
    description: fm.description ?? "",
    body: parsed.body.trim(),
  };

  // Normalize allowed-tools / disallowed-tools to arrays
  if (fm["allowed-tools"] !== undefined) {
    common["allowed-tools"] = normalizeToolList(fm["allowed-tools"]);
  }
  if (fm["disallowed-tools"] !== undefined) {
    common["disallowed-tools"] = normalizeToolList(fm["disallowed-tools"]);
  }

  return {
    id,
    kind: "skill",
    sourcePath: filePath,
    common,
    platform: { claude: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "claude-code", sourceFiles: [filePath] },
    _sources: {},
  } as SkillIR;
}

// ---------------------------------------------------------------------------
// Hook importer
// ---------------------------------------------------------------------------

function importClaudeHooks(
  filePath: string,
  diagnostics: Diagnostic[],
): HookIR[] {
  const hooksJson = readJsonFile<ClaudeHooksJson>(filePath, diagnostics);
  if (hooksJson === undefined) return [];

  const result: HookIR[] = [];
  const validEvents = new Set<string>(HOOK_EVENTS);

  for (const [eventKey, groups] of Object.entries(hooksJson.hooks)) {
    // Validate event name
    if (!validEvents.has(eventKey)) {
      diagnostics.push({
        severity: "warn",
        code: "codex.hooks.event.dropped",
        message: `Unknown Claude hook event '${eventKey}'; skipping.`,
        details: { event: eventKey, file: filePath },
      });
      continue;
    }

    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
      const group = groups[groupIdx];
      const hookId = `${eventKey}-${groupIdx + 1}`;
      const actions: HookActionIR[] = [];

      for (const handler of group.hooks) {
        const action = mapHandlerToAction(handler, diagnostics, hookId);
        if (action !== undefined) actions.push(action);
      }

      if (actions.length === 0) continue;

      const platform: Record<string, unknown> = {};
      if (group.matcher !== undefined) platform.matcher = group.matcher;

      result.push({
        id: hookId,
        kind: "hook",
        sourcePath: filePath,
        common: {
          name: hookId,
          description: `Imported Claude hook for ${eventKey}`,
          events: [eventKey as HookEvent],
          actions,
        },
        platform: { claude: Object.keys(platform).length > 0 ? platform : undefined },
        provenance: { importedFrom: "claude-code", sourceFiles: [filePath] },
        _sources: {},
      } as HookIR);
    }
  }

  return result;
}

function mapHandlerToAction(
  handler: ClaudeHookHandler,
  diagnostics: Diagnostic[],
  hookId: string,
): HookActionIR | undefined {
  switch (handler.type) {
    case "command":
      return {
        type: "run_command",
        command: handler.command ?? "",
        shell: handler.shell,
        timeoutMs: handler.timeout,
      };
    case "http":
      return {
        type: "http_request",
        url: handler.url ?? "",
        headers: handler.headers,
        allowedEnvVars: handler.allowedEnvVars,
      };
    case "mcp_tool":
      return {
        type: "call_mcp_tool",
        server: handler.server ?? "",
        tool: handler.tool ?? "",
        input: handler.input,
      };
    case "prompt":
      return {
        type: "invoke_prompt",
        prompt: handler.prompt ?? "",
        model: handler.model,
      };
    case "agent":
      return {
        type: "invoke_agent",
        prompt: handler.prompt ?? "",
        model: handler.model,
      };
    default:
      diagnostics.push({
        severity: "warn",
        code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
        message: `Unknown Claude hook handler type '${(handler as Record<string, unknown>).type}' in hook ${hookId}.`,
        details: { hookId, handlerType: (handler as Record<string, unknown>).type },
      });
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// MCP importer
// ---------------------------------------------------------------------------

function importClaudeMcp(
  filePath: string,
  diagnostics: Diagnostic[],
): McpServerIR[] {
  const mcpJson = readJsonFile<ClaudeMcpJson>(filePath, diagnostics);
  if (mcpJson === undefined) return [];

  const result: McpServerIR[] = [];

  for (const [id, serverDef] of Object.entries(mcpJson.mcpServers)) {
    const mcp = mapMcpServer(id, serverDef, filePath, diagnostics);
    if (mcp !== undefined) result.push(mcp);
  }

  return result;
}

function mapMcpServer(
  id: string,
  def: ClaudeMcpServerDef,
  filePath: string,
  diagnostics: Diagnostic[],
): McpServerIR | undefined {
  const transport = resolveTransport(def.type, id, diagnostics);
  if (transport === undefined) return undefined;

  const common: Record<string, unknown> = {
    name: id,
    transport,
  };

  if (transport === "stdio") {
    if (def.command !== undefined) common.command = def.command;
    if (def.args !== undefined) common.args = def.args;
    if (def.env !== undefined) common.env = def.env;
  }

  if (transport === "http") {
    if (def.url !== undefined) common.url = def.url;
    if (def.headers !== undefined) common.headers = def.headers;
  }

  if (def.cwd !== undefined) common.cwd = def.cwd;

  return {
    id,
    kind: "mcp",
    sourcePath: filePath,
    common,
    mcpEnvelope: {
      sourceShape: "wrapped",
      emitShape: "wrapped",
      wrapperKey: "mcpServers",
    },
    platform: {},
    provenance: { importedFrom: "claude-code", sourceFiles: [filePath] },
    _sources: {},
  } as McpServerIR;
}

function resolveTransport(
  type: string | undefined,
  id: string,
  diagnostics: Diagnostic[],
): "stdio" | "http" | undefined {
  if (type === undefined || type === "stdio") return "stdio";
  if (type === "http") return "http";
  if (type === "streamable-http") {
    diagnostics.push({
      severity: "info",
      code: "mcp.envelope.normalized",
      message: `MCP server ${id} uses 'streamable-http' transport; normalized to 'http'.`,
      details: { id, originalType: type },
    });
    return "http";
  }
  if (type === "sse") {
    diagnostics.push({
      severity: "warn",
      code: "codex.mcp.sse.dropped",
      message: `MCP server ${id} uses deprecated 'sse' transport; normalized to 'http'.`,
      details: { id, originalType: type },
    });
    return "http";
  }

  diagnostics.push({
    severity: "warn",
    code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
    message: `Unknown MCP transport type '${type}' for server ${id}.`,
    details: { id, type },
  });
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeToolList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  // Space-separated or comma-separated string
  if (value.includes(",")) {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return value.split(/\s+/).filter(Boolean);
}

function resolveModelAlias(model: string): string {
  const aliases: Record<string, string> = {
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-opus-4-20250514",
    haiku: "claude-haiku-3-20240307",
  };
  if (model === "inherit") return "";
  return aliases[model] ?? model;
}

function readJsonFile<T>(filePath: string, diagnostics: Diagnostic[]): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `Failed to parse JSON file: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: filePath },
    });
    return undefined;
  }
}

function sortedReaddir(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => a.localeCompare(b));
}
