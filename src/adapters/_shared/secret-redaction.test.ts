import { describe, expect, test } from "bun:test";

import { sanitizeDetails } from "./secret-redaction";

describe("sanitizeDetails", () => {
  test("redacts configured secret keys at top level", () => {
    expect(
      sanitizeDetails({
        token: "token-value",
        secret: "secret-value",
        key: "key-value",
        authorization: "authorization-value",
        bearer: "bearer-value",
        password: "password-value",
        env: { USER: "alice" },
        headers: { Accept: "application/json" },
      }),
    ).toEqual({
      token: "[REDACTED]",
      secret: "[REDACTED]",
      key: "[REDACTED]",
      authorization: "[REDACTED]",
      bearer: "[REDACTED]",
      password: "[REDACTED]",
      env: "[REDACTED]",
      headers: "[REDACTED]",
    });
  });

  test("redacts nested objects recursively", () => {
    expect(
      sanitizeDetails({
        outer: {
          token: "nested-token",
          safe: "kept",
          deeper: {
            headers: { Authorization: "Bearer abc" },
          },
        },
        list: [{ password: "nested-password", name: "service" }],
      }),
    ).toEqual({
      outer: {
        token: "[REDACTED]",
        safe: "kept",
        deeper: {
          headers: "[REDACTED]",
        },
      },
      list: [{ password: "[REDACTED]", name: "service" }],
    });
  });

  test("redacts case-insensitive key matches", () => {
    expect(
      sanitizeDetails({
        Token: "a",
        TOKEN: "b",
        token: "c",
      }),
    ).toEqual({
      Token: "[REDACTED]",
      TOKEN: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  test("passes through non-secret keys unchanged", () => {
    expect(
      sanitizeDetails({
        count: 3,
        enabled: true,
        name: "diagnostic",
        nested: { user: "alice" },
      }),
    ).toEqual({
      count: 3,
      enabled: true,
      name: "diagnostic",
      nested: { user: "alice" },
    });
  });
});
