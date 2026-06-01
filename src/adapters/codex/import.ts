import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Diagnostic } from "../../core/diagnostics";
import type {
  AgentIR,
  HookIR,
  IRResource,
  McpServerIR,
} from "../../core/ir";
import type { HookEvent } from "../../core/hook-runtime/events";
import { CODEX_HOOK_EVENTS, HOOK_EVENTS } from "../../core/hook-runtime/events";
import type { HookActionIR } from "../../core/hook-runtime/primitives";
import { parseToml } from "../../core/loader/toml-parser";

export interface CodexImportResult {
  ir: IRResource[];
  diagnostics: Diagnostic[];
}

interface CodexConfig {
  model?: string;
  review_model?: string;
  model_provider?: string;
  model_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  model_reasoning_summary?: "auto" | "concise" | "detailed" | "none";
  model_verbosity?: "low" | "medium" | "high";
  approval_policy?: string | Record<string, unknown>;
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access";
  default_permissions?: Record<string, unknown>;
  developer_instructions?: string;
  model_instructions_file?: string;
  compact_prompt?: string;
  features?: {
    hooks?: boolean;
    multi_agent?: boolean;
    shell_tool?: boolean;
    unified_exec?: boolean;
  };
  hooks?: CodexHooksByEvent;
  mcp_servers?: Record<string, CodexMcpServerDef>;
  permissions?: Record<string, Record<string, unknown>>;
  agents?: {
    max_threads?: number;
    max_depth?: number;
    job_max_runtime_seconds?: number;
  };
  skills?: { config?: Record<string, unknown> };
  plugins?: Record<string, { enabled?: boolean; mcp_servers?: Record<string, unknown> }>;
  [key: string]: unknown;
}

interface CodexAgentToml {
  name: string;
  description: string;
  developer_instructions: string;
  nickname_candidates?: string[];
  model?: string;
  model_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access";
  mcp_servers?: Record<string, unknown> | string[];
  skills?: { config?: Record<string, unknown> };
  approval_policy?: string | Record<string, unknown>;
  permissionProfiles?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  agents?: {
    max_threads?: number;
    max_depth?: number;
    job_max_runtime_seconds?: number;
  };
  [key: string]: unknown;
}

interface CodexHooksJson {
  hooks?: CodexHooksByEvent;
}

type CodexHooksByEvent = Record<string, CodexHookGroup[]>;

interface CodexHookGroup {
  id?: string;
  matcher?: string;
  hooks?: CodexHookHandler[];
}

interface CodexHookHandler {
  type: "command" | "prompt" | "agent";
  command?: string;
  prompt?: string;
  model?: string;
  async?: boolean;
  timeout?: number;
  statusMessage?: string;
  commandWindows?: string;
  command_windows?: string;
}

type CodexMcpJson =
  | { mcp_servers: Record<string, CodexMcpServerDef> }
  | Record<string, CodexMcpServerDef>;

interface CodexEnvVarRef {
  name: string;
  source?: string;
}

interface CodexMcpServerDef {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  env_vars?: Array<string | CodexEnvVarRef>;
  url?: string;
  bearer_token_env_var?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  startup_timeout_sec?: number;
  startup_timeout_ms?: number;
  tool_timeout_sec?: number;
  enabled?: boolean;
  enabled_tools?: string[];
  disabled_tools?: string[];
  [key: string]: unknown;
}

interface CodexPluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  apps?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  interface?: Record<string, unknown>;
  [key: string]: unknown;
}

export function importCodex(
  projectDir: string,
): CodexImportResult {
  const absDir = resolve(projectDir);
  const diagnostics: Diagnostic[] = [];
  const ir: IRResource[] = [];

  const agentsDir = join(absDir, ".codex", "agents");
  if (existsSync(agentsDir)) {
    for (const entry of sortedReaddir(agentsDir)) {
      if (!entry.endsWith(".toml")) continue;
      const id = entry.replace(/\.toml$/, "");
      const filePath = join(agentsDir, entry);
      const agent = importCodexAgent(id, filePath, diagnostics);
      if (agent !== undefined) ir.push(agent);
    }
  }

  const hooksPath = join(absDir, ".codex", "hooks.json");
  if (existsSync(hooksPath)) {
    const hooks = importCodexHooks(hooksPath, diagnostics);
    ir.push(...hooks);
  }

  const mcpPath = join(absDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const mcps = importCodexMcp(mcpPath, diagnostics);
    ir.push(...mcps);
  }

  const configPath = join(absDir, ".codex", "config.toml");
  if (existsSync(configPath)) {
    const config = readTomlFile<CodexConfig>(configPath, diagnostics);
    if (config !== undefined) {
      if (config.mcp_servers !== undefined) {
        for (const [id, serverDef] of Object.entries(config.mcp_servers)) {
          const mcp = mapCodexMcpServer(id, serverDef, configPath, "wrapped", diagnostics);
          if (mcp !== undefined) ir.push(mcp);
        }
      }

      if (config.hooks !== undefined) {
        ir.push(...importCodexHookGroups(config.hooks, configPath, diagnostics));
      }

    }
  }

  const pluginManifestPath = join(absDir, ".codex-plugin", "plugin.json");
  if (existsSync(pluginManifestPath)) {
    const manifest = readJsonFile<CodexPluginManifest>(pluginManifestPath, diagnostics);
    if (manifest !== undefined) {
      diagnostics.push({
        severity: "info",
        code: "mcp.envelope.normalized",
        message: `Codex plugin manifest loaded: ${manifest.name ?? "unnamed"}`,
        details: { file: pluginManifestPath, name: manifest.name },
      });
    }
  }

  return { ir, diagnostics };
}

