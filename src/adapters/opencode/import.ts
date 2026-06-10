import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
import { parseYamlFrontmatter } from "../../core/loader/yaml-parser";
import { loadReferencesFromDir } from "../_shared/references";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenCodeImportResult {
  ir: IRResource[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// OpenCode config shape (subset we care about for import)
// ---------------------------------------------------------------------------

interface OpenCodeConfig {
  agent?: Record<string, OpenCodeAgentConfig>;
  mcp?: Record<string, OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig>;
  command?: Record<string, OpenCodeCommandConfig>;
  permission?: Record<string, unknown>;
  plugin?: string[];
  skills?: { paths?: string[] };
}

interface OpenCodeAgentConfig {
  description?: string;
  mode?: string;
  model?: string;
  variant?: string;
  temperature?: number;
  top_p?: number;
  color?: string;
  permission?: Record<string, unknown>;
  disable?: boolean;
  hidden?: boolean;
  steps?: unknown[];
  maxSteps?: number;
  options?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  prompt?: string;
  external_directory?: Record<string, unknown>;
}

interface OpenCodeMcpLocalConfig {
  type: "local";
  command: string | string[];
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

interface OpenCodeMcpRemoteConfig {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: Record<string, unknown>;
  enabled?: boolean;
  timeout?: number;
}

interface OpenCodeCommandConfig {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

// ---------------------------------------------------------------------------
// Recognized OpenCode plugin hook keys (@opencode-ai/plugin@1.15.12)
// ---------------------------------------------------------------------------

const OPENCODE_PLUGIN_HOOK_KEYS = new Set([
  "dispose",
  "event",
  "config",
  "tool",
  "auth",
  "provider",
  "chat.message",
  "chat.params",
  "chat.headers",
  "permission.ask",
  "command.execute.before",
  "tool.execute.before",
  "shell.env",
  "tool.execute.after",
  "experimental.chat.messages.transform",
  "experimental.chat.system.transform",
  "experimental.session.compacting",
  "experimental.compaction.autocontinue",
  "experimental.text.complete",
  "tool.definition",
]);

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

export function importOpenCode(projectDir: string): OpenCodeImportResult {
  const absDir = resolve(projectDir);
  const diagnostics: Diagnostic[] = [];
  const ir: IRResource[] = [];

  // 1. Read opencode.json / opencode.jsonc
  const config = readOpenCodeConfig(absDir, diagnostics);

  // 2. Import agents from .opencode/agents/*.md
  const agentDir = join(absDir, ".opencode", "agents");
  if (existsSync(agentDir)) {
    for (const entry of sortedReaddir(agentDir)) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.replace(/\.md$/, "");
      const filePath = join(agentDir, entry);
      const agent = importMarkdownAgent(id, filePath, diagnostics);
      if (agent !== undefined) ir.push(agent);
    }
  }

  // 3. Import agents from config
  if (config.agent !== undefined) {
    for (const [id, agentConfig] of Object.entries(config.agent)) {
      const agent = importConfigAgent(id, agentConfig, absDir, diagnostics);
      if (agent !== undefined) ir.push(agent);
    }
  }

  // 4. Import skills from .opencode/skills/<id>/SKILL.md
  const skillDir = join(absDir, ".opencode", "skills");
  if (existsSync(skillDir)) {
    for (const entry of sortedReaddir(skillDir)) {
      const skillPath = join(skillDir, entry, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const skill = importSkill(entry, skillPath, diagnostics);
      if (skill !== undefined) ir.push(skill);
    }
  }

  // 5. Import MCP servers from config
  if (config.mcp !== undefined) {
    for (const [id, mcpConfig] of Object.entries(config.mcp)) {
      const mcp = importMcpServer(id, mcpConfig, absDir, diagnostics);
      if (mcp !== undefined) ir.push(mcp);
    }
  }

  // 6. Import commands from .opencode/commands/<id>.md
  const commandDir = join(absDir, ".opencode", "commands");
  if (existsSync(commandDir)) {
    for (const entry of sortedReaddir(commandDir)) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.replace(/\.md$/, "");
      const filePath = join(commandDir, entry);
      const command = importMarkdownCommand(id, filePath, diagnostics);
      if (command !== undefined) ir.push(command);
    }
  }

  // 7. Import commands from config
  if (config.command !== undefined) {
    for (const [id, cmdConfig] of Object.entries(config.command)) {
      const command = importConfigCommand(id, cmdConfig, absDir, diagnostics);
      if (command !== undefined) ir.push(command);
    }
  }

  // 8. Import plugins as opaque hooks
  const pluginDir = join(absDir, ".opencode", "plugins");
  if (existsSync(pluginDir)) {
    for (const entry of sortedReaddir(pluginDir)) {
      if (!entry.endsWith(".js") && !entry.endsWith(".ts")) continue;
      const id = entry.replace(/\.(js|ts)$/, "");
      const filePath = join(pluginDir, entry);
      const hook = importPluginAsHook(id, filePath, diagnostics);
      if (hook !== undefined) ir.push(hook);
    }
  }

  return { ir, diagnostics };
}

// ---------------------------------------------------------------------------
// Agent importers
// ---------------------------------------------------------------------------

function importMarkdownAgent(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
): AgentIR | undefined {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseYamlFrontmatter(content);
  const fm = parsed.frontmatter;

  const role = mapAgentRole(fm.mode as string | undefined, id, diagnostics);
  const prompt = parsed.body.trim();

  if (!fm.name && !fm.description && !prompt) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `OpenCode agent ${id} has no name, description, or prompt body; skipping.`,
      details: { id, file: filePath },
    });
    return undefined;
  }

  const platform: Record<string, unknown> = {};
  if (fm.color !== undefined) platform.color = fm.color;
  if (fm.variant !== undefined) platform.variant = fm.variant;
  if (fm.top_p !== undefined) platform.top_p = fm.top_p;
  if (fm.disable !== undefined) platform.disable = fm.disable;
  if (fm.hidden !== undefined) platform.hidden = fm.hidden;
  if (fm.steps !== undefined) platform.steps = fm.steps;
  if (fm.maxSteps !== undefined) platform.maxSteps = fm.maxSteps;
  if (fm.options !== undefined) platform.options = fm.options;
  if (fm.external_directory !== undefined) platform.external_directory = fm.external_directory;

  const permissions = fm.permission !== undefined
    ? mapOpenCodePermission(fm.permission as Record<string, unknown>)
    : undefined;
  const references = loadReferencesFromDir(join(dirname(filePath), id, "references"));
  const sourceFiles = references.sourceFiles.length > 0
    ? [filePath, ...references.sourceFiles]
    : [filePath];

  return {
    id,
    kind: "agent",
    sourcePath: filePath,
    common: {
      name: (fm.name as string) ?? id,
      description: (fm.description as string) ?? "",
      role,
      model: fm.model as string | undefined,
      temperature: fm.temperature as number | undefined,
      permissions,
      prompt: prompt || (fm.prompt as string) || "",
    },
    references: Object.keys(references.files).length > 0 ? references.files : undefined,
    platform: { opencode: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "opencode", sourceFiles },
    _sources: {},
  } as AgentIR;
}

