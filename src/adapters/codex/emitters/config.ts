/**
 * Codex `.codex/config.toml` emitter.
 *
 * Produces the Codex top-level config: feature flags and MCP server
 * tables. Per-agent TOML files are emitted by the agent-emitter as
 * standalone files. Hook descriptors live in `.codex/hooks.json` (see
 * `emitters/hooks.ts`); this emitter does NOT embed inline `[hooks]`
 * tables (Codex would warn at startup if both shapes appeared in the
 * same layer).
 *
 * Feature flag policy (ADR Rev 2): emit only the canonical `hooks` key
 * plus `child_agents_md = true`. The deprecated `codex_hooks` alias is
 * no longer emitted.
 */
import type { ZeroxCraftConfig, CodexMcpExtension } from "../../../core/config";
import type { McpServerSpec } from "../../../core/mcp";
import type { HookSpec } from "../../../core/hooks";
import type { Diagnostic } from "../../../core/diagnostics/diagnostic";
import { CODEX_MATRIX } from "../../_shared/capability-matrix";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import {
  tomlDocument,
  tomlTable,
  type TomlTableEntry,
  type TomlValue,
} from "../_internal/toml-emitter";

export interface CodexConfigEmitOptions {
  config: ZeroxCraftConfig;
  /** Enabled, non-disabled MCP servers to emit. */
  mcpServers: McpServerSpec[];
  /** Enabled, non-disabled hooks — used only for feature-flag presence; descriptors emitted separately. */
  hooks: HookSpec[];
  /** Shebang/runtime used by emitted hook scripts. Default "bun" (reserved for future use). */
  codexHookRuntime?: "bun" | "node";
}

export interface CodexConfigEmitResult {
  toml: string;
  diagnostics: Diagnostic[];
}

/* ---------------------------------------------------------------- */
/*  Public entry                                                      */
/* ---------------------------------------------------------------- */

export function emitCodexConfig(options: CodexConfigEmitOptions): CodexConfigEmitResult {
  const diagnostics = new DiagnosticCollector();
  void options.codexHookRuntime; // reserved
  void options.hooks;            // descriptors now live in `.codex/hooks.json`

  const parts: string[] = [];

  parts.push(emitFeaturesBlock());

  // T-23: beta `[permissions.<name>]` profiles. Only emitted when
  // `platforms.codex.permissionsBeta === true`. When profiles exist but
  // the flag is off, surface a single info diagnostic so doctor can
  // explain why they were skipped. Profiles are sorted by name for
  // determinism. `approval_policy = "on-failure"` is excluded at the
  // schema level — assert defensively in case of schema bypass.
  const beta = options.config.platforms.codex?.permissionsBeta === true;
  const profiles = options.config.platforms.codex?.permissionProfiles ?? {};
  const profileNames = Object.keys(profiles).sort();
  if (profileNames.length > 0 && !beta) {
    diagnostics.info(
      "codex.permissions.beta.disabled",
      `platforms.codex.permissionProfiles defines ${profileNames.length} profile(s) but permissionsBeta is not enabled; profiles skipped.`,
      { profiles: profileNames },
    );
  }
  if (beta && profileNames.length > 0) {
    for (const name of profileNames) {
      const profile = profiles[name]!;
      const entries: TomlTableEntry[] = [];
      if (profile.sandbox_mode !== undefined) {
        entries.push({ key: "sandbox_mode", value: stringValue(profile.sandbox_mode) });
      }
      if (profile.approval_policy !== undefined) {
        // Defensive: schema rejects "on-failure"; assert at emit time
        // as well so any future schema relaxation cannot leak it.
        if ((profile.approval_policy as string) === "on-failure") {
          diagnostics.error(
            "codex.permissions.approval_policy.invalid",
            `Permission profile '${name}' uses deprecated approval_policy='on-failure'; not emitted.`,
            { profile: name },
          );
          continue;
        }
        entries.push({ key: "approval_policy", value: stringValue(profile.approval_policy) });
      }
      if (entries.length > 0) {
        parts.push(tomlTable({ header: ["permissions", name], entries }));
      }
    }
  }

  const mcpExtensions = options.config.platforms.codex?.mcpExtensions ?? {};

  for (const server of options.mcpServers) {
    // T-20: SSE is not natively supported by Codex — drop with dedicated
    // diagnostic, do NOT emit any TOML block for the server.
    if (server.transport === "sse") {
      diagnostics.warn(
        "codex.mcp.sse.dropped",
        `MCP server '${server.id}' uses transport='sse' which Codex does not support; entry dropped from .codex/config.toml.`,
        { name: server.id, transport: server.transport, url: server.url },
      );
      continue;
    }

    parts.push(
      emitMcpServerBlock(server, mcpExtensions[server.id], diagnostics),
    );
  }

  return {
    toml: tomlDocument(parts),
    diagnostics: diagnostics.getAll(),
  };
}

