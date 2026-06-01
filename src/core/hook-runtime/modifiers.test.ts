import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { HookModifierIR } from "./modifiers";

describe("HookModifierIR", () => {
  test.each([
    ["filter_files", { type: "filter_files", include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] }],
    ["match_tool", { type: "match_tool", tools: ["Read", "Write"] }],
    ["set_env", { type: "set_env", env: { NODE_ENV: "test" } }],
    ["set_cwd", { type: "set_cwd", cwd: "packages/core" }],
    ["timeout", { type: "timeout", timeoutMs: 1000 }],
    ["flow.parallel", { type: "flow.parallel", actions: [{ type: "run_command", command: "bun test" }] }],
    ["flow.serial", { type: "flow.serial", actions: [{ type: "run_exec", command: "bun", args: ["test"] }] }],
    ["flow.piped", { type: "flow.piped", actions: [{ type: "run_script", path: "scripts/check.ts", runner: "bun" }] }],
    ["failure.fail_fast", { type: "failure.fail_fast", enabled: true }],
    ["decision.allow", { type: "decision.allow", reason: "safe read" }],
    ["decision.deny", { type: "decision.deny", reason: "unsafe write" }],
    ["decision.continue", { type: "decision.continue" }],
    ["decision.add_context", { type: "decision.add_context", context: "Remember this audit result." }],
    ["decision.rewrite_input", { type: "decision.rewrite_input", transform: "stripSecrets" }],
  ])("parses a valid %s modifier", (_name, fixture) => {
    expect(() => HookModifierIR.parse(fixture)).not.toThrow();
  });

  test("rejects an invalid modifier type literal", () => {
    const result = HookModifierIR.safeParse({ type: "unknown_modifier" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  test("rejects unknown fields because schemas are strict", () => {
    const result = HookModifierIR.safeParse({ type: "decision.continue", extra: true });

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
