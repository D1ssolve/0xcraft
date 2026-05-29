/**
 * Claude Code permission mapper — Batch 5 (T-5.2).
 *
 * Translates the neutral `PermissionSpec` (spec §6, ADR §5) into the
 * `allowedTools` / `disallowedTools` arrays consumed by Claude Code
 * subagent manifests. Verdicts of `"ask"` map to neither list (Claude
 * Code's plugin agent schema has no ask channel — the user is
 * implicitly prompted at runtime by the host).
 *
 * Mapping rules (per `.ai/tasks.md` T-5.2 acceptance):
 *  - `sandbox: "read"`            → disallow Edit, MultiEdit, Write, Bash.
 *  - `sandbox: "workspace-write"` → no implicit denies.
 *  - `sandbox: "full"`            → info `permission.sandbox.degraded`
 *    (Claude Code has no native sandbox; relying on host process).
 *  - `tools.<name>`               → `allowedTools` / `disallowedTools`
 *    using the neutral → Claude tool-name map below.
 *  - `bash.<glob>`                → `Bash(<glob>)` rule syntax in the
 *    appropriate array.
 *  - `filesystem.readableRoots`   → drop-warn
 *    `permission.filesystem.unsupported` (no exact equivalent).
 *  - `delegation.<id>`            → `Task` allow/deny; per-agent
 *    objects collapse to coarse `Task` deny only when all entries deny.
 *
 * Determinism: arrays are deduped and sorted alphabetically so two
 * runs with identical input emit byte-identical output.
 */

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { PermissionSpec, ToolVerdict } from "../../../core/permission/permission-spec";

export interface ClaudeCodePermissionConfig {
  allowedTools: string[];
  disallowedTools: string[];
}

/* ---------------------------------------------------------------- */
/*  Neutral tool → Claude tool name(s)                                */
/* ---------------------------------------------------------------- */

/**
 * Neutral tool ids map onto one or more Claude Code tool names. `edit`
 * fans out to the full edit family so a single deny verdict blocks
 * every write path.
 */
const TOOL_NAME_MAP: Record<string, readonly string[]> = {
  edit: ["Edit", "MultiEdit", "Write"],
  bash: ["Bash"],
  webfetch: ["WebFetch"],
  websearch: ["WebSearch"],
  read: ["Read"],
  glob: ["Glob"],
  grep: ["Grep"],
  list: ["LS"],
};

/* ---------------------------------------------------------------- */
/*  mapPermissions                                                    */
/* ---------------------------------------------------------------- */

