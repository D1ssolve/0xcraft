import { describe, expect, test } from "bun:test";

import type {
  BuildOptions,
  PlatformArtifact,
  PlatformArtifactMetadata,
} from "./artifact";

describe("artifact types", () => {
  test("PlatformArtifactMetadata forbids generatedAt at compile time", () => {
    const meta: PlatformArtifactMetadata = { deterministic: true };
    expect(meta.deterministic).toBe(true);

    // @ts-expect-error — generatedAt is typed `never`; assignment must fail.
    const bad: PlatformArtifactMetadata = { deterministic: true, generatedAt: "now" };
    expect(bad.deterministic).toBe(true);
  });

  test("PlatformArtifact carries declared shape with deterministic metadata", () => {
    const artifact: PlatformArtifact = {
      platform: "opencode",
      kind: "runtime-plugin",
      ok: true,
      files: [],
      diagnostics: [],
      capabilityReport: {
        platform: "opencode",
        features: {} as PlatformArtifact["capabilityReport"]["features"],
      },
      metadata: { deterministic: true },
    };
    expect(artifact.metadata.deterministic).toBe(true);
    expect(artifact.ok).toBe(true);
  });

  test("BuildOptions carries config + projectRoot + packageRoot", () => {
    const options: BuildOptions = {
      config: {} as BuildOptions["config"],
      projectRoot: "/p",
      packageRoot: "/k",
    };
    expect(options.projectRoot).toBe("/p");
    expect(options.packageRoot).toBe("/k");
  });
});
