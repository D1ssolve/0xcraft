import { describe, expect, test } from "bun:test";
import {
  HOOK_EVENTS,
  CODEX_UNSUPPORTED_EVENTS,
  CODEX_MATCHER_IGNORED_EVENTS,
  type HookEvent,
} from "../core/hook-runtime/events";
import type { HookActionIR } from "../core/hook-runtime/primitives";
import {
  translateActionForPlatform,
  translateEventForPlatform,
  type Platform,
} from "../core/hook-runtime/translator";

const PLATFORMS: Platform[] = ["opencode", "claude", "codex"];

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeRunCommand = (): HookActionIR => ({
  type: "run_command",
  command: "echo hello",
});

const makeRunExec = (): HookActionIR => ({
  type: "run_exec",
  command: "node",
  args: ["--version"],
});

const makeRunScript = (): HookActionIR => ({
  type: "run_script",
  path: "./scripts/post-hook.sh",
});

const makeHttpRequest = (): HookActionIR => ({
  type: "http_request",
  url: "https://example.com/hook",
  method: "POST",
});

const makeCallMcpTool = (): HookActionIR => ({
  type: "call_mcp_tool",
  server: "my-server",
  tool: "my-tool",
});

const makeInvokePrompt = (): HookActionIR => ({
  type: "invoke_prompt",
  prompt: "summarise the last tool output",
});

const makeInvokeAgent = (): HookActionIR => ({
  type: "invoke_agent",
  agent: "code-explorer",
  prompt: "analyse changed files",
});

const makeRuntimeCode = (runtime: string): HookActionIR => ({
  type: "runtime_code",
  runtime,
  body: "console.log('hi')",
});

// ---------------------------------------------------------------------------
// Describe("Primitive emission matrix") — 8 primitives × 3 platforms
// ---------------------------------------------------------------------------

