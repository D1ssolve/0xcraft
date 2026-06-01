import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { importClaude, type ClaudeImportMode } from "../adapters/claude/import";
import { importCodex } from "../adapters/codex/import";
import { importOpenCode } from "../adapters/opencode/import";
import type { Diagnostic } from "../core/diagnostics";
import type { AgentIR, CommandIR, HookIR, IRResource, McpServerIR, SkillIR } from "../core/ir";
import { serializeToml } from "../core/loader/toml-parser";
import { serializeYamlFrontmatter } from "../core/loader/yaml-parser";

export type ImportSourcePlatform = "opencode" | "claude-code" | "codex";
export type ImportExitCode = 0 | 1 | 2;

export interface RunImportOptions {
  from?: string;
  mode?: ClaudeImportMode;
  inDir?: string;
  outDir?: string;
  overwrite?: boolean;
  strict?: boolean;
  json?: boolean;
}

export interface RunImportResult {
  diagnostics: Diagnostic[];
  exitCode: ImportExitCode;
  output: string;
  writtenFiles: string[];
}

interface PendingFile {
  path: string;
  content: string;
}

const VALID_SOURCES = new Set<ImportSourcePlatform>(["opencode", "claude-code", "codex"]);
const VALID_CLAUDE_MODES = new Set<ClaudeImportMode>(["claude-plugin", "claude-subagent", "auto"]);

export function createImportCommand(): Command {
  return new Command("import")
    .description("Import existing platform artifacts into common 0xcraft source layout")
    .requiredOption("--from <id>", "Source platform: opencode | claude-code | codex")
    .option("--mode <mode>", "Claude import mode: claude-plugin | claude-subagent | auto", "auto")
    .option("--in <dir>", "Input platform artifact root", ".")
    .option("--out <dir>", "Output common source root", ".")
    .option("--overwrite", "Overwrite existing common files")
    .option("--strict", "Upgrade warnings to errors")
    .option("--json", "Emit JSON diagnostics")
    .action((options: RunImportOptions) => {
      const result = runImport(options);
      if (result.output.length > 0) {
        console.log(result.output);
      }
      process.exitCode = result.exitCode;
    });
}

export function runImport(options: RunImportOptions): RunImportResult {
  const diagnostics: Diagnostic[] = [];
  const inDir = resolve(options.inDir ?? ".");
  const outDir = resolve(options.outDir ?? ".");
  const from = options.from;

  if (!isImportSourcePlatform(from)) {
    diagnostics.push({
      severity: "error",
      code: "ERR_UNSUPPORTED_MODE",
      message: `Unsupported import source '${from ?? ""}'. Expected opencode, claude-code, or codex.`,
      details: { from },
    });
    return finalizeImportResult(diagnostics, [], options.json === true);
  }

  if (options.mode !== undefined && !VALID_CLAUDE_MODES.has(options.mode)) {
    diagnostics.push({
      severity: "error",
      code: "ERR_UNSUPPORTED_MODE",
      message: `Unsupported Claude import mode '${options.mode}'. Expected claude-plugin, claude-subagent, or auto.`,
      details: { mode: options.mode },
    });
    return finalizeImportResult(diagnostics, [], options.json === true);
  }

  const importResult = importPlatform(from, inDir, {
    mode: options.mode ?? "auto",
  });
  diagnostics.push(...importResult.diagnostics);

  const files = buildCommonLayoutFiles(importResult.ir, outDir);
  diagnostics.push(...existingFileDiagnostics(files, options.overwrite === true));

  const finalDiagnostics = options.strict === true ? upgradeWarnsToErrors(diagnostics) : diagnostics;
  if (finalDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return finalizeImportResult(finalDiagnostics, [], options.json === true);
  }

  const writtenFiles = writePendingFiles(files);
  return finalizeImportResult(finalDiagnostics, writtenFiles, options.json === true);
}

function importPlatform(
  from: ImportSourcePlatform,
  inDir: string,
  options: { mode: ClaudeImportMode },
): { ir: IRResource[]; diagnostics: Diagnostic[] } {
  switch (from) {
    case "opencode":
      return importOpenCode(inDir);
    case "claude-code":
      return importClaude(inDir, { mode: options.mode });
    case "codex":
      return importCodex(inDir);
  }
}

