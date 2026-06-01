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
      const agent = agents[0]!;
      expect(agent.id).toBe("explorer");
      expect(agent.common.name).toBe("explorer");
      expect(agent.common.prompt).toBe("You explore codebases.");
      expect(agent.common.model).toBe("o3");
      expect(agent.provenance?.importedFrom).toBe("codex");
    } finally {
      cleanup(dir);
    }
  });

  it("loads agent references from adjacent references directory", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      const referencesDir = join(agentsDir, "explorer", "references");
      mkdirSync(referencesDir, { recursive: true });
      writeFileSync(join(agentsDir, "explorer.toml"), [
        'name = "explorer"',
        'description = "Code exploration agent"',
        'developer_instructions = "You explore codebases."',
      ].join("\n"));
      writeFileSync(join(referencesDir, "guide.md"), "# Guide\nUse this guide.");
      writeFileSync(join(referencesDir, "template_1.txt"), "Template body");
      writeFileSync(join(referencesDir, "Bad File.md"), "skip me");

      const result = importCodex(dir);
      const agent = result.ir.find((r) => r.kind === "agent" && r.id === "explorer");

      expect(agent?.references).toEqual({
        "guide.md": "# Guide\nUse this guide.",
        "template_1.txt": "Template body",
      });
    } finally {
      cleanup(dir);
    }
  });

  it("omits references when agent references directory is absent", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "reviewer.toml"), [
        'name = "reviewer"',
        'description = "Review agent"',
        'developer_instructions = "Review prompt."',
      ].join("\n"));

      const result = importCodex(dir);
      const agent = result.ir.find((r) => r.kind === "agent" && r.id === "reviewer");

      expect(agent?.references).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });

  it("does not create SkillIR from codex references-only directories", () => {
    const dir = createTempDir();
    try {
      const skillReferencesDir = join(dir, ".codex", "skills", "research", "references");
      mkdirSync(skillReferencesDir, { recursive: true });
      writeFileSync(join(skillReferencesDir, "guide.md"), "# Guide");

      const result = importCodex(dir);

      expect(result.ir.some((r) => r.kind === "skill")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it("imports supported approval_policy unchanged", () => {
    const dir = createTempDir();
    try {
      const agentsDir = join(dir, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "reviewer.toml"), [
        'name = "reviewer"',
        'description = "Review agent"',
        'developer_instructions = "Review prompt."',
        'approval_policy = "on-request"',
      ].join("\n"));

      const result = importCodex(dir);
      const agent = result.ir.find((r) => r.kind === "agent" && r.id === "reviewer");
      const codex = (agent?.platform as Record<string, Record<string, unknown>>)?.codex;
      expect(codex?.approval_policy).toBe("on-request");
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
        hooks: {
          PostToolUse: [
            {
              hooks: [{ type: "prompt", prompt: "Summarize the result" }],
            },
          ],
        },
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
      expect(mcps[0]!.mcpEnvelope.sourceShape).toBe("direct");
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
      expect(mcps[0]!.mcpEnvelope.sourceShape).toBe("wrapped");
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
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "npm run lint" }],
            },
          ],
        },
      }));

      const result = importCodex(dir);
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBe(1);
      const hook = hooks[0]!;
      expect(hook.id).toBe("PreToolUse-1");
      expect(hook.common.actions[0]!.type).toBe("run_command");
      expect((hook.common.actions[0] as { command: string }).command).toBe("npm run lint");
    } finally {
      cleanup(dir);
    }
  });

  it("imports event-keyed hooks from config.toml", () => {
    const dir = createTempDir();
    try {
      const codexDir = join(dir, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "config.toml"), [
        "[features]",
        "hooks = true",
        "",
        "[[hooks.PreToolUse]]",
        'matcher = "Bash"',
        "",
        "[[hooks.PreToolUse.hooks]]",
        'type = "command"',
        'command = "echo config"',
        "timeout = 3",
      ].join("\n"));

      const result = importCodex(dir);
      const hooks = result.ir.filter((r) => r.kind === "hook");
      expect(hooks.length).toBe(1);
      const hook = hooks[0];
      expect(hook?.id).toBe("PreToolUse-1");
      expect(hook?.common.actions[0]?.type).toBe("run_command");
      expect((hook?.common.actions[0] as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(3000);
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
