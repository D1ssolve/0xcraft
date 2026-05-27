import { describe, expect, test } from "bun:test";
import { runClaudePluginValidate, type ClaudeProcessRunner } from "./validate";

describe("runClaudePluginValidate", () => {
  test("runs claude plugin validate with argv array and no strict flag by default", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: ClaudeProcessRunner = async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stdout: "valid\n", stderr: "" };
    };

    const result = await runClaudePluginValidate({ pluginDir: "/tmp/plugin", runner });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("passed");
    expect(calls).toEqual([{ command: "claude", args: ["plugin", "validate", "/tmp/plugin"] }]);
    expect(result.command).toEqual({ command: "claude", args: ["plugin", "validate", "/tmp/plugin"] });
  });

  test("adds strict flag only when requested", async () => {
    const calls: string[][] = [];
    const runner: ClaudeProcessRunner = async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runClaudePluginValidate({ pluginDir: "/tmp/plugin", runner });
    await runClaudePluginValidate({ pluginDir: "/tmp/plugin", strict: true, runner });

    expect(calls).toEqual([
      ["plugin", "validate", "/tmp/plugin"],
      ["plugin", "validate", "/tmp/plugin", "--strict"],
    ]);
  });

  test("returns structured warning when claude binary is missing by default", async () => {
    const runner: ClaudeProcessRunner = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const result = await runClaudePluginValidate({ pluginDir: "/tmp/plugin", runner });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("warning");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "claude.validate.binary_missing",
      }),
    ]);
  });

  test("returns hard failure for missing claude when requested", async () => {
    const runner: ClaudeProcessRunner = async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    };

    const result = await runClaudePluginValidate({
      pluginDir: "/tmp/plugin",
      failOnMissingClaude: true,
      runner,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "claude.validate.binary_missing",
    });
  });

  test("warns for unknown Claude Code validation capability by default", async () => {
    const runner: ClaudeProcessRunner = async () => ({ exitCode: 0, stdout: "", stderr: "" });

    const result = await runClaudePluginValidate({
      pluginDir: "/tmp/plugin",
      runner,
      claudeCode: { version: "2.1.120", capabilities: { pluginValidate: "unknown" } },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("warning");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "warning",
      code: "claude.validate.capability_unknown",
    });
  });

  test("fails for unsupported Claude Code validation capability during strict checks", async () => {
    let called = false;
    const runner: ClaudeProcessRunner = async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await runClaudePluginValidate({
      pluginDir: "/tmp/plugin",
      strict: true,
      runner,
      claudeCode: { version: "2.1.120", capabilities: { pluginValidate: "unsupported" } },
    });

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "claude.validate.capability_unsupported",
    });
  });

  test("fails for unknown Claude Code validation capability when caller requires validation", async () => {
    let called = false;
    const runner: ClaudeProcessRunner = async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await runClaudePluginValidate({
      pluginDir: "/tmp/plugin",
      failOnUnsupportedCapability: true,
      runner,
      claudeCode: { version: "2.1.120", capabilities: { pluginValidate: "unknown" } },
    });

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "claude.validate.capability_unknown",
    });
  });

  test("returns sanitized stdout and stderr summary for non-zero exit", async () => {
    const runner: ClaudeProcessRunner = async () => ({
      exitCode: 2,
      stdout: "ok before\nAuthorization: Bearer secret-token\nA".repeat(200),
      stderr: "failure\nAPI_KEY=secret-value\n--config { huge: true }",
    });

    const result = await runClaudePluginValidate({ pluginDir: "/tmp/plugin", runner });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.outputSummary?.stdout).toContain("Authorization: [redacted]");
    expect(result.outputSummary?.stdout).not.toContain("secret-token");
    expect(result.outputSummary?.stderr).toContain("API_KEY=[redacted]");
    expect(result.outputSummary?.stderr).not.toContain("secret-value");
    expect(result.outputSummary?.stdout.length).toBeLessThanOrEqual(1_024);
  });
});
