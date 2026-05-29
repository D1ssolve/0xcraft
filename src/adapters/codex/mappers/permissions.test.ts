/**
 * Tests for the neutral-spec Codex permission mapper (Batch 5, T-5.3).
 *
 * Legacy bucketed mapper tests live in `../permission-mapper.test.ts`
 * — kept untouched. These tests cover only `./permissions.ts`.
 */

import { describe, expect, test } from "bun:test";

import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import type { PermissionSpec } from "../../../core/permission/permission-spec";
import { mapPermissions } from "./permissions";

function makeSpec(overrides: Partial<PermissionSpec> = {}): PermissionSpec {
  return {
    sandbox: "workspace-write",
    tools: {},
    bash: {},
    ...overrides,
  };
}

describe("Codex mapPermissions (neutral spec)", () => {
  test("sandbox: read → sandbox_mode read-only", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "read" }), collector);
    expect(out.sandbox_mode).toBe("read-only");
    expect(collector.hasErrors()).toBe(false);
  });

  test("sandbox: workspace-write → sandbox_mode workspace-write", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "workspace-write" }), collector);
    expect(out.sandbox_mode).toBe("workspace-write");
    expect(collector.getAll()).toEqual([]);
  });

  test("sandbox: full → danger-full-access + warn permission.sandbox.degraded", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "full" }), collector);
    expect(out.sandbox_mode).toBe("danger-full-access");
    const warns = collector.getAll().filter((d) => d.severity === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.code).toBe("permission.sandbox.degraded");
    expect(collector.hasErrors()).toBe(false);
  });

  test("no verdicts → approval_policy = never", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec(), collector);
    expect(out.approval_policy).toBe("never");
  });

  test("all-allow verdicts → approval_policy = never", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { read: "allow", bash: "allow" }, bash: { "git *": "allow" } }),
      collector,
    );
    expect(out.approval_policy).toBe("never");
    // No unsupported warns because everything is `allow`.
    expect(
      collector.getAll().some((d) => d.code === "permission.tool.unsupported"),
    ).toBe(false);
  });

  test("any ask → approval_policy = on-request (no deny warn)", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { webfetch: "ask" } }),
      collector,
    );
    expect(out.approval_policy).toBe("on-request");
    expect(
      collector.getAll().some((d) => d.code === "permission.approval.deny_softened"),
    ).toBe(false);
  });

  test("any deny → approval_policy = on-request + softened warn", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { bash: "deny" } }),
      collector,
    );
    expect(out.approval_policy).toBe("on-request");
    expect(
      collector.getAll().some((d) => d.code === "permission.approval.deny_softened"),
    ).toBe(true);
  });

  test("per-tool non-allow verdicts → permission.tool.unsupported warn with sorted dropped list", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(
      makeSpec({
        tools: { webfetch: "deny", websearch: "deny", lsp: "ask" },
        bash: { "git push *": "deny" },
      }),
      collector,
    );
    const warn = collector
      .getAll()
      .find((d) => d.code === "permission.tool.unsupported");
    expect(warn).toBeDefined();
    expect(warn!.details!.dropped).toEqual([
      "bash.git push *",
      "tools.lsp",
      "tools.webfetch",
      "tools.websearch",
    ]);
  });

  test("filesystem roots → permission.filesystem.unsupported warn", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(
      makeSpec({ filesystem: { readableRoots: ["/etc"], writableRoots: [] } }),
      collector,
    );
    expect(
      collector.getAll().some((d) => d.code === "permission.filesystem.unsupported"),
    ).toBe(true);
  });
});

describe("Codex mapPermissions: T-23", () => {
  test("emits one codex.permissions.bashGlob.dropped per non-allow bash glob", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(
      makeSpec({
        bash: {
          "rm -rf *": "deny",
          "git push": "ask",
          "ls": "allow",
        },
      }),
      collector,
    );
    const drops = collector.getAll().filter((d) => d.code === "codex.permissions.bashGlob.dropped");
    expect(drops.length).toBe(2);
    const globs = drops.map((d) => (d.details as { glob: string }).glob).sort();
    expect(globs).toEqual(["git push", "rm -rf *"]);
  });

  test("no bashGlob.dropped when all bash verdicts are allow", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(makeSpec({ bash: { ls: "allow", pwd: "allow" } }), collector);
    expect(
      collector.getAll().some((d) => d.code === "codex.permissions.bashGlob.dropped"),
    ).toBe(false);
  });

  test("approval_policy never emits 'on-failure' (deprecated)", () => {
    // Exhaust all input shapes; the union type itself excludes
    // "on-failure", so this asserts the mapper output never widens.
    const cases: PermissionSpec[] = [
      makeSpec(),
      makeSpec({ tools: { edit: "deny" } }),
      makeSpec({ tools: { edit: "ask" } }),
      makeSpec({ bash: { "*": "deny" } }),
      makeSpec({ sandbox: "full" }),
    ];
    for (const spec of cases) {
      const result = mapPermissions(spec, new DiagnosticCollector());
      expect(result.approval_policy).not.toBe("on-failure" as never);
    }
  });
});