// ---------------------------------------------------------------------------
// Agent importer
// ---------------------------------------------------------------------------

function importCodexAgent(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
): AgentIR | undefined {
  const data = readTomlFile<CodexAgentToml>(filePath, diagnostics);
  if (data === undefined) return undefined;

  const name = data.name ?? id;
  const description = data.description ?? "";
  const prompt = data.developer_instructions ?? "";

  const approvalPolicy = data.approval_policy;
  if (approvalPolicy === "on-failure") {
    diagnostics.push({
      severity: "error",
      code: "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
      message: "Codex approval_policy 'on-failure' is not supported.",
      details: { id, approvalPolicy },
    });
    return undefined;
  }

  const platform: Record<string, unknown> = {};
  if (data.nickname_candidates !== undefined) platform.nickname_candidates = data.nickname_candidates;
  if (data.model_reasoning_effort !== undefined) platform.model_reasoning_effort = data.model_reasoning_effort;
  if (approvalPolicy !== undefined) platform.approval_policy = approvalPolicy;
  if (data.permissionProfiles !== undefined) platform.permissionProfiles = data.permissionProfiles;
  if (data.permissions !== undefined) platform.permissions = data.permissions;
  if (data.skills !== undefined) platform.skills = data.skills;
  if (data.agents !== undefined) platform.agents = data.agents;

  if (data.mcp_servers !== undefined) {
    if (!Array.isArray(data.mcp_servers) && typeof data.mcp_servers === "object") {
      platform.mcp_servers = data.mcp_servers;
    }
  }

  const sandbox = data.sandbox_mode ?? "read-only";

  const common: AgentIR["common"] = {
    name,
    description,
    prompt,
    model: data.model,
  };

  if (Array.isArray(data.mcp_servers) && data.mcp_servers.every((s) => typeof s === "string")) {
    common.mcpServers = data.mcp_servers;
  }

  const permissions = {
    default: "ask" as const,
    tools: {},
    bash: { allow: [], ask: [], deny: [] },
    sandbox,
    platform: { codex: { approval_policy: approvalPolicy, permissions: data.permissions } },
    _sources: {},
  };

  return {
    id,
    kind: "agent",
    sourcePath: filePath,
    common: { ...common, permissions },
    platform: { codex: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "codex", sourceFiles: [filePath] },
    _sources: {},
  } as AgentIR;
}

function importCodexHooks(
  filePath: string,
  diagnostics: Diagnostic[],
): HookIR[] {
  const hooksJson = readJsonFile<CodexHooksJson>(filePath, diagnostics);
  if (hooksJson === undefined) return [];

  return hooksJson.hooks === undefined ? [] : importCodexHookGroups(hooksJson.hooks, filePath, diagnostics);
}

function importCodexHookGroups(
  entries: CodexHooksByEvent,
  filePath: string,
  diagnostics: Diagnostic[],
): HookIR[] {
  const result: HookIR[] = [];
  const validCodexEvents = new Set<string>(CODEX_HOOK_EVENTS);
  const matcherIgnoredEvents = new Set(["UserPromptSubmit", "Stop"]);

  for (const [event, groups] of Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))) {
    if (!validCodexEvents.has(event)) {
      diagnostics.push({
        severity: "warn",
        code: "codex.hooks.event.dropped",
        message: `Codex hook has unsupported event '${event}'; dropping.`,
        details: { event },
      });
      continue;
    }

    for (const [groupIdx, entry] of groups.entries()) {
      const hookId = entry.id ?? `${event}-${groupIdx + 1}`;
      const actions: HookActionIR[] = [];
      const hookDiagnostics: Diagnostic[] = [];

      if (matcherIgnoredEvents.has(event) && entry.matcher !== undefined) {
        hookDiagnostics.push({
          severity: "info",
          code: "codex.hooks.matcher.ignored",
          message: `Codex ignores matcher for event '${event}'.`,
          details: { hookId, event },
        });
      }

      for (const handler of entry.hooks ?? []) {
        const action = mapCodexHandler(handler, hookId, hookDiagnostics);
        if (action !== undefined) actions.push(action);
      }

      if (actions.length === 0) continue;

      const platform: Record<string, unknown> = {};
      if (entry.matcher !== undefined) platform.matcher = entry.matcher;

      result.push({
        id: hookId,
        kind: "hook",
        sourcePath: filePath,
        common: {
          name: hookId,
          description: `Imported Codex hook`,
          events: [event as HookEvent],
          actions,
        },
        platform: { codex: Object.keys(platform).length > 0 ? platform : undefined },
        diagnostics: hookDiagnostics.length > 0 ? hookDiagnostics : undefined,
        provenance: { importedFrom: "codex", sourceFiles: [filePath] },
        _sources: {},
      } as HookIR);

      diagnostics.push(...hookDiagnostics);
    }
  }

  return result;
}

