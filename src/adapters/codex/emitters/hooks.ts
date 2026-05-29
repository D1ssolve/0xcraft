/**
 * Codex hooks emitter — Batch D / T-13, T-14.
 *
 * Produces two artifact groups from the output of `mapHooksToCodex`:
 *
 *   1. `.codex/hooks.json` — canonical hook descriptor file Codex reads
 *      at startup (https://developers.openai.com/codex/hooks).
 *      Format: `{ "hooks": { <EventName>: [ { matcher?, hooks: [{
 *      type: "command", command, statusMessage?, timeout? }] } ] } }`.
 *
 *   2. `.codex/hooks/<hook-id>.sh` — one POSIX shell script per emitted
 *      `CodexHookEntry`. Scripts:
 *        - Read the hook event JSON on stdin (`/dev/stdin`).
 *        - Apply optional shim guards:
 *            * `first-only` — exit 0 silently if marker file already
 *              exists at `/tmp/0xcraft_codex_first_<projHash>_<hookId>`.
 *            * `failure-only` — exit 0 silently unless tool exit code
 *              is non-zero (AfterToolFailure shim over PostToolUse).
 *        - Run the declared handler:
 *            * `context-injection` — emit `additionalContext` JSON.
 *            * `command` — exec the configured command + args.
 *            * `diagnostic-only` — emit `systemMessage` JSON with the
 *              configured diagnostic code.
 *            * `mcp-tool` — no-op (already diagnosed by mapper).
 *
 * Determinism:
 *   - JSON file emitted via `JSON.stringify(value, null, 2) + "\n"` with
 *     keys in insertion order (Codex event order = stable enum order).
 *   - Scripts emitted in `entries` order (already deterministic from
 *     mapper, which preserves source registry order).
 *   - No timestamps, no env-derived noise.
 */

import { createHash } from "node:crypto";

import type { Diagnostic } from "../../../core/diagnostics/diagnostic";
import type { HookSpec } from "../../../core/hooks";
import type { CodexBuiltFile } from "../index";

import type { CodexHookEntry, CodexNativeEvent } from "../mappers/hooks";

/* ---------------------------------------------------------------- */
/*  Public entry                                                      */
/* ---------------------------------------------------------------- */

export interface EmitCodexHooksOptions {
  entries: ReadonlyArray<CodexHookEntry>;
  projectRoot: string;
}

export interface EmitCodexHooksResult {
  files: CodexBuiltFile[];
  diagnostics: Diagnostic[];
}

const HOOKS_JSON_PATH = ".codex/hooks.json";
const SCRIPT_MODE = 0o755;

export function emitCodexHooks(opts: EmitCodexHooksOptions): EmitCodexHooksResult {
  const diagnostics: Diagnostic[] = [];

  if (opts.entries.length === 0) {
    return { files: [], diagnostics };
  }

  const files: CodexBuiltFile[] = [];

  // 1. hooks.json
  files.push({
    path: HOOKS_JSON_PATH,
    content: renderHooksJson(opts.entries),
  });

  // 2. per-hook scripts
  const projectHash = projectRootHash(opts.projectRoot);
  for (const entry of opts.entries) {
    files.push({
      path: scriptPath(entry.hookId),
      content: renderScript(entry, projectHash),
      mode: SCRIPT_MODE,
    });
  }

  return { files, diagnostics };
}

/* ---------------------------------------------------------------- */
/*  hooks.json rendering                                              */
/* ---------------------------------------------------------------- */

interface HookJsonHandler {
  type: "command";
  command: string;
  statusMessage?: string;
  timeout?: number;
}

interface HookJsonMatcherGroup {
  matcher?: string;
  hooks: HookJsonHandler[];
}

type HookJsonDocument = {
  hooks: Partial<Record<CodexNativeEvent, HookJsonMatcherGroup[]>>;
};

/**
 * Stable event ordering: matches Codex docs reading order. Determinism
 * pinned by tests in `codex-snapshot.test.ts`.
 */
const NATIVE_EVENT_ORDER: CodexNativeEvent[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
];

function renderHooksJson(entries: ReadonlyArray<CodexHookEntry>): string {
  const grouped = new Map<CodexNativeEvent, CodexHookEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.codexEvent) ?? [];
    list.push(entry);
    grouped.set(entry.codexEvent, list);
  }

  const doc: HookJsonDocument = { hooks: {} };

  for (const event of NATIVE_EVENT_ORDER) {
    const list = grouped.get(event);
    if (list === undefined || list.length === 0) continue;

    doc.hooks[event] = list.map((entry) => {
      const handler: HookJsonHandler = {
        type: "command",
        command: invocationCommand(entry.hookId),
      };
      if (entry.statusMessage !== undefined) handler.statusMessage = entry.statusMessage;
      if (entry.timeout !== undefined) handler.timeout = entry.timeout;

      const group: HookJsonMatcherGroup = { hooks: [handler] };
      if (entry.matcher !== undefined) group.matcher = entry.matcher;
      return group;
    });
  }

  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Command Codex runs to invoke the hook. Resolves from the git root so
 * scripts work when Codex is started from a subdirectory (per docs
 * recommendation under "Notes" §Config shape).
 */
function invocationCommand(hookId: string): string {
  return `sh "$(git rev-parse --show-toplevel)/.codex/hooks/${hookId}.sh"`;
}

