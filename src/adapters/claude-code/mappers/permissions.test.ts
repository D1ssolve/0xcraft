/**
 * Tests for the Claude Code permission mapper (Batch 5, T-5.2).
 *
 * Legacy bucketed mapper tests live in `./permission-mapper.test.ts`
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

describe("Claude Code mapPermissions (neutral spec)", () => {
  test("sandbox: read → disallow Edit family + Bash", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "read" }), collector);
    expect(out.disallowedTools).toEqual(["Bash", "Edit", "MultiEdit", "Write"]);
    expect(out.allowedTools).toEqual([]);
  });

  test("sandbox: workspace-write → empty arrays", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "workspace-write" }), collector);
    expect(out).toEqual({ allowedTools: [], disallowedTools: [] });
    expect(collector.getAll()).toEqual([]);
  });

  test("sandbox: full → info permission.sandbox.degraded", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(makeSpec({ sandbox: "full" }), collector);
    const diags = collector.getAll();
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("info");
    expect(diags[0]!.code).toBe("permission.sandbox.degraded");
  });

  test("tools.edit deny → Edit + MultiEdit + Write disallowed (sorted)", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { edit: "deny" } }),
      collector,
    );
    expect(out.disallowedTools).toEqual(["Edit", "MultiEdit", "Write"]);
  });

  test("tools allow + deny mix → split into allowed/disallowed sorted", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({
        tools: {
          read: "allow",
          grep: "allow",
          webfetch: "deny",
          websearch: "deny",
        },
      }),
      collector,
    );
    expect(out.allowedTools).toEqual(["Grep", "Read"]);
    expect(out.disallowedTools).toEqual(["WebFetch", "WebSearch"]);
  });

  test("tools ask → neither list (Claude prompts at runtime)", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { webfetch: "ask" } }),
      collector,
    );
    expect(out.allowedTools).toEqual([]);
    expect(out.disallowedTools).toEqual([]);
  });

  test("bash.<glob> → Bash(<glob>) rule syntax", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ bash: { "git *": "allow", "rm -rf *": "deny" } }),
      collector,
    );
    expect(out.allowedTools).toEqual(["Bash(git *)"]);
    expect(out.disallowedTools).toEqual(["Bash(rm -rf *)"]);
  });

  test("explicit tools.bash allow overrides sandbox: read default", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ sandbox: "read", tools: { bash: "allow" } }),
      collector,
    );
    expect(out.allowedTools).toContain("Bash");
    expect(out.disallowedTools).not.toContain("Bash");
    // Edit family still denied by sandbox.
    expect(out.disallowedTools).toContain("Edit");
  });

  test("delegation all-deny → Task disallowed", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ delegation: { "*": "deny" } }),
      collector,
    );
    expect(out.disallowedTools).toContain("Task");
  });

  test("delegation all-allow → Task allowed", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ delegation: { "*": "allow" } }),
      collector,
    );
    expect(out.allowedTools).toContain("Task");
  });

  test("delegation mixed → permission.delegation.lossy warn, Task NOT in either list", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ delegation: { "*": "deny", "code-explorer": "allow" } }),
      collector,
    );
    expect(out.allowedTools).not.toContain("Task");
    expect(out.disallowedTools).not.toContain("Task");
    const warn = collector
      .getAll()
      .find((d) => d.code === "permission.delegation.lossy");
    expect(warn).toBeDefined();
    expect(warn!.details).toEqual({
      allowedAgents: ["code-explorer"],
      deniedAgents: ["*"],
    });
  });

  test("filesystem roots → permission.filesystem.unsupported warn", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(
      makeSpec({ filesystem: { readableRoots: ["/etc"] } }),
      collector,
    );
    expect(
      collector.getAll().some((d) => d.code === "permission.filesystem.unsupported"),
    ).toBe(true);
  });

  test("unknown neutral tool id → info permission.tool.passthrough", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { my_custom_tool: "deny" } }),
      collector,
    );
    expect(out.disallowedTools).toContain("my_custom_tool");
    expect(
      collector.getAll().some((d) => d.code === "permission.tool.passthrough"),
    ).toBe(true);
  });
});
