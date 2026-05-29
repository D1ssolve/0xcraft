/**
 * Batch-0 baseline snapshot (T-0.3).
 *
 * Locks the current OpenCode adapter public surface BEFORE Batch-1+ refactor.
 * The OpenCode adapter does NOT emit files — it returns a `Hooks` object
 * consumed by `@opencode-ai/plugin`. We snapshot the exported symbol shape
 * and assert the `createPlugin` entry is callable and async.
 *
 * Deeper behavioural regression for hook factories lives in
 * `opencode-regression.test.ts` (B.2 surface).
 */
import { describe, expect, test } from "bun:test";

import * as openCodeAdapter from "./index";

describe("opencode adapter — Batch-0 baseline snapshot (T-0.3)", () => {
  test("exports expected public symbols", () => {
    const exportedKeys = Object.keys(openCodeAdapter).sort();
    expect(exportedKeys).toContain("createPlugin");
    expect(exportedKeys).toContain("createPluginHooks");
    expect(exportedKeys).toContain("resolvePluginRoot");
    expect(exportedKeys).toContain("resolvePackageRoot");
  });

  test("createPlugin is an async function", () => {
    expect(typeof openCodeAdapter.createPlugin).toBe("function");
    // Async functions report length === 1 here (one declared param).
    expect(openCodeAdapter.createPlugin.length).toBe(1);
  });

  test("createPluginHooks is an async function with default options", () => {
    expect(typeof openCodeAdapter.createPluginHooks).toBe("function");
    expect(openCodeAdapter.createPluginHooks.length).toBeGreaterThanOrEqual(1);
  });

  test("resolvePluginRoot prefers worktree over directory", () => {
    const root = openCodeAdapter.resolvePluginRoot({
      worktree: "/tmp/work",
      directory: "/tmp/dir",
    });
    expect(root).toBe("/tmp/work");
  });

  test("resolvePluginRoot falls back to directory when worktree is missing", () => {
    const root = openCodeAdapter.resolvePluginRoot({
      directory: "/tmp/dir-only",
    });
    expect(root).toBe("/tmp/dir-only");
  });
});
