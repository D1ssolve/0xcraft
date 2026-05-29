/**
 * Codex `.codex-plugin/` filesystem-plugin bundle emitter — Batch E / T-18.
 *
 * Pure function. Takes already-built skill/hook artifacts (so the bundle
 * is byte-equal to the `.codex/` tree where they overlap) plus the
 * `CodexPluginManifest` produced by `mappers/plugin.ts`, and returns the
 * full list of `.codex-plugin/*` `CodexBuiltFile`s.
 *
 * Layout (per ADR-003 / T-18):
 *   .codex-plugin/plugin.json
 *   .codex-plugin/skills/<id>/SKILL.md           (copy of .codex/skills/...)
 *   .codex-plugin/hooks/hooks.json               (copy of .codex/hooks.json)
 *   .codex-plugin/hooks/<id>.sh                  (copy of .codex/hooks/<id>.sh)
 *   .codex-plugin/.mcp.json                      (mcpServers JSON object)
 *
 * Gating is performed by the caller (orchestrator checks
 * `config.platforms.codex.emitPlugin === true`).
 */

import type { CodexBuiltFile } from "../index";
import type { CodexPluginManifest } from "../mappers/plugin";

const BUNDLE_ROOT = ".codex-plugin";

export interface EmitCodexPluginBundleOptions {
  manifest: CodexPluginManifest;
  /** Skill files already emitted under `<skillsDir>/<id>/SKILL.md`. */
  skillFiles: ReadonlyArray<CodexBuiltFile>;
  /** Hook files already emitted under `.codex/hooks.json` + `.codex/hooks/<id>.sh`. */
  hookFiles: ReadonlyArray<CodexBuiltFile>;
  /**
   * Root directory of source skills inside the `.codex` tree (matches
   * `config.platforms.codex.skillsDir ?? ".agents/skills"`). Used to
   * trim the prefix so bundled skills land at `skills/<id>/SKILL.md`.
   */
  sourceSkillsDir: string;
}

export interface EmitCodexPluginBundleResult {
  files: CodexBuiltFile[];
}

export function emitCodexPluginBundle(
  options: EmitCodexPluginBundleOptions,
): EmitCodexPluginBundleResult {
  const files: CodexBuiltFile[] = [];

  // 1. plugin.json — JSON, deterministic 2-space indent + trailing newline.
  files.push({
    path: `${BUNDLE_ROOT}/plugin.json`,
    content: JSON.stringify(options.manifest, null, 2) + "\n",
  });

  // 2. .mcp.json — only when manifest references mcp servers.
  if (options.manifest.mcpServers !== undefined) {
    files.push({
      path: `${BUNDLE_ROOT}/.mcp.json`,
      content:
        JSON.stringify({ mcpServers: options.manifest.mcpServers }, null, 2) + "\n",
    });
  }

  // 3. Skills — copy byte-for-byte, retargeting path.
  const sourcePrefix = stripTrailingSlash(options.sourceSkillsDir) + "/";
  for (const skillFile of options.skillFiles) {
    if (!skillFile.path.startsWith(sourcePrefix)) continue;
    const relative = skillFile.path.slice(sourcePrefix.length);
    files.push({
      path: `${BUNDLE_ROOT}/skills/${relative}`,
      content: skillFile.content,
    });
  }

  // 4. Hooks — copy byte-for-byte if the manifest references them.
  if (options.manifest.hooks !== undefined) {
    for (const hookFile of options.hookFiles) {
      if (hookFile.path === ".codex/hooks.json") {
        files.push({
          path: `${BUNDLE_ROOT}/hooks/hooks.json`,
          content: hookFile.content,
        });
      } else if (hookFile.path.startsWith(".codex/hooks/")) {
        const tail = hookFile.path.slice(".codex/hooks/".length);
        files.push({
          path: `${BUNDLE_ROOT}/hooks/${tail}`,
          content: hookFile.content,
          ...(hookFile.mode !== undefined ? { mode: hookFile.mode } : {}),
        });
      }
    }
  }

  return { files };
}

function stripTrailingSlash(p: string): string {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}
