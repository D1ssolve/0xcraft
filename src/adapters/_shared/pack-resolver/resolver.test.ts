import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolvePackResources, resetPackResolverStateForTests } from "./resolver";

describe("resolvePackResources", () => {
  let tmpRoot: string;
  let nodeModulesDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-pack-resolver-"));
    nodeModulesDir = path.join(tmpRoot, "node_modules");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    resetPackResolverStateForTests();
  });

  afterEach(() => {
    resetPackResolverStateForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("resolves a single pack with two agents using namespaced ids", () => {
    writePack("@0xcraft/agents-pack", "1.0.0", {
      resources: { agents: ["agents/**"] },
      files: ["agents/code-explorer/AGENT.md", "agents/reviewer/AGENT.md"],
    });

    const resources = resolvePackResources("@0xcraft/agents-pack", nodeModulesDir, "1.0.0");

    expect(resources).toEqual([
      {
        id: "agents-pack/code-explorer",
        kind: "agent",
        sourcePath: path.join(nodeModulesDir, "@0xcraft", "agents-pack", "agents", "code-explorer"),
      },
      {
        id: "agents-pack/reviewer",
        kind: "agent",
        sourcePath: path.join(nodeModulesDir, "@0xcraft", "agents-pack", "agents", "reviewer"),
      },
    ]);
  });

  test("throws ERR_PACK_ID_CONFLICT when two packs resolve the same namespaced id", () => {
    writePack("@scope/toolbox", "1.0.0", {
      resources: { agents: ["agents/**"] },
      files: ["agents/shared/AGENT.md"],
    });
    writePack("toolbox", "1.0.0", {
      resources: { agents: ["agents/**"] },
      files: ["agents/shared/AGENT.md"],
    });

    resolvePackResources("@scope/toolbox", nodeModulesDir, "1.0.0");

    expect(() => resolvePackResources("toolbox", nodeModulesDir, "1.0.0")).toThrow(
      expect.objectContaining({ code: "ERR_PACK_ID_CONFLICT" }),
    );
  });

  test("throws WARN_PACK_VERSION_DRIFT when installed version differs from declared version", () => {
    writePack("agents-pack", "1.0.0", {
      resources: { agents: ["agents/**"] },
      files: ["agents/code-explorer/AGENT.md"],
    });

    expect(() => resolvePackResources("agents-pack", nodeModulesDir, "2.0.0")).toThrow(
      expect.objectContaining({ code: "WARN_PACK_VERSION_DRIFT" }),
    );
  });

  test("throws clear error when pack directory is missing", () => {
    expect(() => resolvePackResources("missing-pack", nodeModulesDir)).toThrow(
      "Pack directory not found: missing-pack",
    );
  });

  test("throws clear error when 0xcraft-pack.json is missing", () => {
    const packDir = path.join(nodeModulesDir, "agents-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "package.json"), JSON.stringify({ name: "agents-pack", version: "1.0.0" }));

    expect(() => resolvePackResources("agents-pack", nodeModulesDir)).toThrow(
      "Pack manifest not found: agents-pack/0xcraft-pack.json",
    );
  });

  function writePack(
    packName: string,
    version: string,
    options: { resources: Record<string, string[]>; files: string[] },
  ) {
    const packDir = path.join(nodeModulesDir, ...packName.split("/"));
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "package.json"), JSON.stringify({ name: packName, version }));
    fs.writeFileSync(
      path.join(packDir, "0xcraft-pack.json"),
      JSON.stringify({ name: packName, version, resources: options.resources }),
    );

    for (const relativeFile of options.files) {
      const filePath = path.join(packDir, relativeFile);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "---\nname: Test\n---\nBody\n");
    }
  }
});
