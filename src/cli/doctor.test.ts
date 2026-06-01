import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runDoctorCommand } from "./doctor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "0xcraft-doctor-test-"));
}

function writeConfig(projectDir: string, config: Record<string, unknown>): void {
  const dir = path.join(projectDir, ".0xcraft");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2));
}

function captureIo(): { lines: string[]; stdout: (l: string) => void; stderr: (l: string) => void } {
  const lines: string[] = [];
  return { lines, stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("doctor — default config exits 0", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("exits 0 with no user config file", async () => {
    const result = await runDoctorCommand(tmpDir, {});
    expect(result.exitCode).toBe(0);
  });

  it("emits only info diagnostics when no config", async () => {
    const result = await runDoctorCommand(tmpDir, {});
    for (const d of result.diagnostics) {
      expect(d.severity).toBe("info");
    }
  });
});

describe("doctor — valid project exits 0", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writeConfig(tmpDir, { schema: "0xcraft.config.v1" });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("exits 0 for valid config with default source layout", async () => {
    const result = await runDoctorCommand(tmpDir, {});
    expect(result.exitCode).toBe(0);
  });
});

describe("doctor — missing source dirs warns", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writeConfig(tmpDir, { schema: "0xcraft.config.v1", sourceRoot: "src" });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("emits warn for missing source root when user config present", async () => {
    const result = await runDoctorCommand(tmpDir, {});
    const warn = result.diagnostics.find((d) => d.severity === "warn");
    expect(warn).toBeDefined();
    expect(result.exitCode).toBe(2);
  });
});

describe("doctor — --strict upgrades warns to errors", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writeConfig(tmpDir, { schema: "0xcraft.config.v1", sourceRoot: "src" });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("exits 1 with --strict when there are warnings", async () => {
    const result = await runDoctorCommand(tmpDir, { strict: true });
    expect(result.exitCode).toBe(1);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("doctor — --json structured output", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("emits valid JSON array to stdout", async () => {
    const io = captureIo();
    await runDoctorCommand(tmpDir, { json: true }, io);
    const jsonLines = io.lines.join("\n");
    const parsed = JSON.parse(jsonLines) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("JSON output contains severity/code/message fields", async () => {
    const io = captureIo();
    await runDoctorCommand(tmpDir, { json: true }, io);
    const entries = JSON.parse(io.lines.join("\n")) as Array<Record<string, unknown>>;
    for (const entry of entries) {
      expect(entry).toHaveProperty("severity");
      expect(entry).toHaveProperty("code");
      expect(entry).toHaveProperty("message");
    }
  });
});

describe("doctor — marketplace without plugin → error", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writeConfig(tmpDir, {
      schema: "0xcraft.config.v1",
      platforms: { codex: { emitMarketplace: true, emitPlugin: false } },
    });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("emits ERR_MARKETPLACE_REQUIRES_PLUGIN", async () => {
    // Config parse itself throws because Zod superRefine catches it,
    // but doctor should still surface the error in diagnostics.
    const result = await runDoctorCommand(tmpDir, {});
    const errDiag = result.diagnostics.find(
      (d) => d.severity === "error" && d.code.includes("MARKETPLACE"),
    );
    expect(errDiag).toBeDefined();
    expect(result.exitCode).toBe(1);
  });
});

describe("doctor — assertMatrixComplete runs without error", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("does not throw or produce matrix error diagnostics", async () => {
    const result = await runDoctorCommand(tmpDir, {});
    const matrixErrors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.toLowerCase().includes("matrix"),
    );
    expect(matrixErrors).toHaveLength(0);
  });
});

describe("doctor — --target flag", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("accepts opencode target", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "opencode" });
    expect(result.exitCode).toBe(0);
  });

  it("accepts claude-code target", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "claude-code" });
    expect(result.exitCode).toBe(0);
  });

  it("accepts codex target", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "codex" });
    expect(result.exitCode).toBe(0);
  });

  it("accepts all target", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "all" });
    expect(result.exitCode).toBe(0);
  });

  it("rejects unknown target with exit 1", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "unknown" });
    expect(result.exitCode).toBe(1);
  });
});

describe("doctor — capability matrix summary in output", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("emits capability matrix summary info diagnostics", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "all" });
    const summaries = result.diagnostics.filter(
      (d) => d.severity === "info" && d.message.includes("capability matrix"),
    );
    // all → 3 targets
    expect(summaries.length).toBe(3);
  });

  it("summary includes full= count", async () => {
    const result = await runDoctorCommand(tmpDir, { target: "opencode" });
    const summary = result.diagnostics.find(
      (d) => d.severity === "info" && d.message.includes("capability matrix [opencode]"),
    );
    expect(summary?.message).toContain("full=");
  });
});
