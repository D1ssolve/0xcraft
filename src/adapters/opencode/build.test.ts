/**
 * Batch 4 — `build()` canonical entry tests for opencode.
 *
 * Validates:
 *   - `kind === "runtime-plugin"`.
 *   - `runtimePlugin` is a callable function (matches `Plugin` shape).
 *   - capability report uses OPENCODE_MATRIX verbatim.
 *   - no timestamp on metadata.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

import { OPENCODE_MATRIX } from "../_shared/capability-matrix";

import { defaultConfig } from "../../core/config/config-types";

import { build } from "./build";

const packageRoot = path.resolve(import.meta.dir, "..", "..", "..");

describe("opencode build()", () => {
  test("returns runtime-plugin artifact with callable runtimePlugin", async () => {
    const artifact = await build({
      config: defaultConfig,
      projectRoot: process.cwd(),
      packageRoot,
    });

    expect(artifact.platform).toBe("opencode");
    expect(artifact.kind).toBe("runtime-plugin");
    expect(typeof artifact.runtimePlugin).toBe("function");
    expect(artifact.files).toEqual([]);
    expect(artifact.capabilityReport.features).toEqual(OPENCODE_MATRIX);
    expect("generatedAt" in (artifact.metadata ?? {})).toBe(false);
    expect(artifact.ok).toBe(true);
  });

  test("two consecutive build() calls return equivalent artifacts", async () => {
    const a = await build({ config: defaultConfig, projectRoot: process.cwd(), packageRoot });
    const b = await build({ config: defaultConfig, projectRoot: process.cwd(), packageRoot });
    expect(a.platform).toBe(b.platform);
    expect(a.kind).toBe(b.kind);
    expect(a.capabilityReport).toEqual(b.capabilityReport);
    // runtimePlugin must be the same function reference — proves no
    // hidden per-call construction (determinism, ADR §6).
    expect(a.runtimePlugin).toBe(b.runtimePlugin);
  });
});
