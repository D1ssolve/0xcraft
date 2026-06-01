import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { PackManifest } from "./pack-schema";

describe("PackManifest", () => {
  test("parses strict resources manifest", () => {
    const result = PackManifest.parse({
      name: "@0xcraft/agents-pack",
      version: "1.0.0",
      resources: {
        agents: ["agents/**"],
        skills: ["skills/**"],
        hooks: ["hooks/**"],
        mcp: ["mcp/**"],
        commands: ["commands/**"],
      },
    });

    expect(result.name).toBe("@0xcraft/agents-pack");
    expect(result.resources.agents).toEqual(["agents/**"]);
  });

  test("allows optional resource arrays", () => {
    expect(() =>
      PackManifest.parse({
        name: "agents-pack",
        version: "1.0.0",
        resources: { agents: ["agents/**"] },
      }),
    ).not.toThrow();
  });

  test("rejects unknown keys", () => {
    expect(() =>
      PackManifest.parse({
        name: "agents-pack",
        version: "1.0.0",
        resources: { agents: ["agents/**"] },
        exports: { agents: ["agents/**"] },
      }),
    ).toThrow(z.ZodError);
  });
});
