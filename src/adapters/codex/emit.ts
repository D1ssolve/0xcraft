import type { CapabilityReport, Diagnostic } from "../../core/diagnostics";
import { CAPABILITY_FEATURES } from "../../core/diagnostics";
import type { AgentIR, HookIR, IRResource, McpServerIR, SkillIR } from "../../core/ir";
import { CODEX_MATCHER_IGNORED_EVENTS } from "../../core/hook-runtime/events";
import {
  translateActionForPlatform,
  translateEventForPlatform,
} from "../../core/hook-runtime/translator";
import { serializeToml } from "../../core/loader/toml-parser";
import type { PlatformArtifact } from "../_shared/artifact";
import { ensureTrailingLf, normalizeLf, referencesToArtifactFiles } from "../_shared/references";

export interface CodexPackageMetadata {
  name?: string;
  version?: string;
  description?: string;
  displayName?: string;
}

export interface CodexMarketplaceOptions {
  installationPolicy?: string;
  authenticationPolicy?: string;
  category?: string;
}

export interface CodexEmitOptions {
  emitPlugin?: boolean;
  emitMarketplace?: boolean;
  hooksEmitMode?: "hooks-json" | "hooks.json" | "config-inline";
  permissionsBeta?: boolean;
  packageMetadata?: CodexPackageMetadata;
  marketplace?: CodexMarketplaceOptions;
}

export interface CodexHookEmitResult {
  artifacts: Record<string, string>;
  diagnostics: Diagnostic[];
}

export function emitCodex(ir: IRResource[], opts: CodexEmitOptions): PlatformArtifact {
  const diagnostics: Diagnostic[] = [];
  const files: Array<{ path: string; content: string; mode?: number }> = [];
  const emitPlugin = opts.emitPlugin === true;
  const emitMarketplace = opts.emitMarketplace === true;

  if (emitMarketplace && !emitPlugin) {
    diagnostics.push({
      severity: "error",
      code: "ERR_MARKETPLACE_REQUIRES_PLUGIN",
      message: "Codex marketplace emission requires emitPlugin=true.",
      details: { emitMarketplace: true, emitPlugin: false },
    });

    return artifact([], diagnostics);
  }

  const agents = resourcesOfKind<AgentIR>(ir, "agent");
  const skills = resourcesOfKind<SkillIR>(ir, "skill");
  const hooks = resourcesOfKind<HookIR>(ir, "hook");
  const mcps = resourcesOfKind<McpServerIR>(ir, "mcp");
  const config: Record<string, unknown> = {};

  for (const agent of agents) {
    files.push({
      path: `.codex/agents/${agent.id}.toml`,
      content: emitAgentToml(agent, diagnostics, opts),
    });
    files.push(...referencesToArtifactFiles(agent.references, `.codex/agents/${agent.id}/references`));
  }

  for (const skill of skills) {
    files.push(...referencesToArtifactFiles(skill.references, `.codex/skills/${skill.id}/references`));
  }

  if (hooks.length > 0) {
    const hookResult = emitCodexHooks(hooks);
    diagnostics.push(...hookResult.diagnostics);

    const hooksJson = hookResult.artifacts[".codex/hooks.json"] ?? `${stableStringify({ hooks: {} })}\n`;
    if ((opts.hooksEmitMode ?? "hooks-json") === "config-inline") {
      config["hooks"] = JSON.parse(hooksJson).hooks;
    } else {
      files.push({ path: ".codex/hooks.json", content: hooksJson });
    }
  }

  if (mcps.length > 0 && (opts.hooksEmitMode ?? "hooks-json") === "config-inline") {
    config["mcp_servers"] = emitMcpServers(mcps);
  } else if (mcps.length > 0) {
    files.push({ path: ".mcp.json", content: `${stableStringify({ mcp_servers: emitMcpServers(mcps) })}\n` });
  }

  const features: Record<string, boolean> = {};
  if (hooks.length > 0) features["hooks"] = true;
  if (agents.length > 0) features["multi_agent"] = true;
  if (Object.keys(features).length > 0) config["features"] = features;

  if (opts.permissionsBeta === true) {
    const profiles = collectPermissionProfiles(agents);
    if (Object.keys(profiles).length > 0) config["permissions"] = profiles;
  } else if (agents.some((agent) => agent.platform.codex?.permissionProfiles !== undefined)) {
    diagnostics.push({
      severity: "info",
      code: "codex.permissions.beta.disabled",
      message: "Codex permission profiles were defined but permissionsBeta is not enabled.",
      details: { platform: "codex" },
    });
  }

  files.push({ path: ".codex/config.toml", content: emitToml(config) });

  if (emitPlugin) {
    files.push({ path: ".codex-plugin/plugin.json", content: `${stableStringify(pluginManifest(opts.packageMetadata))}\n` });
  }

  if (emitMarketplace) {
    files.push({
      path: ".agents/plugins/marketplace.json",
      content: `${stableStringify(marketplaceManifest(opts.packageMetadata, opts.marketplace))}\n`,
    });
  }

  return artifact(files, diagnostics);
}

