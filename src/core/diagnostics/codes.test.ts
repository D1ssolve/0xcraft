import { describe, expect, test } from "bun:test";

import {
  DIAGNOSTIC_CODES,
  ERROR_DIAGNOSTIC_CODES,
  INFO_DIAGNOSTIC_CODES,
  PLATFORM_DIAGNOSTIC_CODES,
  WARN_DIAGNOSTIC_CODES,
  type DiagnosticCode,
} from "./codes";

const screamingSnakeCodePattern = /^(ERR|WARN|INFO)_[A-Z0-9_]+$/;
const platformCodePattern = /^[a-z][A-Za-z0-9._-]+$/;

describe("diagnostic code registry", () => {
  test("all codes are unique strings", () => {
    const uniqueCodes = new Set(DIAGNOSTIC_CODES);

    expect(uniqueCodes.size).toBe(DIAGNOSTIC_CODES.length);
    for (const code of DIAGNOSTIC_CODES) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  test("every code follows screaming-snake or platform lowercase naming", () => {
    for (const code of DIAGNOSTIC_CODES) {
      expect(
        screamingSnakeCodePattern.test(code) || platformCodePattern.test(code),
      ).toBe(true);
    }
  });

  test("union type is derivable from constants array", () => {
    const errorCode: DiagnosticCode = ERROR_DIAGNOSTIC_CODES[0];
    const warnCode: DiagnosticCode = WARN_DIAGNOSTIC_CODES[0];
    const infoCode: DiagnosticCode = INFO_DIAGNOSTIC_CODES[0];
    const platformCode: DiagnosticCode = PLATFORM_DIAGNOSTIC_CODES[0];

    expect(DIAGNOSTIC_CODES).toContain(errorCode);
    expect(DIAGNOSTIC_CODES).toContain(warnCode);
    expect(DIAGNOSTIC_CODES).toContain(infoCode);
    expect(DIAGNOSTIC_CODES).toContain(platformCode);
  });
});
