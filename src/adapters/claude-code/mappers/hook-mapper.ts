import type { HookDefinition, HookType } from "../../../core/hooks";
import type { ClaudeCodeHooksJson } from "../types/claude-code-types";

export type ClaudeCodeHookDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeHookMappingDiagnostic {
  severity: ClaudeCodeHookDiagnosticSeverity;
  code: string;
  hookId: string;
  message: string;
}

export interface ClaudeCodeHookMapperOptions {
  hooks: HookDefinition[];
  disabledHooks?: string[];
}

export interface ClaudeCodeHookMapperResult {
  hooksJson?: ClaudeCodeHooksJson;
  diagnostics: ClaudeCodeHookMappingDiagnostic[];
}

const COMMAND_HOOK_EVENTS = {
  "session.start": "SessionStart",
  "tool.before": "PreToolUse",
  "tool.after": "PostToolUse",
} satisfies Readonly<Partial<Record<HookType, string>>>;

const COMMAND_HOOK_EVENT_BY_TYPE: Readonly<Partial<Record<HookType, string>>> = COMMAND_HOOK_EVENTS;

const FIRST_MESSAGE_HOOK_TYPES = new Set<HookType>(["message.first"]);
const SAFE_HOOK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function mapHooksToClaudeCode(options: ClaudeCodeHookMapperOptions): ClaudeCodeHookMapperResult {
  const disabledHooks = new Set(options.disabledHooks ?? []);
  const diagnostics: ClaudeCodeHookMappingDiagnostic[] = [];
  const hooks: ClaudeCodeHooksJson["hooks"] = {};

  for (const hook of options.hooks) {
    if (disabledHooks.has(hook.id)) {
      continue;
    }

    if (!SAFE_HOOK_ID_PATTERN.test(hook.id)) {
      diagnostics.push({
        severity: "error",
        code: "claude.hook.invalid_id",
        hookId: hook.id,
        message: `Hook \`${hook.id}\` has an unsafe id for Claude Code hook mapping.`,
      });
      continue;
    }

    if (COMMAND_HOOK_EVENT_BY_TYPE[hook.type]) {
      diagnostics.push({
        severity: "warning",
        code: "claude.hook.command_scripts_deferred",
        hookId: hook.id,
        message:
          `Hook \`${hook.id}\` maps to Claude Code command hooks, but 0xcraft has no validated source-owned hook script for this behavior; mapping is deferred.`,
      });
      continue;
    }

    diagnostics.push(createUnsupportedDiagnostic(hook));
  }

  if (Object.keys(hooks).length === 0) {
    return { diagnostics };
  }

  return {
    hooksJson: {
      description: "0xcraft Claude Code hooks",
      hooks,
    },
    diagnostics,
  };
}

function createUnsupportedDiagnostic(hook: HookDefinition): ClaudeCodeHookMappingDiagnostic {
  if (FIRST_MESSAGE_HOOK_TYPES.has(hook.type)) {
    return {
      severity: "warning",
      code: "claude.hook.deferred_first_message",
      hookId: hook.id,
      message:
        `Hook \`${hook.id}\` uses OpenCode first-message injection; Claude Code prompt-rewrite parity is unverified, so mapping is deferred.`,
    };
  }

  return {
    severity: "warning",
    code: "claude.hook.unsupported_intent",
    hookId: hook.id,
    message: `Hook \`${hook.id}\` with intent \`${hook.type}\` has no supported Claude Code hook mapping and was omitted.`,
  };
}
