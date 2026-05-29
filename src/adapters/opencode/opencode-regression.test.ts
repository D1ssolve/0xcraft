import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createHookTransform } from "./hooks/hook-shim-builder";
import { builtinHooks } from "../../core/hooks";
import { builtinAgents } from "../../core/agents";
import { builtinSkills } from "../../core/skills";
import { builtinMcpServers } from "../../core/mcp";
import { createAgentsGuardHook } from "./hooks/agents-guard";
import { createCavemanBootstrapHook } from "./hooks/caveman-bootstrap";
import { createGitWorktreeBootstrapHook } from "./hooks/git-worktree-bootstrap";

// The SDK transform signature is strict; tests use minimal mocks. Cast the
// returned handler to a loose `(i, o) => unknown` form for ergonomic testing.
type LooseTransform = (input: unknown, output: unknown) => unknown;
function loose(fn: ReturnType<typeof createHookTransform>): LooseTransform {
  return fn as unknown as LooseTransform;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Regression suite for Task B.2.
 *
 * Verifies the structural surface that the OpenCode adapter must
 * preserve after delegating to `_shared/bootstrap-text`,
 * `_shared/package-root`, and `hook-shim-builder`.
 *
 * Does NOT exercise `loadConfig` end-to-end — A.2 refactored
 * `loadConfig` to a single-options signature; the adapter's
 * `createPluginHooks` still calls it positionally (B.3 will reconcile
 * the call site). Tests that need the merged config path live in
 * `index.test.ts` and currently fail because of that A.2 gap, not B.2.
 */
describe("opencode regression — B.2 structural surface", () => {
  test("registries surface: builtin agents / skills / hooks / enabled MCP exist", () => {
    expect(builtinAgents.length).toBeGreaterThan(0);
    expect(builtinSkills.length).toBeGreaterThan(0);
    expect(builtinHooks.length).toBeGreaterThan(0);
    expect(builtinMcpServers.some((m) => m.enabledByDefault)).toBe(true);
  });

  test("hook factories produce non-empty bootstrap text for relevant project state", () => {
    const projectRoot = makeTempDir("0xcraft-reg-hooks-");
    // No AGENTS.md → agents-guard fires.
    expect(createAgentsGuardHook({ projectRoot }).buildBootstrap()).toContain(
      "AGENTS_GUARD_INJECTED",
    );
    // Caveman bootstrap unconditional.
    expect(createCavemanBootstrapHook().buildBootstrap()).toContain(
      "CAVEMAN_BOOTSTRAP_INJECTED",
    );
    // No .git / .tasks → worktree opts out (empty).
    expect(createGitWorktreeBootstrapHook({ projectRoot }).buildBootstrap()).toBe("");
  });

  test("AGENTS.md present → agents-guard opts out (empty text)", () => {
    const projectRoot = makeTempDir("0xcraft-reg-guard-skip-");
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Agents\n");
    expect(createAgentsGuardHook({ projectRoot }).buildBootstrap()).toBe("");
  });

  test("createHookTransform: prepends one bootstrap part on first user message", async () => {
    const projectRoot = makeTempDir("0xcraft-reg-transform-");
    const transform = createHookTransform({ hooks: builtinHooks, projectRoot });

    const originalPart = { type: "text", text: "Original request" };
    const output = {
      messages: [{ info: { role: "user" }, parts: [originalPart] }],
    };

    await loose(transform)({}, output);

    expect(output.messages[0]?.parts).toHaveLength(2);
    const injected = output.messages[0]?.parts[0] as { type: string; text: string };
    expect(injected.type).toBe("text");
    expect(injected.text).toContain("AGENTS_GUARD_INJECTED");
    expect(injected.text).toContain("CAVEMAN_BOOTSTRAP_INJECTED");
    expect(injected.text).toContain("\n\n"); // double-newline join
  });

  test("createHookTransform: second call with marker present → no double injection", async () => {
    const projectRoot = makeTempDir("0xcraft-reg-dedupe-");
    const transform = createHookTransform({ hooks: builtinHooks, projectRoot });

    const output = {
      messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "Original" }] }],
    };

    await loose(transform)({}, output);
    const lengthAfterFirst = output.messages[0]?.parts.length;
    await loose(transform)({}, output);

    expect(output.messages[0]?.parts.length).toBe(lengthAfterFirst);
  });

  test("createHookTransform: empty hook list → no-op", async () => {
    const transform = createHookTransform({ hooks: [], projectRoot: makeTempDir("0xcraft-reg-empty-") });
    const originalPart = { type: "text", text: "Untouched" };
    const output = {
      messages: [{ info: { role: "user" }, parts: [originalPart] }],
    };

    await loose(transform)({}, output);

    expect(output.messages[0]?.parts).toHaveLength(1);
    expect(output.messages[0]?.parts[0]).toBe(originalPart);
  });

  test("createHookTransform: malformed outputs do not throw", async () => {
    const transform = createHookTransform({
      hooks: builtinHooks,
      projectRoot: makeTempDir("0xcraft-reg-malformed-"),
    });

    await expect(loose(transform)({}, undefined)).resolves.toBeUndefined();
    await expect(loose(transform)({}, null)).resolves.toBeUndefined();
    await expect(loose(transform)({}, {})).resolves.toBeUndefined();
    await expect(loose(transform)({}, { messages: "bad" })).resolves.toBeUndefined();
    await expect(
      loose(transform)({}, { messages: [{ info: { role: "assistant" }, parts: [] }] }),
    ).resolves.toBeUndefined();
    await expect(loose(transform)({}, { messages: [{ info: { role: "user" } }] })).resolves.toBeUndefined();
  });

  test("createHookTransform: marker scan only checks first user message", async () => {
    const projectRoot = makeTempDir("0xcraft-reg-first-user-");
    const transform = createHookTransform({ hooks: builtinHooks, projectRoot });

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "First user request" }] },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "CAVEMAN_BOOTSTRAP_INJECTED later" }],
        },
      ],
    };

    await loose(transform)({}, output);

    // Should still inject because the *first* user message has no marker.
    expect(output.messages[0]?.parts.length).toBeGreaterThan(1);
    expect((output.messages[0]?.parts[0] as { text: string }).text).toContain(
      "CAVEMAN_BOOTSTRAP_INJECTED",
    );
  });
});
