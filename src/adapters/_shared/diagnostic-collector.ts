/**
 * DiagnosticCollector — shared mutable collector used by adapter pipelines
 * to accumulate non-fatal issues without throwing.
 *
 * Canonical home (spec §12). The old `./diagnostic.ts` module is kept as a
 * thin re-export shim for back-compat during the migration window.
 *
 * Also exports `sanitizeDetails()` which redacts secret-looking values from
 * a structured details bag before the diagnostic is printed or returned.
 * Required by spec §12 (secret redaction).
 */

import type { Diagnostic, DiagnosticSeverity } from "../../core/diagnostics";

export type { Diagnostic, DiagnosticSeverity };

/* ---------------------------------------------------------------- */
/*  Secret redaction                                                */
/* ---------------------------------------------------------------- */

/**
 * Keys whose values are redacted by `sanitizeDetails`. Case-insensitive
 * substring match anywhere in the key name. Matches spec §12.
 */
const SECRET_KEY_PATTERN = /token|secret|password|authorization|cookie|key/i;
const REDACTED = "[redacted]";

/**
 * Return a shallow copy of `details` with values redacted for any key
 * whose name matches `/token|secret|password|authorization|cookie|key/i`.
 *
 * Returns the input unchanged if it is `undefined`. Nested objects are
 * recursively sanitized; arrays are sanitized element-wise. Non-plain
 * values are passed through verbatim.
 *
 * MUST be called before a diagnostic with secret-bearing details is
 * printed OR returned to a caller.
 */
export function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  return sanitizeRecord(details);
}

function sanitizeRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (isPlainObject(value)) return sanitizeRecord(value);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
      if (sanitized !== undefined) copy.details = sanitized;
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
      if (sanitized !== undefined) entry.details = sanitized;
    }
    return entry;
  }
}
