import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig, mergeConfig, type ZeroxCraftConfig } from "../../core/config";
import { builtinHooks, getHookById } from "../../core/hooks";
import {
  AGENTS_GUARD_MARKER,
  CAVEMAN_MARKER,
  GIT_WORKTREE_MARKER,
} from "../_shared/bootstrap-text";
import { emitClaudeCodeHookScript } from "./hook-script-emitter";

function hook(id: string) {
  const h = getHookById(id);
  if (!h) throw new Error(`missing builtin hook ${id}`);
  return h;
}

const cavemanHook = hook("caveman-bootstrap");
const agentsGuardHook = hook("agents-guard");
const gitWorktreeHook = hook("git-worktree-bootstrap");

async function runScript(
  scriptPath: string,
  cwd: string,
  stdinText = "",
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", scriptPath], {
    cwd,
    stdin: stdinText.length > 0 ? new TextEncoder().encode(stdinText) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function writeScript(dir: string, filename: string, content: string): string {
  const full = path.join(dir, filename);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, { mode: 0o755 });
  return full;
}

describe("emitClaudeCodeHookScript — content shape", () => {
  const projectRoot = "/projects/example";
  const config: ZeroxCraftConfig = defaultConfig;

  test("caveman-bootstrap → SessionStart + bun shebang + marker + non-empty text", () => {
    const res = emitClaudeCodeHookScript({ hook: cavemanHook, projectRoot, config });
    expect(res).not.toBeNull();
    expect(res!.filename).toBe("hooks/caveman-bootstrap.mjs");
    expect(res!.hookEventName).toBe("SessionStart");
    expect(res!.content.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(res!.content).toContain(`const MARKER = "${CAVEMAN_MARKER}"`);
    expect(res!.content).toContain(`const HOOK_EVENT = "SessionStart"`);
    expect(res!.content).toContain(`const HOOK_ID = "caveman-bootstrap"`);
    expect(res!.content).toMatch(/const TEXT = ".+";/);
    expect(res!.diagnostics).toEqual([]);
  });

  test("agents-guard → UserPromptSubmit", () => {
    const res = emitClaudeCodeHookScript({ hook: agentsGuardHook, projectRoot, config });
    expect(res).not.toBeNull();
    expect(res!.filename).toBe("hooks/agents-guard.mjs");
    expect(res!.hookEventName).toBe("UserPromptSubmit");
    expect(res!.content).toContain(`const MARKER = "${AGENTS_GUARD_MARKER}"`);
    expect(res!.content).toContain(`const HOOK_EVENT = "UserPromptSubmit"`);
  });

  test("git-worktree-bootstrap → SessionStart", () => {
    const res = emitClaudeCodeHookScript({ hook: gitWorktreeHook, projectRoot, config });
    expect(res).not.toBeNull();
    expect(res!.filename).toBe("hooks/git-worktree-bootstrap.mjs");
    expect(res!.hookEventName).toBe("SessionStart");
    expect(res!.content).toContain(`const MARKER = "${GIT_WORKTREE_MARKER}"`);
  });

  test("runtime = node → node shebang", () => {
    const res = emitClaudeCodeHookScript({
      hook: cavemanHook,
      projectRoot,
      config,
      runtime: "node",
    });
    expect(res!.content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  test("config.platforms['claude-code'].hookRuntime = node honored when no explicit runtime", () => {
    const nodeConfig = mergeConfig({ platforms: { "claude-code": { hookRuntime: "node" } } });
    const res = emitClaudeCodeHookScript({ hook: cavemanHook, projectRoot, config: nodeConfig });
    expect(res!.content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  test("disabled hook → null", () => {
    const disabled = mergeConfig({ disabled: { agents: [], skills: [], hooks: ["caveman-bootstrap"], commands: [], mcp: [] } });
    expect(
      emitClaudeCodeHookScript({ hook: cavemanHook, projectRoot, config: disabled }),
    ).toBeNull();
  });

  test("covers all three builtin bootstrap hooks", () => {
    const bootstrapIds = ["caveman-bootstrap", "agents-guard", "git-worktree-bootstrap"];
    for (const id of bootstrapIds) {
      const h = builtinHooks.find((x) => x.id === id);
      expect(h).toBeDefined();
      const res = emitClaudeCodeHookScript({ hook: h!, projectRoot, config });
      expect(res).not.toBeNull();
    }
  });
});

describe("emitClaudeCodeHookScript — runtime behavior via Bun.spawn", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-cc-hook-"));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("caveman script prints valid JSON with SessionStart + marker in additionalContext", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "caveman-"));
    const res = emitClaudeCodeHookScript({
      hook: cavemanHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "caveman.mjs", res!.content);

    const { stdout, exitCode } = await runScript(scriptPath, sandbox);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(CAVEMAN_MARKER);
  });

  test("caveman script guard fires when stdin contains marker", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "caveman-guard-"));
    const res = emitClaudeCodeHookScript({
      hook: cavemanHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "caveman-guard.mjs", res!.content);

    const stdinPayload = `irrelevant junk ${CAVEMAN_MARKER} more junk`;
    const { stdout, exitCode } = await runScript(scriptPath, sandbox, stdinPayload);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("");
  });

  test("agents-guard injects when AGENTS.md missing", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "agents-missing-"));
    const res = emitClaudeCodeHookScript({
      hook: agentsGuardHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "agents-missing.mjs", res!.content);

    const { stdout, exitCode } = await runScript(scriptPath, sandbox);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(AGENTS_GUARD_MARKER);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("codebase-indexer");
  });

  test("agents-guard suppresses when AGENTS.md present", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "agents-present-"));
    fs.writeFileSync(path.join(sandbox, "AGENTS.md"), "# stub\n");
    const res = emitClaudeCodeHookScript({
      hook: agentsGuardHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "agents-present.mjs", res!.content);

    const { stdout, exitCode } = await runScript(scriptPath, sandbox);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("");
  });

  test("git-worktree-bootstrap injects when .tasks directory exists", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "worktree-tasks-"));
    fs.mkdirSync(path.join(sandbox, ".tasks"), { recursive: true });
    const res = emitClaudeCodeHookScript({
      hook: gitWorktreeHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "worktree-tasks.mjs", res!.content);

    const { stdout, exitCode } = await runScript(scriptPath, sandbox);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(GIT_WORKTREE_MARKER);
  });

  test("git-worktree-bootstrap injects when .git is a file (worktree pointer)", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "worktree-gitfile-"));
    fs.writeFileSync(path.join(sandbox, ".git"), "gitdir: /elsewhere\n");
    const res = emitClaudeCodeHookScript({
      hook: gitWorktreeHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "worktree-gitfile.mjs", res!.content);

    const { stdout } = await runScript(scriptPath, sandbox);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(GIT_WORKTREE_MARKER);
  });

  test("git-worktree-bootstrap suppresses in clean tmpdir", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "worktree-clean-"));
    const res = emitClaudeCodeHookScript({
      hook: gitWorktreeHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "worktree-clean.mjs", res!.content);

    const { stdout } = await runScript(scriptPath, sandbox);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("");
  });

  test("uses CLAUDE_PROJECT_DIR env var to locate project root", async () => {
    const sandbox = fs.mkdtempSync(path.join(tmp, "cc-env-"));
    const wrongCwd = fs.mkdtempSync(path.join(tmp, "cc-env-wrong-"));
    fs.writeFileSync(path.join(sandbox, "AGENTS.md"), "# stub\n");
    const res = emitClaudeCodeHookScript({
      hook: agentsGuardHook,
      projectRoot: sandbox,
      config: defaultConfig,
    });
    const scriptPath = writeScript(tmp, "cc-env.mjs", res!.content);

    // Run from a different cwd but point CLAUDE_PROJECT_DIR at the sandbox
    // that contains AGENTS.md → script must suppress.
    const { stdout } = await runScript(scriptPath, wrongCwd, "", {
      CLAUDE_PROJECT_DIR: sandbox,
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toBe("");
  });
});
