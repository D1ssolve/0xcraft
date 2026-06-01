import { describe, expect, test } from "bun:test";

import { PLATFORM_DIAGNOSTIC_CODES } from "../diagnostics/codes";
import type { HookActionIR } from "./primitives";
import {
  translateActionForPlatform,
  translateEventForPlatform,
  translateEventToCodex,
  type Platform,
} from "./translator";

const ACTIONS: HookActionIR[] = [
  { type: "run_command", command: "bun test", shell: "bash", timeoutMs: 1000 },
  { type: "run_exec", command: "bun", args: ["test", "src/core/hook-runtime/translator.test.ts"], timeoutMs: 1000 },
  { type: "run_script", path: "scripts/check.ts", runner: "bun", args: ["--ci"] },
  { type: "http_request", url: "https://example.com/hook", method: "POST", headers: { "X-Test": "yes" }, body: { ok: true }, allowedEnvVars: ["TOKEN"] },
  { type: "call_mcp_tool", server: "filesystem", tool: "read_file", input: { path: "README.md" } },
  { type: "invoke_prompt", prompt: "Summarize this change", model: "sonnet" },
  { type: "invoke_agent", agent: "code-reviewer", prompt: "Review this diff", model: "sonnet" },
  { type: "runtime_code", runtime: "opencode", file: "hooks/audit/hook.opencode.js", entry: "default" },
];

const PLATFORMS: Platform[] = ["opencode", "claude", "codex"];

describe("translateActionForPlatform", () => {
  test.each(ACTIONS.flatMap((action) => PLATFORMS.map((platform) => [action, platform] as const)))(
    "translates %s for %s with expected output and diagnostics",
    (action, platform) => {
      const result = translateActionForPlatform(action, platform);

      if (platform !== "codex") {
        if (action.type === "runtime_code" && platform === "claude") {
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "claude.hook.runtime_code.dropped" });
        } else {
          expect(result.output).toEqual(action);
          expect(result.diagnostic).toBeUndefined();
        }
        return;
      }

      switch (action.type) {
        case "run_command":
        case "run_script":
          expect(result.output).toEqual(action);
          expect(result.diagnostic).toBeUndefined();
          break;
        case "run_exec":
          expect(result.output).toEqual({
            type: "run_command",
            command: "bun test src/core/hook-runtime/translator.test.ts",
            timeoutMs: 1000,
          });
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hooks.run_exec.shim" });
          break;
        case "http_request":
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hooks.handler.http.dropped" });
          break;
        case "call_mcp_tool":
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hooks.handler.mcp_tool.dropped" });
          break;
        case "invoke_prompt":
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hooks.handler.prompt.skipped" });
          break;
        case "invoke_agent":
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hooks.handler.agent.skipped" });
          break;
        case "runtime_code":
          expect(result.output).toBeUndefined();
          expect(result.diagnostic).toMatchObject({ severity: "warn", code: "codex.hook.runtime_code.dropped" });
          break;
      }
    },
  );

  test("quotes run_exec args when shimmed to Codex run_command", () => {
    const action: HookActionIR = { type: "run_exec", command: "tool", args: ["simple", "two words", "it's ok", "$(nope)"] };

    expect(translateActionForPlatform(action, "codex").output).toEqual({
      type: "run_command",
      command: "tool simple 'two words' 'it'\\''s ok' '$(nope)'",
    });
  });

  test("drops runtime_code for OpenCode when the target runtime is not opencode", () => {
    const action: HookActionIR = { type: "runtime_code", runtime: "codex", body: "export default {}" };

    const result = translateActionForPlatform(action, "opencode");

    expect(result.output).toBeUndefined();
    expect(result.diagnostic).toMatchObject({ severity: "warn", code: "WARN_OPENCODE_RUNTIME_OPAQUE" });
  });

  test("returns structurally equal results for repeated calls", () => {
    const action: HookActionIR = { type: "run_exec", command: "bun", args: ["test"] };

    expect(translateActionForPlatform(action, "codex")).toEqual(translateActionForPlatform(action, "codex"));
  });
});

describe("translateEventToCodex", () => {
  test("returns CodexHookEvent for a supported event", () => {
    expect(translateEventToCodex("PreToolUse")).toBe("PreToolUse");
  });

  test("returns null for an unsupported event", () => {
    expect(translateEventToCodex("Setup")).toBeNull();
  });

  test("returns CodexHookEvent for a matcher-ignored but supported event", () => {
    expect(translateEventToCodex("UserPromptSubmit")).toBe("UserPromptSubmit");
  });
});

describe("translateEventForPlatform", () => {
  test("returns platform-agnostic event for OpenCode and Claude", () => {
    expect(translateEventForPlatform("Setup", "opencode")).toEqual({ output: "Setup" });
    expect(translateEventForPlatform("Setup", "claude")).toEqual({ output: "Setup" });
  });

  test("drops Codex-unsupported event with warn diagnostic", () => {
    expect(translateEventForPlatform("Setup", "codex")).toMatchObject({
      diagnostic: { severity: "warn", code: "codex.hooks.event.dropped" },
    });
    expect(translateEventForPlatform("Setup", "codex").output).toBeUndefined();
  });

  test("emits matcher-ignored Codex event with info diagnostic and output", () => {
    expect(translateEventForPlatform("Stop", "codex")).toEqual({
      output: "Stop",
      diagnostic: expect.objectContaining({ severity: "info", code: "codex.hooks.matcher.ignored" }),
    });
  });

  test("emits Codex-supported event without diagnostic", () => {
    expect(translateEventForPlatform("PreToolUse", "codex")).toEqual({ output: "PreToolUse" });
  });

  test("returns structurally equal results for repeated calls", () => {
    expect(translateEventForPlatform("Stop", "codex")).toEqual(translateEventForPlatform("Stop", "codex"));
  });
});

describe("translator diagnostic code registry additions", () => {
  test("contains precise runtime_code drop diagnostics", () => {
    expect(PLATFORM_DIAGNOSTIC_CODES).toContain("claude.hook.runtime_code.dropped");
    expect(PLATFORM_DIAGNOSTIC_CODES).toContain("codex.hook.runtime_code.dropped");
  });
});
