/**
 * T-10.3 — Secret redaction integration test.
 *
 * Asserts secrets supplied via config (mcpServers.headers.Authorization,
 * mcpServers.env.SECRET_TOKEN, etc.) never appear verbatim in any
 * downstream diagnostic emitted by:
 *
 *   1. `loadConfig` / `loadNestedConfig` (core config loader).
 *   2. `sanitizeDetails` from `_shared/diagnostic-collector` (adapter
 *      diagnostic surface).
 *   3. Any of the three adapter `build()` pipelines.
 */

import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../core/config";
import {
  DiagnosticCollector,
  sanitizeDetails as sharedSanitizeDetails,
} from "../adapters/_shared/diagnostic-collector";
import { build as buildOpenCode } from "../adapters/opencode/build";
import { build as buildClaudeCode } from "../adapters/claude-code/build";
import { build as buildCodex } from "../adapters/codex/build";

const packageRoot = path.resolve(import.meta.dir, "..", "..");

const SECRETS = ["SUPERSECRET", "abc123"] as const;

const sandboxes: string[] = [];

function makeSandbox(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `0xcraft-redact-${prefix}-`));
  sandboxes.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function stringifyDiag(d: { message: string; details?: Record<string, unknown> }): string {
  return JSON.stringify({ message: d.message, details: d.details ?? null });
}

function assertNoSecretLeak(label: string, blobs: string[]): void {
  for (const blob of blobs) {
    for (const secret of SECRETS) {
      if (blob.includes(secret)) {
        throw new Error(
          `${label} leaked secret "${secret}" in: ${blob.slice(0, 240)}`,
        );
      }
    }
  }
}

/* ---------------------------------------------------------------- */
/*  1. _shared/diagnostic-collector.sanitizeDetails                  */
/* ---------------------------------------------------------------- */

describe("T-10.3 — _shared/diagnostic-collector redacts secret-bearing details", () => {
  test("Authorization header value is redacted", () => {
    const sanitized = sharedSanitizeDetails({
      headers: {
        Authorization: "Bearer SUPERSECRET",
        "X-Other": "plain",
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("SUPERSECRET");
  });

  test("env.SECRET_TOKEN value is redacted", () => {
    const sanitized = sharedSanitizeDetails({
      env: { SECRET_TOKEN: "abc123", NORMAL: "ok" },
    });
    expect(JSON.stringify(sanitized)).not.toContain("abc123");
  });

  test("DiagnosticCollector.add sanitizes incoming details", () => {
    const c = new DiagnosticCollector();
    c.add({
      severity: "warn",
      code: "test.leak",
      message: "checking redaction",
      details: {
        headers: { Authorization: "Bearer SUPERSECRET" },
        env: { SECRET_TOKEN: "abc123" },
      },
    });
    const blob = JSON.stringify(c.getAll());
    assertNoSecretLeak("DiagnosticCollector.add", [blob]);
  });
});

/* ---------------------------------------------------------------- */
/*  2. Core config loader                                            */
/* ---------------------------------------------------------------- */

describe("T-10.3 — config loader redacts secrets in diagnostics", () => {
  function seedProjectConfig(): string {
    const projectRoot = makeSandbox("loader");
    fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
    const config = {
      mcpServers: {
        foo: {
          type: "local",
          command: ["echo", "hi"],
          headers: { Authorization: "Bearer SUPERSECRET" },
          env: { SECRET_TOKEN: "abc123" },
        },
      },
    };
    fs.writeFileSync(
      path.join(projectRoot, ".opencode", "0xcraft.json"),
      JSON.stringify(config),
    );
    return projectRoot;
  }

  test("loadConfig (legacy shape) does not leak secrets in diagnostics", () => {
    const projectRoot = seedProjectConfig();
    const result = loadConfig({ harness: "opencode", projectRoot });
    const blobs = result.diagnostics.map(stringifyDiag);
    assertNoSecretLeak("loadConfig", blobs);
  });

  test("loadConfig diagnostics are secret-free (second call regression)", () => {
    const projectRoot = seedProjectConfig();
    const result = loadConfig({ harness: "opencode", projectRoot });
    const blobs = result.diagnostics.map(stringifyDiag);
    assertNoSecretLeak("loadConfig (regression)", blobs);
  });
});

/* ---------------------------------------------------------------- */
/*  3. Adapter build() pipelines                                     */
/* ---------------------------------------------------------------- */

describe("T-10.3 — adapter build() diagnostics never contain raw secrets", () => {
  const secretBearingConfig = {
    disabled: { agents: [], skills: [], hooks: [], commands: [], mcp: [] },
    enabled: { agents: [], skills: [], commands: [] },
    mcpServers: {
      foo: {
        transport: "stdio" as const,
        command: ["echo", "hi"],
        env: { SECRET_TOKEN: "abc123", AUTH: "Bearer SUPERSECRET" },
      },
    },
    customPaths: { agents: [], skills: [], commands: [] },
    modelOverrides: {},
    platformModelOverrides: {},
    platforms: { codex: { hookRuntime: "bun" as const } },
  };

  test("opencode build() diagnostics are secret-free", async () => {
    const artifact = await buildOpenCode({
      config: secretBearingConfig,
      projectRoot: makeSandbox("oc-build"),
      packageRoot,
    });
    const blobs = artifact.diagnostics.map(stringifyDiag);
    assertNoSecretLeak("opencode build()", blobs);
  });

  test("claude-code build() diagnostics are secret-free", async () => {
    const out = makeSandbox("cc-build");
    const artifact = await buildClaudeCode({
      config: secretBearingConfig,
      projectRoot: out,
      packageRoot,
      outputRoot: out,
      homeDir: makeSandbox("cc-build-home"),
    });
    const blobs = artifact.diagnostics.map(stringifyDiag);
    assertNoSecretLeak("claude-code build()", blobs);
  });

  test("codex build() diagnostics are secret-free", async () => {
    const out = makeSandbox("codex-build");
    const artifact = await buildCodex({
      config: secretBearingConfig,
      projectRoot: out,
      packageRoot,
      outputRoot: out,
      homeDir: makeSandbox("codex-build-home"),
    });
    const blobs = artifact.diagnostics.map(stringifyDiag);
    assertNoSecretLeak("codex build()", blobs);
  });
});
