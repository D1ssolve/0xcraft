import { describe, expect, test } from "bun:test";
import * as entry from "./index";

describe("0xcraft v3 package entry", () => {
  test("no default plugin export", () => {
    expect((entry as { default?: unknown }).default).toBeUndefined();
  });

  test("no createPlugin export", () => {
    expect((entry as Record<string, unknown>).createPlugin).toBeUndefined();
  });
});
