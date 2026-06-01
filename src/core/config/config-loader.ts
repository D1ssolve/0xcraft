import fs from "node:fs";
import path from "node:path";

import { ConfigSchema, DEFAULT_CONFIG, type ZeroxCraftConfig } from "./config-schema";

export type { ZeroxCraftConfig } from "./config-schema";

export function stripJsonc(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      if (i < input.length) output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        if (input[i] === "\n") output += "\n";
        i++;
      }
      i++;
      continue;
    }

    output += char;
  }

  return output;
}

export function parseJsonc(input: string): unknown {
  return JSON.parse(stripJsonc(input));
}

export function loadConfig(projectDir: string): ZeroxCraftConfig {
  const configPath = firstExistingConfigPath(projectDir);
  if (configPath === undefined) return DEFAULT_CONFIG;

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parseJsonc(raw);
  return ConfigSchema.parse(parsed);
}

function firstExistingConfigPath(projectDir: string): string | undefined {
  const jsonPath = path.join(projectDir, ".0xcraft", "config.json");
  if (fs.existsSync(jsonPath)) return jsonPath;

  const jsoncPath = path.join(projectDir, ".0xcraft", "config.jsonc");
  if (fs.existsSync(jsoncPath)) return jsoncPath;

  return undefined;
}
