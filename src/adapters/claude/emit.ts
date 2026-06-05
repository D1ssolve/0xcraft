import type { Diagnostic } from "../../core/diagnostics";
import type { AgentIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { translateActionForPlatform, translateEventForPlatform } from "../../core/hook-runtime/translator";
import type { HookActionIR } from "../../core/hook-runtime/primitives";
import type { PlatformArtifact, PlatformArtifactFile } from "../_shared/artifact";
import { serializeFrontmatter } from "../_shared/frontmatter";
import { normalizeLf, referencesToArtifactFiles, rewriteReferenceTokens } from "../_shared/references";

export type ClaudeEmitMode = "claude-plugin" | "claude-subagent";

export interface ClaudePackageMetadata {
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
}

export interface ClaudeEmitOptions {
  mode: ClaudeEmitMode;
  packageMetadata?: ClaudePackageMetadata;
}

interface ClaudePluginManifest {
  name: string;
  displayName?: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  defaultEnabled?: boolean;
  agents: Record<string, { name: string; description: string }>;
  skills: Record<string, { name: string; description: string }>;
}

export interface ClaudeHookEmitResult {
  artifacts: Record<string, string>;
  diagnostics: Diagnostic[];
}

type ClaudeHookHandler = Record<string, unknown> & { type: string };

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookHandler[];
}

interface ClaudeHooksJson {
  hooks: Record<string, ClaudeHookGroup[]>;
}

const PLUGIN_AGENT_STRIPPED_FIELDS = ["color", "hooks", "mcpServers", "permissionMode"] as const;

export function emitClaude(ir: IRResource[], opts: ClaudeEmitOptions): PlatformArtifact {
  const diagnostics: Diagnostic[] = [];
  const files: PlatformArtifactFile[] = [];
  const agents = resourcesOfKind(ir, "agent");

  if (opts.mode === "claude-subagent") {
    for (const agent of sortById(agents)) {
      files.push(textFile(`.claude/agents/${agent.id}.md`, emitSubagentAgent(agent, `.claude/agents/${agent.id}/references`)));
      files.push(...referencesToArtifactFiles(agent.references, `.claude/agents/${agent.id}/references`));
    }

    return artifact(files, diagnostics);
  }

  const skills = resourcesOfKind(ir, "skill");
  const hooks = resourcesOfKind(ir, "hook");
  const mcps = resourcesOfKind(ir, "mcp");

  const manifest = emitPluginManifest(agents, skills, opts.packageMetadata);
  files.push(textFile(".claude-plugin/plugin.json", `${stableJson(manifest)}\n`));

  for (const agent of sortById(agents)) {
    files.push(textFile(`.claude-plugin/agents/${agent.id}.md`, emitPluginAgent(agent, diagnostics, `.claude-plugin/agents/${agent.id}/references`)));
    files.push(...referencesToArtifactFiles(agent.references, `.claude-plugin/agents/${agent.id}/references`));
  }

  for (const skill of sortById(skills)) {
    files.push(textFile(`.claude-plugin/skills/${skill.id}/SKILL.md`, emitPluginSkill(skill, `.claude-plugin/skills/${skill.id}/references`)));
    files.push(...referencesToArtifactFiles(skill.references, `.claude-plugin/skills/${skill.id}/references`));
  }

  if (hooks.length > 0) {
    const hookResult = emitClaudeHooks(hooks);
    diagnostics.push(...hookResult.diagnostics);
    for (const [path, content] of Object.entries(hookResult.artifacts)) {
      files.push(textFile(path, content));
    }
  }

  if (mcps.length > 0) {
    files.push(textFile(".claude-plugin/.mcp.json", `${stableJson(emitMcpJson(mcps))}\n`));
  }

  return artifact(files, diagnostics);
}

