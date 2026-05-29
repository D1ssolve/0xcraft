/**
 * Codex skill emitter (Task D.4).
 *
 * Emits `<codexSkillsDir>/<id>/SKILL.md` for a single enabled skill.
 *
 * - Default skills dir: `.agents/skills/` (research §refresh, ADR §5).
 *   Overridable via `config.codexSkillsDir`.
 * - YAML frontmatter contains exactly `name` + `description` from the
 *   registry (preferred over the source file's frontmatter — registry is
 *   canonical).
 * - Body is the source SKILL.md body verbatim (post-frontmatter). Codex
 *   picks up the file as-is, so no Codex-specific instructions are
 *   injected here.
 * - Per-skill `mcpServers` and `autoLoad` are NOT representable in Codex;
 *   diagnostics are emitted but the keys are not written into frontmatter.
 *
 * Path returned is always POSIX (forward-slash). The orchestrator joins
 * with the output root.
 */
import fs from "node:fs";
import path from "node:path";

import type { SkillDefinition } from "../../../core/skills";
import type { ZeroxCraftConfig } from "../../../core/config";
import type { Diagnostic } from "../../../core/diagnostics/diagnostic";

import { parseFrontmatter, serializeFrontmatter } from "../../_shared/frontmatter";
import { DiagnosticCollector } from "../../_shared/diagnostic-collector";
import { CODEX_MATRIX } from "../../_shared/capability-matrix";
import { emitCapabilityDiagnostic } from "../_internal/capability-diagnostic";

export interface EmitCodexSkillOptions {
  skill: SkillDefinition;
  /** Root containing `skills/<id>/SKILL.md` source files. */
  packageRoot: string;
  /** Used for `codexSkillsDir` override + `enabledSkills` / `disabledSkills`. */
  config: ZeroxCraftConfig;
}

export interface EmitCodexSkillResult {
  /** POSIX relative path, e.g. `.agents/skills/<id>/SKILL.md`. */
  filename: string;
  /** Final SKILL.md content (frontmatter + body). */
  content: string;
  diagnostics: Diagnostic[];
}

const DEFAULT_SKILLS_DIR = ".agents/skills";

export function emitCodexSkill(options: EmitCodexSkillOptions): EmitCodexSkillResult | null {
  const { skill, packageRoot, config } = options;

  // Gating: disabled or not in non-empty whitelist → skip.
  if (config.disabled.skills.includes(skill.id)) {
    return null;
  }
  if (config.enabled.skills.length > 0 && !config.enabled.skills.includes(skill.id)) {
    return null;
  }

  const diagnostics = new DiagnosticCollector();

  // Codex cannot express per-skill MCP scoping (matrix-driven).
  if (skill.mcpServers !== undefined && skill.mcpServers.length > 0) {
    const d = emitCapabilityDiagnostic(CODEX_MATRIX, "skills.mcpScoping", {
      code: "codex.skill.mcp_scoping_dropped",
      dropMessage:
        "per-skill MCP scoping not native in Codex; MCP servers must be registered globally or per-agent",
      degradeMessage:
        "per-skill MCP scoping degraded in Codex; MCP servers must be registered globally or per-agent",
      details: { skillId: skill.id, mcpServers: skill.mcpServers.map((s) => s.name) },
    });
    if (d) diagnostics.add(d);
  }

  // Codex has no native autoLoad — discovery is description-driven (matrix-driven).
  if (skill.autoLoad === true) {
    const d = emitCapabilityDiagnostic(CODEX_MATRIX, "skills.autoLoad", {
      code: "codex.skill.auto_load_degraded",
      dropMessage:
        "autoLoad behavior not supported in Codex; skill discovery is description-driven via /skills",
      degradeMessage:
        "autoLoad behavior not directly supported in Codex; skill discovery is description-driven via /skills",
      shimMessage:
        "autoLoad behavior shimmed in Codex; skill discovery is description-driven via /skills",
      details: { skillId: skill.id },
    });
    if (d) diagnostics.add(d);
  }

  // Read source body.
  const sourcePath = path.join(packageRoot, "skills", skill.id, "SKILL.md");
  let body = "";
  let sourceFrontmatter: Record<string, unknown> | undefined;
  if (!fs.existsSync(sourcePath)) {
    diagnostics.error(
      "codex.skill.source_missing",
      `Skill source not found at ${sourcePath}; emitting minimal SKILL.md from registry`,
      { skillId: skill.id, sourcePath },
    );
  } else {
    const raw = fs.readFileSync(sourcePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    body = parsed.body;
    sourceFrontmatter = parsed.meta as Record<string, unknown> | undefined;
  }

  // T-22: Codex has no allowedTools / allowed-tools surface for skills —
  // matrix says `drop-warn`. If the source SKILL.md frontmatter has
  // `allowed-tools` (Claude convention) or `allowedTools`, emit the
  // matrix-keyed diagnostic and drop the field (not propagated to the
  // emitted Codex frontmatter, which carries only name + description).
  const allowedToolsField =
    sourceFrontmatter?.["allowed-tools"] ?? sourceFrontmatter?.allowedTools;
  if (allowedToolsField !== undefined) {
    const d = emitCapabilityDiagnostic(CODEX_MATRIX, "skills.allowedTools", {
      code: "codex.skills.allowedTools.dropped",
      dropMessage:
        "Codex skills have no per-skill allowedTools surface; field dropped from emitted SKILL.md.",
      degradeMessage:
        "Codex skills approximate allowedTools via agent-level sandbox/permissions; field dropped from emitted SKILL.md.",
      details: { skillId: skill.id, allowedTools: allowedToolsField },
    });
    if (d) diagnostics.add(d);
  }

  const frontmatter = serializeFrontmatter({
    name: skill.name,
    description: skill.description,
  });

  // `parseFrontmatter` strips exactly one `\n` after the closing `---`,
  // so we join with a single `\n` here to round-trip cleanly.
  const content = body.length > 0 ? `${frontmatter}\n${body}` : `${frontmatter}\n`;

  // POSIX path. `platforms.codex.skillsDir` is treated as a relative
  // path; normalize separators so callers always see forward slashes.
  const baseDir = (config.platforms.codex?.skillsDir ?? DEFAULT_SKILLS_DIR)
    .replace(/\\/g, "/")
    .replace(/\/+$/u, "");
  const filename = `${baseDir}/${skill.id}/SKILL.md`;

  return {
    filename,
    content,
    diagnostics: diagnostics.getAll(),
  };
}
