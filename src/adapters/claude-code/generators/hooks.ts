import type { HookDefinition } from "../../../core/hooks";
import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import { mapHooksToClaudeCode, type ClaudeCodeHookMappingDiagnostic } from "../mappers/hook-mapper";
import { claudeCodeHooksJsonSchema } from "../types/claude-code-types";

export interface GenerateClaudeCodeHooksOptions {
  writer: ClaudeCodeFilesystemWriter;
  hooks: HookDefinition[];
  disabledHooks?: string[];
}

export interface GenerateClaudeCodeHooksResult {
  emittedFiles: string[];
  diagnostics: ClaudeCodeHookMappingDiagnostic[];
}

export function generateClaudeCodeHooks(options: GenerateClaudeCodeHooksOptions): GenerateClaudeCodeHooksResult {
  const mapping = mapHooksToClaudeCode({
    hooks: options.hooks,
    disabledHooks: options.disabledHooks,
  });

  if (!mapping.hooksJson) {
    return {
      emittedFiles: [],
      diagnostics: mapping.diagnostics,
    };
  }

  const hooksJson = claudeCodeHooksJsonSchema.parse(mapping.hooksJson);

  return {
    emittedFiles: options.writer.writeJson("hooks/hooks.json", hooksJson),
    diagnostics: mapping.diagnostics,
  };
}
