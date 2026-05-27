import { describe, expect, test } from "bun:test";
import plugin from "./index";
import { createPlugin } from "./adapters/opencode/index";
import { builtinAgents } from "./core";

describe("0xcraft package entry", () => {
  test("default export is an OpenCode plugin function", () => {
    expect(typeof plugin).toBe("function");
  });

  test("default export points to the OpenCode adapter plugin", () => {
    expect(plugin).toBe(createPlugin);
  });

  test("core exports remain available from separate entry", () => {
    expect(builtinAgents.length).toBeGreaterThan(0);
  });
});