function importConfigAgent(
  id: string,
  config: OpenCodeAgentConfig,
  projectDir: string,
  diagnostics: Diagnostic[],
): AgentIR | undefined {
  const role = mapAgentRole(config.mode, id, diagnostics);
  const prompt = config.prompt ?? "";

  const platform: Record<string, unknown> = {};
  if (config.color !== undefined) platform.color = config.color;
  if (config.variant !== undefined) platform.variant = config.variant;
  if (config.top_p !== undefined) platform.top_p = config.top_p;
  if (config.disable !== undefined) platform.disable = config.disable;
  if (config.hidden !== undefined) platform.hidden = config.hidden;
  if (config.options !== undefined) platform.options = config.options;
  if (config.external_directory !== undefined) platform.external_directory = config.external_directory;

  const permissions = config.permission !== undefined
    ? mapOpenCodePermission(config.permission)
    : undefined;

  const sourcePath = join(projectDir, "opencode.json");

  return {
    id,
    kind: "agent",
    sourcePath,
    common: {
      name: config.description ? id : id,
      description: config.description ?? "",
      role,
      model: config.model,
      temperature: config.temperature,
      permissions,
      prompt,
    },
    platform: { opencode: Object.keys(platform).length > 0 ? platform : undefined },
    provenance: { importedFrom: "opencode", sourceFiles: [sourcePath] },
    _sources: {},
  } as AgentIR;
}

