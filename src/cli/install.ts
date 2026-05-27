/**
 * Install — interactive setup wizard for 0xcraft.
 *
 * Steps:
 * 1. Check if 0xcraft is already registered in opencode.json
 * 2. If not, add it to the plugin array
 * 3. Offer to create a 0xcraft.json config file
 * 4. Validate the setup
 */

import fs from "fs";
import path from "path";
import os from "os";
import { runDoctor, printDoctorResults } from "./doctor";

const HOME = os.homedir();
const OPENCODE_CONFIG_DIR = path.join(HOME, ".config", "opencode");
const OPENCODE_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "opencode.json");
const ZEROCRAFT_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "0xcraft.json");

export async function runInstall(): Promise<void> {
  console.log("\n  0xcraft — Agent Operations Plugin\n");
  console.log("  This wizard will:\n");
  console.log("  1. Register 0xcraft in your OpenCode config");
  console.log("  2. Create a default 0xcraft.json config (optional)");
  console.log("  3. Run health diagnostics\n");

  // Step 1: Register plugin
  await registerPlugin();

  // Step 2: Create config
  await createConfig();

  // Step 3: Run doctor
  console.log("\n  Running diagnostics...\n");
  const result = await runDoctor();
  printDoctorResults(result);

  console.log("\n  Setup complete! Restart OpenCode to activate 0xcraft.\n");
}

async function registerPlugin(): Promise<void> {
  // Ensure config directory exists
  if (!fs.existsSync(OPENCODE_CONFIG_DIR)) {
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
  }

  let config: Record<string, unknown> = {};

  if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(OPENCODE_CONFIG_PATH, "utf-8"));
    } catch {
      console.log("  ⚠ Could not parse opencode.json — creating backup and starting fresh");
      const backup = OPENCODE_CONFIG_PATH + ".backup";
      fs.copyFileSync(OPENCODE_CONFIG_PATH, backup);
      console.log(`  Backup saved to: ${backup}`);
    }
  }

  const plugins = (config.plugin ?? []) as string[];
  if (plugins.includes("0xcraft")) {
    console.log("  ✓ 0xcraft is already registered in opencode.json");
    return;
  }

  // Add 0xcraft to plugin array
  config.plugin = [...plugins, "0xcraft"];

  fs.writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log("  ✓ Added 0xcraft to opencode.json plugin array");
}

async function createConfig(): Promise<void> {
  if (fs.existsSync(ZEROCRAFT_CONFIG_PATH)) {
    console.log("  ✓ 0xcraft.json config already exists");
    return;
  }

  const defaultConfig = {
    "// 0xcraft config": "See README.md for all options",
    disabledAgents: [],
    disabledSkills: [],
    disabledHooks: [],
    modelOverrides: {},
    temperatureOverrides: {},
    agentsGuardEnabled: true,
    cavemanBootstrapEnabled: true,
    gitWorktreeBootstrapEnabled: true,
  };

  fs.writeFileSync(ZEROCRAFT_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2) + "\n");
  console.log(`  ✓ Created default config at ${ZEROCRAFT_CONFIG_PATH}`);
}