import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import { claudeCodeSettingsJsonSchema, type ClaudeCodeSettingsJson } from "../types/claude-code-types";

export interface GenerateClaudeCodeSettingsOptions {
  writer: ClaudeCodeFilesystemWriter;
  settings?: Record<string, unknown> | ClaudeCodeSettingsJson;
}

export interface GenerateClaudeCodeSettingsResult {
  emittedFiles: string[];
}

const SUPPORTED_SETTINGS_KEYS = ["agent", "subagentStatusLine"] as const;

export function generateClaudeCodeSettings(options: GenerateClaudeCodeSettingsOptions): GenerateClaudeCodeSettingsResult {
  const settings = selectSupportedSettings(options.settings ?? {});

  if (Object.keys(settings).length === 0) {
    return { emittedFiles: [] };
  }

  return {
    emittedFiles: options.writer.writeJson("settings.json", claudeCodeSettingsJsonSchema.parse(settings)),
  };
}

function selectSupportedSettings(settings: Record<string, unknown> | ClaudeCodeSettingsJson): Partial<ClaudeCodeSettingsJson> {
  const selected: Partial<ClaudeCodeSettingsJson> = {};

  for (const key of SUPPORTED_SETTINGS_KEYS) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) {
      selected[key] = value;
    }
  }

  return selected;
}
