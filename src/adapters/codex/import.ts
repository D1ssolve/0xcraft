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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CodexImportOptions {
  nonInteractive?: boolean;
}

export interface CodexImportResult {
  ir: IRResource[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Codex config.toml shape
// ---------------------------------------------------------------------------

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
  hooks?: Record<string, unknown>;
  codex_hooks?: Record<string, unknown>; // deprecated alias
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

// ---------------------------------------------------------------------------
// Codex agent TOML shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Codex hooks.json shape
// ---------------------------------------------------------------------------

interface CodexHooksJson {
  hooks?: CodexHookEntry[];
  codex_hooks?: CodexHookEntry[]; // deprecated alias
}

interface CodexHookEntry {
  id?: string;
  events?: string[];
  matcher?: string;
  handlers?: CodexHookHandler[];
}

interface CodexHookHandler {
  type: "command" | "prompt" | "agent";
  command?: string;
  prompt?: string;
  model?: string;
  async?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Codex .mcp.json shape (two variants)
// ---------------------------------------------------------------------------

type CodexMcpJson =
  | { mcp_servers: Record<string, CodexMcpServerDef> }  // wrapped
  | Record<string, CodexMcpServerDef>;                   // direct

interface CodexMcpServerDef {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  env_vars?: Record<string, string>;
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

// ---------------------------------------------------------------------------
// Codex plugin manifest shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

export function importCodex(
  projectDir: string,
  options?: CodexImportOptions,
): CodexImportResult {
  const absDir = resolve(projectDir);
  const diagnostics: Diagnostic[] = [];
  const ir: IRResource[] = [];
  const nonInteractive = options?.nonInteractive ?? false;

  // 1. Import agents from .codex/agents/*.toml
  const agentsDir = join(absDir, ".codex", "agents");
  if (existsSync(agentsDir)) {
    for (const entry of sortedReaddir(agentsDir)) {
      if (!entry.endsWith(".toml")) continue;
      const id = entry.replace(/\.toml$/, "");
      const filePath = join(agentsDir, entry);
      const agent = importCodexAgent(id, filePath, nonInteractive, diagnostics);
      if (agent !== undefined) ir.push(agent);
    }
  }

  // 2. Import hooks from .codex/hooks.json
  const hooksPath = join(absDir, ".codex", "hooks.json");
  if (existsSync(hooksPath)) {
    const hooks = importCodexHooks(hooksPath, diagnostics);
    ir.push(...hooks);
  }

  // 3. Import MCP from .mcp.json
  const mcpPath = join(absDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const mcps = importCodexMcp(mcpPath, diagnostics);
    ir.push(...mcps);
  }

  // 4. Import MCP from config.toml mcp_servers
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

      // Check for deprecated codex_hooks in config
      if (config.codex_hooks !== undefined) {
        diagnostics.push({
          severity: "warn",
          code: "codex.hooks.codex_hooks.deprecated",
          message: "Config uses deprecated 'codex_hooks' key; use 'hooks' instead.",
          details: { file: configPath },
        });
      }
    }
  }

  // 5. Import plugin manifest
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
  nonInteractive: boolean,
  diagnostics: Diagnostic[],
): AgentIR | undefined {
  const data = readTomlFile<CodexAgentToml>(filePath, diagnostics);
  if (data === undefined) return undefined;

  // Required fields
  const name = data.name ?? id;
  const description = data.description ?? "";
  const prompt = data.developer_instructions ?? "";

  // Handle approval_policy deprecation
  let approvalPolicy = data.approval_policy;
  let deprecatedOnFailure = false;
  if (approvalPolicy === "on-failure") {
    diagnostics.push({
      severity: "warn",
      code: "codex.approval_policy.on-failure.deprecated",
      message: `Agent ${id} uses deprecated approval_policy 'on-failure'; rewriting to '${nonInteractive ? "never" : "on-request"}'.`,
      details: { id, originalPolicy: "on-failure", rewrittenPolicy: nonInteractive ? "never" : "on-request" },
    });
    approvalPolicy = nonInteractive ? "never" : "on-request";
    deprecatedOnFailure = true;
  }

  // Build platform.codex
  const platform: Record<string, unknown> = {};
  if (data.nickname_candidates !== undefined) platform.nickname_candidates = data.nickname_candidates;
  if (data.model_reasoning_effort !== undefined) platform.model_reasoning_effort = data.model_reasoning_effort;
  if (approvalPolicy !== undefined) platform.approval_policy = approvalPolicy;
  if (data.permissionProfiles !== undefined) platform.permissionProfiles = data.permissionProfiles;
  if (data.permissions !== undefined) platform.permissions = data.permissions;
  if (data.skills !== undefined) platform.skills = data.skills;
  if (data.agents !== undefined) platform.agents = data.agents;

  // mcp_servers: string refs → common.mcpServers, inline → platform
  if (data.mcp_servers !== undefined) {
    if (Array.isArray(data.mcp_servers) && data.mcp_servers.every((s) => typeof s === "string")) {
      // String refs go to common
    } else if (typeof data.mcp_servers === "object" && !Array.isArray(data.mcp_servers)) {
      platform.mcp_servers = data.mcp_servers;
    }
  }

  // sandbox_mode → PermissionIR
  const sandbox = data.sandbox_mode ?? "read-only";

  const common: Record<string, unknown> = {
    name,
    description,
    prompt,
    model: data.model,
  };

  if (Array.isArray(data.mcp_servers) && data.mcp_servers.every((s) => typeof s === "string")) {
    common.mcpServers = data.mcp_servers;
  }

  // Build permissions from sandbox_mode
  const permissions = {
    default: "ask" as const,
    tools: {},
    bash: { allow: [], ask: [], deny: [] },
    sandbox,
    platform: { codex: { approval_policy: approvalPolicy, permissions: data.permissions } },
    _deprecatedOnFailure: deprecatedOnFailure,
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

// ---------------------------------------------------------------------------
// Hook importer
// ---------------------------------------------------------------------------

function importCodexHooks(
  filePath: string,
  diagnostics: Diagnostic[],
): HookIR[] {
  const hooksJson = readJsonFile<CodexHooksJson>(filePath, diagnostics);
  if (hooksJson === undefined) return [];

  // Handle deprecated codex_hooks alias
  let entries = hooksJson.hooks;
  if (entries === undefined && hooksJson.codex_hooks !== undefined) {
    diagnostics.push({
      severity: "warn",
      code: "codex.hooks.codex_hooks.deprecated",
      message: "hooks.json uses deprecated 'codex_hooks' key; use 'hooks' instead.",
      details: { file: filePath },
    });
    entries = hooksJson.codex_hooks;
  }

  if (entries === undefined) return [];

  const result: HookIR[] = [];
  const validCodexEvents = new Set<string>(CODEX_HOOK_EVENTS);
  const matcherIgnoredEvents = new Set(["UserPromptSubmit", "Stop"]);

  for (const entry of entries) {
    const hookId = entry.id ?? `codex-hook-${result.length + 1}`;
    const actions: HookActionIR[] = [];
    const hookDiagnostics: Diagnostic[] = [];

    // Validate events
    const validEvents: HookEvent[] = [];
    if (entry.events !== undefined) {
      for (const event of entry.events) {
        if (!validCodexEvents.has(event)) {
          hookDiagnostics.push({
            severity: "warn",
            code: "codex.hooks.event.dropped",
            message: `Codex hook ${hookId} has unsupported event '${event}'; dropping.`,
            details: { hookId, event },
          });
          continue;
        }
        validEvents.push(event as HookEvent);

        // Matcher ignored for certain events
        if (matcherIgnoredEvents.has(event) && entry.matcher !== undefined) {
          hookDiagnostics.push({
            severity: "info",
            code: "codex.hooks.matcher.ignored",
            message: `Codex ignores matcher for event '${event}'.`,
            details: { hookId, event },
          });
        }
      }
    }

    if (validEvents.length === 0) continue;

    // Map handlers
    if (entry.handlers !== undefined) {
      for (const handler of entry.handlers) {
        const action = mapCodexHandler(handler, hookId, hookDiagnostics);
        if (action !== undefined) actions.push(action);
      }
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
        events: validEvents,
        actions,
      },
      platform: { codex: Object.keys(platform).length > 0 ? platform : undefined },
      diagnostics: hookDiagnostics.length > 0 ? hookDiagnostics : undefined,
      provenance: { importedFrom: "codex", sourceFiles: [filePath] },
      _sources: {},
    } as HookIR);

    // Merge hook-level diagnostics into top-level result
    diagnostics.push(...hookDiagnostics);
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
        timeoutMs: handler.timeoutMs,
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

// ---------------------------------------------------------------------------
// MCP importer
// ---------------------------------------------------------------------------

function importCodexMcp(
  filePath: string,
  diagnostics: Diagnostic[],
): McpServerIR[] {
  const raw = readJsonFile<Record<string, unknown>>(filePath, diagnostics);
  if (raw === undefined) return [];

  // Detect shape: wrapped (has mcp_servers key) or direct
  let isWrapped = false;
  let servers: Record<string, CodexMcpServerDef>;

  if ("mcp_servers" in raw && typeof raw.mcp_servers === "object" && raw.mcp_servers !== null) {
    isWrapped = true;
    servers = raw.mcp_servers as Record<string, CodexMcpServerDef>;
  } else {
    // Direct map: all top-level keys are server IDs
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
    // env takes precedence over env_vars for common
    if (def.env !== undefined) common.env = def.env;
  }

  if (transport === "http") {
    if (def.url !== undefined) common.url = def.url;
  }

  // Codex-specific platform fields
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
