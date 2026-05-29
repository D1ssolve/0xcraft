/**
 * Diagnostic type — shared by normalizers, validators, and adapters
 * to communicate non-fatal issues (deprecations, dropped fields,
 * schema mismatches) without throwing.
 *
 * Pure types. No runtime dependencies, no platform SDKs.
 */

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
