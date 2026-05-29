# 0xcraft

> Multi-harness agent operations plugin — harness-agnostic core with thin adapters for OpenCode, Claude Code, and Codex.

You're juggling 17 agents, 20 skills, 3 plugins, and 4 MCP servers. Configuring workflows. Debugging hooks.

0xcraft packages all of it into a single installable plugin. One config file. One install command per harness.

## Supported harnesses

| Harness     | Mode                                       | Install                                                     |
| ----------- | ------------------------------------------ | ----------------------------------------------------------- |
| OpenCode    | Default package export, runtime plugin     | `opencode plugin add 0xcraft`                               |
| Claude Code | Generated filesystem plugin (local load)   | `bun run src/cli/index.ts install --harness claude-code`    |
| Codex       | Generated TOML config + agent files + hooks | `bun run src/cli/index.ts install --harness codex`          |

## What It Does

- **17 agents** — team-lead, backend-developer, code-explorer, code-reviewer, codebase-indexer, adr-reviewer, research-agent, spec-driven, system-architect, dotnet-mentor, go-mentor, plus dual-mode routing configs
- **20 skills** — brainstorming, caveman, code-review-orchestrator, context7, implementation-patterns, pm-routing, systematic-debugging, TDD, verification, and more
- **3 bootstrap hooks** — agents-guard (AGENTS.md check), caveman (communication mode), git-worktree (worktree context)
- **4 MCP servers** — sequential-thinking, context7, mempalace, notebooklm-mcp
- **Harness-agnostic core** — zero platform dependencies in `src/core/`. The OpenCode adapter is the package default export; Claude Code and Codex adapters generate filesystem artifacts for local loading.
- **Capability matrix** — single source of truth (`src/adapters/_shared/capability-matrix.ts`) drives every adapter's emission and diagnostic decisions per ADR Rev 3.

## Architecture

```txt
src/core/          ← Harness-agnostic. Zero platform dependencies.
  agents/          ← AgentDefinition data + registry
  skills/          ← SkillDefinition data + registry
  config/          ← ZeroxCraftConfig schema + merge
  hooks/           ← HookDefinition data + registry (with buildContext)
  mcp/             ← McpRegistryEntry data + registry
  diagnostic.ts    ← Shared Diagnostic primitive

src/adapters/
  _shared/         ← Capability matrix + bootstrap text + TOML emitter
  opencode/        ← Runtime plugin via @opencode-ai/plugin
    hooks/         ← config, agents-guard, caveman, git-worktree
  claude-code/    ← Generates .claude-plugin/ artifacts
  codex/          ← Generates .codex/ config.toml + agents/*.toml + hook scripts

src/cli/
  index.ts         ← Commander entrypoint
  install.ts       ← install --harness <opencode|claude-code|codex>
  doctor.ts        ← doctor --harness <id>
  codex.ts         ← codex generate
  claude-code.ts   ← claude-code generate
```

## Token Optimization

- **Lazy skill loading**: Skills are loaded on-demand via the `skill` tool, not injected into every message
- **Minimal bootstrap**: Only the first user message gets bootstrap text
- **Config-driven registration**: Only enabled agents are registered
- **MCP on-demand**: Skill-embedded MCPs start only when the skill is activated

## Installation

### OpenCode (default)

```bash
opencode plugin add 0xcraft

# Or manually in opencode.json:
{
  "plugin": ["0xcraft"]
}
```

### Claude Code (local plugin-dir)

```bash
bun run src/cli/index.ts install --harness claude-code --output dist/claude-code-plugin/0xcraft --force
claude --plugin-dir dist/claude-code-plugin/0xcraft/
```

### Codex (TOML config)

```bash
bun run src/cli/index.ts install --harness codex --output . --project . --force
# Generates .codex/config.toml, .codex/agents/*.toml, .codex/hooks/*.mjs
```

### Diagnostics

```bash
bun run src/cli/index.ts doctor                          # opencode (default)
bun run src/cli/index.ts doctor --harness claude-code
bun run src/cli/index.ts doctor --harness codex
```

## Claude Code plugin-dir workflow

Claude Code support is generated output, not the package default export. Normal `bun run build`, `bun test`, and `bun run doctor` do not require the `claude` CLI.

First release supports local plugin loading only:

```bash
# Generate into the default ephemeral output under dist/
bun run src/cli/index.ts claude-code generate --force

# Or choose an explicit directory
bun run src/cli/index.ts claude-code generate --out /tmp/0xcraft-claude-plugin --force

# Optional external validation. This requires Claude Code CLI.
bun run src/cli/index.ts claude-code generate --force --validate
bun run src/cli/index.ts claude-code generate --force --strict
```

