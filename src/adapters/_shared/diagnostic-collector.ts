/**
 * DiagnosticCollector — shared mutable collector used by adapter pipelines
 * to accumulate non-fatal issues without throwing.
 *
 * Diagnostic details are sanitized before diagnostics are printed or returned.
 * Required by spec §11 / §12 (secret redaction).
 */

import type { Diagnostic, DiagnosticSeverity } from "../../core/diagnostics";
import { sanitizeDetails } from "./secret-redaction";

export type { Diagnostic, DiagnosticSeverity };
export { sanitizeDetails } from "./secret-redaction";

/* ---------------------------------------------------------------- */
/*  DiagnosticCollector                                             */
/* ---------------------------------------------------------------- */

/**
 * Deterministic sort order: severity → code → message.
 *
 * Severity ordering matches spec §12 print priority: error > warn > info.
 */
const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (severityDiff !== 0) return severityDiff;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export class DiagnosticCollector {
  private readonly entries: Diagnostic[] = [];

  info(code: string, message: string, details?: Record<string, unknown>): void {
    this.entries.push(this.build("info", code, message, details));
  }

  warn(code: string, message: string, details?: Record<string, unknown>): void {
    this.entries.push(this.build("warn", code, message, details));
  }

  error(code: string, message: string, details?: Record<string, unknown>): void {
    this.entries.push(this.build("error", code, message, details));
  }

  /** Append an externally constructed diagnostic. `details` are sanitized. */
  add(diagnostic: Diagnostic): void {
    const copy: Diagnostic = {
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
    };
    if (diagnostic.details !== undefined) {
      const sanitized = sanitizeDetails(diagnostic.details);
      copy.details = sanitized;
    }
    this.entries.push(copy);
  }

  /** Return a shallow-copied snapshot of all collected diagnostics. */
  getAll(): Diagnostic[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  /**
   * Return diagnostics sorted by `(severity, code, message)`. Stable and
   * deterministic — used by `build()` callers that must emit byte-identical
   * `PlatformArtifact.diagnostics` arrays.
   */
  sorted(): Diagnostic[] {
    return this.getAll().sort(compareDiagnostics);
  }

  hasErrors(): boolean {
    return this.entries.some((entry) => entry.severity === "error");
  }

  private build(
    severity: DiagnosticSeverity,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Diagnostic {
    const entry: Diagnostic = { severity, code, message };
    if (details !== undefined) {
      const sanitized = sanitizeDetails(details);
      entry.details = sanitized;
    }
    return entry;
  }
}
