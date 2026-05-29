import { describe, expect, it } from "bun:test";
import { builtinAgents, getAgentById } from "./builtin-agents";
import type { PermissionSpec } from "../permission/permission-spec";

/**
 * T-12.13 canonical-state assertions for built-in agents.
 *
 * Builtins now declare the canonical {@link PermissionSpec} via
 * `permission:` (not the deprecated bucketed `permissions:`).
 * T-12.6: the legacy bridge `effectiveAgentPermissions` is removed;
 * adapters consume `agent.permission` directly via per-platform
 * `mapPermissions`.
 */

const CANONICAL_MODES = new Set(["primary", "subagent", "all"]);

describe("builtinAgents — canonical PermissionSpec (T-12.13)", () => {
  it("registry is non-empty", () => {
    expect(builtinAgents.length).toBeGreaterThan(0);
  });

  it("all agent ids are unique", () => {
    const ids = builtinAgents.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const agent of builtinAgents) {
    describe(`agent: ${agent.id}`, () => {
      it("has required identity fields", () => {
        expect(agent.id).toBeTruthy();
        expect(agent.name).toBeTruthy();
        expect(agent.description).toBeTruthy();
        expect(agent.model).toBeTruthy();
        expect(agent.promptFile).toBeTruthy();
      });

      it("uses canonical mode values (no legacy 'both')", () => {
        expect(CANONICAL_MODES.has(agent.mode as string)).toBe(true);
        expect(agent.mode).not.toBe("both");
      });

      it("declares canonical `permission: PermissionSpec` when permissions are set", () => {
        // Not every agent must have permissions, but if effectiveAgentPermissions
        // returns something it must be derived from the canonical spec.
        if (agent.permission) {
          const spec: PermissionSpec = agent.permission;
          // Shape sanity — at least one canonical bucket is present.
          const hasAnyCanonicalKey =
            spec.sandbox !== undefined ||
            spec.tools !== undefined ||
            spec.bash !== undefined ||
            spec.filesystem !== undefined ||
            spec.delegation !== undefined;
          expect(hasAnyCanonicalKey).toBe(true);
        }
      });
    });
  }

  it("code-explorer denies edit/webfetch/task (acceptance criterion)", () => {
    const agent = getAgentById("code-explorer");
    expect(agent).toBeDefined();

    // Canonical: assert on PermissionSpec directly.
    const spec = agent!.permission;
    expect(spec).toBeDefined();
    expect(spec!.tools?.edit).toBe("deny");
    expect(spec!.tools?.webfetch).toBe("deny");
    expect(spec!.delegation?.["*"]).toBe("deny");
  });
});