export function emitClaudeHooks(hooks: HookIR[]): ClaudeHookEmitResult {
  const diagnostics: Diagnostic[] = [];
  const byEvent: Record<string, ClaudeHookGroup[]> = {};

  for (const hook of [...hooks].sort((a, b) => a.id.localeCompare(b.id))) {
    const handlers = emitHandlers(hook, diagnostics);
    if (handlers.length === 0) continue;

    for (const event of [...hook.common.events].sort()) {
      const translatedEvent = translateEventForPlatform(event, "claude");
      if (translatedEvent.diagnostic !== undefined) diagnostics.push(translatedEvent.diagnostic);
      if (translatedEvent.output === undefined) continue;

      const group: ClaudeHookGroup = { hooks: handlers };
      const matcher = matcherFor(hook);
      if (matcher !== undefined) group.matcher = matcher;

      const eventKey = String(translatedEvent.output);
      byEvent[eventKey] = [...(byEvent[eventKey] ?? []), group];
    }
  }

  const payload: ClaudeHooksJson = { hooks: byEvent };

  return {
    artifacts: { ".claude-plugin/hooks/hooks.json": `${stableJson(payload)}\n` },
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function emitPluginManifest(
  agents: AgentIR[],
  skills: SkillIR[],
  packageMetadata: ClaudePackageMetadata | undefined,
): ClaudePluginManifest {
  return omitUndefined({
    name: packageMetadata?.name ?? "0xcraft-claude-plugin",
    displayName: packageMetadata?.displayName,
    version: packageMetadata?.version ?? "0.0.0",
    description: packageMetadata?.description ?? "Generated Claude plugin resources from 0xcraft.",
    author: packageMetadata?.author,
    homepage: packageMetadata?.homepage,
    repository: packageMetadata?.repository,
    license: packageMetadata?.license,
    keywords: packageMetadata?.keywords,
    defaultEnabled: packageMetadata?.defaultEnabled,
    agents: Object.fromEntries(
      sortById(agents).map((agent) => [agent.id, {
        name: agent.platform.claude?.name ?? agent.common.name,
        description: agent.platform.claude?.description ?? agent.common.description,
      }]),
    ),
    skills: Object.fromEntries(
      sortById(skills).map((skill) => [skill.id, {
        name: skill.platform.claude?.name ?? skill.common.name,
        description: skill.platform.claude?.description ?? skill.common.description,
      }]),
    ),
  }) as ClaudePluginManifest;
}

function emitPluginAgent(agent: AgentIR, diagnostics: Diagnostic[], referencesDir: string): string {
  const claude = agent.platform.claude ?? {};
  const meta: Record<string, unknown> = omitUndefined({
    name: claude.name ?? agent.common.name,
    description: claude.description ?? agent.common.description,
    model: claude.model ?? agent.common.model,
    effort: claude.effort,
    maxTurns: claude.maxTurns ?? agent.common.maxTurns,
    tools: claude.tools,
    disallowedTools: claude.disallowedTools,
    skills: claude.skills,
    memory: claude.memory ?? memoryType(agent.common.memory),
    background: claude.background,
    isolation: claude.isolation,
  });

  for (const field of PLUGIN_AGENT_STRIPPED_FIELDS) {
    const value = (claude as Record<string, unknown>)[field] ?? (agent.common as Record<string, unknown>)[field];
    if (value !== undefined) diagnostics.push(strippedAgentFieldDiagnostic(agent.id, field));
  }

  return withFrontmatter(meta, rewriteReferenceTokens(agent.common.prompt, referencesDir));
}

function emitSubagentAgent(agent: AgentIR, referencesDir: string): string {
  const claude = agent.platform.claude ?? {};
  const meta: Record<string, unknown> = omitUndefined({
    name: claude.name ?? agent.common.name,
    description: claude.description ?? agent.common.description,
    model: claude.model ?? agent.common.model,
    effort: claude.effort,
    maxTurns: claude.maxTurns ?? agent.common.maxTurns,
    tools: claude.tools,
    disallowedTools: claude.disallowedTools,
    skills: claude.skills,
    memory: claude.memory ?? memoryType(agent.common.memory),
    background: claude.background,
    isolation: claude.isolation,
    permissionMode: claude.permissionMode,
    hooks: claude.hooks,
    mcpServers: claude.mcpServers ?? agent.common.mcpServers,
    color: claude.color,
    initialPrompt: claude.initialPrompt,
  });

  return withFrontmatter(meta, rewriteReferenceTokens(agent.common.prompt, referencesDir));
}

function emitPluginSkill(skill: SkillIR, referencesDir: string): string {
  const claude = skill.platform.claude ?? {};
  const meta: Record<string, unknown> = omitUndefined({
    name: claude.name ?? skill.common.name,
    description: claude.description ?? skill.common.description,
    when_to_use: claude.when_to_use,
    "argument-hint": claude["argument-hint"],
    arguments: claude.arguments,
    "disable-model-invocation": claude["disable-model-invocation"],
    "user-invocable": claude["user-invocable"],
    "allowed-tools": normalizeToolList(claude["allowed-tools"] ?? skill.common["allowed-tools"]),
    "disallowed-tools": normalizeToolList(claude["disallowed-tools"] ?? skill.common["disallowed-tools"]),
    model: claude.model,
    effort: claude.effort,
    context: claude.context,
    agent: claude.agent,
    hooks: claude.hooks,
    paths: claude.paths,
    shell: claude.shell,
  });

  return withFrontmatter(meta, rewriteReferenceTokens(skill.common.body, referencesDir));
}

function emitMcpJson(mcps: McpServerIR[]): { mcpServers: Record<string, Record<string, unknown>> } {
  return {
    mcpServers: Object.fromEntries(sortById(mcps).map((mcp) => [mcp.id, emitMcpServer(mcp)])),
  };
}

function emitMcpServer(mcp: McpServerIR): Record<string, unknown> {
  const common = mcp.common;
  const claude = mcp.platform.claude;
  if (common.transport === "stdio") {
    return omitUndefined({
      command: common.command,
      args: common.args,
      env: common.env,
      cwd: claude?.cwd,
      oauth: claude?.oauth,
      alwaysLoad: claude?.alwaysLoad,
    });
  }

  return omitUndefined({
    type: common.transport,
    url: common.url,
    headers: common.headers,
    cwd: claude?.cwd,
    oauth: claude?.oauth,
    alwaysLoad: claude?.alwaysLoad,
  });
}

function strippedAgentFieldDiagnostic(agentId: string, field: string): Diagnostic {
  return {
    severity: "warn",
    code: "claude.agent.plugin.field_stripped",
    message: `Plugin agent ${agentId} field '${field}' is not supported in plugin mode and was stripped.`,
    details: { id: agentId, field, platform: "claude", mode: "claude-plugin" },
  };
}

function artifact(files: PlatformArtifactFile[], diagnostics: Diagnostic[]): PlatformArtifact {
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    platform: "claude-code",
    kind: "filesystem-tree",
    ok: !sortedDiagnostics.some((diagnostic) => diagnostic.severity === "error"),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    diagnostics: sortedDiagnostics,
    capabilityReport: { platform: "claude-code", features: {} as PlatformArtifact["capabilityReport"]["features"] },
    metadata: { deterministic: true },
  };
}

function emitHandlers(hook: HookIR, diagnostics: Diagnostic[]): ClaudeHookHandler[] {
  const handlers: ClaudeHookHandler[] = [];

  for (const action of hook.common.actions) {
    const translated = translateActionForPlatform(action, "claude");
    if (translated.diagnostic !== undefined) diagnostics.push(translated.diagnostic);
    if (translated.output === undefined) continue;

    const handler = emitHandler(translated.output as HookActionIR, diagnostics);
    if (handler !== undefined) handlers.push(handler);
  }

  return handlers;
}

function resourcesOfKind<K extends IRResource["kind"]>(
  ir: IRResource[],
  kind: K,
): Extract<IRResource, { kind: K }>[] {
  return ir.filter((resource): resource is Extract<IRResource, { kind: K }> => resource.kind === kind);
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function textFile(path: string, content: string): PlatformArtifactFile {
  return { path, content: normalizeLf(content), mode: 0o644 };
}

function withFrontmatter(meta: Record<string, unknown>, body: string): string {
  return `${serializeFrontmatter(sortObject(meta))}\n\n${normalizeLf(body).trimEnd()}\n`;
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
  );
}

function normalizeToolList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return value.includes(",")
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : value.split(/\s+/u).filter(Boolean);
}

