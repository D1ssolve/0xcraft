/**
 * Claude Code hook script emitter.
 *
 * Generates self-contained `.mjs` shim scripts that Claude Code executes
 * on `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse`
 * and that print the
 * `{ hookSpecificOutput: { hookEventName, additionalContext } }`
 * JSON protocol Claude Code expects on stdout (research §Q5).
 *
 * Design (per ADR Revision 2 §5 / §6):
 *   - Scripts use `#!/usr/bin/env bun` (or `node` when
 *     `config.codexHookRuntime === "node"`). Both runtimes execute the
 *     same plain-`.mjs` body — no platform SDK imports at runtime.
 *   - Bootstrap text is inlined at generation time via
 *     `getBootstrapTextForHookId` from `_shared/bootstrap-text`.
 *   - Filesystem gating (e.g. AGENTS.md presence, .git worktree
 *     detection) is performed AT RUNTIME inside the script body — not
 *     at generation time. The same generated script behaves correctly
 *     across many future sessions in different filesystem states.
 *   - Marker guard: if Claude Code hands stdin payload containing the
 *     hook's marker comment, the script suppresses the additional
 *     context to avoid double-injection on resume.
 *
 * NOTE: the script template is intentionally duplicated from the
 * sibling Codex adapter's hook-script-emitter (rather than extracted
 * into `_shared`) to keep the two adapters independent — the wire
 * format happens to match today but is owned by different upstreams.
 */

import type { Diagnostic } from "../../core/diagnostics/diagnostic";
import type { HookSpec } from "../../core/hooks";
import { HOOK_EVENTS, type HookEvent } from "../../core/hooks";
import type { ZeroxCraftConfig } from "../../core/config";
import { getBootstrapTextForHookId } from "../_shared/bootstrap-text";

export type ClaudeCodeHookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse";

export interface EmitClaudeCodeHookScriptOptions {
  hook: HookSpec;
  /** Project root forwarded to the bootstrap builder (informational). */
  projectRoot: string;
  config: ZeroxCraftConfig;
  /** Shebang runtime. Defaults to `config.codexHookRuntime ?? "bun"`. */
  runtime?: "bun" | "node";
}

export interface EmitClaudeCodeHookScriptResult {
  /** Path relative to the plugin output root (e.g. `hooks/<id>.mjs`). */
  filename: string;
  content: string;
  hookEventName: ClaudeCodeHookEventName;
  diagnostics: Diagnostic[];
}

/**
 * Map a neutral hook event to the Claude Code event name the generated
 * script reports via `hookSpecificOutput.hookEventName`.
 */
function mapEventToClaudeCodeEvent(
  event: HookEvent,
): ClaudeCodeHookEventName | null {
  switch (event) {
    case HOOK_EVENTS.SessionStart:
      return "SessionStart";
    case HOOK_EVENTS.UserPromptFirst:
    case HOOK_EVENTS.UserPromptEvery:
      return "UserPromptSubmit";
    case HOOK_EVENTS.BeforeToolCall:
      return "PreToolUse";
    case HOOK_EVENTS.AfterToolCall:
      return "PostToolUse";
    default:
      return null;
  }
}

/**
 * Emit a Claude Code hook shim script for the given hook definition.
 *
 * Returns `null` when:
 *   - The hook id is listed in `config.disabledHooks`.
 *   - The hook event has no corresponding Claude Code event.
 *   - The hook has no inlinable bootstrap text (unknown id → no builder).
 *
 * No filesystem side effects. Pure file content generation.
 */
export function emitClaudeCodeHookScript(
  options: EmitClaudeCodeHookScriptOptions,
): EmitClaudeCodeHookScriptResult | null {
  const { hook, projectRoot, config } = options;
  const diagnostics: Diagnostic[] = [];

  if (config.disabled.hooks.includes(hook.id)) {
    return null;
  }

  const hookEventName = mapEventToClaudeCodeEvent(hook.event);
  if (!hookEventName) {
    diagnostics.push({
      severity: "warn",
      code: "claude-code.hook.event.unsupported",
      message: `Hook "${hook.id}" event "${hook.event}" has no Claude Code event mapping; skipped.`,
    });
    return null;
  }

  const text = getBootstrapTextForHookId(hook.id, {
    projectRoot,
    platform: "claude-code",
  });
  if (text === null) {
    diagnostics.push({
      severity: "warn",
      code: "claude-code.hook.bootstrap.missing",
      message: `No inlinable bootstrap text for hook "${hook.id}"; skipped.`,
    });
    return null;
  }

  const runtime = options.runtime ?? config.platforms["claude-code"]?.hookRuntime ?? "bun";
  const filename = `hooks/${hook.id}.mjs`;
  const content = buildScriptContent({
    hookId: hook.id,
    event: hook.event,
    hookEventName,
    marker: hook.marker,
    text,
    runtime,
  });

  return { filename, content, hookEventName, diagnostics };
}

interface BuildScriptContentArgs {
  hookId: string;
  event: string;
  hookEventName: ClaudeCodeHookEventName;
  marker: string;
  text: string;
  runtime: "bun" | "node";
}

function buildScriptContent(args: BuildScriptContentArgs): string {
  const { hookId, event, hookEventName, marker, text, runtime } = args;

  return `#!/usr/bin/env ${runtime}
// Auto-generated by 0xcraft claude-code adapter — DO NOT EDIT.
// Hook: ${hookId}
// Event: ${event}
// Claude Code event: ${hookEventName}
// Marker: ${marker}

import fs from "node:fs";
import path from "node:path";

const MARKER = ${JSON.stringify(marker)};
const HOOK_EVENT = ${JSON.stringify(hookEventName)};
const HOOK_ID = ${JSON.stringify(hookId)};

// Inline bootstrap text (computed at generation time).
const TEXT = ${JSON.stringify(text)};

// Claude Code hook stdin protocol: hooks receive JSON on stdin. We
// read it best-effort; if absent or unparseable, proceed without guard.
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function alreadyInjected(stdin) {
  return typeof stdin === "string" && stdin.includes(MARKER);
}

function locateProjectRoot() {
  // Claude Code exposes the project root via CLAUDE_PROJECT_DIR for
  // hook scripts (research §Q5). Fall back to CWD if not set.
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function shouldEmitAtRuntime(text, projectRoot) {
  if (!text) return false;
  if (HOOK_ID === "agents-guard") {
    return !fs.existsSync(path.join(projectRoot, "AGENTS.md"));
  }
  if (HOOK_ID === "git-worktree-bootstrap") {
    const gitPath = path.join(projectRoot, ".git");
    let gitIsFile = false;
    try {
      const stat = fs.statSync(gitPath);
      gitIsFile = stat.isFile();
    } catch {}
    const hasTasksDir = fs.existsSync(path.join(projectRoot, ".tasks"));
    return gitIsFile || hasTasksDir;
  }
  // caveman-bootstrap and any other always-on hooks.
  return true;
}

const stdin = readStdin();
const projectRoot = locateProjectRoot();

let additionalContext = "";
if (!alreadyInjected(stdin) && shouldEmitAtRuntime(TEXT, projectRoot)) {
  additionalContext = TEXT;
}

const output = {
  hookSpecificOutput: {
    hookEventName: HOOK_EVENT,
    additionalContext,
  },
};
process.stdout.write(JSON.stringify(output));
process.stdout.write("\\n");
`;
}
