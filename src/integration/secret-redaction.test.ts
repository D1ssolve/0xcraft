/**
 * T-6.7 — Secret redaction integration test.
 *
 * Asserts that sensitive field values are redacted to "[REDACTED]" before
 * they appear in any diagnostic emitted by:
 *
 *   1. `sanitizeDetails` from `_shared/diagnostic-collector` (direct unit).
 *   2. `DiagnosticCollector` (collector sanitizes on add/build).
 *   3. `emitCodex` — end-to-end: IR with secret-bearing MCP fields → diagnostics.
 *
 * Fields covered: token, secret, key, authorization, bearer, password,
 * env, headers (MCP common), bearer_token_env_var, env_vars, env_http_headers
 * (Codex-specific).
 */

import { describe, expect, test } from "bun:test";

import {
  DiagnosticCollector,
  sanitizeDetails,
} from "../adapters/_shared/diagnostic-collector";
import { emitCodex } from "../adapters/codex/emit";
import type { IRResource, McpServerIR } from "../core/ir";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const REDACTED = "[REDACTED]";

function assertNoSecretLeak(label: string, blob: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (blob.includes(secret)) {
      throw new Error(
        `${label} leaked secret "${secret}" in: ${blob.slice(0, 240)}`,
      );
    }
  }
}

function mcpIR(overrides: Partial<McpServerIR["common"]> & {
  codex?: McpServerIR["platform"]["codex"];
} = {}): IRResource {
  const { codex, ...commonOverrides } = overrides;
  return {
    id: "test-mcp",
    kind: "mcp",
    sourcePath: "test.json",
    common: {
      name: "test-mcp",
      transport: "stdio",
      command: "echo",
      ...commonOverrides,
    },
    mcpEnvelope: { sourceShape: "direct", emitShape: "direct", wrapperKey: "" },
    platform: {
      codex: codex,
    },
    _sources: [],
  } satisfies McpServerIR;
}

/* ------------------------------------------------------------------ */
/*  1. sanitizeDetails — direct                                         */
/* ------------------------------------------------------------------ */

