import { describe, expect, test } from "bun:test";

import { DiagnosticCollector } from "./diagnostic-collector";

describe("DiagnosticCollector", () => {
  test("collects info/warn/error", () => {
    const c = new DiagnosticCollector();
    c.info("i.code", "info msg");
    c.warn("w.code", "warn msg");
    c.error("e.code", "err msg");
    expect(c.getAll().length).toBe(3);
    expect(c.hasErrors()).toBe(true);
  });

  test("hasErrors is false when only info/warn", () => {
    const c = new DiagnosticCollector();
    c.info("a", "a");
    c.warn("b", "b");
    expect(c.hasErrors()).toBe(false);
  });

  test("sorted() orders by severity (error < warn < info), then code, then message", () => {
    const c = new DiagnosticCollector();
    c.info("a", "z");
    c.warn("b", "m");
    c.error("c", "x");
    c.warn("a", "n");
    const out = c.sorted();
    expect(out.map((d) => `${d.severity}:${d.code}:${d.message}`)).toEqual([
      "error:c:x",
      "warn:a:n",
      "warn:b:m",
      "info:a:z",
    ]);
  });

  test("sorted() is stable for identical tuples", () => {
    const c = new DiagnosticCollector();
    c.warn("x", "same", { i: 1 });
    c.warn("x", "same", { i: 2 });
    const out = c.sorted();
    expect(out[0]?.details).toEqual({ i: 1 });
    expect(out[1]?.details).toEqual({ i: 2 });
  });

  test("sanitizes details on build()", () => {
    const c = new DiagnosticCollector();
    c.warn("w", "msg", { token: "leak", ok: 1 });
    expect(c.getAll()[0]?.details).toEqual({ token: "[REDACTED]", ok: 1 });
  });

  test("add() sanitizes external diagnostic details", () => {
    const c = new DiagnosticCollector();
    c.add({
      severity: "error",
      code: "e",
      message: "boom",
      details: { password: "p", value: 42 },
    });
    expect(c.getAll()[0]?.details).toEqual({ password: "[REDACTED]", value: 42 });
  });

  test("add() preserves diagnostic when no details", () => {
    const c = new DiagnosticCollector();
    c.add({ severity: "info", code: "i", message: "m" });
    const got = c.getAll()[0];
    expect(got).toEqual({ severity: "info", code: "i", message: "m" });
    expect(got?.details).toBeUndefined();
  });

  test("getAll() returns copies — caller mutations do not leak", () => {
    const c = new DiagnosticCollector();
    c.warn("w", "msg");
    const snap = c.getAll();
    snap[0]!.message = "mutated";
    expect(c.getAll()[0]?.message).toBe("msg");
  });
});
