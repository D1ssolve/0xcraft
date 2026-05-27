import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig, parseJsonc } from "./config-loader";

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
});
