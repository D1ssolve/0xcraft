/**
 * Matrix-driven capability diagnostic helper.
 *
 * Replaces hardcoded "warn and drop" branches inside per-harness emitters
 * with a single function that consults `PlatformCapabilityMatrix` cells.
 * Severity is derived from the cell's status:
 *
 *  - `full`         → no diagnostic (feature fully supported)
 *  - `shim`         → info (works via shim; informational only)
 *  - `experimental` → warn (best-effort)
 *  - `shell-cmd`    → warn (works via emitted shell command, not native)
 *  - `drop-warn`    → warn (field omitted from output)
 *
 * Returns `null` for `full` so callers can simply push the result into
 * their diagnostic array unconditionally:
 *
 *   const d = emitCapabilityDiagnostic(CODEX_MATRIX, "agents.color", {
 *     code: "codex.agent.color_dropped",
 *     dropMessage: "Codex does not support per-agent color; field omitted.",
 *     details: { agentId },
 *   });
 *   if (d) diagnostics.push(d);
 */

import type { Diagnostic } from "../../../core/diagnostics/diagnostic";
import type {
  CapabilityFeature,
  CapabilityStatus,
} from "../../../core/diagnostics";

import type { PlatformCapabilityMatrix } from "../../_shared/capability-matrix";

export interface CapabilityDiagnosticInput {
  /** Diagnostic code emitted regardless of status (e.g. `codex.agent.color_dropped`). */
  code: string;
  /** Message used when matrix status is `drop-warn`. Also default for `shell-cmd`. */
  dropMessage: string;
  /** Message used when matrix status is `shim` or `experimental`. Defaults to `shimMessage`/`dropMessage`. */
  degradeMessage?: string;
  /** Message used when matrix status is `shim`. Defaults to `degradeMessage` then `dropMessage`. */
  shimMessage?: string;
  /** Optional structured details attached to the diagnostic. */
  details?: Record<string, unknown>;
}

/**
 * Build a `Diagnostic` for a single capability cell, or return `null`
 * when the harness supports the capability fully.
 */
export function emitCapabilityDiagnostic(
  matrix: PlatformCapabilityMatrix,
  feature: CapabilityFeature,
  input: CapabilityDiagnosticInput,
): Diagnostic | null {
  const status: CapabilityStatus = matrix[feature].status;

  if (status === "full") return null;

  let severity: "info" | "warn";
  let message: string;
  switch (status) {
    case "shim":
      severity = "info";
      message = input.shimMessage ?? input.degradeMessage ?? input.dropMessage;
      break;
    case "experimental":
      severity = "warn";
      message = input.degradeMessage ?? input.dropMessage;
      break;
    case "shell-cmd":
    case "drop-warn":
    default:
      severity = "warn";
      message = input.dropMessage;
      break;
  }

  const diag: Diagnostic = { severity, code: input.code, message };
  if (input.details !== undefined) diag.details = input.details;
  return diag;
}
