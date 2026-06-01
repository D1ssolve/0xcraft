import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { PlatformArtifact, PlatformArtifactFile } from "../_shared/artifact";
import { serializeFrontmatter } from "../_shared/frontmatter";
import { ensureTrailingLf, normalizeLf, referencesToArtifactFiles, rewriteReferenceTokens } from "../_shared/references";
import { matrixDiagnosticFor } from "../../core/capability-matrix/diagnostics";
import type { CapabilityFeature } from "../../core/capability-matrix/matrix-types";
import type { Diagnostic } from "../../core/diagnostics";
import type { AgentIR, CommandIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { translateActionForPlatform } from "../../core/hook-runtime/translator";
import type { HookActionIR } from "../../core/hook-runtime/primitives";
import { createPathResolver } from "./path-resolver";
import type { OpenCodeEmitMode, OpenCodePathResolver } from "./path-resolver";

export type { OpenCodeEmitMode } from "./path-resolver";

export interface OpenCodePluginMetadata {
  readonly packageName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly license?: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly keywords?: readonly string[];
}

export interface EmitOptions {
  /** Reserved for future CLI build context; no timestamp or environment data is read. */
  readonly strict?: boolean;
  readonly mode?: OpenCodeEmitMode;
  readonly plugin?: OpenCodePluginMetadata;
}

type JsonObject = Record<string, unknown>;

interface OpenCodeConfig {
  agent?: Record<string, JsonObject>;
  mcp?: Record<string, JsonObject>;
  plugin?: string[];
}

export interface OpenCodeHookEmitResult {
  /** Map from artifact file path → content. Use PlatformArtifact later. */
  artifacts: Record<string, string>;
  diagnostics: Diagnostic[];
}

export function emitOpenCode(ir: IRResource[], opts: EmitOptions = {}): PlatformArtifact {
  const diagnostics: Diagnostic[] = [];
  const files: PlatformArtifactFile[] = [];
  const config: OpenCodeConfig = {};
  const hooks: HookIR[] = [];
  const resolver = createPathResolver(opts.mode ?? "filesystem");
  const isPlugin = resolver.mode === "plugin";

  for (const resource of [...ir].sort(compareResource)) {
    switch (resource.kind) {
      case "agent":
        files.push(...emitAgentFiles(resource, diagnostics, resolver));
        break;
      case "skill":
        files.push(...emitSkillFiles(resource, diagnostics, resolver));
        break;
      case "command":
        files.push(emitCommandFile(resource, resolver));
        break;
      case "mcp":
        addMcpConfig(config, resource, diagnostics);
        break;
      case "hook":
        hooks.push(resource);
        addHookCapabilityDiagnostics(resource, diagnostics);
        break;
    }
  }

  const hookResult = isPlugin
    ? emitPluginModeHooks(hooks, {
        packageName: pluginModuleId(opts.plugin?.packageName),
        mcp: config.mcp ?? {},
      })
    : emitOpenCodeHooks(hooks, resolver);
  diagnostics.push(...hookResult.diagnostics);
  for (const [path, content] of Object.entries(hookResult.artifacts)) {
    files.push({ path: isPlugin ? `.opencode-plugin/${path}` : path, content, mode: 0o644 });
  }

  if (isPlugin) {
    if (!hookResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      files.push(emitPluginPackageJson(opts.plugin, diagnostics));
    }
  } else {
    const pluginPaths = Object.keys(hookResult.artifacts)
      .sort((left, right) => left.localeCompare(right))
      .map((path) => `./${path}`);
    if (pluginPaths.length > 0) {
      config.plugin = pluginPaths;
    }

    files.push({ path: resolver.configFile(), content: `${stableStringify(config)}\n`, mode: 0o644 });
  }

  const sortedFiles = files
    .map((file) => ({ ...file, content: ensureTrailingLf(normalizeLf(file.content)) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const sortedDiagnostics = [...diagnostics].sort(compareDiagnostics);

  return {
    platform: "opencode",
    kind: "filesystem-tree",
    ok: !sortedDiagnostics.some((diagnostic) => diagnostic.severity === "error"),
    files: sortedFiles,
    diagnostics: sortedDiagnostics,
    capabilityReport: { platform: "opencode", features: {} as never },
    metadata: { deterministic: true },
  };
}

function emitAgentFiles(agent: AgentIR, diagnostics: Diagnostic[], resolver: OpenCodePathResolver): PlatformArtifactFile[] {
  diagnosePlatformOnlyFields(agent.platform.claude, "claude", diagnostics);
  diagnosePlatformOnlyFields(agent.platform.codex, "codex", diagnostics);

  const meta = sortedObject(removeUndefined({
    name: agent.common.name,
    description: agent.common.description,
    mode: agent.platform.opencode?.mode ?? agent.platform.opencode?.role ?? agent.common.role,
    model: agent.platform.opencode?.model ?? agent.common.model,
    temperature: agent.platform.opencode?.temperature ?? agent.common.temperature,
    mcpServers: agent.platform.opencode?.mcpServers ?? agent.common.mcpServers,
    permission: agent.platform.opencode?.permissions ?? agent.common.permissions?.platform?.opencode,
    color: agent.platform.opencode?.color,
    tools: agent.platform.opencode?.tools,
    enabled: agent.platform.opencode?.enabled,
    schema: agent.platform.opencode?.schema,
    plugin: agent.platform.opencode?.plugin,
    experimental: agent.platform.opencode?.experimental,
  }));

  const referencesDir = resolver.agentReferencesDir(agent.id);
  const body = rewriteReferenceTokens(agent.common.prompt, referencesDir);

  return [
    {
      path: resolver.agentFile(agent.id),
      content: frontmatterWithBody(meta, body),
      mode: 0o644,
    },
    ...referencesToArtifactFiles(agent.references, referencesDir),
  ];
}

function emitSkillFiles(skill: SkillIR, diagnostics: Diagnostic[], resolver: OpenCodePathResolver): PlatformArtifactFile[] {
  if (skill.common["allowed-tools"] !== undefined || skill.common["disallowed-tools"] !== undefined) {
    diagnostics.push(createSkillToolListDiagnostic(skill.id, "common"));
  }
  if (skill.platform.claude?.["allowed-tools"] !== undefined || skill.platform.claude?.["disallowed-tools"] !== undefined) {
    diagnostics.push(createSkillToolListDiagnostic(skill.id, "claude"));
  }
  if (skill.platform.opencode?.["allowed-tools"] !== undefined || skill.platform.opencode?.["disallowed-tools"] !== undefined) {
    diagnostics.push(createSkillToolListDiagnostic(skill.id, "opencode"));
  }
  const opencodeMeta = (skill.platform.opencode ?? {}) as Record<string, unknown>;
  const meta = sortedObject(removeUndefined({
    name: skill.common.name,
    description: skill.common.description,
    license: opencodeMeta.license,
    compatibility: opencodeMeta.compatibility,
    metadata: opencodeMeta.metadata,
  }));

  const referencesDir = resolver.skillReferencesDir(skill.id);
  const body = rewriteReferenceTokens(skill.common.body, referencesDir);

  return [
    {
      path: resolver.skillFile(skill.id),
      content: frontmatterWithBody(meta, body),
      mode: 0o644,
    },
    ...referencesToArtifactFiles(skill.references, referencesDir),
  ];
}

function emitCommandFile(command: CommandIR, resolver: OpenCodePathResolver): PlatformArtifactFile {
  const meta = sortedObject(removeUndefined({
    name: command.common.name,
    description: command.common.description,
    agent: command.common.agent,
    model: command.common.model,
    arguments: command.common.arguments,
  }));

  return {
    path: resolver.commandFile(command.id),
    content: frontmatterWithBody(meta, command.common.template),
    mode: 0o644,
  };
}

function emitPluginPackageJson(
  opts: OpenCodePluginMetadata | undefined,
  diagnostics: Diagnostic[],
): PlatformArtifactFile {
  const packageName = opts?.packageName ?? "0xcraft-opencode-plugin";
  if (!isValidNpmPackageName(packageName)) {
    diagnostics.push({
      severity: "error",
      code: "ERR_PLUGIN_INVALID_PACKAGE_NAME",
      message: "OpenCode plugin package name must be a valid npm package name.",
      details: { packageName, platform: "opencode" },
    });
  }

  const manifest = sortedObject(removeUndefined({
    name: packageName,
    version: opts?.version ?? "0.0.0",
    type: "module",
    main: "index.js",
    description: opts?.description,
    license: opts?.license,
    author: opts?.author,
    homepage: opts?.homepage,
    repository: opts?.repository,
    keywords: opts?.keywords === undefined ? undefined : [...opts.keywords],
    peerDependencies: {
      "@opencode-ai/sdk": ">=1.0.0",
    },
  }));

  return { path: ".opencode-plugin/package.json", content: `${stableStringify(manifest)}\n`, mode: 0o644 };
}

function isValidNpmPackageName(packageName: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(packageName)
    && packageName.length <= 214
    && !packageName.startsWith(".")
    && !packageName.startsWith("_")
    && !packageName.includes(" ");
}

function pluginModuleId(packageName: string | undefined): string {
  return packageName !== undefined && isValidNpmPackageName(packageName)
    ? packageName
    : "0xcraft-opencode-plugin";
}

function addMcpConfig(config: OpenCodeConfig, mcp: McpServerIR, diagnostics: Diagnostic[]): void {
  const mcpConfig = emitMcpConfig(mcp, diagnostics);
  if (mcpConfig === undefined) return;
  config.mcp = config.mcp ?? {};
  config.mcp[mcp.id] = mcpConfig;
}

function emitMcpConfig(mcp: McpServerIR, diagnostics: Diagnostic[]): JsonObject | undefined {
  const platformMeta = mcp.platform.opencode ?? {};
  const timeout = typeof platformMeta.timeout === "number" ? platformMeta.timeout : undefined;

  if (mcp.common.transport === "stdio") {
    if (mcp.common.command === undefined) {
      diagnostics.push({
        severity: "warn",
        code: "WARN_LOSSY_CONVERT",
        message: "OpenCode stdio MCP server requires a command; server was skipped.",
        details: { id: mcp.id, platform: "opencode" },
      });
      return undefined;
    }

    return sortedObject(removeUndefined({
      type: "local",
      command: mcp.common.args !== undefined && mcp.common.args.length > 0
        ? [mcp.common.command, ...mcp.common.args]
        : mcp.common.command,
      environment: mcp.common.env,
      enabled: mcp.common.enabled,
      timeout,
    }));
  }

  if (mcp.common.transport === "http") {
    if (mcp.common.url === undefined) {
      diagnostics.push({
        severity: "warn",
        code: "WARN_LOSSY_CONVERT",
        message: "OpenCode remote MCP server requires a URL; server was skipped.",
        details: { id: mcp.id, platform: "opencode" },
      });
      return undefined;
    }

    return sortedObject(removeUndefined({
      type: "remote",
      url: mcp.common.url,
      headers: mcp.common.headers,
      oauth: platformMeta.oauth,
      enabled: mcp.common.enabled,
      timeout,
    }));
  }

  diagnostics.push({
    severity: "warn",
    code: "WARN_LOSSY_CONVERT",
    message: "OpenCode emitter does not have a native SSE MCP config shape; server was skipped.",
    details: { id: mcp.id, transport: mcp.common.transport, platform: "opencode" },
  });
  return undefined;
}

function addHookCapabilityDiagnostics(hook: HookIR, diagnostics: Diagnostic[]): void {
  for (const event of hook.common.events) {
    const feature = `hooks.events.${event}` as CapabilityFeature;
    const diagnostic = matrixDiagnosticFor(feature, "opencode");
    if (diagnostic !== undefined) {
      diagnostics.push(withDetails(diagnostic, { hookId: hook.id }));
    }
  }

  for (const event of hook.platform.opencode?.events ?? []) {
    const feature = `hooks.events.${event}` as CapabilityFeature;
    const diagnostic = matrixDiagnosticFor(feature, "opencode");
    if (diagnostic !== undefined) {
      diagnostics.push(withDetails(diagnostic, { hookId: hook.id, source: "platform.opencode.events" }));
    } else if (!isKnownOpenCodePluginHookKey(event)) {
      diagnostics.push({
        severity: "warn",
        code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
        message: "OpenCode plugin hook key is not in the verified capability matrix.",
        details: { hookId: hook.id, event, platform: "opencode" },
      });
    }
  }
}

function isKnownOpenCodePluginHookKey(event: string): boolean {
  return OPENCODE_PLUGIN_HOOK_KEYS.has(event);
}

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

export function emitOpenCodeHooks(
  hooks: HookIR[],
  resolver: OpenCodePathResolver = createPathResolver("filesystem"),
): OpenCodeHookEmitResult {
  const artifacts: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];

  for (const hook of [...hooks].sort((left, right) => left.id.localeCompare(right.id))) {
    const translatedActions: HookActionIR[] = [];

    for (const action of hook.common.actions) {
      const translation = translateActionForPlatform(action, "opencode");
      if (translation.diagnostic !== undefined) {
        diagnostics.push(translation.diagnostic);
      }
      if (translation.output !== undefined) {
        translatedActions.push(translation.output as HookActionIR);
      }
    }

    if (translatedActions.length === 0) {
      continue;
    }

    artifacts[resolver.hookFile(hook.id)] = emitHookPlugin(hook, translatedActions, diagnostics);
  }

  return { artifacts, diagnostics };
}

interface PluginModeIndexOptions {
  readonly packageName: string;
  readonly mcp: Record<string, JsonObject>;
}

export function emitPluginModeHooks(
  hooks: HookIR[],
  options: PluginModeIndexOptions = { packageName: "0xcraft-opencode-plugin", mcp: {} },
): OpenCodeHookEmitResult {
  const diagnostics: Diagnostic[] = [];
  const sortedHooks = [...hooks].sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set<string>();

  for (const hook of sortedHooks) {
    if (seen.has(hook.id)) {
      diagnostics.push({
        severity: "error",
        code: "ERR_PLUGIN_DUPLICATE_HOOK_ID",
        message: "OpenCode plugin mode requires unique hook ids because hooks are consolidated into index.js.",
        details: { hookId: hook.id, platform: "opencode" },
      });
      return { artifacts: {}, diagnostics };
    }
    seen.add(hook.id);
  }

  if (sortedHooks.length === 0) {
    return {
      artifacts: { "index.js": emitPluginModeIndex([], [], options) },
      diagnostics,
    };
  }

  const functions: string[] = [];
  const dispatcherCalls: string[] = [];

  for (const hook of sortedHooks) {
    const translatedActions: HookActionIR[] = [];

    for (const action of hook.common.actions) {
      const translation = translateActionForPlatform(action, "opencode");
      if (translation.diagnostic !== undefined) {
        diagnostics.push(translation.diagnostic);
      }
      if (translation.output !== undefined) {
        translatedActions.push(translation.output as HookActionIR);
      }
    }

    if (translatedActions.length === 0) {
      continue;
    }

    const functionName = pluginHookFunctionName(hook.id);
    functions.push(emitPluginModeHookFunction(functionName, hook, translatedActions, diagnostics));
    dispatcherCalls.push(`        await ${functionName}(input, ctx);`);
  }

  if (functions.length === 0) {
    return {
      artifacts: { "index.js": emitPluginModeIndex([], [], options) },
      diagnostics,
    };
  }

  return {
    artifacts: { "index.js": emitPluginModeIndex(functions, dispatcherCalls, options) },
    diagnostics,
  };
}

function pluginHookFunctionName(id: string): string {
  return `hook_${id.replaceAll(/[^A-Za-z0-9_$]/g, "_")}`;
}

function emitPluginModeHookFunction(
  functionName: string,
  hook: HookIR,
  actions: HookActionIR[],
  diagnostics: Diagnostic[],
): string {
  const runtimeCodeActions = actions.filter(isOpenCodeRuntimeCodeAction);
  if (runtimeCodeActions.length > 0) {
    const runtimeCode = runtimeCodeActions
      .map((action) => readRuntimeCodeAction(hook, action, diagnostics))
      .join("\n")
      .replaceAll("\r\n", "\n");
    return normalizeLf(`async function ${functionName}(input, ctx) {
  const module = await import("data:text/javascript;base64,${Buffer.from(runtimeCode).toString("base64")}");
  const plugin = await module.default(input);
  if (typeof plugin?.event === "function") await plugin.event(ctx);
}`);
  }

  for (const action of actions) {
    if (requiresOpenCodeOnlyInfo(action)) {
      diagnostics.push(createOpenCodeOnlyDiagnostic(hook.id, action.type));
    }
  }

  return normalizeLf(`async function ${functionName}(input, ctx) {
  const actions = ${stableStringify(actions)};
  for (const action of actions) {
    await runAction(action, input, ctx);
  }
}`);
}

function emitPluginModeIndex(
  functions: string[],
  dispatcherCalls: string[],
  options: PluginModeIndexOptions,
): string {
  const eventHook = dispatcherCalls.length === 0
    ? ""
    : `\n    event: async (ctx) => {\n${dispatcherCalls.join("\n")}\n    },\n`;

  return normalizeLf(`// 0xcraft-generated OpenCode plugin (plugin mode)
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcp = ${stableStringify(options.mcp)};

${emitPluginModeLoaders()}

${functions.join("\n\n")}

export default async function zeroXCraftPlugin(input, options) {
  const agents = loadAgents();
  const commands = loadCommands();
  const skillsDir = join(__dirname, "skills");

  return {${eventHook}
    config: async (config) => {
      if (Object.keys(agents).length > 0) config.agent = { ...(config.agent ?? {}), ...agents };
      if (Object.keys(commands).length > 0) config.command = { ...(config.command ?? {}), ...commands };
      if (Object.keys(mcp).length > 0) config.mcp = { ...(config.mcp ?? {}), ...mcp };
      if (existsSync(skillsDir)) {
        const skills = config.skills ?? {};
        const paths = Array.isArray(skills.paths) ? skills.paths : [];
        config.skills = { ...skills, paths: [...paths, skillsDir] };
      }
    },
  };
}

${emitRuntimeHelpers()}`);
}

function emitPluginModeLoaders(): string {
  return normalizeLf(String.raw`function loadAgents() {
  const agents = {};
  const agentsDir = join(__dirname, "agents");
  if (!existsSync(agentsDir)) return agents;

  for (const entry of readdirSync(agentsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const agentId = entry.name.slice(0, -3);
    const filePath = join(agentsDir, entry.name);
    const { data, body } = parseFrontmatter(readFileSync(filePath, "utf8"));
    agents[agentId] = { ...data, prompt: resolveReferenceTokens(body, join("agents", agentId, "references")) };
  }

  return agents;
}

function loadCommands() {
  const commands = {};
  const commandsDir = join(__dirname, "commands");
  if (!existsSync(commandsDir)) return commands;

  for (const entry of readdirSync(commandsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const commandId = entry.name.slice(0, -3);
    const filePath = join(commandsDir, entry.name);
    const { data, body } = parseFrontmatter(readFileSync(filePath, "utf8"));
    commands[commandId] = { ...data, template: body };
  }

  return commands;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  return { data: parseFrontmatterYaml(match[1]), body: match[2] ?? "" };
}

function parseFrontmatterYaml(header) {
  const data = {};
  const lines = header.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    const match = line.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1].trim();
    const rawValue = match[2] ?? "";
    if (rawValue.trim() !== "") {
      data[key] = parseScalar(rawValue);
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (/^\s*-\s+/.test(nextLine)) {
      const values = [];
      while (/^\s*-\s+/.test(lines[index + 1] ?? "")) {
        index++;
        values.push(parseScalar((lines[index].match(/^\s*-\s+(.*)$/) ?? ["", ""])[1]));
      }
      data[key] = values;
      continue;
    }

    if (/^\s+[^:\s][^:]*:/.test(nextLine)) {
      const nested = {};
      while (/^\s+[^:\s][^:]*:/.test(lines[index + 1] ?? "")) {
        index++;
        const nestedMatch = lines[index].match(/^\s+([^:]+):\s*(.*)$/);
        if (nestedMatch) nested[nestedMatch[1].trim()] = parseScalar(nestedMatch[2] ?? "");
      }
      data[key] = nested;
      continue;
    }

    data[key] = "";
  }

  return data;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function resolveReferenceTokens(content, referencesDir) {
  return content.replaceAll("{{references_dir}}", referencesDir);
}`);
}

function emitHookPlugin(hook: HookIR, actions: HookActionIR[], diagnostics: Diagnostic[]): string {
  const runtimeCodeActions = actions.filter(isOpenCodeRuntimeCodeAction);
  if (runtimeCodeActions.length > 0) {
    return runtimeCodeActions
      .map((action) => readRuntimeCodeAction(hook, action, diagnostics))
      .join("\n")
      .replaceAll("\r\n", "\n");
  }

  for (const action of actions) {
    if (requiresOpenCodeOnlyInfo(action)) {
      diagnostics.push(createOpenCodeOnlyDiagnostic(hook.id, action.type));
    }
  }

  return emitShimPlugin(actions);
}

function isOpenCodeRuntimeCodeAction(action: HookActionIR): action is Extract<HookActionIR, { type: "runtime_code" }> {
  return action.type === "runtime_code" && action.runtime === "opencode";
}

function readRuntimeCodeAction(
  hook: HookIR,
  action: Extract<HookActionIR, { type: "runtime_code" }>,
  diagnostics: Diagnostic[],
): string {
  if (action.body !== undefined) {
    return normalizeLf(action.body);
  }

  if (!action.file) {
    diagnostics.push({
      severity: "warn",
      code: "WARN_LOSSY_CONVERT",
      message: "OpenCode runtime_code file could not be loaded; emitted empty plugin stub.",
      details: { hookId: hook.id, file: action.file, platform: "opencode" },
    });

    return emitEmptyPluginStub(hook.id);
  }

  const filePath = resolve(dirname(hook.sourcePath), action.file ?? "");
  if (existsSync(filePath)) {
    return normalizeLf(readFileSync(filePath, "utf8"));
  }

  diagnostics.push({
    severity: "warn",
    code: "WARN_LOSSY_CONVERT",
    message: "OpenCode runtime_code file could not be loaded; emitted empty plugin stub.",
    details: { hookId: hook.id, file: action.file, platform: "opencode" },
  });

  return emitEmptyPluginStub(hook.id);
}

function emitShimPlugin(actions: HookActionIR[]): string {
  const actionJson = stableStringify(actions);

  return normalizeLf(`// 0xcraft-generated OpenCode hook plugin
import { spawn } from "node:child_process";

const actions = ${actionJson};

export default async function hook(input) {
  return {
    event: async (ctx) => {
      for (const action of actions) {
        await runAction(action, input, ctx);
      }
    },
  };
}

${emitRuntimeHelpers()}`);
}

function emitRuntimeHelpers(): string {
  return normalizeLf(`async function runAction(action, input, ctx) {
  switch (action.type) {
    case "run_command":
      await runCommand(action.command, { shell: action.shell, timeoutMs: action.timeoutMs });
      return;
    case "run_exec":
      await runExec(action.command, action.args ?? [], { timeoutMs: action.timeoutMs });
      return;
    case "run_script":
      await runExec(action.runner ?? action.path, action.runner === undefined ? (action.args ?? []) : [action.path, ...(action.args ?? [])]);
      return;
    case "http_request":
      await fetch(action.url, {
        method: action.method ?? "GET",
        headers: action.headers,
        body: action.body === undefined ? undefined : typeof action.body === "string" ? action.body : JSON.stringify(action.body),
      });
      return;
    case "call_mcp_tool":
      await invokeOpenCodeMcpTool(input, action);
      return;
    case "invoke_prompt":
      await invokeOpenCodePrompt(input, ctx, action);
      return;
    case "invoke_agent":
      await invokeOpenCodeAgent(input, ctx, action);
      return;
  }
}

function runCommand(command, options = {}) {
  return runExec(options.shell ?? process.env.SHELL ?? "sh", ["-c", command], { timeoutMs: options.timeoutMs });
}

function runExec(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("OpenCode hook action timed out after " + options.timeoutMs + "ms"));
    }, options.timeoutMs);

    child.on("error", (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("OpenCode hook action exited with code " + code));
    });
  });
}

async function invokeOpenCodeMcpTool(input, action) {
  if (typeof input?.client?.mcp?.tool === "function") {
    await input.client.mcp.tool({ server: action.server, tool: action.tool, input: action.input ?? {} });
    return;
  }
  console.warn("[0xcraft] INFO INFO_HOOK_OPENCODE_ONLY — MCP hook shim requires OpenCode client support for " + action.server + "." + action.tool);
}

async function invokeOpenCodePrompt(input, ctx, action) {
  if (typeof input?.client?.chat?.send === "function") {
    await input.client.chat.send({ prompt: action.prompt, model: action.model, context: ctx });
    return;
  }
  console.warn("[0xcraft] INFO INFO_HOOK_OPENCODE_ONLY — prompt hook shim requires OpenCode client chat support");
}

async function invokeOpenCodeAgent(input, ctx, action) {
  if (typeof input?.client?.agent?.invoke === "function") {
    await input.client.agent.invoke({ agent: action.agent, prompt: action.prompt, model: action.model, context: ctx });
    return;
  }
  console.warn("[0xcraft] INFO INFO_HOOK_OPENCODE_ONLY — agent hook shim requires OpenCode client agent support");
}
`);
}

function emitEmptyPluginStub(hookId: string): string {
  return normalizeLf(`// 0xcraft-generated OpenCode hook plugin
// runtime_code file for hook ${hookId} was not loadable during emit.
export default async function hook() {
  return {};
}
`);
}

function requiresOpenCodeOnlyInfo(action: HookActionIR): boolean {
  return (
    action.type === "http_request" ||
    action.type === "call_mcp_tool" ||
    action.type === "invoke_prompt" ||
    action.type === "invoke_agent"
  );
}

function createOpenCodeOnlyDiagnostic(hookId: string, actionType: HookActionIR["type"]): Diagnostic {
  return {
    severity: "info",
    code: "INFO_HOOK_OPENCODE_ONLY",
    message: "Hook action emitted as an OpenCode JS shim because OpenCode has no declarative hook format.",
    details: { hookId, actionType, platform: "opencode" },
  };
}

function diagnosePlatformOnlyFields(
  meta: Record<string, unknown> | undefined,
  sourcePlatform: "claude" | "codex",
  diagnostics: Diagnostic[],
): void {
  if (meta === undefined) return;

  for (const [field, value] of Object.entries(meta).sort(([left], [right]) => left.localeCompare(right))) {
    if (value === undefined) continue;
    const feature = platformFieldToFeature(field);
    const matrixDiagnostic = feature === undefined ? undefined : matrixDiagnosticFor(feature, "opencode");
    diagnostics.push(
      matrixDiagnostic === undefined
        ? createPlatformOnlyDiagnostic(sourcePlatform, field)
        : withDetails(matrixDiagnostic, { sourcePlatform, sourceField: field }),
    );
  }
}

function platformFieldToFeature(field: string): CapabilityFeature | undefined {
  switch (field) {
    case "background":
      return "agent.frontmatter.background";
    case "color":
      return "agent.frontmatter.color";
    case "description":
      return "agent.frontmatter.description";
    case "disallowedTools":
      return "agent.frontmatter.disallowedTools";
    case "effort":
    case "model_reasoning_effort":
      return "agent.frontmatter.effort";
    case "hooks":
      return "agent.frontmatter.hooks";
    case "initialPrompt":
      return "agent.frontmatter.initialPrompt";
    case "isolation":
      return "agent.frontmatter.isolation";
    case "maxTurns":
      return "agent.frontmatter.maxTurns";
    case "mcpServers":
    case "mcp_servers":
      return "agent.frontmatter.mcpServers";
    case "memory":
      return "agent.frontmatter.memory";
    case "model":
      return "agent.frontmatter.model";
    case "name":
      return "agent.frontmatter.name";
    case "permissionMode":
    case "approval_policy":
      return "agent.frontmatter.permissionMode";
    case "skills":
      return "agent.frontmatter.skills";
    case "developer_instructions":
      return "agent.frontmatter.systemPrompt";
    case "tools":
      return "agent.frontmatter.tools";
    default:
      return undefined;
  }
}

function createPlatformOnlyDiagnostic(sourcePlatform: "claude" | "codex", field: string): Diagnostic {
  return {
    severity: "warn",
    code: "WARN_UNRECOGNIZED_PLATFORM_FIELD",
    message: "Platform-specific field has no OpenCode emission slot and was dropped.",
    details: { platform: "opencode", sourcePlatform, field },
  };
}

function createSkillToolListDiagnostic(skillId: string, source: string): Diagnostic {
  return {
    severity: "warn",
    code: "opencode.skill.allowed_tools_no_native_slot",
    message: "OpenCode skill frontmatter has no native allowed-tools/disallowed-tools slot; field was not emitted.",
    details: { skillId, source, platform: "opencode" },
  };
}

function withDetails(diagnostic: Diagnostic, details: Record<string, unknown>): Diagnostic {
  return {
    ...diagnostic,
    details: { ...(diagnostic.details ?? {}), ...details },
  };
}

function compareResource(left: IRResource, right: IRResource): number {
  const kindCompare = left.kind.localeCompare(right.kind);
  if (kindCompare !== 0) return kindCompare;
  return left.id.localeCompare(right.id);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return [left.severity, left.code, left.message].join("\0").localeCompare(
    [right.severity, right.code, right.message].join("\0"),
  );
}

function frontmatterWithBody(meta: Record<string, unknown>, body: string): string {
  return `${serializeFrontmatter(meta)}\n${ensureTrailingLf(body)}`;
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function sortedObject(value: Record<string, unknown>): Record<string, unknown> {
  return sortJsonValue(value) as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }

  return value;
}
