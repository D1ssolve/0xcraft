import fs from "fs";
import path from "path";
import type { SkillDefinition, McpServerConfig } from "../../../core/skills";
import type { ClaudeCodeFilesystemWriter } from "../filesystem";

export type ClaudeCodeSkillGeneratorDiagnosticSeverity = "warning" | "error";

export interface ClaudeCodeSkillGeneratorDiagnostic {
  severity: ClaudeCodeSkillGeneratorDiagnosticSeverity;
  code: string;
  skillId: string;
  skillFile: string;
  message: string;
}

export interface ClaudeCodeGeneratedSkillReference {
  id: string;
  /** Stable Claude Code namespace for invoking 0xcraft skills. */
  namespace: `/0xcraft:${string}`;
}

export interface ClaudeCodeSkillsGeneratorOptions {
  skills: SkillDefinition[];
  disabledSkillIds?: string[];
  packageRoot: string;
  writer: ClaudeCodeFilesystemWriter;
}

export interface ClaudeCodeSkillsGeneratorResult {
  emittedFiles: string[];
  skills: ClaudeCodeGeneratedSkillReference[];
  diagnostics: ClaudeCodeSkillGeneratorDiagnostic[];
  /** Intentionally empty: skill-embedded MCP servers are handled by the MCP mapper/generator only after explicit opt-in. */
  mcpServers: McpServerConfig[];
}

const SAFE_SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function generateClaudeCodeSkills(options: ClaudeCodeSkillsGeneratorOptions): ClaudeCodeSkillsGeneratorResult {
  const disabledSkillIds = new Set(options.disabledSkillIds ?? []);
  const packageRoot = path.resolve(options.packageRoot);
  const diagnostics: ClaudeCodeSkillGeneratorDiagnostic[] = [];
  const emittedFiles: string[] = [];
  const skills: ClaudeCodeGeneratedSkillReference[] = [];

  for (const skill of [...options.skills].sort((left, right) => compareIds(left.id, right.id))) {
    if (disabledSkillIds.has(skill.id)) {
      continue;
    }

    if (!SAFE_SKILL_ID_PATTERN.test(skill.id)) {
      diagnostics.push({
        severity: "error",
        code: "claude.skill.invalid_id",
        skillId: skill.id,
        skillFile: skill.skillFile,
        message: `Skill \`${skill.id}\` was omitted because its id is not safe for Claude Code skill path emission.`,
      });
      continue;
    }

    const skillFilePath = path.resolve(packageRoot, skill.skillFile);
    if (!isInsideDirectory(packageRoot, skillFilePath)) {
      diagnostics.push({
        severity: "error",
        code: "claude.skill.file_outside_package",
        skillId: skill.id,
        skillFile: skill.skillFile,
        message: `Skill \`${skill.id}\` was omitted because ${skill.skillFile} resolves outside the package root.`,
      });
      continue;
    }

    if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
      diagnostics.push({
        severity: "error",
        code: "claude.skill.missing_file",
        skillId: skill.id,
        skillFile: skill.skillFile,
        message: `Skill \`${skill.id}\` was omitted because ${skill.skillFile} does not exist.`,
      });
      continue;
    }

    const skillDirectory = path.dirname(skillFilePath);
    const skillOutputFile = `skills/${skill.id}/SKILL.md`;
    // Exclude SKILL.md from the bulk copy — we rewrite it immediately
    // below with normalized frontmatter, so copying then overwriting
    // would be wasted I/O (and on disk, a redundant write).
    emittedFiles.push(
      ...options.writer.copyDirectory(skillDirectory, `skills/${skill.id}`, (rel) => rel === "SKILL.md"),
    );
    emittedFiles.push(
      ...options.writer.overwriteMarkdown(skillOutputFile, normalizeSkillMarkdownForClaudeCode(skill, fs.readFileSync(skillFilePath, "utf8"))),
    );
    skills.push({
      id: skill.id,
      namespace: `/0xcraft:${skill.id}`,
    });
  }

  return {
    emittedFiles: emittedFiles.sort(compareIds),
    skills,
    diagnostics,
    mcpServers: [],
  };
}

function normalizeSkillMarkdownForClaudeCode(skill: SkillDefinition, sourceMarkdown: string): string {
  const body = stripSourceFrontmatter(sourceMarkdown);
  return `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${body}`;
}

function stripSourceFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }

  const end = markdown.indexOf("\n---", 4);
  if (end === -1) {
    return markdown;
  }

  return markdown.slice(end + 4).replace(/^(?:\r?\n)+/u, "");
}

function isInsideDirectory(directory: string, filePath: string): boolean {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