describe("Hook primitive cross-runtime", () => {
  describe("Primitive emission matrix", () => {
    // ── run_command ──────────────────────────────────────────────────────────
    describe("run_command", () => {
      for (const platform of PLATFORMS) {
        test(`emits on ${platform} with no diagnostic`, () => {
          const result = translateActionForPlatform(makeRunCommand(), platform);
          expect(result.output).toBeDefined();
          expect(result.diagnostic).toBeUndefined();
        });
      }
    });

    // ── run_exec ─────────────────────────────────────────────────────────────
    describe("run_exec", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeRunExec(), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on claude with no diagnostic", () => {
        const result = translateActionForPlatform(makeRunExec(), "claude");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on codex with shim diagnostic codex.hooks.run_exec.shim", () => {
        const result = translateActionForPlatform(makeRunExec(), "codex");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.run_exec.shim");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── run_script ───────────────────────────────────────────────────────────
    describe("run_script", () => {
      for (const platform of PLATFORMS) {
        test(`emits on ${platform} with no diagnostic`, () => {
          const result = translateActionForPlatform(makeRunScript(), platform);
          expect(result.output).toBeDefined();
          expect(result.diagnostic).toBeUndefined();
        });
      }
    });

    // ── http_request ─────────────────────────────────────────────────────────
    describe("http_request", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeHttpRequest(), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on claude with no diagnostic", () => {
        const result = translateActionForPlatform(makeHttpRequest(), "claude");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("drops on codex with diagnostic codex.hooks.handler.http.dropped", () => {
        const result = translateActionForPlatform(makeHttpRequest(), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.handler.http.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── call_mcp_tool ────────────────────────────────────────────────────────
    describe("call_mcp_tool", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeCallMcpTool(), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on claude with no diagnostic", () => {
        const result = translateActionForPlatform(makeCallMcpTool(), "claude");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("drops on codex with diagnostic codex.hooks.handler.mcp_tool.dropped", () => {
        const result = translateActionForPlatform(makeCallMcpTool(), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.handler.mcp_tool.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── invoke_prompt ────────────────────────────────────────────────────────
    describe("invoke_prompt", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeInvokePrompt(), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on claude with no diagnostic (full emit)", () => {
        const result = translateActionForPlatform(makeInvokePrompt(), "claude");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("drops on codex with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeInvokePrompt(), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.handler.prompt.skipped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── invoke_agent ─────────────────────────────────────────────────────────
    describe("invoke_agent", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeInvokeAgent(), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("emits on claude with no diagnostic (full emit)", () => {
        const result = translateActionForPlatform(makeInvokeAgent(), "claude");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("drops on codex with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeInvokeAgent(), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.handler.agent.skipped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── runtime_code (runtime: "opencode") ───────────────────────────────────
    describe("runtime_code [runtime=opencode]", () => {
      test("emits on opencode with no diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("opencode"), "opencode");
        expect(result.output).toBeDefined();
        expect(result.diagnostic).toBeUndefined();
      });

      test("drops on claude with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("opencode"), "claude");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("claude.hook.runtime_code.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });

      test("drops on codex with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("opencode"), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hook.runtime_code.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });

    // ── runtime_code (runtime: "claude-code") — non-opencode runtime ─────────
    describe("runtime_code [runtime=claude-code]", () => {
      test("drops on opencode with WARN_OPENCODE_RUNTIME_OPAQUE diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("claude-code"), "opencode");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("WARN_OPENCODE_RUNTIME_OPAQUE");
        expect(result.diagnostic!.severity).toBe("warn");
      });

      test("drops on claude with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("claude-code"), "claude");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("claude.hook.runtime_code.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });

      test("drops on codex with drop-warn diagnostic", () => {
        const result = translateActionForPlatform(makeRuntimeCode("claude-code"), "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hook.runtime_code.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Event coverage — all known hook events × 3 platforms
  // -------------------------------------------------------------------------

  describe("Event coverage", () => {
    test("HOOK_EVENTS has 31 entries", () => {
      expect(HOOK_EVENTS.length).toBe(31);
    });

    test("opencode: all events emit with no diagnostic", () => {
      for (const event of HOOK_EVENTS) {
        const result = translateEventForPlatform(event, "opencode");
        expect(result.output).toBe(event);
        expect(result.diagnostic).toBeUndefined();
      }
    });

    test("claude: all events emit with no diagnostic", () => {
      for (const event of HOOK_EVENTS) {
        const result = translateEventForPlatform(event, "claude");
        expect(result.output).toBe(event);
        expect(result.diagnostic).toBeUndefined();
      }
    });

    test("codex: unsupported events produce codex.hooks.event.dropped diagnostic", () => {
      const unsupportedEvents = HOOK_EVENTS.filter((e) =>
        CODEX_UNSUPPORTED_EVENTS.has(e),
      );
      expect(unsupportedEvents.length).toBeGreaterThan(0);

      for (const event of unsupportedEvents) {
        const result = translateEventForPlatform(event, "codex");
        expect(result.output).toBeUndefined();
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.event.dropped");
        expect(result.diagnostic!.severity).toBe("warn");
      }
    });

    test("codex: supported non-ignored events emit with no diagnostic", () => {
      const supportedNonIgnored = HOOK_EVENTS.filter(
        (e) => !CODEX_UNSUPPORTED_EVENTS.has(e) && !CODEX_MATCHER_IGNORED_EVENTS.has(e),
      );
      expect(supportedNonIgnored.length).toBeGreaterThan(0);

      for (const event of supportedNonIgnored) {
        const result = translateEventForPlatform(event, "codex");
        expect(result.output).toBe(event);
        expect(result.diagnostic).toBeUndefined();
      }
    });

    test("codex: matcher-ignored events emit output AND codex.hooks.matcher.ignored info diagnostic", () => {
      const ignoredEvents = HOOK_EVENTS.filter((e: HookEvent) =>
        CODEX_MATCHER_IGNORED_EVENTS.has(e),
      );
      expect(ignoredEvents.length).toBeGreaterThan(0);

      for (const event of ignoredEvents) {
        const result = translateEventForPlatform(event, "codex");
        // output must be present — event IS emitted
        expect(result.output).toBe(event);
        // diagnostic must also be present with matcher.ignored code
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic!.code).toBe("codex.hooks.matcher.ignored");
        expect(result.diagnostic!.severity).toBe("info");
      }
    });

    test("codex: all events × codex = correct split (unsupported + matcher-ignored + supported)", () => {
      let dropped = 0;
      let matcherIgnored = 0;
      let fullySupported = 0;

      for (const event of HOOK_EVENTS) {
        const result = translateEventForPlatform(event, "codex");
        if (result.output === undefined) {
          dropped++;
        } else if (result.diagnostic?.code === "codex.hooks.matcher.ignored") {
          matcherIgnored++;
        } else {
          fullySupported++;
        }
      }

      expect(dropped + matcherIgnored + fullySupported).toBe(HOOK_EVENTS.length);
      expect(dropped).toBe(CODEX_UNSUPPORTED_EVENTS.size);
      expect(matcherIgnored).toBe(CODEX_MATCHER_IGNORED_EVENTS.size);
    });
  });
});
