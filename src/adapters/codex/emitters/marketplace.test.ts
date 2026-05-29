import { describe, test, expect } from "bun:test";

import { emitCodexMarketplace } from "./marketplace";

describe("emitCodexMarketplace", () => {
  test("emits .agents/plugins/marketplace.json at expected path", () => {
    const { files } = emitCodexMarketplace({
      packageName: "0xcraft",
      packageVersion: "2.0.0",
    });
    expect(files.map((f) => f.path)).toEqual([".agents/plugins/marketplace.json"]);
  });

  test("default bundle path is ./.codex-plugin", () => {
    const { manifest } = emitCodexMarketplace({ packageName: "0xcraft" });
    expect(manifest.plugins[0]!.path).toBe("./.codex-plugin");
  });

  test("includes name = '<package>-marketplace'", () => {
    const { manifest } = emitCodexMarketplace({ packageName: "demo-pkg" });
    expect(manifest.name).toBe("demo-pkg-marketplace");
  });

  test("omits version when packageVersion missing", () => {
    const { manifest } = emitCodexMarketplace({ packageName: "demo-pkg" });
    expect(manifest.plugins[0]!.version).toBeUndefined();
  });

  test("emits version when provided", () => {
    const { manifest } = emitCodexMarketplace({
      packageName: "demo-pkg",
      packageVersion: "9.9.9",
    });
    expect(manifest.plugins[0]!.version).toBe("9.9.9");
  });

  test("custom bundlePath honoured", () => {
    const { manifest } = emitCodexMarketplace({
      packageName: "x",
      bundlePath: "./custom-bundle",
    });
    expect(manifest.plugins[0]!.path).toBe("./custom-bundle");
  });

  test("file content is pretty-printed JSON with trailing newline", () => {
    const { files } = emitCodexMarketplace({ packageName: "x", packageVersion: "1.0.0" });
    const c = files[0]!.content;
    expect(c.endsWith("\n")).toBe(true);
    expect(JSON.parse(c)).toEqual({
      name: "x-marketplace",
      plugins: [{ name: "x", path: "./.codex-plugin", version: "1.0.0" }],
    });
  });

  test("deterministic across calls", () => {
    const a = JSON.stringify(
      emitCodexMarketplace({ packageName: "x", packageVersion: "1.0.0" }),
    );
    const b = JSON.stringify(
      emitCodexMarketplace({ packageName: "x", packageVersion: "1.0.0" }),
    );
    expect(a).toBe(b);
  });
});
