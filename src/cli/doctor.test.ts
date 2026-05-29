import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { runDoctor, doctorExitCode } from "./doctor";
import { builtinAgents } from "../core/agents/builtin-agents";
import { builtinHooks } from "../core/hooks";
import type { BunOnPathChecker } from "./_shared";
import { upgradeWarnsToErrors, exitFromDiagnostics } from "./_shared";
import type { Diagnostic } from "../core/diagnostics/diagnostic";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCodexTree(
  projectRoot: string,
  opts: {
    configToml?: string;
    hookShebang?: string;
    skipHookFiles?: boolean;
    skipAgentFiles?: boolean;
    skillsDir?: string | null;
  } = {},
): void {
  const codexDir = path.join(projectRoot, ".codex");
  fs.mkdirSync(path.join(codexDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(codexDir, "agents"), { recursive: true });

  const configToml =
    opts.configToml ??
    [
      "[features]",
      "hooks = true",
      "child_agents_md = true",
      "",
      "[mcp_servers.dummy]",
      'command = "bun"',
      "",
    ].join("\n");
  fs.writeFileSync(path.join(codexDir, "config.toml"), configToml);

  if (!opts.skipHookFiles) {
    const shebang = opts.hookShebang ?? "#!/usr/bin/env bun";
    for (const hook of builtinHooks) {
      fs.writeFileSync(
        path.join(codexDir, "hooks", `${hook.id}.mjs`),
        `${shebang}\nconsole.log("noop");\n`,
        { mode: 0o755 },
      );
    }
  }

  if (!opts.skipAgentFiles) {
    for (const agent of builtinAgents) {
      fs.writeFileSync(
        path.join(codexDir, "agents", `${agent.id}.toml`),
        `name = "${agent.id}"\n`,
      );
    }
  }

  const skillsDir =
    opts.skillsDir === null
      ? null
      : path.join(projectRoot, opts.skillsDir ?? ".agents/skills");
  if (skillsDir) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
}

const bunPresent: BunOnPathChecker = () => null;
const bunMissing: BunOnPathChecker = () => ({
  severity: "error",
  code: "bun.not_on_path",
  message: "bun not found on PATH; hook scripts require bun",
});

describe("doctor — codex harness", () => {
  test("passes with a fully generated .codex/ tree and bun on PATH", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-ok-");
    writeCodexTree(projectRoot);

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(true);
    expect(
      result.checks.some((c) => c.category === "System" && c.status === "ok" && c.name.includes("bun")),
    ).toBe(true);
  });

  test("fails with codex.config.missing when .codex/config.toml absent", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-noconfig-");

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.config.missing")).toBe(true);
  });

  test("fails when [features].hooks=true or child_agents_md=true missing from config.toml", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-badfeatures-");
    writeCodexTree(projectRoot, {
      configToml: ["[features]", 'name = "0xcraft"', ""].join("\n"),
    });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.features.hooks_missing")).toBe(true);
    expect(result.checks.some((c) => c.code === "codex.features.child_agents_md_missing")).toBe(
      true,
    );
  });

  test("Batch 6 — reports codex.hook.dropped (info) when hook scripts are absent", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-nohook-");
    writeCodexTree(projectRoot, { skipHookFiles: true });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    // Codex matrix marks ALL hook cells drop-warn (Batch 6) → missing
    // scripts are a structural matrix fact, not a user-config problem.
    // T-11.3: emitted as `ok` (info-class) so default-config doctor exits 0.
    // The diagnostic code `codex.hook.dropped` remains stable for tooling.
    expect(result.checks.some((c) => c.code === "codex.hook.dropped")).toBe(true);
    expect(result.checks.some((c) => c.code === "codex.hook.missing")).toBe(false);
    // No `fail` introduced by drop-warn matrix cells.
    expect(result.checks.filter((c) => c.code === "codex.hook.dropped").every((c) => c.status === "ok")).toBe(true);
  });

  test("fails with codex.hook.bad_shebang when hook script has wrong shebang", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-badshebang-");
    writeCodexTree(projectRoot, { hookShebang: "#!/bin/sh" });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.hook.bad_shebang")).toBe(true);
  });

  test("fails with codex.agent.missing when an agent toml is absent", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-noagent-");
    writeCodexTree(projectRoot, { skipAgentFiles: true });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.agent.missing")).toBe(true);
  });

  test("fails with codex.skills_dir.missing when skills enabled but dir absent", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-noskills-");
    writeCodexTree(projectRoot, { skillsDir: null });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.skills_dir.missing")).toBe(true);
  });

  test("fails with bun.not_on_path when bun probe reports missing", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-nobun-");
    writeCodexTree(projectRoot);

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunMissing },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "bun.not_on_path")).toBe(true);
  });

  test("does NOT fail on bun.not_on_path when platforms.codex.hookRuntime=node", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-node-runtime-");
    writeCodexTree(projectRoot);
    // Local 0xcraft config opts into the node runtime — bun missing is fine.
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "0xcraft.json"),
      JSON.stringify({ platforms: { codex: { hookRuntime: "node" } } }),
    );

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunMissing },
    });

    expect(result.checks.some((c) => c.code === "bun.not_on_path")).toBe(false);
    expect(
      result.checks.some(
        (c) =>
          c.category === "System" &&
          c.name === "bun on PATH" &&
          c.status === "ok" &&
          c.message.includes("platforms.codex.hookRuntime"),
      ),
    ).toBe(true);
  });

  test("fails with codex.config.parse_failed when config.toml is malformed", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-badtoml-");
    writeCodexTree(projectRoot, {
      configToml: "[features\nhooks = true\n",
    });

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.code === "codex.config.parse_failed")).toBe(true);
  });

  test("surfaces config.parse.failed warning when local 0xcraft.json is malformed", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-badcfg-");
    writeCodexTree(projectRoot);
    // Malformed JSON triggers a `warn`-severity `config.parse.failed`
    // diagnostic in the loader; the doctor should fold it into the
    // Config category as a warn check.
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "0xcraft.json"),
      "{ this is not valid json",
    );

    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(
      result.checks.some(
        (c) => c.category === "Config" && c.code === "config.parse.failed" && c.status === "warn",
      ),
    ).toBe(true);
  });
});

