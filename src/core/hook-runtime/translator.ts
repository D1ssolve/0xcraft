import type { Diagnostic } from "../diagnostics";
import type { HookActionIR } from "./primitives";
import {
  CODEX_MATCHER_IGNORED_EVENTS,
  CODEX_UNSUPPORTED_EVENTS,
  type CodexHookEvent,
  type HookEvent,
} from "./events";

export type Platform = "opencode" | "claude" | "codex";

// TODO(phase-4): replace this placeholder with per-platform native hook action
// shapes once emitters own the final OpenCode/Claude/Codex contracts. Until
// then, full translations intentionally return raw HookActionIR.
export type NativeHookAction = unknown;

export interface TranslateActionResult {
  output?: NativeHookAction;
  diagnostic?: Diagnostic;
}

export interface TranslateEventResult {
  output?: CodexHookEvent | HookEvent;
  diagnostic?: Diagnostic;
}

export function translateEventToCodex(event: HookEvent): CodexHookEvent | null {
  return CODEX_UNSUPPORTED_EVENTS.has(event) ? null : (event as CodexHookEvent);
}

export function translateActionForPlatform(
  action: HookActionIR,
  platform: Platform,
  _opts?: Record<string, never>,
): TranslateActionResult {
  if (platform === "opencode") {
    return translateActionForOpenCode(action);
  }

  if (platform === "claude") {
    return translateActionForClaude(action);
  }

  return translateActionForCodex(action);
}

export function translateEventForPlatform(
  event: HookEvent,
  platform: Platform,
): TranslateEventResult {
  if (platform === "opencode" || platform === "claude") {
    return { output: event };
  }

  const codexEvent = translateEventToCodex(event);
  if (codexEvent === null) {
    return {
      diagnostic: createDiagnostic(
        "warn",
        "codex.hooks.event.dropped",
        "Hook event has no Codex equivalent and will be dropped.",
        { event, platform },
      ),
    };
  }

  if (CODEX_MATCHER_IGNORED_EVENTS.has(event)) {
    return {
      output: codexEvent,
      diagnostic: createDiagnostic(
        "info",
        "codex.hooks.matcher.ignored",
        "Codex emits this hook event but ignores matcher fields for it.",
        { event, platform },
      ),
    };
  }

  return { output: codexEvent };
}

function translateActionForOpenCode(action: HookActionIR): TranslateActionResult {
  if (action.type === "runtime_code" && action.runtime !== "opencode") {
    return {
      diagnostic: createDiagnostic(
        "warn",
        "WARN_OPENCODE_RUNTIME_OPAQUE",
        "Runtime-specific hook code does not target OpenCode and will be dropped.",
        { actionType: action.type, runtime: action.runtime, platform: "opencode" },
      ),
    };
  }

  return { output: action };
}

function translateActionForClaude(action: HookActionIR): TranslateActionResult {
  if (action.type === "runtime_code") {
    return {
      diagnostic: createDiagnostic(
        "warn",
        "claude.hook.runtime_code.dropped",
        "Claude has no arbitrary runtime_code hook execution surface; action will be dropped.",
        { actionType: action.type, runtime: action.runtime, platform: "claude" },
      ),
    };
  }

  // TODO(phase-4): map raw HookActionIR into concrete Claude hook handler shape.
  return { output: action };
}

function translateActionForCodex(action: HookActionIR): TranslateActionResult {
  switch (action.type) {
    case "run_command":
    case "run_script":
      // TODO(phase-4): map raw HookActionIR into concrete Codex command handler shape.
      return { output: action };
    case "run_exec":
      return {
        output: {
          type: "run_command",
          command: composeShellCommand(action.command, action.args),
          ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
        },
        diagnostic: createDiagnostic(
          "warn",
          "codex.hooks.run_exec.shim",
          "Exec-form hook action converted to Codex command string.",
          { actionType: action.type, platform: "codex" },
        ),
      };
    case "http_request":
      return dropCodexAction(action, "codex.hooks.handler.http.dropped", "Codex has no runnable HTTP hook handler; action will be dropped.");
    case "call_mcp_tool":
      return dropCodexAction(action, "codex.hooks.handler.mcp_tool.dropped", "Codex has no runnable MCP tool hook handler; action will be dropped.");
    case "invoke_prompt":
      return dropCodexAction(action, "codex.hooks.handler.prompt.skipped", "Codex parses prompt hook handlers but skips execution; action will be dropped.");
    case "invoke_agent":
      return dropCodexAction(action, "codex.hooks.handler.agent.skipped", "Codex parses agent hook handlers but skips execution; action will be dropped.");
    case "runtime_code":
      return dropCodexAction(action, "codex.hook.runtime_code.dropped", "Codex has no arbitrary runtime_code hook execution surface; action will be dropped.");
  }
}

function dropCodexAction(action: HookActionIR, code: string, message: string): TranslateActionResult {
  return {
    diagnostic: createDiagnostic("warn", code, message, {
      actionType: action.type,
      platform: "codex",
    }),
  };
}

function createDiagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Diagnostic {
  return details === undefined ? { severity, code, message } : { severity, code, message, details };
}

function composeShellCommand(command: string, args: readonly string[] | undefined): string {
  return [command, ...(args ?? [])].map(quoteShellPart).join(" ");
}

function quoteShellPart(part: string): string {
  if (part.length > 0 && !/[\s'"`$\\!;&|<>(){}[\]*?~]/.test(part)) {
    return part;
  }

  // POSIX single-quote escape. This is deterministic and adequate for the
  // Codex run_exec shim; platform-specific shell semantics remain a Phase 4
  // emitter concern.
  return `'${part.replaceAll("'", "'\\''")}'`;
}
