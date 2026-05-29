/**
 * Codex permission mapper — Batch 5 (T-5.3).
 *
 * Translates the neutral `PermissionSpec` onto Codex's coarse
 * `sandbox_mode` + `approval_policy` knobs. Codex does not support
 * fine-grained per-tool denies; any verdicts that cannot be folded
 * into the two coarse knobs are surfaced as diagnostics on the
 * shared `DiagnosticCollector`.
 *
 * Mapping rules (per `.ai/tasks.md` T-5.3 acceptance):
 *  - `sandbox: "read"`            → `sandbox_mode = "read-only"`.
 *  - `sandbox: "workspace-write"` → `sandbox_mode = "workspace-write"`.
 *  - `sandbox: "full"`            → `sandbox_mode = "danger-full-access"`
 *    + high-severity warn `permission.sandbox.degraded`.
 *  - approval_policy collapse over `tools` + `bash` verdicts:
 *      • all `allow` (or empty)  → `"never"`
 *      • any `ask`               → `"on-request"`
 *      • any `deny`              → `"on-request"` + warn
 *        `permission.approval.deny_softened`
 *  - Per-tool verdicts beyond sandbox → warn
 *    `permission.tool.unsupported` (Codex cannot map fine-grained
 *    tool denies).
 */

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { PermissionSpec, ToolVerdict } from "../../../core/permission/permission-spec";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
/** `on-failure` intentionally excluded — deprecated per research. */
export type CodexApprovalPolicy = "never" | "on-request" | "untrusted";

export interface CodexPermissionConfig {
  sandbox_mode: CodexSandboxMode;
  approval_policy: CodexApprovalPolicy;
}

/* ---------------------------------------------------------------- */
/*  mapPermissions                                                    */
/* ---------------------------------------------------------------- */

export function mapPermissions(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): CodexPermissionConfig {
  emitDegradedByDesign(spec, collector);

  const sandbox_mode = mapSandboxTier(spec.sandbox, collector);
  const approval_policy = collapseApprovalPolicy(spec, collector);

  reportUnsupportedToolVerdicts(spec, collector);
  reportUnsupportedFilesystem(spec, collector);
  reportLegacyContractCodes(spec, collector);

  return { sandbox_mode, approval_policy };
}

/* ---------------------------------------------------------------- */
/*  Legacy external-contract diagnostic codes (T-12.6)                */
/* ---------------------------------------------------------------- */

/**
 * Emit `codex.permission.degraded_by_design` whenever the agent
 * declares ANY non-default permission surface. Preserves the legacy
 * mapper's external contract.
 */
function emitDegradedByDesign(spec: PermissionSpec, collector: DiagnosticCollector): void {
  const hasAny =
    Object.keys(spec.tools).length > 0 ||
    Object.keys(spec.bash).length > 0 ||
    (spec.delegation && Object.keys(spec.delegation).length > 0) ||
    (spec.filesystem &&
      ((spec.filesystem.readableRoots?.length ?? 0) > 0 ||
        (spec.filesystem.writableRoots?.length ?? 0) > 0));
  if (!hasAny) return;
  collector.info(
    "codex.permission.degraded_by_design",
    "Codex per-agent permissions are degraded: only sandbox_mode/approval_policy are expressible; fine-grained tool denials map coarsely or are dropped.",
  );
}

/**
 * Emit the legacy code aliases that downstream consumers may assert on.
 *  - `codex.permission.edit_deny_softened` — fired when only `edit` is
 *    denied but `bash` is not.
 *  - `codex.permission.bash_deny_softened` — fired when only `bash` is
 *    denied but `edit` is not.
 *  - `codex.permission.task_delegation_dropped` — any deny in
 *    `delegation`.
 *  - `codex.permission.external_directory_degraded` — any filesystem
 *    root entry (Codex cannot model per-agent FS scoping).
 *  - `codex.permission.doom_loop_degraded` — `tools["safety.doom_loop"]`
 *    set to deny.
 *  - `codex.permission.fine_grained_dropped` — any non-allow verdict on
 *    a tool other than edit/bash (which sandbox can express coarsely).
 */
