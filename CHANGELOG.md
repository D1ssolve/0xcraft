# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0] - 2026-06-01

### Breaking Changes

- Removed `createPlugin` default export — OpenCode adapter is now filesystem-only (no `@opencode-ai/plugin` runtime)
- Removed `@opencode-ai/plugin` and `@opencode-ai/sdk` dependencies entirely
- Removed `@anthropic-ai/*` dependencies
- Removed all built-in agents, skills, hooks, and commands registries
- Removed v2 adapter architecture (plugin-based three-adapter system)
- Removed unsupported-policy flat config parsing (`disabledAgents`, `enabledAgents`, etc.)
- Renamed `src/adapters/claude-code/` → `src/adapters/claude/`; platform adapter now named `claude`
- New CLI surface: `init`, `build`, `convert`, `import`, `doctor`, `pack` (replaces old subcommands)
- New config path: `.0xcraft/config.json[c]` (replaces `.opencode/0xcraft.{json,jsonc}`)
- Codex adapter now uses TOML agents (`agents/*.toml`) instead of hook scripts
- Claude adapter now has two emit modes: `claude-plugin` and `claude-subagent`
- Capability matrix expanded from 37 → 106 features × 3 platforms

### Added

- Converter-first architecture: platform files → import → IR → emit → platform files
- IR layer: `AgentIR`, `SkillIR`, `HookIR`, `McpServerIR`, `CommandIR`, `PermissionIR` in `src/core/ir/`
- 8 hook runtime primitives (`run_command`, `run_exec`, `http_request`, `call_mcp_tool`, `invoke_prompt`, `invoke_agent`, `runtime_code`, `run_script`) × per-platform translator
- Pack system: npm packages with `0xcraft-pack.json` manifest; resolved via `src/adapters/_shared/pack-resolver/`
- `0xcraft convert --from X --to Y` for cross-platform IR-based conversion
- `0xcraft import --from X [--overwrite]` to import from existing platform configs
- `0xcraft doctor [--target <platform|all>] [--strict] [--json]` with capability matrix validation
- `0xcraft init` and `0xcraft pack add/list` commands
- Deterministic output: sorted keys, LF line endings, no timestamps — same input → byte-identical artifacts
- Secret redaction in diagnostics via `sanitizeDetails` (`[REDACTED]` for MCP env vars, headers, tokens)
- 106-feature capability matrix × 3 platforms (`opencode`, `claude-code`, `codex`); completeness-asserted on every `doctor` run
- Strict Zod schemas throughout: config, IR shapes, MCP transports, permission specs, pack manifests
- `DiagnosticCollector` with structured `{ severity, code, message, details? }` diagnostics
- Doctor exit codes: `0` clean, `1` any error, `2` warn-only; `--strict` upgrades `warn` → `error`

### Test Baseline

571 pass / 0 fail / 51 files
