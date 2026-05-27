import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import {
  mapClaudeCodeMcpServers,
  type ClaudeCodeMcpMapperOptions,
  type ClaudeMcpDiagnostic,
} from "../mappers/mcp-mapper";
import { claudeCodeMcpJsonSchema } from "../types/claude-code-types";

export interface ClaudeCodeMcpGeneratorOptions extends ClaudeCodeMcpMapperOptions {
  writer: ClaudeCodeFilesystemWriter;
}

export interface ClaudeCodeMcpGeneratorResult {
  emittedFiles: string[];
  diagnostics: ClaudeMcpDiagnostic[];
}

export function generateClaudeCodeMcp(options: ClaudeCodeMcpGeneratorOptions): ClaudeCodeMcpGeneratorResult {
  const { mcpJson, diagnostics } = mapClaudeCodeMcpServers(options);
  const validatedMcpJson = claudeCodeMcpJsonSchema.parse(mcpJson);

  return {
    emittedFiles: options.writer.writeJson(".mcp.json", validatedMcpJson),
    diagnostics,
  };
}
