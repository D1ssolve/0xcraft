/**
 * Doctor — health diagnostics for 0xcraft.
 *
 * Checks:
 * 1. System: Node.js/Bun version, platform
 * 2. Config: config file found, valid, sources listed
 * 3. Agents: all agent prompt files exist
 * 4. Skills: all skill SKILL.md files exist
 * 5. MCPs: required commands available on PATH
 * 6. OpenCode: plugin registered in opencode.json
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { builtinAgents } from "../core/agents/builtin-agents";
import { builtinSkills } from "../core/skills/skill-types";
import { builtinMcpServers } from "../core/mcp/mcp-registry";
import { loadConfig, validateConfig } from "../core/config/config-loader";

export interface DoctorCheck {
  category: string;
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const pkgRoot = findPkgRoot();

  // 1. System checks
  checks.push(...checkSystem());

  // 2. Config checks
  checks.push(...checkConfig());

  // 3. Agent checks
  checks.push(...checkAgents(pkgRoot));

  // 4. Skill checks
  checks.push(...checkSkills(pkgRoot));

  // 5. MCP checks
  checks.push(...checkMcps());

  // 6. OpenCode registration
  checks.push(...checkOpenCodeRegistration());

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

function findPkgRoot(): string {
  // Walk up from CWD to find package.json
  let current = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(current, "package.json"), "utf-8"));
      if (pkg.name === "0xcraft") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume we're in the repo
  return path.resolve(import.meta.dirname, "../..");
}

function checkSystem(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Node.js version
  try {
    const nodeVersion = process.version;
    checks.push({
      category: "System",
      name: "Node.js",
      status: "ok",
      message: `Node.js ${nodeVersion}`,
    });
  } catch {
    checks.push({ category: "System", name: "Node.js", status: "fail", message: "Node.js not found" });
  }

  // Bun check
  try {
    const bunVersion = execSync("bun --version", { encoding: "utf-8" }).trim();
    checks.push({
      category: "System",
      name: "Bun",
      status: "ok",
      message: `Bun ${bunVersion}`,
    });
  } catch {
    checks.push({
      category: "System",
      name: "Bun",
      status: "warn",
      message: "Bun not found (optional, recommended for development)",
    });
  }

  // Platform
  checks.push({
    category: "System",
    name: "Platform",
    status: "ok",
    message: `${os.type()} ${os.release()} (${os.arch()})`,
  });

  return checks;
}

function checkConfig(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  try {
    const { config, sources } = loadConfig();
    const validation = validateConfig(config);

    if (sources.length === 0) {
      checks.push({
        category: "Config",
        name: "Config files",
        status: "warn",
        message: "No config files found — using defaults",
      });
    } else {
      checks.push({
        category: "Config",
        name: "Config files",
        status: "ok",
        message: `Found: ${sources.join(", ")}`,
      });
    }

    if (validation.valid) {
      checks.push({
        category: "Config",
        name: "Config validation",
        status: "ok",
        message: "Config is valid",
      });
    } else {
      for (const error of validation.errors) {
        checks.push({
          category: "Config",
          name: "Config validation",
          status: "fail",
          message: error,
        });
      }
    }
  } catch (err) {
    checks.push({
      category: "Config",
      name: "Config loading",
      status: "fail",
      message: `Error loading config: ${(err as Error).message}`,
    });
  }

  return checks;
}

function checkAgents(pkgRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const agent of builtinAgents) {
    const agentPath = path.join(pkgRoot, agent.promptFile);
    if (fs.existsSync(agentPath)) {
      checks.push({
        category: "Agents",
        name: agent.id,
        status: "ok",
        message: `Prompt file found: ${agent.promptFile}`,
      });
    } else {
      checks.push({
        category: "Agents",
        name: agent.id,
        status: "fail",
        message: `Prompt file missing: ${agent.promptFile}`,
      });
    }
  }

  return checks;
}

function checkSkills(pkgRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const skill of builtinSkills) {
    const skillPath = path.join(pkgRoot, skill.skillFile);
    if (fs.existsSync(skillPath)) {
      checks.push({
        category: "Skills",
        name: skill.id,
        status: "ok",
        message: `SKILL.md found: ${skill.skillFile}`,
      });
    } else {
      checks.push({
        category: "Skills",
        name: skill.id,
        status: "fail",
        message: `SKILL.md missing: ${skill.skillFile}`,
      });
    }
  }

  return checks;
}

function checkMcps(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const mcp of builtinMcpServers) {
    if (mcp.type === "local" && mcp.command) {
      const cmd = mcp.command[0];
      try {
        execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8" });
        checks.push({
          category: "MCPs",
          name: mcp.name,
          status: "ok",
          message: `${cmd} found on PATH`,
        });
      } catch {
        checks.push({
          category: "MCPs",
          name: mcp.name,
          status: "warn",
          message: `${cmd} not found on PATH (MCP may fail to start)`,
        });
      }
    } else if (mcp.type === "remote" && mcp.url) {
      checks.push({
        category: "MCPs",
        name: mcp.name,
        status: "ok",
        message: `Remote: ${mcp.url}`,
      });
    }
  }

  return checks;
}

function checkOpenCodeRegistration(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const home = os.homedir();
  const configPath = path.join(home, ".config", "opencode", "opencode.json");

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      const plugins = config.plugin ?? [];
      const registered = plugins.includes("0xcraft") || plugins.some((p: string) => p.includes("0xcraft"));

      if (registered) {
        checks.push({
          category: "OpenCode",
          name: "Plugin registration",
          status: "ok",
          message: "0xcraft is registered in opencode.json",
        });
      } else {
        checks.push({
          category: "OpenCode",
          name: "Plugin registration",
          status: "warn",
          message: "0xcraft is not registered in opencode.json — run `0xcraft install`",
        });
      }
    } else {
      checks.push({
        category: "OpenCode",
        name: "Plugin registration",
        status: "warn",
        message: "opencode.json not found — run `0xcraft install`",
      });
    }
  } catch {
    checks.push({
      category: "OpenCode",
      name: "Plugin registration",
      status: "warn",
      message: "Could not read opencode.json",
    });
  }

  return checks;
}

export function printDoctorResults(result: DoctorResult): void {
  const categories = [...new Set(result.checks.map((c) => c.category))];

  for (const category of categories) {
    console.log(`\n  ${category}`);
    const categoryChecks = result.checks.filter((c) => c.category === category);
    for (const check of categoryChecks) {
      const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
      const color = check.status === "ok" ? "" : check.status === "warn" ? "" : "";
      console.log(`    ${icon} ${check.name}: ${check.message}`);
    }
  }

  console.log("");
  if (result.ok) {
    console.log("  All checks passed ✓");
  } else {
    console.log("  Some checks failed ✗ — see above for details");
  }
}