Load locally:

```bash
claude --plugin-dir dist/claude-code-plugin/0xcraft/
```

After regenerating while Claude Code is running, execute this inside Claude Code:

```text
/reload-plugins
```

Rollback:

1. Stop passing `--plugin-dir` to `claude`.
2. Run `/reload-plugins` or restart Claude Code.
3. Remove generated output if desired:

```bash
rm -rf dist/claude-code-plugin/0xcraft/
```

### Generated output ownership

`dist/claude-code-plugin/0xcraft/` is generated, gitignored, cleanable output under `dist/`. It is not source-owned, not meant for manual edits, and may be deleted by `bun run clean` because that command removes `dist/`. Regenerate it with `0xcraft claude-code generate`.

Package assets needed by the generator are shipped from the package root: `agents/`, `skills/`, and `templates/` are included in package files. The generated Claude plugin copies needed skill/agent artifacts into the chosen plugin directory.

### Compatibility policy

- Supported workflow: `claude --plugin-dir <dir>` plus `/reload-plugins`.
- Required capability checks for validation workflows: `--plugin-dir`, `/reload-plugins`, and `claude plugin validate`.
- `displayName` in `.claude-plugin/plugin.json` is emitted unconditionally when `packageMetadata.displayName` is set (capability-matrix-driven per ADR Rev 3 — no per-version probing).
- Zip loading is deferred. If enabled later, it must be gated by the capability matrix.
- Per ADR Rev 3, the capability matrix is the single source of truth — no runtime version probing.

### Security and parity limits

- Claude Code plugins are trusted filesystem packages. Hook scripts, MCP servers, and binaries can execute with user privileges.
- Generated diagnostics must not expose secrets from MCP env, headers, tokens, or local config.
- Claude plugin agents do not support OpenCode `permissionMode`, agent-local hooks, or agent-local MCP servers.
- OpenCode first-message prompt transforms have no confirmed Claude Code prompt-rewrite parity; generated output reports unsupported/deferred mappings instead of silently changing behavior.
- Skill-embedded MCP servers are not auto-registered by default because Claude starts plugin MCP servers when the plugin is enabled.
- Skill `allowed-tools` can widen approvals while active; generated skills avoid broad allowlists.

## Configuration

Create `~/.config/opencode/0xcraft.json` or `.opencode/0xcraft.json`:

```jsonc
{
  // Disable specific agents
  "disabledAgents": ["go-mentor"],

  // Disable specific skills
  "disabledSkills": ["linkedin-article"],

  // Disable specific hooks
  "disabledHooks": ["git-worktree-bootstrap"],

  // Override models per agent
  "modelOverrides": {
    "team-lead": "opencode/claude-opus-4-7",
    "backend-developer": "github-copilot/gpt-5.5"
  },

  // Override temperatures per agent
  "temperatureOverrides": {
    "team-lead": 0.1
  },

  // Add custom MCP servers
  "mcpServers": {
    "my-custom-mcp": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-server"]
    }
  },

  // Toggle bootstrap hooks
  "agentsGuardEnabled": true,
  "cavemanBootstrapEnabled": true,
  "gitWorktreeBootstrapEnabled": true,

  // Add custom skill directories
  "customSkillPaths": ["/path/to/my/skills"],

  // Add custom agent directories
  "customAgentPaths": ["/path/to/my/agents"]
}
```

## Universality

The core module (`src/core/`) has zero harness dependencies. All three adapters consume the same registries:

- **OpenCode**: `src/adapters/opencode/` — runtime plugin via `@opencode-ai/plugin`. Default package export.
- **Claude Code**: `src/adapters/claude-code/` — generates filesystem plugin artifacts (`.claude-plugin/plugin.json`, agents, skills, hooks).
- **Codex**: `src/adapters/codex/` — generates `.codex/config.toml`, per-agent TOML files, and standalone hook scripts.

Capability differences are governed by `src/adapters/_shared/capability-matrix.ts` (ADR Rev 3 — single source of truth).

Key principle: **Don't over-abstract.** The core defines data; each adapter maps to its platform's idioms.

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
bun run doctor
bun run src/cli/index.ts claude-code generate --force
```

`bun run clean` removes `dist/`, including generated Claude Code output under `dist/claude-code-plugin/0xcraft/`. It does not remove source assets under `agents/`, `skills/`, or `templates/`.

Manual verification note: restart OpenCode after changing plugin code, config, agents, or skills so the runtime reloads the updated package assets and hooks.

## License

MIT