describe("Secret redaction — sanitizeDetails", () => {
  test("fields: token, secret, key, authorization, bearer, password", () => {
    const sanitized = sanitizeDetails({
      token: "tok-supersecret",
      secret: "my-secret",
      key: "api-key-value",
      authorization: "Bearer abc123",
      bearer: "abc123",
      password: "hunter2",
    });
    expect(sanitized.token).toBe(REDACTED);
    expect(sanitized.secret).toBe(REDACTED);
    expect(sanitized.key).toBe(REDACTED);
    expect(sanitized.authorization).toBe(REDACTED);
    expect(sanitized.bearer).toBe(REDACTED);
    expect(sanitized.password).toBe(REDACTED);
  });

  test("MCP env field redacted", () => {
    const sanitized = sanitizeDetails({
      env: { API_KEY: "sk-xxx", NORMAL: "ok" },
    });
    expect(sanitized.env).toBe(REDACTED);
    expect(JSON.stringify(sanitized)).not.toContain("sk-xxx");
  });

  test("MCP headers field redacted", () => {
    const sanitized = sanitizeDetails({
      headers: { Authorization: "Bearer tok-secret", "X-Other": "plain" },
    });
    expect(sanitized.headers).toBe(REDACTED);
    expect(JSON.stringify(sanitized)).not.toContain("tok-secret");
  });

  test("Codex bearer_token_env_var field redacted", () => {
    const sanitized = sanitizeDetails({
      bearer_token_env_var: "MY_BEARER_TOKEN",
    });
    // key contains "bearer" — must be redacted
    expect(sanitized.bearer_token_env_var).toBe(REDACTED);
  });

  test("Codex env_vars field redacted", () => {
    const sanitized = sanitizeDetails({
      env_vars: { SECRET_KEY: "abc123", NORMAL: "val" },
    });
    // key contains "env" — must be redacted
    expect(sanitized.env_vars).toBe(REDACTED);
    expect(JSON.stringify(sanitized)).not.toContain("abc123");
  });

  test("Codex env_http_headers field redacted", () => {
    const sanitized = sanitizeDetails({
      env_http_headers: { Authorization: "Bearer xyz" },
    });
    // key contains "headers" — must be redacted
    expect(sanitized.env_http_headers).toBe(REDACTED);
    expect(JSON.stringify(sanitized)).not.toContain("Bearer xyz");
  });

  test("HTTP headers nested redacted", () => {
    const sanitized = sanitizeDetails({
      server: {
        headers: { Authorization: "Bearer sk-secret" },
      },
    });
    const blob = JSON.stringify(sanitized);
    expect(blob).not.toContain("sk-secret");
  });

  test("redacted value is exactly [REDACTED]", () => {
    const sanitized = sanitizeDetails({ token: "real-value" });
    expect(sanitized.token).toBe("[REDACTED]");
  });

  test("non-secret fields pass through unchanged", () => {
    const sanitized = sanitizeDetails({
      count: 5,
      name: "my-server",
      enabled: true,
    });
    expect(sanitized.count).toBe(5);
    expect(sanitized.name).toBe("my-server");
    expect(sanitized.enabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  2. DiagnosticCollector — sanitizes on every add/warn/error/info    */
/* ------------------------------------------------------------------ */

describe("Secret redaction — DiagnosticCollector", () => {
  test("collector.warn sanitizes env details", () => {
    const c = new DiagnosticCollector();
    c.warn("test.warn", "checking", {
      env: { SECRET_TOKEN: "SUPERSECRET" },
    });
    const blob = JSON.stringify(c.getAll());
    assertNoSecretLeak("collector.warn", blob, ["SUPERSECRET"]);
    expect(blob).toContain(REDACTED);
  });

  test("collector.error sanitizes headers details", () => {
    const c = new DiagnosticCollector();
    c.error("test.error", "checking", {
      headers: { Authorization: "Bearer SUPERSECRET" },
    });
    const blob = JSON.stringify(c.getAll());
    assertNoSecretLeak("collector.error", blob, ["SUPERSECRET"]);
    expect(blob).toContain(REDACTED);
  });

  test("collector.add sanitizes incoming diagnostic details", () => {
    const c = new DiagnosticCollector();
    c.add({
      severity: "warn",
      code: "test.add",
      message: "redaction check",
      details: {
        headers: { Authorization: "Bearer SUPERSECRET" },
        env: { SECRET_TOKEN: "abc123" },
      },
    });
    const blob = JSON.stringify(c.getAll());
    assertNoSecretLeak("collector.add", blob, ["SUPERSECRET", "abc123"]);
  });

  test("collector.info sanitizes bearer_token_env_var details", () => {
    const c = new DiagnosticCollector();
    c.info("test.info", "checking", {
      bearer_token_env_var: "MY_TOKEN_VALUE",
    });
    const blob = JSON.stringify(c.getAll());
    assertNoSecretLeak("collector.info", blob, ["MY_TOKEN_VALUE"]);
    expect(blob).toContain(REDACTED);
  });
});

/* ------------------------------------------------------------------ */
/*  3. emitCodex — diagnostics from IR with secret-bearing MCP fields  */
/* ------------------------------------------------------------------ */

describe("Secret redaction — emitCodex diagnostics", () => {
  test("MCP with env secrets does not leak in diagnostics", () => {
    const ir: IRResource[] = [
      mcpIR({ env: { API_KEY: "sk-supersecret", NORMAL: "ok" } }),
    ];
    const artifact = emitCodex(ir, {});
    const blob = JSON.stringify(artifact.diagnostics);
    assertNoSecretLeak("emitCodex MCP env", blob, ["sk-supersecret"]);
  });

  test("MCP with header secrets does not leak in diagnostics", () => {
    const ir: IRResource[] = [
      mcpIR({ headers: { Authorization: "Bearer tok-secret" } }),
    ];
    const artifact = emitCodex(ir, {});
    const blob = JSON.stringify(artifact.diagnostics);
    assertNoSecretLeak("emitCodex MCP headers", blob, ["tok-secret"]);
  });

  test("Codex bearer_token_env_var does not leak in diagnostics", () => {
    const ir: IRResource[] = [
      mcpIR({
        codex: { bearer_token_env_var: "MY_BEARER_SECRET" },
      }),
    ];
    const artifact = emitCodex(ir, {});
    const blob = JSON.stringify(artifact.diagnostics);
    assertNoSecretLeak("emitCodex bearer_token_env_var", blob, ["MY_BEARER_SECRET"]);
  });

  test("Codex env_vars does not leak in diagnostics", () => {
    const ir: IRResource[] = [
      mcpIR({
        codex: { env_vars: { SECRET_KEY: "very-secret-val" } },
      }),
    ];
    const artifact = emitCodex(ir, {});
    const blob = JSON.stringify(artifact.diagnostics);
    assertNoSecretLeak("emitCodex env_vars", blob, ["very-secret-val"]);
  });

  test("Codex env_http_headers does not leak in diagnostics", () => {
    const ir: IRResource[] = [
      mcpIR({
        codex: { env_http_headers: { Authorization: "Bearer secret-header-val" } },
      }),
    ];
    const artifact = emitCodex(ir, {});
    const blob = JSON.stringify(artifact.diagnostics);
    assertNoSecretLeak("emitCodex env_http_headers", blob, ["secret-header-val"]);
  });
});