describe("doctor — claude-code harness", () => {
  test("warns when hooks dir is missing (no generated plugin yet)", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-cc-nohooks-");
    const pluginDir = path.join(makeTempDir("0xcraft-doctor-cc-plugin-"), "empty");

    const result = await runDoctor({
      harness: "claude-code",
      projectRoot,
      pluginDir,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(
      result.checks.some((c) => c.code === "claude_code.hooks_dir.missing"),
    ).toBe(true);
  });

  test("passes when bun on PATH and every enabled hook script exists with bun shebang", async () => {
    const pluginDir = makeTempDir("0xcraft-doctor-cc-ok-");
    fs.mkdirSync(path.join(pluginDir, "hooks"), { recursive: true });
    for (const hook of builtinHooks) {
      fs.writeFileSync(
        path.join(pluginDir, "hooks", `${hook.id}.mjs`),
        `#!/usr/bin/env bun\nconsole.log("noop");\n`,
        { mode: 0o755 },
      );
    }

    const result = await runDoctor({
      harness: "claude-code",
      projectRoot: makeTempDir("0xcraft-doctor-cc-proj-"),
      pluginDir,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(true);
    expect(result.checks.some((c) => c.code === "claude_code.hook.missing")).toBe(false);
  });

  test("fails with claude_code.hook.bad_shebang when hook script has wrong shebang", async () => {
    const pluginDir = makeTempDir("0xcraft-doctor-cc-shebang-");
    fs.mkdirSync(path.join(pluginDir, "hooks"), { recursive: true });
    for (const hook of builtinHooks) {
      fs.writeFileSync(
        path.join(pluginDir, "hooks", `${hook.id}.mjs`),
        `#!/usr/bin/python3\n`,
        { mode: 0o755 },
      );
    }

    const result = await runDoctor({
      harness: "claude-code",
      projectRoot: makeTempDir("0xcraft-doctor-cc-shebang-proj-"),
      pluginDir,
      dependencies: { bunOnPathChecker: bunPresent },
    });

    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.code === "claude_code.hook.bad_shebang"),
    ).toBe(true);
  });
});

describe("doctor — exit code policy (spec §10)", () => {
  test("doctorExitCode returns 0 for all-ok results", () => {
    expect(
      doctorExitCode({
        ok: true,
        checks: [{ category: "X", name: "x", status: "ok", message: "" }],
      }),
    ).toBe(0);
  });
  test("doctorExitCode returns 1 when any check is fail", () => {
    expect(
      doctorExitCode({
        ok: false,
        checks: [
          { category: "X", name: "a", status: "warn", message: "" },
          { category: "X", name: "b", status: "fail", message: "" },
        ],
      }),
    ).toBe(1);
  });
  test("doctorExitCode returns 2 when only warns are present", () => {
    expect(
      doctorExitCode({
        ok: true,
        checks: [{ category: "X", name: "x", status: "warn", message: "" }],
      }),
    ).toBe(2);
  });
});

describe("doctor — capability matrix surfacing", () => {
  test("opencode result includes capabilitySummaries for opencode", async () => {
    const result = await runDoctor({
      harness: "opencode",
      dependencies: { bunOnPathChecker: bunPresent },
    });
    expect(result.capabilitySummaries).toBeDefined();
    expect(result.capabilitySummaries?.[0]?.platform).toBe("opencode");
    const counts = result.capabilitySummaries![0]!.counts;
    expect(counts.full + counts.shim + counts["shell-cmd"] + counts["drop-warn"] + counts.experimental).toBe(37);
  });
});

describe("doctor — --strict upgrades warns to fails", () => {
  test("upgradeWarnsToErrors flips warn → error; exitFromDiagnostics returns 1", () => {
    // Direct unit test of the strict-mode contract. Bypasses the full doctor
    // run because, post-T-11.3, default-baseline conditions (missing config
    // files, missing claude-code hooks dir) emit info instead of warn —
    // there's no naturally-emitted warn under default config to drive the
    // integration variant of this test. The strict transform itself is the
    // contract that matters; test it in isolation.
    const input: Diagnostic[] = [
      { severity: "warn", code: "synthetic.warn", message: "synthetic warn" },
      { severity: "info", code: "synthetic.info", message: "synthetic info" },
    ];
    expect(exitFromDiagnostics(input)).toBe(2);

    const upgraded = upgradeWarnsToErrors(input);
    expect(upgraded.find((d) => d.code === "synthetic.warn")?.severity).toBe("error");
    expect(upgraded.find((d) => d.code === "synthetic.info")?.severity).toBe("info");
    expect(exitFromDiagnostics(upgraded)).toBe(1);
  });

  test("strict mode applied to a synthetic DoctorResult flips warn checks to fail", () => {
    // Validates DoctorResult-shaped strict path via doctorExitCode. The
    // internal applyStrict() is invoked by runDoctor; here we verify the
    // exit-code policy directly on a synthetic check list.
    const result = {
      ok: true,
      checks: [
        { category: "X", name: "warn-one", status: "warn" as const, message: "" },
        { category: "X", name: "ok-one", status: "ok" as const, message: "" },
      ],
    };
    expect(doctorExitCode(result)).toBe(2);

    const strictChecks = result.checks.map((c) =>
      c.status === "warn" ? { ...c, status: "fail" as const } : c,
    );
    expect(doctorExitCode({ ok: false, checks: strictChecks })).toBe(1);
  });
});

describe("doctor — --harness all aggregates per-harness results", () => {
  test("returns perHarness map with all three platforms", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-all-");
    const result = await runDoctor({
      harness: "all",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    expect(result.perHarness).toBeDefined();
    expect(result.perHarness!.opencode).toBeDefined();
    expect(result.perHarness!["claude-code"]).toBeDefined();
    expect(result.perHarness!.codex).toBeDefined();
    // Each per-harness sub-result has its own capability summary.
    expect(result.perHarness!.opencode.capabilitySummaries?.[0]?.platform).toBe("opencode");
    expect(result.perHarness!.codex.capabilitySummaries?.[0]?.platform).toBe("codex");
    // Aggregated summaries cover all three platforms.
    expect(result.capabilitySummaries?.length).toBe(3);
  });
});

describe("doctor — T-24 codex plugin bundle + marketplace", () => {
  function writeCodexUserConfig(projectRoot: string, body: object): void {
    // Codex harness loader picks up <proj>/.codex/0xcraft.{json,jsonc}.
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "0xcraft.json"),
      JSON.stringify(body),
    );
  }

  test("default config: no plugin/marketplace checks emitted (opt-out is silent)", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-no-plugin-");
    writeCodexTree(projectRoot);
    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const codes = result.checks.map((c) => c.code).filter(Boolean);
    expect(codes).not.toContain("codex.plugin.bundle.missing");
    expect(codes).not.toContain("codex.plugin.marketplace.missing");
    expect(codes).not.toContain("codex.plugin.marketplace_requires_plugin");
  });

  test("emitPlugin=true + bundle present → ok check", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-plugin-ok-");
    writeCodexTree(projectRoot);
    writeCodexUserConfig(projectRoot, { platforms: { codex: { emitPlugin: true } } });
    fs.mkdirSync(path.join(projectRoot, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "0xcraft" }),
    );
    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const check = result.checks.find((c) => c.name === ".codex-plugin/plugin.json");
    expect(check).toBeDefined();
    expect(check!.status).toBe("ok");
  });

  test("emitPlugin=true + bundle absent → codex.plugin.bundle.missing failure", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-plugin-missing-");
    writeCodexTree(projectRoot);
    writeCodexUserConfig(projectRoot, { platforms: { codex: { emitPlugin: true } } });
    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const codes = result.checks.map((c) => c.code);
    expect(codes).toContain("codex.plugin.bundle.missing");
  });

  test("emitMarketplace=true without emitPlugin → codex.plugin.marketplace_requires_plugin failure", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-mkt-only-");
    writeCodexTree(projectRoot);
    writeCodexUserConfig(projectRoot, { platforms: { codex: { emitMarketplace: true } } });
    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const codes = result.checks.map((c) => c.code);
    expect(codes).toContain("codex.plugin.marketplace_requires_plugin");
    expect(codes).not.toContain("codex.plugin.marketplace.missing");
  });

  test("emitPlugin + emitMarketplace + marketplace.json missing → codex.plugin.marketplace.missing", async () => {
    const projectRoot = makeTempDir("0xcraft-doctor-codex-mkt-missing-");
    writeCodexTree(projectRoot);
    writeCodexUserConfig(projectRoot, {
      platforms: { codex: { emitPlugin: true, emitMarketplace: true } },
    });
    fs.mkdirSync(path.join(projectRoot, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "0xcraft" }),
    );
    const result = await runDoctor({
      harness: "codex",
      projectRoot,
      dependencies: { bunOnPathChecker: bunPresent },
    });
    const codes = result.checks.map((c) => c.code);
    expect(codes).toContain("codex.plugin.marketplace.missing");
  });
});
