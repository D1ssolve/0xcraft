import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENTS_GUARD_MARKER,
  CAVEMAN_MARKER,
  GIT_WORKTREE_MARKER,
  buildAgentsGuardBootstrap,
  buildBootstrapByHookId,
  buildCavemanBootstrap,
  buildGitWorktreeBootstrap,
  getBootstrapTextForHookId,
} from "./bootstrap-text";

describe("bootstrap-text", () => {
  let tmp: string;
  let bareProject: string;
  let projectWithAgents: string;
  let projectWithTasks: string;
  let projectWithGitFile: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-bootstrap-"));

    bareProject = path.join(tmp, "bare");
    fs.mkdirSync(bareProject, { recursive: true });

    projectWithAgents = path.join(tmp, "with-agents");
    fs.mkdirSync(projectWithAgents, { recursive: true });
    fs.writeFileSync(path.join(projectWithAgents, "AGENTS.md"), "# placeholder\n");

    projectWithTasks = path.join(tmp, "with-tasks");
    fs.mkdirSync(path.join(projectWithTasks, ".tasks"), { recursive: true });

    projectWithGitFile = path.join(tmp, "with-git-file");
    fs.mkdirSync(projectWithGitFile, { recursive: true });
    fs.writeFileSync(path.join(projectWithGitFile, ".git"), "gitdir: /elsewhere\n");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("caveman bootstrap always returns marker and text", () => {
    const payload = buildCavemanBootstrap({ projectRoot: bareProject, platform: "opencode" });
    expect(payload).not.toBeNull();
    expect(payload.marker).toBe(CAVEMAN_MARKER);
    expect(payload.text.startsWith(CAVEMAN_MARKER)).toBe(true);
    expect(payload.text).toContain("caveman");
  });

  test("agents-guard returns payload when AGENTS.md missing", () => {
    const payload = buildAgentsGuardBootstrap({ projectRoot: bareProject, platform: "claude-code" });
    expect(payload).not.toBeNull();
    expect(payload?.marker).toBe(AGENTS_GUARD_MARKER);
    expect(payload?.text).toContain(bareProject);
    expect(payload?.text).toContain("codebase-indexer");
  });

  test("agents-guard returns null when AGENTS.md exists", () => {
    expect(buildAgentsGuardBootstrap({ projectRoot: projectWithAgents, platform: "opencode" })).toBeNull();
  });

  test("git-worktree returns null when no indicator present", () => {
    expect(buildGitWorktreeBootstrap({ projectRoot: bareProject, platform: "opencode" })).toBeNull();
  });

  test("git-worktree fires when .tasks directory exists", () => {
    const payload = buildGitWorktreeBootstrap({ projectRoot: projectWithTasks, platform: "codex" });
    expect(payload).not.toBeNull();
    expect(payload?.marker).toBe(GIT_WORKTREE_MARKER);
  });

  test("git-worktree fires when .git is a file (worktree indicator)", () => {
    const payload = buildGitWorktreeBootstrap({ projectRoot: projectWithGitFile, platform: "opencode" });
    expect(payload).not.toBeNull();
    expect(payload?.text).toContain("git-worktree");
  });

  test("buildBootstrapByHookId dispatches correctly", () => {
    const ctx = { projectRoot: bareProject, platform: "opencode" as const };
    expect(buildBootstrapByHookId("caveman-bootstrap", ctx)?.marker).toBe(CAVEMAN_MARKER);
    expect(buildBootstrapByHookId("agents-guard", ctx)?.marker).toBe(AGENTS_GUARD_MARKER);
    expect(buildBootstrapByHookId("unknown", ctx)).toBeNull();
  });

  test("getBootstrapTextForHookId returns raw text without filesystem gating", () => {
    // Even on a project where AGENTS.md exists, the raw text is returned.
    const agentsText = getBootstrapTextForHookId("agents-guard", {
      projectRoot: projectWithAgents,
      platform: "codex",
    });
    expect(agentsText).not.toBeNull();
    expect(agentsText).toContain(AGENTS_GUARD_MARKER);
    expect(agentsText).toContain("codebase-indexer");

    // Even on a project with no .git/.tasks, the raw text is returned.
    const worktreeText = getBootstrapTextForHookId("git-worktree-bootstrap", {
      projectRoot: bareProject,
      platform: "codex",
    });
    expect(worktreeText).not.toBeNull();
    expect(worktreeText).toContain(GIT_WORKTREE_MARKER);
    expect(worktreeText).toContain("git-worktree");

    const cavemanText = getBootstrapTextForHookId("caveman-bootstrap");
    expect(cavemanText).not.toBeNull();
    expect(cavemanText).toContain(CAVEMAN_MARKER);

    expect(getBootstrapTextForHookId("unknown")).toBeNull();
  });
});