export function mapPermissions(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): ClaudeCodePermissionConfig {
  const allowed = new Set<string>();
  const disallowed = new Set<string>();

  /* Sandbox tier — applied first; per-tool verdicts below can override. */
  applySandboxDefaults(spec.sandbox, allowed, disallowed, collector);

  /* Per-tool verdicts. */
  for (const [neutralName, verdict] of Object.entries(spec.tools)) {
    // Prefixed UI/safety/fs ids: Claude Code has no representation.
    // Emit legacy unsupported diagnostic to preserve external contract.
    if (neutralName.startsWith("ui.") || neutralName.startsWith("safety.") || neutralName.startsWith("fs.")) {
      const sub = neutralName.split(".").slice(1).join(".");
      collector.warn(
        "claude-code.permission.unsupported",
        `Claude Code permission mapper does not support ${sub}; no hidden behavior change applied.`,
        { permission: sub, verdict },
      );
      continue;
    }
    const claudeNames = TOOL_NAME_MAP[neutralName];
    if (!claudeNames) {
      // Unknown neutral id — pass through verbatim. Capitalize is
      // unsafe; emit info diagnostic so the operator notices.
      collector.info(
        "permission.tool.passthrough",
        `Claude Code mapper has no canonical name for tool "${neutralName}"; passing through verbatim.`,
        { tool: neutralName, verdict },
      );
      applyVerdict(neutralName, verdict, allowed, disallowed);
      continue;
    }
    for (const name of claudeNames) {
      applyVerdict(name, verdict, allowed, disallowed);
    }
  }

  /* Bash glob rules — Claude's `Bash(<glob>)` syntax. */
  for (const [glob, verdict] of Object.entries(spec.bash)) {
    applyVerdict(`Bash(${glob})`, verdict, allowed, disallowed);
  }

  /* Delegation — only emit a coarse `Task` deny when every entry is
   * `deny`. Mixed per-agent maps are lossy on Claude (no per-agent
   * task routing), so we surface a warn and leave Task available. */
  if (spec.delegation && Object.keys(spec.delegation).length > 0) {
    applyDelegation(spec.delegation, allowed, disallowed, collector);
  }

  /* Filesystem scoping — no native equivalent on Claude. */
  reportUnsupportedFilesystem(spec, collector);

  return {
    allowedTools: sortUnique(allowed),
    disallowedTools: sortUnique(disallowed),
  };
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

function applySandboxDefaults(
  sandbox: PermissionSpec["sandbox"],
  _allowed: Set<string>,
  disallowed: Set<string>,
  collector: DiagnosticCollector,
): void {
  switch (sandbox) {
    case "read":
      for (const name of ["Edit", "MultiEdit", "Write", "Bash"]) {
        disallowed.add(name);
      }
      break;
    case "workspace-write":
      break;
    case "full":
      collector.info(
        "permission.sandbox.degraded",
        'Claude Code has no native sandbox; `sandbox: "full"` is informational — host process owns isolation.',
        { sandbox },
      );
      break;
  }
}

function applyVerdict(
  name: string,
  verdict: ToolVerdict,
  allowed: Set<string>,
  disallowed: Set<string>,
): void {
  if (verdict === "allow") {
    allowed.add(name);
    disallowed.delete(name);
  } else if (verdict === "deny") {
    disallowed.add(name);
    allowed.delete(name);
  }
  // ask → neither array; Claude prompts at runtime.
}

function applyDelegation(
  delegation: Record<string, ToolVerdict>,
  allowed: Set<string>,
  disallowed: Set<string>,
  collector: DiagnosticCollector,
): void {
  const entries = Object.entries(delegation);
  const allDeny = entries.every(([, v]) => v === "deny");
  const allAllow = entries.every(([, v]) => v === "allow");

  if (allDeny) {
    applyVerdict("Task", "deny", allowed, disallowed);
    return;
  }
  if (allAllow) {
    applyVerdict("Task", "allow", allowed, disallowed);
    return;
  }

  // Mixed per-agent routing — Claude cannot express it. Warn and
  // leave Task available (safer than coarse deny that breaks workflows).
  const allowedAgents = entries
    .filter(([, v]) => v === "allow")
    .map(([id]) => id)
    .sort();
  const deniedAgents = entries
    .filter(([, v]) => v === "deny")
    .map(([id]) => id)
    .sort();
  const message =
    "Claude Code plugin agents cannot represent per-agent task routing; leaving Task available instead of applying unsafe coarse deny.";
  collector.warn("permission.delegation.lossy", message, { allowedAgents, deniedAgents });
  // Preserve legacy external-contract code (T-12.6 acceptance).
  collector.warn("claude-code.permission.task-routing-lossy", message, {
    permission: "task",
    allowedAgents,
    deniedAgents,
  });
}

function reportUnsupportedFilesystem(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): void {
  const fs = spec.filesystem;
  if (!fs) return;
  const readable = fs.readableRoots ?? [];
  const writable = fs.writableRoots ?? [];
  if (readable.length === 0 && writable.length === 0) return;
  collector.warn(
    "permission.filesystem.unsupported",
    "Claude Code has no per-agent filesystem root scoping; dropping `filesystem.{readableRoots,writableRoots}`.",
    { readableRoots: [...readable], writableRoots: [...writable] },
  );
  // Preserve legacy external-contract code (T-12.6 acceptance).
  collector.warn(
    "claude-code.permission.unsupported",
    "Claude Code permission mapper does not support external_directory; no hidden behavior change applied.",
    { permission: "external_directory", readableRoots: [...readable], writableRoots: [...writable] },
  );
}

function sortUnique(values: Set<string>): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