function reportLegacyContractCodes(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): void {
  const editDeny = spec.tools.edit === "deny";
  const bashDeny = spec.tools.bash === "deny";

  if (editDeny && !bashDeny) {
    collector.warn(
      "codex.permission.edit_deny_softened",
      "Codex maps edit-deny to read-only sandbox — also blocks writes.",
    );
  }
  if (bashDeny && !editDeny) {
    collector.warn(
      "codex.permission.bash_deny_softened",
      "Codex maps fine-grained bash deny to workspace-write sandbox — bash may still run within sandbox.",
    );
  }

  // delegation deny → task_delegation_dropped (one diagnostic per occurrence).
  if (spec.delegation) {
    const hasDeny = Object.values(spec.delegation).some((v) => v === "deny");
    if (hasDeny) {
      collector.warn(
        "codex.permission.task_delegation_dropped",
        "Codex has no per-agent task delegation deny; consider not registering this subagent in profile.",
      );
    }
  }

  // filesystem roots → external_directory_degraded.
  const fs = spec.filesystem;
  if (fs && ((fs.readableRoots?.length ?? 0) > 0 || (fs.writableRoots?.length ?? 0) > 0)) {
    collector.warn(
      "codex.permission.external_directory_degraded",
      "Codex external directory access controlled by sandbox_mode/profile, not per-agent rules; deny entries dropped.",
    );
  }

  // safety.doom_loop deny → doom_loop_degraded.
  if (spec.tools["safety.doom_loop"] === "deny") {
    collector.warn(
      "codex.permission.doom_loop_degraded",
      "Codex has no doom_loop guard; approximated via approval_policy=on-request.",
    );
  }

  // Fine-grained non-allow verdicts (anything beyond edit/bash) → dropped.
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(spec.tools)) {
    if (v === "allow") continue;
    if (k === "edit" || k === "bash") continue;
    dropped.push(`tools.${k}`);
  }
  if (dropped.length > 0) {
    collector.warn(
      "codex.permission.fine_grained_dropped",
      `Codex cannot express fine-grained tool denials: ${dropped.sort().join(", ")}.`,
      { dropped: dropped.sort() },
    );
  }
}

/* ---------------------------------------------------------------- */
/*  Sandbox tier                                                      */
/* ---------------------------------------------------------------- */

function mapSandboxTier(
  sandbox: PermissionSpec["sandbox"],
  collector: DiagnosticCollector,
): CodexSandboxMode {
  switch (sandbox) {
    case "read":
      return "read-only";
    case "workspace-write":
      return "workspace-write";
    case "full":
      collector.warn(
        "permission.sandbox.degraded",
        'Codex `sandbox_mode = "danger-full-access"` disables all sandboxing; grants full host access.',
        { sandbox },
      );
      return "danger-full-access";
  }
}

/* ---------------------------------------------------------------- */
/*  Approval policy collapse                                          */
/* ---------------------------------------------------------------- */

function collapseApprovalPolicy(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): CodexApprovalPolicy {
  const verdicts = collectAllVerdicts(spec);

  if (verdicts.length === 0) return "never";

  const hasDeny = verdicts.some((v) => v === "deny");
  const hasAsk = verdicts.some((v) => v === "ask");

  if (hasDeny) {
    collector.warn(
      "permission.approval.deny_softened",
      'Codex has no per-tool deny; softening to `approval_policy = "on-request"` — user is prompted instead of blocked.',
      { hasDeny: true, hasAsk },
    );
    return "on-request";
  }

  if (hasAsk) return "on-request";

  return "never";
}

function collectAllVerdicts(spec: PermissionSpec): ToolVerdict[] {
  const out: ToolVerdict[] = [];
  for (const v of Object.values(spec.tools)) out.push(v);
  for (const v of Object.values(spec.bash)) out.push(v);
  return out;
}

/* ---------------------------------------------------------------- */
/*  Per-tool unsupported warn                                         */
/* ---------------------------------------------------------------- */

function reportUnsupportedToolVerdicts(
  spec: PermissionSpec,
  collector: DiagnosticCollector,
): void {
  // Any non-`allow` per-tool or per-bash verdict is "fine-grained"
  // from Codex's perspective — the deny/ask is approximated via the
  // collapsed `approval_policy` and the sandbox tier, never per-tool.
  const dropped: string[] = [];
  const droppedBashGlobs: Array<{ glob: string; verdict: ToolVerdict }> = [];
  for (const [name, verdict] of Object.entries(spec.tools)) {
    if (verdict !== "allow") dropped.push(`tools.${name}`);
  }
  for (const [glob, verdict] of Object.entries(spec.bash)) {
    if (verdict !== "allow") {
      dropped.push(`bash.${glob}`);
      droppedBashGlobs.push({ glob, verdict });
    }
  }

  // T-23: dedicated per-bash-glob diagnostic — Codex cannot scope bash
  // permissions by glob pattern; the entire bash surface collapses
  // into sandbox_mode/approval_policy. One warn per dropped glob so
  // doctor output enumerates each lost rule.
  for (const { glob, verdict } of droppedBashGlobs) {
    collector.warn(
      "codex.permissions.bashGlob.dropped",
      `Codex cannot scope bash by glob; rule 'bash.${glob}' (${verdict}) dropped — verdict collapsed into sandbox_mode/approval_policy.`,
      { glob, verdict },
    );
  }

  if (dropped.length === 0) return;

  collector.warn(
    "permission.tool.unsupported",
    `Codex cannot express per-tool verdicts; ${dropped.length} entries collapsed into sandbox_mode/approval_policy.`,
    { dropped: dropped.sort() },
  );
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
    "Codex filesystem access is controlled by the sandbox profile, not per-agent roots; dropping `filesystem.{readableRoots,writableRoots}`.",
    { readableRoots: [...readable], writableRoots: [...writable] },
  );
}