function memoryType(memory: Record<string, unknown> | undefined): string | undefined {
  return typeof memory?.type === "string" ? memory.type : undefined;
}

function emitHandler(action: HookActionIR, diagnostics: Diagnostic[]): ClaudeHookHandler | undefined {
  switch (action.type) {
    case "run_command":
      return omitUndefined({
        type: "command",
        command: action.command,
        shell: action.shell,
        timeout: action.timeoutMs,
      });
    case "run_exec":
      return omitUndefined({
        type: "command",
        command: action.command,
        args: action.args,
        timeout: action.timeoutMs,
      });
    case "run_script":
      diagnostics.push({
        severity: "warn",
        code: "WARN_LOSSY_CONVERT",
        message: "Script hook action converted to Claude command handler invocation.",
        details: { actionType: action.type, platform: "claude" },
      });
      return omitUndefined({
        type: "command",
        command: action.runner ?? action.path,
        args: action.runner === undefined ? action.args : [action.path, ...(action.args ?? [])],
      });
    case "http_request":
      return omitUndefined({
        type: "http",
        url: action.url,
        headers: action.headers,
        allowedEnvVars: action.allowedEnvVars,
      });
    case "call_mcp_tool":
      return omitUndefined({
        type: "mcp_tool",
        server: action.server,
        tool: action.tool,
        input: action.input,
      });
    case "invoke_prompt":
      return omitUndefined({
        type: "prompt",
        prompt: action.prompt,
        model: action.model,
      });
    case "invoke_agent":
      return omitUndefined({
        type: "agent",
        prompt: action.prompt,
        model: action.model,
      });
    case "runtime_code":
      return undefined;
  }
}

function matcherFor(hook: HookIR): string | undefined {
  const matcher = hook.platform.claude?.matcher;
  return typeof matcher === "string" && matcher.length > 0 ? matcher : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }

  return value;
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const severityOrder: Record<Diagnostic["severity"], number> = { error: 0, warn: 1, info: 2 };
  return [...diagnostics].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}
