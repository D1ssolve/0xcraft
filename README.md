# 0xcraft

> Agent operations plugin for OpenCode — harness-agnostic core with thin adapter layer.

You're juggling 17 agents, 20 skills, 3 plugins, and 4 MCP servers. Configuring workflows. Debugging hooks.

0xcraft packages all of it into a single installable plugin. One config file. One `opencode plugin add`.

## What It Does

- **17 agents** — team-lead, backend-developer, code-explorer, code-reviewer, codebase-indexer, adr-reviewer, research-agent, spec-driven, system-architect, dotnet-mentor, go-mentor, plus dual-mode routing configs
- **20 skills** — brainstorming, caveman, code-review-orchestrator, context7, implementation-patterns, pm-routing, systematic-debugging, TDD, verification, and more
- **3 bootstrap hooks** — agents-guard (AGENTS.md check), caveman (communication mode), git-worktree (worktree context)
- **4 MCP servers** — sequential-thinking, context7, mempalace, notebooklm-mcp
- **Harness-agnostic core** — zero OpenCode dependencies in `src/core/`. The OpenCode adapter remains the package default export; the Claude Code adapter generates filesystem plugin artifacts for local loading.

## Architecture

```txt
src/core/          ← Harness-agnostic. Zero dependencies.
  agents/          ← AgentDefinition data + registry
  skills/          ← SkillDefinition data + registry
  config/          ← ZeroxCraftConfig schema + merge
  hooks/           ← HookDefinition data + registry
  mcp/             ← McpRegistryEntry data + registry

src/adapters/
  opencode/        ← Thin adapter. Imports core, wraps in plugin API.
    hooks/          ← config, agents-guard, caveman, git-worktree
  claude-code/     ← Generator for Claude Code plugin-dir artifacts.
```

## Token Optimization

- **Lazy skill loading**: Skills are loaded on-demand via the `skill` tool, not injected into every message
- **Minimal bootstrap**: Only the first user message gets bootstrap text
- **Config-driven registration**: Only enabled agents are registered
- **MCP on-demand**: Skill-embedded MCPs start only when the skill is activated

## Installation

```bash
# Install as OpenCode plugin
opencode plugin add 0xcraft

# Or manually in opencode.json:
{
  "plugin": ["0xcraft"]
}
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
- `displayName` in `.claude-plugin/plugin.json` is omitted unless Claude Code v2.1.143+ or explicit support is confirmed.
- Zip loading is deferred. If enabled later, it must be gated behind Claude Code v2.1.128+ and documented separately.
- Unsupported or unknown Claude Code versions produce warnings for normal generation. Hard failure is reserved for explicit validation or strict checks such as `--validate` / `--strict`.

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

The core module (`src/core/`) has zero harness dependencies. Future adapters:

- **Codex**: `src/adapters/codex/` — maps agent definitions to Codex plugin API, skills to Codex skill format
- **Claude Code**: `src/adapters/claude-code/` — generates local plugin-dir artifacts from the same core registries. This adapter does not replace the OpenCode default export.

Key principle: **Don't over-abstract.** Build the OpenCode adapter first, make it work well, then add other adapters as needed.

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