function mapAgentRole(
  mode: string | undefined,
  id: string,
  diagnostics: Diagnostic[],
): "primary" | "subagent" | undefined {
  if (mode === undefined) return undefined;
  if (mode === "primary" || mode === "subagent") return mode;
  if (mode === "all") {
    diagnostics.push({
      severity: "info",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `OpenCode agent ${id} uses mode 'all'; mapping to 'primary'.`,
      details: { id, field: "mode", value: "all" },
    });
    return "primary";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Skill importer
// ---------------------------------------------------------------------------

function importSkill(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
): SkillIR | undefined {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseYamlFrontmatter(content);
  const fm = parsed.frontmatter;

  // Recognized native fields
  const native: Record<string, unknown> = {};
  if (fm.license !== undefined) native.license = fm.license;
  if (fm.compatibility !== undefined) native.compatibility = fm.compatibility;
  if (fm.metadata !== undefined) native.metadata = fm.metadata;

  // Pass unknown fields to platform.opencode
  const knownKeys = new Set(["name", "description", "license", "compatibility", "metadata", "schema"]);
  const platformOpaque: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!knownKeys.has(key)) {
      platformOpaque[key] = value;
    }
  }
  const references = loadReferencesFromDir(join(dirname(filePath), "references"));
  const sourceFiles = references.sourceFiles.length > 0
    ? [filePath, ...references.sourceFiles]
    : [filePath];

  return {
    id,
    kind: "skill",
    sourcePath: filePath,
    common: {
      name: (fm.name as string) ?? id,
      description: (fm.description as string) ?? "",
      body: parsed.body.trim(),
    },
    references: Object.keys(references.files).length > 0 ? references.files : undefined,
    platform: {
      opencode: Object.keys({ ...native, ...platformOpaque }).length > 0
        ? { ...native, ...platformOpaque }
        : undefined,
    },
    provenance: { importedFrom: "opencode", sourceFiles },
    _sources: {},
  } as SkillIR;
}

// ---------------------------------------------------------------------------
// MCP server importer
// ---------------------------------------------------------------------------

function importMcpServer(
  id: string,
  config: OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig,
  projectDir: string,
  diagnostics: Diagnostic[],
): McpServerIR | undefined {
  const sourcePath = join(projectDir, "opencode.json");

  if (config.type === "local") {
    const command = Array.isArray(config.command) ? config.command[0] : config.command;
    const args = Array.isArray(config.command) ? config.command.slice(1) : undefined;
    const env = config.environment ?? {};

    const platform: Record<string, unknown> = {};
    if (config.timeout !== undefined) platform.timeout = config.timeout;

    return {
      id,
      kind: "mcp",
      sourcePath,
      common: {
        name: id,
        transport: "stdio",
        command,
        args,
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled: config.enabled,
      },
      mcpEnvelope: { sourceShape: "config", emitShape: "config", wrapperKey: "" },
      platform: { opencode: Object.keys(platform).length > 0 ? platform : undefined },
      provenance: { importedFrom: "opencode", sourceFiles: [sourcePath] },
      _sources: {},
    } as McpServerIR;
  }

  if (config.type === "remote") {
    const platform: Record<string, unknown> = {};
    if (config.oauth !== undefined) platform.oauth = config.oauth;
    if (config.timeout !== undefined) platform.timeout = config.timeout;

    return {
      id,
      kind: "mcp",
      sourcePath,
      common: {
        name: id,
        transport: "http",
        url: config.url,
        headers: config.headers,
        enabled: config.enabled,
      },
      mcpEnvelope: { sourceShape: "config", emitShape: "config", wrapperKey: "" },
      platform: { opencode: Object.keys(platform).length > 0 ? platform : undefined },
      provenance: { importedFrom: "opencode", sourceFiles: [sourcePath] },
      _sources: {},
    } as McpServerIR;
  }

  diagnostics.push({
    severity: "warn",
    code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
    message: `Unknown OpenCode MCP type for server ${id}; skipping.`,
    details: { id, type: (config as Record<string, unknown>).type },
  });
  return undefined;
}

// ---------------------------------------------------------------------------
// Command importers
// ---------------------------------------------------------------------------

function importMarkdownCommand(
  id: string,
  filePath: string,
  _diagnostics: Diagnostic[],
): CommandIR | undefined {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseYamlFrontmatter(content);
  const fm = parsed.frontmatter;

  return {
    id,
    kind: "command",
    sourcePath: filePath,
    common: {
      name: (fm.name as string) ?? id,
      description: (fm.description as string) ?? "",
      agent: fm.agent as string | undefined,
      model: fm.model as string | undefined,
      template: parsed.body.trim(),
    },
    platform: {},
    provenance: { importedFrom: "opencode", sourceFiles: [filePath] },
    _sources: {},
  } as CommandIR;
}

