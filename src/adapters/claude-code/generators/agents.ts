import fs from "fs";
import path from "path";
import type { AgentDefinition } from "../../../core/agents/agent-types";
import type { ZeroxCraftConfig } from "../../../core/config/config-types";
import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import type { ClaudeCodeAgentFrontmatter } from "../types/claude-code-types";
import { mapAgentToClaudeCodeAgent } from "../mappers/agent-mapper";
import type { ClaudePermissionDiagnostic } from "../mappers/permission-mapper";

export type ClaudeCodeAgentGeneratorDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeAgentGeneratorDiagnostic {
  severity: ClaudeCodeAgentGeneratorDiagnosticSeverity;
  code: string;
  agentId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GenerateClaudeCodeAgentsOptions {
  packageRoot: string;
  writer: ClaudeCodeFilesystemWriter;
  builtInAgents: AgentDefinition[];
  customAgents?: AgentDefinition[];
  config: Pick<ZeroxCraftConfig, "enabledAgents" | "disabledAgents" | "modelOverrides">;
}

export interface GenerateClaudeCodeAgentsResult {
  emittedFiles: string[];
  diagnostics: Array<ClaudeCodeAgentGeneratorDiagnostic | ClaudePermissionDiagnostic>;
}

export function generateClaudeCodeAgents(options: GenerateClaudeCodeAgentsOptions): GenerateClaudeCodeAgentsResult {
  const enabledAgentIds = options.config.enabledAgents ?? [];
  const disabledAgentIds = options.config.disabledAgents ?? [];
  const modelOverrides = options.config.modelOverrides ?? {};
  const selectedAgents = [...options.builtInAgents, ...(options.customAgents ?? [])]
    .filter((agent) => isAgentEnabled(agent.id, enabledAgentIds, disabledAgentIds))
    .sort((left, right) => comparePaths(left.id, right.id));
  const emittedFiles: string[] = [];
  const diagnostics: GenerateClaudeCodeAgentsResult["diagnostics"] = [];
  const emittedOutputFiles = new Set<string>();

  for (const agent of selectedAgents) {
    const outputFile = `agents/${agent.id}.md`;
    if (emittedOutputFiles.has(outputFile)) {
      diagnostics.push(createNameCollisionDiagnostic(agent.id, outputFile));
      continue;
    }

    const promptFilePath = resolvePromptFilePath(options.packageRoot, agent.promptFile);
    if (!fs.existsSync(promptFilePath) || !fs.statSync(promptFilePath).isFile()) {
      diagnostics.push(createMissingPromptDiagnostic(agent.id, agent.promptFile));
      continue;
    }

    const promptBody = readPromptBody(promptFilePath);
    const mappedAgent = mapAgentToClaudeCodeAgent(
      {
        ...agent,
        model: modelOverrides[agent.id] ?? agent.model,
      },
      promptBody,
    );
    diagnostics.push(...mappedAgent.diagnostics);

    const writtenFiles = options.writer.writeMarkdown(
      outputFile,
      formatAgentMarkdown(mappedAgent.frontmatter, mappedAgent.body),
    );
    emittedFiles.push(...writtenFiles);
    emittedOutputFiles.add(outputFile);
  }

  return {
    emittedFiles: emittedFiles.sort(comparePaths),
    diagnostics,
  };
}

function isAgentEnabled(agentId: string, enabledAgentIds: string[], disabledAgentIds: string[]): boolean {
  if (disabledAgentIds.includes(agentId)) return false;
  if (enabledAgentIds.length > 0 && !enabledAgentIds.includes(agentId)) return false;
  return true;
}

function resolvePromptFilePath(packageRoot: string, promptFile: string): string {
  if (path.isAbsolute(promptFile)) return promptFile;
  return path.resolve(packageRoot, promptFile);
}

function readPromptBody(promptFilePath: string): string {
  const content = fs.readFileSync(promptFilePath, "utf8");
  if (!content.startsWith("---")) return content;

  const frontmatterEnd = content.indexOf("\n---", 3);
  if (frontmatterEnd === -1) return content;

  return content.slice(frontmatterEnd + "\n---".length).trimStart();
}

function formatAgentMarkdown(frontmatter: ClaudeCodeAgentFrontmatter, body: string): string {
  return `---\n${formatFrontmatter(frontmatter)}---\n${body}`;
}

function formatFrontmatter(frontmatter: ClaudeCodeAgentFrontmatter): string {
  const lines: string[] = [];
  const orderedKeys: Array<keyof ClaudeCodeAgentFrontmatter> = [
    "name",
    "description",
    "model",
    "effort",
    "maxTurns",
    "tools",
    "disallowedTools",
    "skills",
    "memory",
    "background",
    "isolation",
  ];

  for (const key of orderedKeys) {
    const value = frontmatter[key];
    if (value === undefined) continue;
    appendFrontmatterValue(lines, key, value);
  }

  return lines.join("\n") + "\n";
}

function appendFrontmatterValue(lines: string[], key: string, value: string | number | boolean | string[]): void {
  if (Array.isArray(value)) {
    lines.push(`${key}:`);
    for (const item of value) {
      lines.push(`  - ${quoteYamlScalar(item)}`);
    }
    return;
  }

  lines.push(`${key}: ${quoteYamlScalar(value)}`);
}

function quoteYamlScalar(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  if (/^[A-Za-z0-9_./-]+$/u.test(value)) return value;
  return JSON.stringify(value);
}

function createMissingPromptDiagnostic(agentId: string, promptFile: string): ClaudeCodeAgentGeneratorDiagnostic {
  return {
    severity: "warning",
    code: "claude-code.agent.prompt-missing",
    agentId,
    message: `Claude Code agent \`${agentId}\` prompt file not found; omitting generated agent.`,
    details: { promptFile },
  };
}

function createNameCollisionDiagnostic(agentId: string, outputFile: string): ClaudeCodeAgentGeneratorDiagnostic {
  return {
    severity: "warning",
    code: "claude-code.agent.name-collision",
    agentId,
    message: `Claude Code agent \`${agentId}\` collides with an already emitted agent; omitting duplicate.`,
    details: { outputFile },
  };
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
