import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { AgentSpec } from "../../../core/agents";
import {
  mapAgentToOpencode,
  readMarkdownAgent,
  resolveExternalDirectory,
  resolvePromptTokens,
} from "./agents";

const baseAgent: AgentSpec = {
  id: "review-helper",
  name: "Review Helper",
  description: "Reviews focused diffs",
  mode: "subagent",
  model: "github-copilot/gpt-5.5",
  temperature: 0.2,
  color: "warning",
  promptFile: "agents/review-helper.md",
};

describe("OpenCode agent mapper", () => {
  test("nominal mapping yields all OpenCode agent fields", () => {
    const mapped = mapAgentToOpencode({
      agent: baseAgent,
      prompt: "# Prompt",
      permission: { edit: "deny" },
    });

    expect(mapped).toEqual({
      description: "Reviews focused diffs",
      mode: "subagent",
      model: "github-copilot/gpt-5.5",
      temperature: 0.2,
      color: "warning",
      permission: { edit: "deny" },
      prompt: "# Prompt",
    });
  });

  test("missing optional fields are absent instead of set to undefined", () => {
    const { temperature: _temperature, ...agent } = baseAgent;
    const mapped = mapAgentToOpencode({
      agent,
      prompt: "# Prompt",
      permission: {},
    });

    expect(Object.hasOwn(mapped, "temperature")).toBe(false);
    expect(Object.hasOwn(mapped, "model")).toBe(true);
    expect(Object.hasOwn(mapped, "color")).toBe(true);
  });

  test("model override injected by caller takes precedence", () => {
    const mapped = mapAgentToOpencode({
      agent: baseAgent,
      prompt: "# Prompt",
      modelOverride: "openai/gpt-5",
      permission: {},
    });

    expect(mapped.model).toBe("openai/gpt-5");
  });

  test("markdown agent file parsing returns OpenCode-shaped entry", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-agent-mapper-"));
    const agentPath = path.join(tmpDir, "review-helper.md");
    fs.writeFileSync(
      agentPath,
      `---\ndescription: Reviews focused diffs\nmode: subagent\nmodel: github-copilot/gpt-5.5\ntemperature: 0.1\ncolor: info\npermission:\n  edit: deny\n---\n\n# Review Helper\n`,
    );

    expect(readMarkdownAgent(agentPath)).toEqual({
      description: "Reviews focused diffs",
      mode: "subagent",
      model: "github-copilot/gpt-5.5",
      temperature: 0.1,
      color: "info",
      permission: { edit: "deny" },
      prompt: "# Review Helper\n",
    });
  });

  test("SPEC_TEMPLATE_TOKEN substitution resolves relative to package root", () => {
    expect(resolvePromptTokens("Use {{SPEC_TEMPLATE_PATH}} now", "/repo/pkg")).toBe(
      "Use /repo/pkg/templates/spec-template.md now",
    );
  });

  test("external_directory relative paths resolve while absolute and home paths pass through", () => {
    expect(
      resolveExternalDirectory(
        {
          external_directory: {
            "templates/*": "allow",
            "/var/tmp": "deny",
            "~/notes": "allow",
          },
        },
        "/repo/pkg",
      ),
    ).toEqual({
      external_directory: {
        "/repo/pkg/templates/*": "allow",
        "/var/tmp": "deny",
        "~/notes": "allow",
      },
    });
  });
});
