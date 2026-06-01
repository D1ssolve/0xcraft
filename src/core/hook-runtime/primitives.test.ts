import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { HookActionIR } from "./primitives";

describe("HookActionIR", () => {
  test.each([
    ["run_command", { type: "run_command", command: "bun test", shell: "bash", timeoutMs: 1000 }],
    ["run_exec", { type: "run_exec", command: "bun", args: ["test"], timeoutMs: 1000 }],
    ["run_script", { type: "run_script", path: "scripts/check.ts", runner: "bun", args: ["--ci"] }],
    ["http_request", { type: "http_request", url: "https://example.com/hook", method: "POST", headers: { "X-Test": "yes" }, body: { ok: true }, allowedEnvVars: ["TOKEN"] }],
    ["call_mcp_tool", { type: "call_mcp_tool", server: "filesystem", tool: "read_file", input: { path: "README.md" } }],
    ["invoke_prompt", { type: "invoke_prompt", prompt: "Summarize this change", model: "sonnet" }],
    ["invoke_agent", { type: "invoke_agent", agent: "code-reviewer", prompt: "Review this diff", model: "sonnet" }],
    ["runtime_code", { type: "runtime_code", runtime: "opencode", file: "hooks/audit/hook.opencode.js", entry: "default" }],
  ])("parses a valid %s action", (_name, fixture) => {
    expect(() => HookActionIR.parse(fixture)).not.toThrow();
  });

  test("rejects an invalid action type literal", () => {
    const result = HookActionIR.safeParse({ type: "unknown_action" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  test("rejects runtime_code without file and without body", () => {
    const result = HookActionIR.safeParse({ type: "runtime_code", runtime: "opencode" });

    expect(result.success).toBe(false);
  });

  test("rejects runtime_code with both file and body", () => {
    const result = HookActionIR.safeParse({
      type: "runtime_code",
      runtime: "opencode",
      file: "hooks/audit/hook.opencode.js",
      body: "export default {}",
    });

    expect(result.success).toBe(false);
  });

  test("rejects unknown fields because schemas are strict", () => {
    const result = HookActionIR.safeParse({ type: "run_command", command: "bun test", extra: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: "unrecognized_keys",
        }),
      );
    }
  });
});
