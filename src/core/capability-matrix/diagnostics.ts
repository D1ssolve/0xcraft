import type { Diagnostic } from "../diagnostics/diagnostic";
import { CODEX_MATRIX, CLAUDE_MATRIX, OPENCODE_MATRIX } from "./matrix";
import {
  type CapabilityFeature,
  type ClaudeMode,
  type MatrixCell,
  type PlatformId,
  isClaudeModeCell,
} from "./matrix-types";

const MATRICES = {
  opencode: OPENCODE_MATRIX,
  "claude-code": CLAUDE_MATRIX,
  codex: CODEX_MATRIX,
} as const;

export function matrixDiagnosticFor(
  feature: CapabilityFeature,
  platform: PlatformId,
  mode: ClaudeMode = "plugin",
): Diagnostic | undefined {
  const entry = MATRICES[platform][feature];
  if (entry === undefined) return undefined;

  const cell: MatrixCell = isClaudeModeCell(entry) ? entry[mode] : entry;
  if (cell.status === "full") return undefined;

  const severity = cell.status === "experimental" ? "info" : "warn";
  const codePrefix = severity === "info" ? "INFO" : "WARN";
  // TODO(T-1.12): replace derived code with registry-backed diagnostic code.
  const code = `${codePrefix}_CAPABILITY_${cell.status.toUpperCase().replaceAll("-", "_")}_${feature
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")}`;

  return {
    severity,
    code,
    message: `${platform} capability ${feature} is ${cell.status}`,
    details: {
      evidence: cell.evidence,
      feature,
      platform,
      status: cell.status,
      ...(isClaudeModeCell(entry) ? { mode } : {}),
      ...(cell.notes === undefined ? {} : { notes: cell.notes }),
    },
  };
}
