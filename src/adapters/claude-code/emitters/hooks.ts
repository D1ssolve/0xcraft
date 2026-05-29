import type { HookSpec } from "../../../core/hooks";
import type { ZeroxCraftConfig } from "../../../core/config";
import { defaultConfig } from "../../../core/config";
import type { ClaudeCodeFilesystemWriter } from "../filesystem";
import { emitClaudeCodeHookScript } from "../hook-script-emitter";
import {
  mapHooksToClaudeCode,
  type ClaudeCodeHookMappingDiagnostic,
  type ClaudeCodeMappedHookScriptRef,
} from "../mappers/hooks";
import { claudeCodeHooksJsonSchema } from "../types/claude-code-types";

export interface GenerateClaudeCodeHooksScriptFile {
  /** Path relative to the plugin output root. */
  path: string;
  content: string;
  /** POSIX file mode (0o755 for executable). */
  mode: number;
}

export interface GenerateClaudeCodeHooksOptions {
  writer: ClaudeCodeFilesystemWriter;
  hooks: HookSpec[];
  disabledHooks?: string[];
  /**
   * Project root passed to script emitters — only embedded in the
   * agents-guard text for informational purposes; the script resolves
   * the real project root at runtime via `CLAUDE_PROJECT_DIR`/`cwd`.
   */
  projectRoot?: string;
  /** Runtime for the emitted scripts and the commands that invoke them. */
  runtime?: "bun" | "node";
  /**
   * Override the full config the emitter sees. Defaults are derived
   * from `disabledHooks` + `runtime` + core defaults.
   */
  config?: ZeroxCraftConfig;
}

export interface GenerateClaudeCodeHooksResult {
  emittedFiles: string[];
  diagnostics: ClaudeCodeHookMappingDiagnostic[];
  /**
   * Hook shim scripts that the orchestrator must write to disk with
   * executable mode. The generator does NOT write them via the JSON
   * writer because they require a POSIX mode flag.
   */
  scriptFiles: GenerateClaudeCodeHooksScriptFile[];
}

export function generateClaudeCodeHooks(options: GenerateClaudeCodeHooksOptions): GenerateClaudeCodeHooksResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const runtime =
    options.runtime ?? options.config?.platforms["claude-code"]?.hookRuntime ?? "bun";
  // Default-config base: synthesize a nested-shaped config when callers
  // don't pass one. `disabledHooks` here refers to the function param,
  // not a config field — config-shape access uses `config.disabled.hooks`.
  const config: ZeroxCraftConfig = options.config ?? {
    ...defaultConfig,
    disabled: {
      ...defaultConfig.disabled,
      hooks: [...new Set([...defaultConfig.disabled.hooks, ...(options.disabledHooks ?? [])])],
    },
    platforms: {
      ...defaultConfig.platforms,
      "claude-code": {
        ...(defaultConfig.platforms["claude-code"] ?? {}),
        hookRuntime: runtime,
      },
    },
  };

  const scriptFiles: GenerateClaudeCodeHooksScriptFile[] = [];
  const scriptRefs: ClaudeCodeMappedHookScriptRef[] = [];
  const diagnostics: ClaudeCodeHookMappingDiagnostic[] = [];

  for (const hook of options.hooks) {
    const emitted = emitClaudeCodeHookScript({
      hook,
      projectRoot,
      config,
      runtime,
    });
    for (const diag of emitted?.diagnostics ?? []) {
      diagnostics.push({
        severity: diag.severity === "error" ? "error" : "warning",
        code: diag.code,
        hookId: hook.id,
        message: diag.message,
      });
    }
    if (!emitted) continue;

    scriptFiles.push({
      path: emitted.filename,
      content: emitted.content,
      mode: 0o755,
    });
    scriptRefs.push({
      hookId: hook.id,
      hookEventName: emitted.hookEventName,
      scriptPath: emitted.filename,
    });
  }

  const mapping = mapHooksToClaudeCode({
    hooks: options.hooks,
    disabledHooks: options.disabledHooks ?? config.disabled.hooks,
    scriptRefs,
    runtime,
  });
  diagnostics.push(...mapping.diagnostics);

  if (!mapping.hooksJson) {
    return {
      emittedFiles: [],
      diagnostics,
      scriptFiles,
    };
  }

  const hooksJson = claudeCodeHooksJsonSchema.parse(mapping.hooksJson);
  const emittedFiles = options.writer.writeJson("hooks/hooks.json", hooksJson);

  return {
    emittedFiles,
    diagnostics,
    scriptFiles,
  };
}
