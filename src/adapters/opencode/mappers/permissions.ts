/**
 * OpenCode permission mapper — canonical (T-12.6).
 *
 * Translates the neutral `PermissionSpec` (spec §6, ADR §5) into the
 * flat permission shape consumed by OpenCode's runtime
 * `PermissionConfig`.
 *
 * Mapping rules:
 *  - `sandbox: "read"`            → deny `edit` + `bash`.
 *  - `sandbox: "workspace-write"` → no implicit denies.
 *  - `sandbox: "full"`            → no implicit denies + warn
 *    `permission.sandbox.degraded` (OpenCode has no OS sandbox).
 *  - `tools.<name>`               → top-level `<name>` verdict.
 *  - Prefixed tool ids:
 *      `tools["ui.question"]`     → `question`
 *      `tools["ui.todowrite"]`    → `todowrite`
 *      `tools["safety.doom_loop"]`→ `doom_loop`
 *      `tools["fs.repo_clone"]`   → `repo_clone`
 *      `tools["fs.repo_overview"]`→ `repo_overview`
 *  - `bash.<glob>`                → bash as `Record<glob, verdict>`.
 *  - `delegation.<id>`            → `task` field (allow/deny/object).
 *  - `filesystem.readableRoots`   → external_directory allow entries
 *    (OpenCode `external_directory` only models writable allow/deny
 *    lists; readable roots are mapped onto allow as a permissive
 *    approximation matching adapter behavior pre-T-12.6).
 *  - `filesystem.writableRoots`   → external_directory allow entries.
 *
 * Returns a plain `Record<string, unknown>` rather than the SDK's
 * `PermissionConfig` type so this mapper does not transitively pull
 * SDK types into core test bundles.
 */

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { PermissionSpec, ToolVerdict } from "../../../core/permission/permission-spec";

export type OpenCodePermissionConfig = Record<string, unknown>;

/* ---------------------------------------------------------------- */
/*  Prefixed tool id → flat OpenCode permission key                  */
/* ---------------------------------------------------------------- */

const PREFIXED_TOOL_REMAP: Record<string, string> = {
  "ui.question": "question",
  "ui.todowrite": "todowrite",
  "safety.doom_loop": "doom_loop",
  "fs.repo_clone": "repo_clone",
  "fs.repo_overview": "repo_overview",
};

/**
 * Whitelist of neutral tool ids that map 1:1 onto OpenCode permission
 * keys. Unknown ids are passed through verbatim so user-defined tools
 * keep working; callers that want strict validation should pre-check.
 */
const KNOWN_TOOL_KEYS = new Set([
  "edit",
  "bash",
  "webfetch",
  "websearch",
  "read",
  "glob",
  "grep",
  "list",
  "lsp",
  "skill",
]);

/* ---------------------------------------------------------------- */
/*  mapPermissions                                                    */
/* ---------------------------------------------------------------- */

export function mapPermissions(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): OpenCodePermissionConfig {
  const out: OpenCodePermissionConfig = {};

  /* Sandbox tier — applied first so explicit per-tool verdicts in
   * `spec.tools` can override the coarse default. */
  applySandboxDefaults(spec.sandbox, out, collector);

  /* Per-tool verdicts. */
  for (const [name, verdict] of Object.entries(spec.tools)) {
    const remapped = PREFIXED_TOOL_REMAP[name];
    if (remapped !== undefined) {
      out[remapped] = verdict;
      continue;
    }
    if (!KNOWN_TOOL_KEYS.has(name)) {
      // Pass through unknown tool ids verbatim.
      out[name] = verdict;
      continue;
    }
    out[name] = verdict;
  }

  /* Bash glob map. If both `tools.bash` and `bash.<glob>` are present,
   * the glob map wins (more specific). Merged into a record. */
  const bashGlobs = Object.entries(spec.bash);
  if (bashGlobs.length > 0) {
    const merged: Record<string, ToolVerdict> = {};
    // Preserve insertion order from spec.bash for determinism.
    for (const [glob, verdict] of bashGlobs) {
      merged[glob] = verdict;
    }
    out.bash = merged;
  }

  /* Delegation. OpenCode accepts either a flat verdict (`task: "deny"`)
   * or a per-agent object (`task: { "*": "...", [id]: "..." }`). We map
   * the canonical record onto whichever shape is most compact. */
  if (spec.delegation && Object.keys(spec.delegation).length > 0) {
    const keys = Object.keys(spec.delegation);
    if (keys.length === 1 && keys[0] === "*") {
      out.task = spec.delegation["*"];
    } else {
      out.task = { ...spec.delegation };
    }
  }

  /* Filesystem scoping. Map both readable and writable roots onto
   * `external_directory` allow entries (OpenCode cannot express
   * read-only distinct from write-only; a permissive allow matches
   * adapter behavior prior to T-12.6 mapper consolidation).
   * Readable roots additionally emit `permission.filesystem.unsupported`
   * to surface that read-only intent cannot be precisely represented. */
  const readable = spec.filesystem?.readableRoots ?? [];
  const writable = spec.filesystem?.writableRoots ?? [];
  if (readable.length > 0 || writable.length > 0) {
    const ext: Record<string, ToolVerdict> = {};
    for (const root of readable) ext[root] = "allow";
    for (const root of writable) ext[root] = "allow";
    out.external_directory = ext;
    if (readable.length > 0) {
      collector.warn(
        "permission.filesystem.unsupported",
        "OpenCode `external_directory` cannot distinguish read-only from writable roots; readable roots mapped to allow (permissive).",
        { readableRoots: [...readable], writableRoots: [...writable] },
      );
    }
  }

  return out;
}

/* ---------------------------------------------------------------- */
/*  Helpers                                                           */
/* ---------------------------------------------------------------- */

function applySandboxDefaults(
  sandbox: PermissionSpec["sandbox"],
  out: OpenCodePermissionConfig,
  collector: DiagnosticCollector,
): void {
  switch (sandbox) {
    case "read":
      out.edit = "deny";
      out.bash = "deny";
      break;
    case "workspace-write":
      // OpenCode default — no implicit denies.
      break;
    case "full":
      collector.warn(
        "permission.sandbox.degraded",
        'OpenCode has no OS-level sandbox; `sandbox: "full"` grants full host access — relying on per-tool verdicts only.',
        { sandbox },
      );
      break;
  }
}
