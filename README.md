<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

[![0xcraft](./.github/assets/hero.png)](https://github.com/0xcraft/0xcraft#0xcraft)

</div>

# 0xcraft

0xcraft converts agentic framework configuration between OpenCode, Claude Code, and OpenAI Codex. It reads platform files into a platform-neutral IR, then emits deterministic filesystem artifacts for the target platform.

The goal is not to invent a fourth agent format. The goal is to keep one source of truth for agents, skills, hooks, MCP servers, commands, and permissions while preserving platform-specific details where the target supports them.

## Supported platforms

| Platform | Import | Emit | Notes |
| --- | --- | --- | --- |
| OpenCode | `opencode.json/jsonc`, `.opencode/agents/*.md`, `.opencode/skills/*.md`, `.opencode/commands/*.md`, `.opencode/plugins/*` | `opencode.json` plus `.opencode/*` files | Project-local files only. OpenCode runtime plugins are represented as runtime-specific hooks. |
| Claude Code | `.claude-plugin/` plugin tree or `.claude/agents/` subagents | `claude-plugin` or `claude-subagent` mode | Plugin mode emits a plugin manifest plus agent, skill, hook, and MCP files. Subagent mode emits `.claude/agents/*.md`. |
| Codex | `.codex/config.toml`, `.codex/agents/*.toml`, `.codex/hooks.json`, `.mcp.json` | `.codex/config.toml`, `.codex/agents/*.toml`, `.codex/hooks.json`, optional plugin/marketplace files | Hooks use the current event-keyed Codex shape. Only command handlers are runnable in Codex today; prompt and agent handlers are imported but diagnosed as skipped. |

Official format references:

- OpenCode config and agents: <https://opencode.ai/docs/config/> and <https://opencode.ai/docs/agents/>
- Claude Code subagents, hooks, and MCP: <https://docs.anthropic.com/en/docs/claude-code/sub-agents>, <https://docs.anthropic.com/en/docs/claude-code/hooks>, <https://docs.anthropic.com/en/docs/claude-code/mcp>
- Codex config, subagents, and hooks: <https://developers.openai.com/codex/config-reference>, <https://developers.openai.com/codex/config-advanced>, <https://developers.openai.com/codex/subagents>, <https://developers.openai.com/codex/hooks>

## Install

```bash
npm install -g 0xcraft
```

For local development in this repository:

```bash
bun install
bun run build
bun test
```

## Quick start

```bash
0xcraft init
0xcraft doctor --target all
0xcraft build --target codex --force
```

To convert an existing platform project:

```bash
0xcraft import --from opencode --overwrite
0xcraft build --target claude-code --mode claude-plugin --force
```

Or convert directly:

```bash
0xcraft convert --from opencode --to codex
```

Example agent packs live outside this repository at:

```text
/Users/diss0x/dev/craft-agents
```

That repository contains reusable `agents/`, `skills/`, `hooks/`, `mcp/`, `opencode.json`, and `0xcraft-pack.json` examples.

## Project layout

0xcraft loads resources from `sourceRoot` in `.0xcraft/config.json[c]`. By default, `sourceRoot` is the project root.

```text
agents/<id>/AGENT.md          # common agent definition
agents/<id>/agent.opencode.md # optional OpenCode metadata
agents/<id>/agent.claude.md   # optional Claude metadata
agents/<id>/agent.codex.toml  # optional Codex metadata

skills/<id>/SKILL.md
hooks/<id>/HOOK.md
mcp/<id>/MCP.md
commands/<id>/COMMAND.md
```

Resource ids must be lowercase kebab-case (`backend-developer`, `code-reviewer`, `pre-tool-guard`).

## Configuration

Create `.0xcraft/config.json` or `.0xcraft/config.jsonc`. The schema is strict: unknown keys are rejected.

```jsonc
{
  "schema": "0xcraft.config.v1",
  "sourceRoot": ".",
  "out": {
    "opencode": ".",
    "claudeCode": ".",
    "codex": "."
  },
  "enabled": {
    "agents": [],
    "skills": []
  },
  "disabled": {
    "agents": ["experimental-agent"],
    "skills": [],
    "hooks": [],
    "mcpServers": []
  },
  "packs": [
    { "name": "@my-org/agent-pack", "version": "1.2.3" }
  ],
  "platforms": {
    "codex": {
      "hooksEmitMode": "hooks.json",
      "mcpEnvelope": "wrapped",
      "emitPlugin": false,
      "emitMarketplace": false,
      "permissionsBeta": false,
      "agents": {
        "backend-developer": {
          "model": "gpt-5.5",
          "model_reasoning_effort": "high",
          "nickname_candidates": ["backend", "api"]
        }
      },
      "mcpExtensions": {
        "docs": {
          "env_vars": ["DOCS_TOKEN"]
        }
      },
      "permissionProfiles": {
        "workspace": {
          "sandbox_mode": "workspace-write",
          "approval_policy": "on-request"
        }
      }
    },
    "claude": {},
    "opencode": {}
  },
  "diagnostics": {
    "strict": false,
    "codes": {}
  }
}
```

## CLI reference

| Command | Purpose |
| --- | --- |
| `0xcraft init` | Create a starter `.0xcraft/config.json`. |
| `0xcraft build --target opencode\|claude-code\|codex\|all` | Build platform artifacts from the 0xcraft resource tree. |
| `0xcraft build --target claude-code --mode claude-plugin\|claude-subagent` | Choose the Claude output mode. |
| `0xcraft build --validate` | Dry-run without writing artifacts. |
| `0xcraft build --force` | Overwrite existing generated files. |
| `0xcraft convert --from <platform> --to <platform>` | Import one platform and emit another through IR. |
| `0xcraft import --from <platform> --overwrite` | Import platform files into the 0xcraft resource tree. |
| `0xcraft doctor --target all --strict --json` | Run diagnostics and capability matrix checks. |
| `0xcraft pack add <pkg> --version <range>` | Add an npm package with a `0xcraft-pack.json` manifest. |
| `0xcraft pack list` | List configured packs. |

Supported platform ids are `opencode`, `claude-code`, and `codex`.

## Conversion model

All conversions go through IR:

```text
platform files -> import adapter -> IR -> emit adapter -> platform files
```

This keeps adapters symmetric and prevents platform adapters from depending on each other. The core IR is platform-agnostic; platform-specific fields live under `platform.opencode`, `platform.claude`, or `platform.codex` and are preserved when possible.

## Hooks and limitations

0xcraft supports these IR hook primitives:

```text
run_command, run_exec, run_script, http_request,
call_mcp_tool, invoke_prompt, invoke_agent, runtime_code
```

Platform support is intentionally explicit:

- Claude Code has the broadest hook surface and uses event-keyed `hooks.json`.
- Codex currently emits runnable command handlers only. `run_exec` is shimmed to a shell command, `timeoutMs` is emitted as Codex `timeout` seconds, and unsupported handlers produce diagnostics.
- OpenCode runtime plugin hooks are preserved as platform-specific runtime code when they cannot be represented neutrally.
- Some conversions are lossy. Run `0xcraft doctor` and inspect diagnostics before committing generated artifacts.

## Codex details

Codex output follows the current documented shapes:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(*)",
        "hooks": [
          { "type": "command", "command": "bun test", "timeout": 30 }
        ]
      }
    ]
  }
}
```

Codex `approval_policy` accepts `untrusted`, `on-request`, `never`, or a granular policy object. Unsupported policy values are reported as errors instead of being rewritten.

## Development

```bash
bun run typecheck
bun test
bun run build
bun run src/cli/index.ts doctor --target all
```

The test suite covers purity rules, deterministic output, golden import/emit fixtures, round trips across platform pairs, capability matrix completeness, secret redaction, and pack resolution.

## License

MIT.
