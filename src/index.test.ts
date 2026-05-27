import { describe, expect, test } from "bun:test";
import plugin from "./index";
import { builtinAgents } from "./core";

describe("0xcraft package entry", () => {
  test("default export is an OpenCode plugin function", () => {
    expect(typeof plugin).toBe("function");
  });

  test("core exports remain available from separate entry", () => {
    expect(builtinAgents.length).toBeGreaterThan(0);
  });
});
