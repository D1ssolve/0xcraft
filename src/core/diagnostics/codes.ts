/**
 * Authoritative diagnostic code registry.
 *
 * SCREAMING_SNAKE codes cover platform-neutral validation, CLI, pack,
 * and general taxonomy. Lowercase dotted codes are kept in a separate
 * block because §11 mandates exact platform/runtime emitted strings for
 * those diagnostics, including historical aliases.
 */

export const ERROR_DIAGNOSTIC_CODES = [
  "ERR_INVALID_RESOURCE_ID",
  "ERR_PLATFORM_BODY_FORBIDDEN",
  "ERR_AMBIGUOUS_FRONTMATTER_MERGE",
  "ERR_UNKNOWN_FRONTMATTER_KEY",
  "ERR_UNKNOWN_TOML_KEY",
  "ERR_PLATFORM_SIBLING_MISSING",
  "ERR_FILE_EXISTS",
  "ERR_SAME_PLATFORM",
  "ERR_CONFIG_EXISTS",
  "ERR_PACK_ID_CONFLICT",
  "ERR_MARKETPLACE_REQUIRES_PLUGIN",
  "ERR_CYCLIC_INCLUDE",
  "ERR_IMPORT_BODY_CONFLICT",
  "ERR_CODEX_APPROVAL_POLICY_ON_FAILURE_EMIT",
  "ERR_CODEX_MARKDOWN_AGENT_META",
  "ERR_UNSUPPORTED_MODE",
] as const;

export const WARN_DIAGNOSTIC_CODES = [
  "WARN_LOSSY_CONVERT",
  "WARN_UNRECOGNIZED_PLATFORM_FIELD",
  "WARN_PACK_VERSION_DRIFT",
  "WARN_CODEX_APPROVAL_POLICY_ON_FAILURE",
  "WARN_CODEX_HANDLER_SKIPPED",
  "WARN_CLAUDE_PLUGIN_FIELD_STRIPPED",
  "WARN_OPENCODE_RUNTIME_OPAQUE",
] as const;

export const INFO_DIAGNOSTIC_CODES = [
  "INFO_MISSING_PLATFORM_SIBLING",
  "INFO_HOOK_OPENCODE_ONLY",
  "INFO_SECRET_REDACTED",
] as const;

export const PLATFORM_DIAGNOSTIC_CODES = [
  "claude.agent.plugin.field_stripped",
  "skill.frontmatter.camelCase.deprecated",
  "codex.skills.allowed-tools.dropped",
  "codex.skills.allowedTools.dropped",
  "codex.approval_policy.on-failure.deprecated",
  "codex.hooks.codex_hooks.deprecated",
  "codex.hooks.handler.prompt.skipped",
  "codex.hooks.handler.agent.skipped",
  "codex.hooks.handler.async.skipped",
  "codex.hooks.handler.http.dropped",
  "codex.hooks.handler.mcp_tool.dropped",
  "codex.hooks.event.dropped",
  "codex.hooks.matcher.ignored",
  "codex.hooks.run_exec.shim",
  "claude.hook.runtime_code.dropped",
  "codex.hook.runtime_code.dropped",
  "mcp.envelope.normalized",
  "codex.hook.dropped",
  "codex.mcp.sse.dropped",
  "codex.permissions.bashGlob.dropped",
  "codex.permissions.beta.disabled",
  "codex.permissions.perTool.shim",
  "codex.plugin.marketplace_requires_plugin",
] as const;

export const DIAGNOSTIC_CODES = [
  ...ERROR_DIAGNOSTIC_CODES,
  ...WARN_DIAGNOSTIC_CODES,
  ...INFO_DIAGNOSTIC_CODES,
  ...PLATFORM_DIAGNOSTIC_CODES,
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
