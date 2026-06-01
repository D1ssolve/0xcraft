import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { PlatformArtifact, PlatformArtifactFile } from "../_shared/artifact";
import { serializeFrontmatter } from "../_shared/frontmatter";
import { ensureTrailingLf, normalizeLf, referencesToArtifactFiles } from "../_shared/references";
import { matrixDiagnosticFor } from "../../core/capability-matrix/diagnostics";
import type { CapabilityFeature } from "../../core/capability-matrix/matrix-types";
import type { Diagnostic } from "../../core/diagnostics";
import type { AgentIR, CommandIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { translateActionForPlatform } from "../../core/hook-runtime/translator";
import type { HookActionIR } from "../../core/hook-runtime/primitives";

export interface EmitOptions {
  /** Reserved for future CLI build context; no timestamp or environment data is read. */
  readonly strict?: boolean;
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

export function emitOpenCode(ir: IRResource[], _opts: EmitOptions = {}): PlatformArtifact {
  const diagnostics: Diagnostic[] = [];
  const files: PlatformArtifactFile[] = [];
  const config: OpenCodeConfig = {};
  const hooks: HookIR[] = [];

  for (const resource of [...ir].sort(compareResource)) {
    switch (resource.kind) {
      case "agent":
        files.push(...emitAgentFiles(resource, diagnostics));
        break;
      case "skill":
        files.push(...emitSkillFiles(resource, diagnostics));
        break;
      case "command":
        files.push(emitCommandFile(resource));
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

  const hookResult = emitOpenCodeHooks(hooks);
  diagnostics.push(...hookResult.diagnostics);
  for (const [path, content] of Object.entries(hookResult.artifacts)) {
    files.push({ path, content: ensureTrailingLf(normalizeLf(content)), mode: 0o644 });
  }

  const pluginPaths = Object.keys(hookResult.artifacts)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => `./${path}`);
  if (pluginPaths.length > 0) {
    config.plugin = pluginPaths;
  }

  files.push({ path: "opencode.json", content: `${stableStringify(config)}\n`, mode: 0o644 });

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

function emitAgentFiles(agent: AgentIR, diagnostics: Diagnostic[]): PlatformArtifactFile[] {
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

  return [
    {
      path: `.opencode/agents/${agent.id}.md`,
      content: frontmatterWithBody(meta, agent.common.prompt),
      mode: 0o644,
    },
    ...referencesToArtifactFiles(agent.references, `.opencode/agents/${agent.id}/references`),
  ];
}

function emitSkillFiles(skill: SkillIR, diagnostics: Diagnostic[]): PlatformArtifactFile[] {
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

  return [
    {
      path: `.opencode/skills/${skill.id}/SKILL.md`,
      content: frontmatterWithBody(meta, skill.common.body),
      mode: 0o644,
    },
    ...referencesToArtifactFiles(skill.references, `.opencode/skills/${skill.id}/references`),
  ];
}

function emitCommandFile(command: CommandIR): PlatformArtifactFile {
  const meta = sortedObject(removeUndefined({
    name: command.common.name,
    description: command.common.description,
    agent: command.common.agent,
    model: command.common.model,
    arguments: command.common.arguments,
  }));

  return {
    path: `.opencode/commands/${command.id}.md`,
    content: frontmatterWithBody(meta, command.common.template),
    mode: 0o644,
  };
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

export function emitOpenCodeHooks(hooks: HookIR[]): OpenCodeHookEmitResult {
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

    artifacts[`.opencode/plugins/${hook.id}.js`] = emitHookPlugin(hook, translatedActions, diagnostics);
  }

  return { artifacts, diagnostics };
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

async function runAction(action, input, ctx) {
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