function mapCodexHandler(
  handler: CodexHookHandler,
  hookId: string,
  diagnostics: Diagnostic[],
): HookActionIR | undefined {
  switch (handler.type) {
    case "command":
      return {
        type: "run_command",
        command: handler.command ?? "",
        timeoutMs: handler.timeout === undefined ? undefined : handler.timeout * 1000,
      };
    case "prompt":
      diagnostics.push({
        severity: "warn",
        code: "codex.hooks.handler.prompt.skipped",
        message: `Codex hook ${hookId} has 'prompt' handler; parsed but skipped by Codex runtime.`,
        details: { hookId, handlerType: "prompt" },
      });
      return {
        type: "invoke_prompt",
        prompt: handler.prompt ?? "",
        model: handler.model,
      };
    case "agent":
      diagnostics.push({
        severity: "warn",
        code: "codex.hooks.handler.agent.skipped",
        message: `Codex hook ${hookId} has 'agent' handler; parsed but skipped by Codex runtime.`,
        details: { hookId, handlerType: "agent" },
      });
      return {
        type: "invoke_agent",
        prompt: handler.prompt ?? "",
        model: handler.model,
      };
    default:
      return undefined;
  }
}

function importCodexMcp(
  filePath: string,
  diagnostics: Diagnostic[],
): McpServerIR[] {
  const raw = readJsonFile<Record<string, unknown>>(filePath, diagnostics);
  if (raw === undefined) return [];

  let isWrapped = false;
  let servers: Record<string, CodexMcpServerDef>;

  if ("mcp_servers" in raw && typeof raw.mcp_servers === "object" && raw.mcp_servers !== null) {
    isWrapped = true;
    servers = raw.mcp_servers as Record<string, CodexMcpServerDef>;
  } else {
    servers = raw as Record<string, CodexMcpServerDef>;
  }

  const sourceShape = isWrapped ? "wrapped" : "direct";
  const result: McpServerIR[] = [];

  for (const [id, serverDef] of Object.entries(servers)) {
    const mcp = mapCodexMcpServer(id, serverDef, filePath, sourceShape, diagnostics);
    if (mcp !== undefined) result.push(mcp);
  }

  return result;
}

function mapCodexMcpServer(
  id: string,
  def: CodexMcpServerDef,
  filePath: string,
  sourceShape: "direct" | "wrapped",
  diagnostics: Diagnostic[],
): McpServerIR | undefined {
  const hasCommand = def.command !== undefined;
  const hasUrl = def.url !== undefined;

  const transport = hasCommand ? "stdio" : hasUrl ? "http" : undefined;
  if (transport === undefined) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `Codex MCP server ${id} has neither command nor url; skipping.`,
      details: { id, file: filePath },
    });
    return undefined;
  }

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
  }

  const platform: Record<string, unknown> = {};
  if (def.cwd !== undefined) platform.cwd = def.cwd;
  if (def.env_vars !== undefined) platform.env_vars = def.env_vars;
  if (def.bearer_token_env_var !== undefined) platform.bearer_token_env_var = def.bearer_token_env_var;
  if (def.env_http_headers !== undefined) platform.env_http_headers = def.env_http_headers;
  if (def.http_headers !== undefined) platform.http_headers = def.http_headers;
  if (def.enabled !== undefined) common.enabled = def.enabled;
  if (def.enabled_tools !== undefined) platform.enabled_tools = def.enabled_tools;
  if (def.disabled_tools !== undefined) platform.disabled_tools = def.disabled_tools;

  return {
    id,
    kind: "mcp",
    sourcePath: filePath,
    common,
    mcpEnvelope: {
      sourceShape,
      emitShape: "wrapped",
      wrapperKey: "mcp_servers",
    },
    platform: { codex: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "codex", sourceFiles: [filePath] },
    _sources: {},
  } as McpServerIR;
}

function readTomlFile<T>(filePath: string, diagnostics: Diagnostic[]): T | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    return parseToml(content) as T;
  } catch (error) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `Failed to parse TOML file: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: filePath },
    });
    return undefined;
  }
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