/* ---------------------------------------------------------------- */
/*  [features] block                                                  */
/* ---------------------------------------------------------------- */

function emitFeaturesBlock(): string {
  return tomlTable({
    header: ["features"],
    entries: [
      { key: "hooks", value: boolValue(true) },
      { key: "child_agents_md", value: boolValue(true) },
    ],
  });
}

/* ---------------------------------------------------------------- */
/*  [mcp_servers.<name>] blocks                                       */
/* ---------------------------------------------------------------- */

function emitMcpServerBlock(
  server: McpServerSpec,
  extension: CodexMcpExtension | undefined,
  diagnostics: DiagnosticCollector,
): string {
  const entries: TomlTableEntry[] = [];

  if (server.transport === "stdio") {
    const [command, ...args] = server.command ?? [];
    if (command === undefined) {
      diagnostics.warn(
        "codex.mcp.local_missing_command",
        `MCP server "${server.id}" is local but has no command; emitting empty entry`,
        { name: server.id },
      );
    } else {
      entries.push({ key: "command", value: stringValue(command) });
      if (args.length > 0) {
        entries.push({ key: "args", value: stringArrayValue(args) });
      }
    }

    // T-20: Codex stdio `cwd` extension (sourced from
    // platforms.codex.mcpExtensions[id].cwd — never from core spec).
    if (extension?.cwd !== undefined) {
      entries.push({ key: "cwd", value: stringValue(extension.cwd) });
    }
  } else {
    // transport === "http" (SSE has already been filtered upstream).
    if (CODEX_MATRIX["mcp.http"].status !== "full") {
      diagnostics.warn(
        "codex.mcp.remote_unverified",
        `Codex remote MCP support is "${CODEX_MATRIX["mcp.http"].status}"; emitting "${server.id}" best-effort`,
        { name: server.id, status: CODEX_MATRIX["mcp.http"].status },
      );
    }
    if (server.url !== undefined) {
      entries.push({ key: "url", value: stringValue(server.url) });
    }
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      const headerLines = Object.entries(server.headers).map(([k, v]) => `${k}=${v}`);
      entries.push({ key: "headers", value: stringArrayValue(headerLines) });
    }

    // T-20: bearer_token_env_var + env_http_headers extension fields (http only).
    if (extension?.bearer_token_env_var !== undefined) {
      entries.push({
        key: "bearer_token_env_var",
        value: stringValue(extension.bearer_token_env_var),
      });
    }
    if (
      extension?.env_http_headers !== undefined &&
      Object.keys(extension.env_http_headers).length > 0
    ) {
      const lines = Object.entries(extension.env_http_headers).map(
        ([k, v]) => `${k}=${v}`,
      );
      entries.push({ key: "env_http_headers", value: stringArrayValue(lines) });
    }
  }

  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    const envLines = Object.entries(server.env).map(([k, v]) => `${k}=${v}`);
    entries.push({ key: "env", value: stringArrayValue(envLines) });
  }

  // T-20: env_vars extension (passthrough host env var names — applies to
  // both stdio and http servers).
  if (extension?.env_vars !== undefined && extension.env_vars.length > 0) {
    entries.push({ key: "env_vars", value: stringArrayValue([...extension.env_vars]) });
  }

  return tomlTable({
    header: ["mcp_servers", server.id],
    entries,
  });
}

/* ---------------------------------------------------------------- */
/*  TomlValue helpers                                                 */
/* ---------------------------------------------------------------- */

function stringValue(value: string): TomlValue {
  return { kind: "string", value };
}

function boolValue(value: boolean): TomlValue {
  return { kind: "bool", value };
}

function stringArrayValue(values: string[]): TomlValue {
  return { kind: "stringArray", values };
}
