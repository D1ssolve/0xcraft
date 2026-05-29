/**
 * Tests for the neutral-spec OpenCode permission mapper (Batch 5, T-5.1).
 *
 * The legacy bucketed mapper tests live in `./permission-mapper.test.ts`
 * — kept untouched. These tests cover only the new `mapPermissions`
 * entry under `./mappers/permissions.ts`.
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

describe("OpenCode mapPermissions (neutral spec)", () => {
  test("sandbox: read → deny edit + bash", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "read" }), collector);
    expect(out.edit).toBe("deny");
    expect(out.bash).toBe("deny");
    expect(collector.hasErrors()).toBe(false);
  });

  test("sandbox: workspace-write → no implicit denies", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "workspace-write" }), collector);
    expect(out).toEqual({});
    expect(collector.getAll()).toEqual([]);
  });

  test("sandbox: full → warn permission.sandbox.degraded", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(makeSpec({ sandbox: "full" }), collector);
    expect(out).toEqual({});
    const diags = collector.getAll();
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warn");
    expect(diags[0]!.code).toBe("permission.sandbox.degraded");
  });

  test("tools.<name> → flat <name>: verdict", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { webfetch: "deny", read: "allow", grep: "ask" } }),
      collector,
    );
    expect(out.webfetch).toBe("deny");
    expect(out.read).toBe("allow");
    expect(out.grep).toBe("ask");
  });

  test("tools.bash override beats sandbox-derived deny", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ sandbox: "read", tools: { bash: "allow" } }),
      collector,
    );
    expect(out.bash).toBe("allow");
    expect(out.edit).toBe("deny");
  });

  test("bash.<glob> → bash record passthrough", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ bash: { "git *": "allow", "rm -rf *": "deny" } }),
      collector,
    );
    expect(out.bash).toEqual({ "git *": "allow", "rm -rf *": "deny" });
  });

  test("unknown tool ids pass through verbatim", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ tools: { my_custom_tool: "deny" } }),
      collector,
    );
    expect(out.my_custom_tool).toBe("deny");
  });

  test("delegation single '*' → flat task verdict", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ delegation: { "*": "deny" } }),
      collector,
    );
    expect(out.task).toBe("deny");
  });

  test("delegation per-agent → task object passthrough", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ delegation: { "*": "deny", "code-explorer": "allow" } }),
      collector,
    );
    expect(out.task).toEqual({ "*": "deny", "code-explorer": "allow" });
  });

  test("filesystem.readableRoots → drop-warn", () => {
    const collector = new DiagnosticCollector();
    mapPermissions(
      makeSpec({ filesystem: { readableRoots: ["/etc"] } }),
      collector,
    );
    expect(
      collector.getAll().some((d) => d.code === "permission.filesystem.unsupported"),
    ).toBe(true);
  });

  test("filesystem.writableRoots → external_directory allow map", () => {
    const collector = new DiagnosticCollector();
    const out = mapPermissions(
      makeSpec({ filesystem: { writableRoots: ["/tmp", "/var/data"] } }),
      collector,
    );
    expect(out.external_directory).toEqual({ "/tmp": "allow", "/var/data": "allow" });
  });
});
