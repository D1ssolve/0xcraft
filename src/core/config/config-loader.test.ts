import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig, parseJsonc, type DiagnosticEvent } from "./config-loader";

describe("parseJsonc", () => {
  test("parses comments and trailing commas", () => {
    const config = parseJsonc(`{
      // comment
      "disabledAgents": ["legacy"],
    }`);

    expect(config).toEqual({ disabledAgents: ["legacy"] });
  });
});

describe("loadConfig", () => {
  test("project config overrides user config", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(tmpHome, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpHome, ".config", "opencode", "0xcraft.json"),
      JSON.stringify({ disabledAgents: ["user-agent"], modelOverrides: { "team-lead": "user/model" } }),
    );
    fs.writeFileSync(
      path.join(projectDir, ".opencode", "0xcraft.json"),
      JSON.stringify({ agentsGuardEnabled: true, modelOverrides: { "team-lead": "project/model" } }),
    );

    const { config } = loadConfig(projectDir, tmpHome);

    expect(config.disabledAgents).toEqual(["user-agent"]);
    expect(config.agentsGuardEnabled).toBe(true);
    expect(config.modelOverrides).toEqual({ "team-lead": "project/model" });
  });

  test("emits parse diagnostic for invalid project config without file contents", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    const secretContent = '{ "disabledAgents": ["keep-secret"], } trailing';
    const configPath = path.join(projectDir, ".opencode", "0xcraft.json");
    fs.writeFileSync(configPath, secretContent);

    const events: DiagnosticEvent[] = [];

    loadConfig(projectDir, tmpHome, {
      diagnosticSink: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      level: "warn",
      code: "config.parse.failed",
      message: `Failed to parse config file "${configPath}"`,
      extra: {
        path: configPath,
        errorMessage: expect.any(String),
      },
    });
    expect(JSON.stringify(events[0])).not.toContain("keep-secret");
  });

  test("redacts quoted parser token excerpts from diagnostics", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    const secretToken = "sk_live_SECRET_123";
    const configPath = path.join(projectDir, ".opencode", "0xcraft.json");
    fs.writeFileSync(configPath, `{ "apiKey": "${secretToken}", "broken": }`);

    const originalParse = JSON.parse;
    const events: DiagnosticEvent[] = [];
    JSON.parse = (() => {
      throw new SyntaxError(`Unexpected token "${secretToken}" at position 13`);
    }) as typeof JSON.parse;

    try {
      loadConfig(projectDir, tmpHome, {
        diagnosticSink: (event) => events.push(event),
      });
    } finally {
      JSON.parse = originalParse;
    }

    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(secretToken);
    expect(events[0]?.extra?.errorMessage).toBe("SyntaxError: Unexpected token \"[redacted]\" at position 13");
  });

  test("keeps console warning fallback when no diagnostic sink is supplied", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    const configPath = path.join(projectDir, ".opencode", "0xcraft.json");
    fs.writeFileSync(configPath, "{ invalid json");

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      loadConfig(projectDir, tmpHome);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`[0xcraft] Failed to parse config file "${configPath}"`);
  });

  test("redacts quoted parser token excerpts from console warning fallback", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    const secretToken = "ghp_SECRET_TOKEN_456";
    const configPath = path.join(projectDir, ".opencode", "0xcraft.json");
    fs.writeFileSync(configPath, `{ "token": "${secretToken}", "broken": }`);

    const originalParse = JSON.parse;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    JSON.parse = (() => {
      throw new SyntaxError(`Unexpected string '${secretToken}' at line 1 column 12`);
    }) as typeof JSON.parse;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      loadConfig(projectDir, tmpHome);
    } finally {
      JSON.parse = originalParse;
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain(secretToken);
    expect(warnings[0]).toContain("SyntaxError: Unexpected string '[redacted]' at line 1 column 12");
  });

  test("keeps valid user config when project config is invalid", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-home-"));
    const projectDir = path.join(tmpHome, "project");
    fs.mkdirSync(path.join(tmpHome, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpHome, ".config", "opencode", "0xcraft.json"),
      JSON.stringify({ disabledAgents: ["user-agent"], agentsGuardEnabled: true }),
    );
    fs.writeFileSync(path.join(projectDir, ".opencode", "0xcraft.json"), "{ invalid json");

    const { config } = loadConfig(projectDir, tmpHome, {
      diagnosticSink: () => undefined,
    });

    expect(config.disabledAgents).toEqual(["user-agent"]);
    expect(config.agentsGuardEnabled).toBe(true);
  });
});