function buildCommonLayoutFiles(resources: IRResource[], outDir: string): PendingFile[] {
  const files: PendingFile[] = [];

  for (const resource of [...resources].sort(compareResources)) {
    switch (resource.kind) {
      case "agent":
        files.push(...agentFiles(resource, outDir));
        break;
      case "skill":
        files.push(...skillFiles(resource, outDir));
        break;
      case "hook":
        files.push(...hookFiles(resource, outDir));
        break;
      case "mcp":
        files.push(mcpFile(resource, outDir));
        break;
      case "command":
        files.push(commandFile(resource, outDir));
        break;
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function agentFiles(agent: AgentIR, outDir: string): PendingFile[] {
  const dir = join(outDir, "agents", agent.id);
  const common = omitKeys(agent.common as Record<string, unknown>, ["prompt"]);
  const files: PendingFile[] = [{
    path: join(dir, "AGENT.md"),
    content: serializeYamlFrontmatter(common, `${agent.common.prompt}\n`),
  }];

  if (agent.platform.opencode !== undefined) {
    files.push({
      path: join(dir, "agent.opencode.md"),
      content: serializeYamlFrontmatter(agent.platform.opencode as Record<string, unknown>, ""),
    });
  }
  if (agent.platform.claude !== undefined) {
    files.push({
      path: join(dir, "agent.claude.md"),
      content: serializeYamlFrontmatter(agent.platform.claude as Record<string, unknown>, ""),
    });
  }
  const codexMeta = agent.platform.codex as Record<string, unknown> | undefined;
  if (codexMeta !== undefined || agent.provenance?.importedFrom === "codex") {
    const codexCommon: Record<string, unknown> = {};
    const commonModel = (agent.common as Record<string, unknown>).model;
    if (commonModel !== undefined) codexCommon.model = commonModel;
    files.push({
      path: join(dir, "agent.codex.toml"),
      content: serializeToml({ ...codexCommon, ...(codexMeta ?? {}) }),
    });
  }
  appendReferenceFiles(files, dir, agent.references);

  return files;
}

function skillFiles(skill: SkillIR, outDir: string): PendingFile[] {
  const dir = join(outDir, "skills", skill.id);
  const common = omitKeys(skill.common as Record<string, unknown>, ["body"]);
  const files: PendingFile[] = [{
    path: join(dir, "SKILL.md"),
    content: serializeYamlFrontmatter(common, `${skill.common.body}\n`),
  }];

  if (skill.platform.opencode !== undefined) {
    files.push({ path: join(dir, "skill.opencode.md"), content: serializeYamlFrontmatter(skill.platform.opencode as Record<string, unknown>, "") });
  }
  if (skill.platform.claude !== undefined) {
    files.push({ path: join(dir, "skill.claude.md"), content: serializeYamlFrontmatter(skill.platform.claude as Record<string, unknown>, "") });
  }
  if (skill.platform.codex !== undefined) {
    files.push({ path: join(dir, "skill.codex.toml"), content: serializeToml(skill.platform.codex as Record<string, unknown>) });
  }
  appendReferenceFiles(files, dir, skill.references);

  return files;
}

function appendReferenceFiles(
  files: PendingFile[],
  targetDir: string,
  references: Record<string, string> | undefined,
): void {
  if (references === undefined) return;
  for (const [filename, content] of Object.entries(references).sort(([a], [b]) => a.localeCompare(b))) {
    files.push({
      path: join(targetDir, "references", filename),
      content: content.replaceAll("\r\n", "\n") + (content.endsWith("\n") ? "" : "\n"),
    });
  }
}

function hookFiles(hook: HookIR, outDir: string): PendingFile[] {
  const dir = join(outDir, "hooks", hook.id);
  const common = hook.common as Record<string, unknown>;
  const files: PendingFile[] = [{
    path: join(dir, "HOOK.md"),
    content: serializeYamlFrontmatter(common, ""),
  }];

  if (hook.platform.opencode !== undefined) {
    files.push({ path: join(dir, "hook.opencode.md"), content: serializeYamlFrontmatter(hook.platform.opencode as Record<string, unknown>, "") });
  }
  if (hook.platform.claude !== undefined) {
    files.push({ path: join(dir, "hook.claude.md"), content: serializeYamlFrontmatter(hook.platform.claude as Record<string, unknown>, "") });
  }
  if (hook.platform.codex !== undefined) {
    files.push({ path: join(dir, "hook.codex.toml"), content: serializeToml(hook.platform.codex as Record<string, unknown>) });
  }

  const jsBody = hook.runtimeFiles?.opencodeJs !== undefined
    ? readRuntimeFileOrBody(hook.runtimeFiles.opencodeJs, hook)
    : undefined;
  if (jsBody !== undefined) {
    files.push({ path: join(dir, "hook.opencode.js"), content: jsBody });
  }

  return files;
}

function mcpFile(mcp: McpServerIR, outDir: string): PendingFile {
  return {
    path: join(outDir, "mcp", mcp.id, "MCP.md"),
    content: serializeYamlFrontmatter({
      ...cleanRecord(mcp.common as Record<string, unknown>),
      mcpEnvelope: cleanRecord(mcp.mcpEnvelope as Record<string, unknown>),
      platform: cleanRecord(mcp.platform as Record<string, unknown>),
    }, ""),
  };
}

function commandFile(command: CommandIR, outDir: string): PendingFile {
  const common = omitKeys(command.common as Record<string, unknown>, ["template"]);
  return {
    path: join(outDir, "commands", command.id, "COMMAND.md"),
    content: serializeYamlFrontmatter(common, `${command.common.template}\n`),
  };
}

function existingFileDiagnostics(files: PendingFile[], overwrite: boolean): Diagnostic[] {
  if (overwrite) return [];
  return files
    .filter((file) => existsSync(file.path))
    .map((file) => ({
      severity: "error" as const,
      code: "ERR_FILE_EXISTS",
      message: `File already exists: ${file.path}. Use --overwrite to replace it.`,
      details: { path: file.path },
    }));
}

function writePendingFiles(files: PendingFile[]): string[] {
  const writtenFiles: string[] = [];
  for (const file of files) {
    mkdirSync(resolve(file.path, ".."), { recursive: true });
    writeFileSync(file.path, file.content, "utf8");
    writtenFiles.push(file.path);
  }
  return writtenFiles;
}

function upgradeWarnsToErrors(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => (
    diagnostic.severity === "warn" ? { ...diagnostic, severity: "error" } : diagnostic
  ));
}

function finalizeImportResult(
  diagnostics: Diagnostic[],
  writtenFiles: string[],
  json: boolean,
): RunImportResult {
  const exitCode = exitFromDiagnostics(diagnostics);
  const output = json
    ? `${JSON.stringify({ diagnostics, exitCode, writtenFiles }, null, 2)}\n`
    : formatDiagnostics(diagnostics);
  return { diagnostics, exitCode, output, writtenFiles };
}

function exitFromDiagnostics(diagnostics: Diagnostic[]): ImportExitCode {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return 1;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warn")) return 2;
  return 0;
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map((diagnostic) => (
    `[0xcraft] ${diagnostic.severity.toUpperCase()} ${diagnostic.code} — ${diagnostic.message}`
  )).join("\n");
}

function compareResources(a: IRResource, b: IRResource): number {
  const kindCompare = a.kind.localeCompare(b.kind);
  return kindCompare === 0 ? a.id.localeCompare(b.id) : kindCompare;
}

function isImportSourcePlatform(value: string | undefined): value is ImportSourcePlatform {
  return value !== undefined && VALID_SOURCES.has(value as ImportSourcePlatform);
}

function omitKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const omitted = new Set(keys);
  return cleanRecord(Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.has(key))));
}

function cleanRecord(record: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      cleaned[key] = value.map((item) => isPlainRecord(item) ? cleanRecord(item) : item);
      continue;
    }
    if (isPlainRecord(value)) {
      cleaned[key] = cleanRecord(value);
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function readRuntimeFileOrBody(filePath: string, hook: HookIR): string | undefined {
  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf8");
  }

  const runtimeAction = hook.common.actions.find((action) => action.type === "runtime_code");
  return runtimeAction?.type === "runtime_code" && "body" in runtimeAction && typeof runtimeAction.body === "string"
    ? runtimeAction.body
    : undefined;
}
