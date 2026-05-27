# 0xcraft

> Agent operations plugin for OpenCode — harness-agnostic core with thin adapter layer.

You're juggling 17 agents, 20 skills, 3 plugins, and 4 MCP servers. Configuring workflows. Debugging hooks.

0xcraft packages all of it into a single installable plugin. One config file. One `opencode plugin add`.

## What It Does

- **17 agents** — team-lead, backend-developer, code-explorer, code-reviewer, codebase-indexer, adr-reviewer, research-agent, spec-driven, system-architect, dotnet-mentor, go-mentor, plus dual-mode routing configs
- **20 skills** — brainstorming, caveman, code-review-orchestrator, context7, implementation-patterns, pm-routing, systematic-debugging, TDD, verification, and more
- **3 bootstrap hooks** — agents-guard (AGENTS.md check), caveman (communication mode), git-worktree (worktree context)
- **4 MCP servers** — sequential-thinking, context7, mempalace, notebooklm-mcp
- **Harness-agnostic core** — zero OpenCode dependencies in `src/core/`. Future Codex and Claude Code adapters can reuse the same agent definitions, skill registries, and config schemas.

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
- **Claude Code**: `src/adapters/claude-code/` — maps skills to CLAUDE.md sections, hooks to Claude Code hooks (PreToolUse, PostToolUse, Notification)

Key principle: **Don't over-abstract.** Build the OpenCode adapter first, make it work well, then add other adapters as needed.

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

## License

MIT