function importConfigCommand(
  id: string,
  config: OpenCodeCommandConfig,
  projectDir: string,
  _diagnostics: Diagnostic[],
): CommandIR | undefined {
  const sourcePath = join(projectDir, "opencode.json");

  return {
    id,
    kind: "command",
    sourcePath,
    common: {
      name: id,
      description: config.description ?? "",
      agent: config.agent,
      model: config.model,
      template: config.template,
    },
    platform: {},
    provenance: { importedFrom: "opencode", sourceFiles: [sourcePath] },
    _sources: {},
  } as CommandIR;
}

// ---------------------------------------------------------------------------
// Plugin → opaque HookIR importer
// ---------------------------------------------------------------------------

function importPluginAsHook(
  id: string,
  filePath: string,
  diagnostics: Diagnostic[],
): HookIR | undefined {
  const body = readFileSync(filePath, "utf8");

  diagnostics.push({
    severity: "info",
    code: "opencode.hook.runtime_code_opaque",
    message: `OpenCode plugin ${id} imported as opaque runtime_code; hook keys cannot be determined without execution.`,
    details: { id, file: filePath },
  });

  // We cannot determine which hook events the plugin subscribes to without
  // executing it. Use a placeholder event set. The consumer can refine this
  // by running the plugin or inspecting the source.
  const placeholderEvents: HookEvent[] = [];

  return {
    id,
    kind: "hook",
    sourcePath: filePath,
    common: {
      name: id,
      description: `Imported OpenCode plugin: ${id}`,
      enabled: true,
      events: placeholderEvents,
      runtime: "opencode-only",
      actions: [{
        type: "runtime_code",
        runtime: "opencode",
        body,
      }],
    },
    platform: { opencode: { jsFile: filePath } },
    runtimeFiles: { opencodeJs: filePath },
    provenance: { importedFrom: "opencode", sourceFiles: [filePath] },
    _sources: {},
  } as HookIR;
}

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

function mapOpenCodePermission(
  perm: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (Object.keys(perm).length === 0) return undefined;

  // OpenCode permission uses allow/ask/deny per tool key.
  // Map to IR PermissionIR shape as best we can.
  const tools: Record<string, "allow" | "ask" | "deny"> = {};
  let defaultVerdict: "allow" | "ask" | "deny" | undefined;

  for (const [key, value] of Object.entries(perm)) {
    if (key === "*") {
      defaultVerdict = value as "allow" | "ask" | "deny";
      continue;
    }
    if (typeof value === "string" && ["allow", "ask", "deny"].includes(value)) {
      tools[key] = value as "allow" | "ask" | "deny";
      continue;
    }
    // Object syntax: { "pattern": "verdict" }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [pattern, verdict] of Object.entries(value as Record<string, unknown>)) {
        if (typeof verdict === "string" && ["allow", "ask", "deny"].includes(verdict)) {
          tools[`${key}.${pattern}`] = verdict as "allow" | "ask" | "deny";
        }
      }
    }
  }

  return {
    default: defaultVerdict ?? "ask",
    tools,
    bash: { allow: [], ask: [], deny: [] },
    sandbox: "read-only",
    platform: { opencode: perm },
    _sources: {},
  };
}

// ---------------------------------------------------------------------------
// Config reader
// ---------------------------------------------------------------------------

function readOpenCodeConfig(
  projectDir: string,
  diagnostics: Diagnostic[],
): OpenCodeConfig {
  const jsonPath = join(projectDir, "opencode.json");
  const jsoncPath = join(projectDir, "opencode.jsonc");

  let configPath: string | undefined;
  let raw: string | undefined;

  if (existsSync(jsonPath)) {
    configPath = jsonPath;
    raw = readFileSync(jsonPath, "utf8");
  } else if (existsSync(jsoncPath)) {
    configPath = jsoncPath;
    raw = readFileSync(jsoncPath, "utf8");
    // Strip JSONC comments (simple line-comment stripping)
    raw = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  }

  if (raw === undefined || configPath === undefined) {
    return {};
  }

  try {
    return JSON.parse(raw) as OpenCodeConfig;
  } catch (error) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
      message: `Failed to parse OpenCode config: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: configPath },
    });
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedReaddir(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => a.localeCompare(b));
}
