const SECRET_KEY_PATTERN = /token|secret|key|authorization|bearer|password|env|headers/iu;
const REDACTED = "[REDACTED]";

export function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(details);
}

function sanitizeRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(value);
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
