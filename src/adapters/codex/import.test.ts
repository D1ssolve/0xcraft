import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { importCodex } from "./import";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "codex-import-"));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("importCodex", () => {
  it("imports agents from .codex/agents/*.toml", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "explorer.toml"), [
        'name = "explorer"',
        'description = "Code exploration agent"',
        'developer_instructions = "You explore codebases."',
        'model = "o3"',
        'model_reasoning_effort = "high"',
      ].join("\n"));

      const result = importCodex(dir);
      const agents = result.ir.filter((r) => r.kind === "agent");
      expect(agents.length).toBe(1);
      const agent = agents[0];
      expect(agent.id).toBe("explorer");
      expect(agent.common.name).toBe("explorer");
      expect(agent.common.prompt).toBe("You explore codebases.");
      expect(agent.common.model).toBe("o3");
      expect(agent.provenance?.importedFrom).toBe("codex");
    } finally {
      cleanup(dir);
    }
  });

  it("emits deprecation diagnostic for approval_policy = on-failure and rewrites to on-request", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "legacy.toml"), [
        'name = "legacy"',
        'description = "Legacy agent"',
        'developer_instructions = "Legacy prompt."',
        'approval_policy = "on-failure"',
      ].join("\n"));

      const result = importCodex(dir);
      const deprecatedDiag = result.diagnostics.find(
        (d) => d.code === "codex.approval_policy.on-failure.deprecated",
      );
      expect(deprecatedDiag).toBeDefined();

      const agent = result.ir.find((r) => r.kind === "agent" && r.id === "legacy");
      const codex = (agent?.platform as Record<string, Record<string, unknown>>)?.codex;
      expect(codex?.approval_policy).toBe("on-request");
    } finally {
      cleanup(dir);
    }
  });

  it("rewrites on-failure to never when nonInteractive is true", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "ci-agent.toml"), [
        'name = "ci-agent"',
        'description = "CI agent"',
        'developer_instructions = "CI prompt."',
        'approval_policy = "on-failure"',
      ].join("\n"));

      const result = importCodex(dir, { nonInteractive: true });
      const agent = result.ir.find((r) => r.kind === "agent" && r.id === "ci-agent");
      const codex = (agent?.platform as Record<string, Record<string, unknown>>)?.codex;
      expect(codex?.approval_policy).toBe("never");
    } finally {
      cleanup(dir);
    }
  });

  it("emits deprecated diagnostic for codex_hooks alias", () => {
    const dir = createTempDir();
    try {
      const codexDir = join(dir, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "hooks.json"), JSON.stringify({
        codex_hooks: [
          {
            id: "test-hook",
            events: ["PreToolUse"],
            handlers: [{ type: "command", command: "echo test" }],
          },
        ],
      }));

      const result = importCodex(dir);
      const deprecatedDiag = result.diagnostics.find(
        (d) => d.code === "codex.hooks.codex_hooks.deprecated",
      );
      expect(deprecatedDiag).toBeDefined();

      // Hook should still be imported
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBe(1);
    } finally {
      cleanup(dir);
    }
  });

  it("emits prompt-skipped diagnostic for prompt handler", () => {
    const dir = createTempDir();
    try {
      const codexDir = join(dir, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            id: "prompt-hook",
            events: ["PostToolUse"],
            handlers: [{ type: "prompt", prompt: "Summarize the result" }],
          },
        ],
      }));

      const result = importCodex(dir);
      const skippedDiag = result.diagnostics.find(
        (d) => d.code === "codex.hooks.handler.prompt.skipped",
      );
      expect(skippedDiag).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  it("sets mcpEnvelope.sourceShape to direct for direct-map .mcp.json", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify({
        "my-server": {
          command: "my-mcp",
          args: ["--stdio"],
        },
      }));

      const result = importCodex(dir);
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      expect(mcps[0].mcpEnvelope.sourceShape).toBe("direct");
    } finally {
      cleanup(dir);
    }
  });

  it("sets mcpEnvelope.sourceShape to wrapped for wrapped .mcp.json", () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify({
        mcp_servers: {
          "my-server": {
            command: "my-mcp",
            args: ["--stdio"],
          },
        },
      }));

      const result = importCodex(dir);
      const mcps = result.ir.filter((r) => r.kind === "mcp");
      expect(mcps.length).toBe(1);
      expect(mcps[0].mcpEnvelope.sourceShape).toBe("wrapped");
    } finally {
      cleanup(dir);
    }
  });

  it("maps developer_instructions to common.prompt", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "doc-writer.toml"), [
        'name = "doc-writer"',
        'description = "Documentation writer"',
        'developer_instructions = "Write clear documentation."',
      ].join("\n"));

      const result = importCodex(dir);
      const agent = result.ir.find((r) => r.kind === "agent");
      expect(agent?.common.prompt).toBe("Write clear documentation.");
    } finally {
      cleanup(dir);
    }
  });

  it("imports command handlers from hooks.json", () => {
    const dir = createTempDir();
    try {
      const codexDir = join(dir, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            id: "lint-hook",
            events: ["PreToolUse", "PostToolUse"],
            matcher: "Bash",
            handlers: [{ type: "command", command: "npm run lint" }],
          },
        ],
      }));

      const result = importCodex(dir);
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBe(1);
      const hook = hooks[0];
      expect(hook.id).toBe("lint-hook");
      expect(hook.common.actions[0].type).toBe("run_command");
      expect((hook.common.actions[0] as { command: string }).command).toBe("npm run lint");
    } finally {
      cleanup(dir);
    }
  });

  it("handles empty project directory gracefully", () => {
    const dir = createTempDir();
    try {
      const result = importCodex(dir);
      expect(result.ir.length).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});