export function emitCodexHooks(hooks: HookIR[]): CodexHookEmitResult {
  const artifacts: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  const emittedHooks: Record<string, unknown[]> = {};

  for (const hook of [...hooks].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const result of processHook(hook, diagnostics)) {
      emittedHooks[result.event] = [...(emittedHooks[result.event] ?? []), result.group];
    }
  }

  artifacts[".codex/hooks.json"] = stableStringify({ hooks: emittedHooks }) + "\n";

  return { artifacts, diagnostics };
}

function emitAgentToml(agent: AgentIR, diagnostics: Diagnostic[], opts: CodexEmitOptions): string {
  const codex = agent.platform.codex;
  const approvalPolicy = (codex?.approval_policy ?? agent.common.permissions?.platform.codex?.approval_policy) as unknown;
  const data: Record<string, unknown> = {
    name: codex?.name ?? agent.common.name,
    description: codex?.description ?? agent.common.description,
    developer_instructions: codex?.developer_instructions ?? agent.common.prompt,
    model: codex?.model ?? agent.common.model,
    model_reasoning_effort: codex?.model_reasoning_effort,
    sandbox_mode: codex?.sandbox_mode ?? agent.common.permissions?.sandbox,
    nickname_candidates: codex?.nickname_candidates,
    mcp_servers: codex?.mcp_servers ?? agent.common.mcpServers,
    skills: codex?.skills,
    agents: codex?.agents,
    permissions: codex?.permissions,
  };

  if (approvalPolicy === "on-failure") {
    diagnostics.push({
      severity: "error",
      code: "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
      message: "Codex approval_policy 'on-failure' is not supported.",
      details: { agentId: agent.id },
    });
  } else if (approvalPolicy !== undefined) {
    data["approval_policy"] = approvalPolicy;
  }

  return emitToml(data);
}

function emitMcpServers(mcps: McpServerIR[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const mcp of [...mcps].sort((a, b) => a.id.localeCompare(b.id))) {
    const codex = mcp.platform.codex;
    result[mcp.id] = omitUndefined({
      command: mcp.common.command,
      args: mcp.common.args,
      env: mcp.common.env,
      url: mcp.common.url,
      http_headers: mcp.common.headers,
      cwd: codex?.cwd,
      env_vars: codex?.env_vars,
      bearer_token_env_var: codex?.bearer_token_env_var,
      env_http_headers: codex?.env_http_headers,
      enabled: mcp.common.enabled,
    });
  }
  return result;
}

function collectPermissionProfiles(agents: AgentIR[]): Record<string, unknown> {
  const profiles: Record<string, unknown> = {};
  for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
    const agentProfiles = agent.platform.codex?.permissionProfiles;
    if (agentProfiles !== undefined) {
      for (const [name, profile] of Object.entries(agentProfiles).sort(([a], [b]) => a.localeCompare(b))) {
        profiles[name] = profile;
      }
    }
  }
  return profiles;
}