function scriptPath(hookId: string): string {
  return `.codex/hooks/${hookId}.sh`;
}

/* ---------------------------------------------------------------- */
/*  Script body rendering                                             */
/* ---------------------------------------------------------------- */

function renderScript(entry: CodexHookEntry, projectHash: string): string {
  const header = `#!/bin/sh
# Auto-generated by 0xcraft Codex adapter — do not edit by hand.
# Hook:  ${entry.hookId}
# Event: ${entry.codexEvent}
# Shim:  ${entry.shim}
set -eu
INPUT=$(cat)
`;

  const shim = renderShim(entry, projectHash);
  const body = renderHandlerBody(entry);
  return header + shim + body;
}

function renderShim(entry: CodexHookEntry, projectHash: string): string {
  switch (entry.shim) {
    case "first-only": {
      const marker = `/tmp/0xcraft_codex_first_${projectHash}_${entry.hookId}`;
      return `
# UserPromptFirst shim — exit silently after the first invocation per project.
MARKER='${marker}'
if [ -e "$MARKER" ]; then
  exit 0
fi
mkdir -p "$(dirname "$MARKER")"
: > "$MARKER"

`;
    }
    case "failure-only": {
      // PostToolUse delivers tool_response on stdin. Extract exit code
      // via grep/sed (no jq dependency). Codex tool_response shape for
      // Bash includes "exit_code"; for apply_patch / MCP, treat any
      // non-empty "error" field as failure.
      return `
# AfterToolFailure shim — only fire when the tool failed.
EXIT_CODE=$(printf '%s' "$INPUT" | sed -n 's/.*"exit_code"[[:space:]]*:[[:space:]]*\\([0-9-]*\\).*/\\1/p' | head -n1)
HAS_ERROR=$(printf '%s' "$INPUT" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1)
if [ -z "\${EXIT_CODE:-}" ] || [ "\${EXIT_CODE:-0}" = "0" ]; then
  if [ -z "\${HAS_ERROR:-}" ]; then
    exit 0
  fi
fi

`;
    }
    case "none":
    default:
      return "\n";
  }
}

function renderHandlerBody(entry: CodexHookEntry): string {
  const handler = entry.source.handler;
  const kind = handler?.kind ?? "context-injection";

  switch (kind) {
    case "context-injection":
      return renderContextInjection(entry.source);
    case "command":
      // handler.kind === "command"
      if (handler === undefined || handler.kind !== "command") return renderNoop(entry);
      return renderCommandHandler(handler.command, handler.args ?? []);
    case "diagnostic-only":
      if (handler === undefined || handler.kind !== "diagnostic-only") return renderNoop(entry);
      return renderDiagnosticOnly(handler.diagnosticCode, entry.source.description);
    case "mcp-tool":
    default:
      return renderNoop(entry);
  }
}

function renderContextInjection(hook: HookSpec): string {
  // `buildContext` is a closure (cannot run from shell). For
  // `context-injection` hooks the static `marker` line is emitted as the
  // additionalContext payload. Tools that need richer context can ship
  // a separate text asset via `handler.textAsset` (also static).
  //
  // We pre-JSON-encode the text so the script body can `printf '%s'` it
  // directly. This avoids quoting headaches when the text contains
  // `<`, `>`, quotes, or newlines.
  const eventName = nativeEventForOutput(hook);
  const jsonPayload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: hook.marker,
    },
  });
  // Single-quote-wrap for printf: backslash-escape every embedded ' as '\''.
  const sqEscaped = jsonPayload.replace(/'/g, "'\\''");
  return `# Handler: context-injection
printf '%s\\n' '${sqEscaped}'
`;
}

function renderCommandHandler(command: string, args: string[]): string {
  const quoted = [command, ...args].map(shellQuote).join(" ");
  return `# Handler: command
printf '%s\\n' "$INPUT" | ${quoted}
`;
}

function renderDiagnosticOnly(code: string, description: string): string {
  const payload = JSON.stringify({ systemMessage: `[${code}] ${description}` });
  const sqEscaped = payload.replace(/'/g, "'\\''");
  return `# Handler: diagnostic-only
printf '%s\\n' '${sqEscaped}'
`;
}

function renderNoop(entry: CodexHookEntry): string {
  return `# Handler: no-op (mcp-tool or unknown kind — see mapper diagnostics)
# Hook id: ${entry.hookId}
exit 0
`;
}

function nativeEventForOutput(hook: HookSpec): CodexNativeEvent {
  // Output marker must match Codex's expected `hookEventName` for the
  // event the script is wired to. The mapper already picked it; re-derive
  // here from `hook.event` to avoid passing it through.
  switch (hook.event) {
    case "session.start":      return "SessionStart";
    case "session.end":        return "Stop";
    case "user-prompt.first":
    case "user-prompt.every":  return "UserPromptSubmit";
    case "tool-call.before":   return "PreToolUse";
    case "tool-call.after":
    case "tool-call.failure":  return "PostToolUse";
    case "permission.request": return "PermissionRequest";
    case "agent.spawn":        return "SubagentStart";
    case "agent.stop":         return "SubagentStop";
    case "compact.before":     return "PreCompact";
    case "compact.after":      return "PostCompact";
    default:                   return "SessionStart"; // unreachable for emitted entries
  }
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

function shellQuote(value: string): string {
  // Single-quote escape for POSIX sh: wrap in '...', escape '\'' inline.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function projectRootHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
}