function pluginManifest(metadata: CodexPackageMetadata | undefined): Record<string, unknown> {
  return omitUndefined({
    name: metadata?.name ?? "0xcraft",
    version: metadata?.version ?? "0.0.0",
    description: metadata?.description ?? "0xcraft generated Codex plugin",
  });
}

function marketplaceManifest(
  metadata: CodexPackageMetadata | undefined,
  options: CodexMarketplaceOptions | undefined,
): Record<string, unknown> {
  const pluginName = metadata?.name ?? "0xcraft";
  return omitUndefined({
    name: `${pluginName}-marketplace`,
    interface: metadata?.displayName === undefined ? undefined : { displayName: metadata.displayName },
    plugins: [omitUndefined({
      name: pluginName,
      source: { source: "local", path: "./.codex-plugin" },
      policy: {
        installation: options?.installationPolicy ?? "allowed",
        authentication: options?.authenticationPolicy ?? "none",
      },
      category: options?.category,
    })],
  });
}

function resourcesOfKind<T extends IRResource>(ir: IRResource[], kind: T["kind"]): T[] {
  return ir
    .filter((resource): resource is T => resource.kind === kind)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function emitToml(data: Record<string, unknown>): string {
  return ensureTrailingLf(normalizeLf(serializeToml(omitUndefined(data))));
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => [key, isPlainRecord(entryValue) ? omitUndefined(entryValue) : entryValue]);
  return Object.fromEntries(entries) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function artifact(
  files: PlatformArtifact["files"],
  diagnostics: Diagnostic[],
): PlatformArtifact {
  const sortedFiles = [...files]
    .map((file) => ({ ...file, content: ensureTrailingLf(normalizeLf(file.content)) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    platform: "codex",
    kind: "filesystem-tree",
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    files: sortedFiles,
    diagnostics,
    capabilityReport: emptyCapabilityReport(),
    metadata: { deterministic: true },
  };
}

function emptyCapabilityReport(): CapabilityReport {
  return {
    platform: "codex",
    features: Object.fromEntries(
      CAPABILITY_FEATURES.map((feature) => [feature, { status: "full", diagnostics: [] }]),
    ) as unknown as CapabilityReport["features"],
  };
}

function processHook(
  hook: HookIR,
  diagnostics: Diagnostic[],
): Array<{ event: string; group: Record<string, unknown> }> {
  const supportedEvents: string[] = [];
  for (const event of hook.common.events) {
    const r = translateEventForPlatform(event, "codex");
    if (r.diagnostic !== undefined) {
      diagnostics.push(r.diagnostic);
    }
    if (r.output !== undefined) {
      supportedEvents.push(r.output as string);
    }
  }

  if (supportedEvents.length === 0) {
    return [];
  }

  const handlers: unknown[] = [];
  for (const action of hook.common.actions) {
    const r = translateActionForPlatform(action, "codex");
    if (r.diagnostic !== undefined) {
      diagnostics.push(r.diagnostic);
    }
    if (r.output !== undefined) {
      handlers.push(toCodexHandler(r.output));
    }
  }

  if (handlers.length === 0) return [];

  const codexMeta = (hook.platform as Record<string, unknown>)["codex"] as
    | Record<string, unknown>
    | undefined;
  const matcher = codexMeta?.["matcher"];
  return supportedEvents.map((event) => {
    const group: Record<string, unknown> = { hooks: handlers };
    if (
      matcher !== undefined &&
      !CODEX_MATCHER_IGNORED_EVENTS.has(event as Parameters<typeof CODEX_MATCHER_IGNORED_EVENTS["has"]>[0])
    ) {
      group["matcher"] = matcher;
    }
    return { event, group };
  });
}

function toCodexHandler(output: unknown): Record<string, unknown> {
  const o = output as Record<string, unknown>;
  if (o["type"] === "run_command") {
    const handler: Record<string, unknown> = {
      command: o["command"],
      type: "command",
    };
    if (o["timeoutMs"] !== undefined) {
      handler["timeout"] = Math.ceil(Number(o["timeoutMs"]) / 1000);
    }
    return handler;
  }
  return o;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}
