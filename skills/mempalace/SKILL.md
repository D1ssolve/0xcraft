---
name: mempalace
description: >
  Use this skill whenever the user asks about mempalace CLI commands, how to run mempalace,
  how to use mempalace MCP server, or anything related to mempalace memory system.
  This skill encodes the correct way to run mempalace via uvx in this specific setup —
  where mempalace is NOT globally installed and must always be invoked through uvx.
  Trigger on any mention of: mempalace, memory palace, mcp server mempalace, mine convos,
  palace status, or any mempalace subcommand.
---
# MemPalace via uvx

## Installation

MemPalace is **not installed globally**. Run only through `uvx`:
- first run — downloads `mempalace` from PyPI, builds a venv
- subsequent runs — fast cache from `~/.cache/uv/`
Memory data location: `~/.mempalace/` (do not touch when clearing cache).
```
~/.cache/uv/environments-v1/mempalace-*/  ← code
~/.mempalace/                              ← data
```
## Critical Rule

CLI entry point: `uvx mempalace <subcommand>`
Python module: `uvx --from mempalace python -m mempalace.<module>`

```bash
# CORRECT
uvx --from mempalace python -m mempalace.mcp_server
# INCORRECT — uvx looks for a package on PyPI
uvx mempalace.mcp_server
```
## Commands

### CLI

```bash
uvx mempalace --version          # version
uvx mempalace init               # initialize palace
uvx mempalace mine .             # mine from current directory
uvx mempalace mine ./chats --mode convos  # mine conversations
uvx mempalace status             # palace status
uvx mempalace mcp                # MCP instructions (does not start the server)
```

### MCP Server

```bash
uvx --from mempalace python -m mempalace.mcp_server
uvx --from mempalace python -m mempalace.mcp_server --palace /path/to/palace
```

## OpenCode MCP Config

File: `~/.config/opencode/opencode.jsonc`
```jsonc
{
  "mcp": {
    "mempalace": {
      "type": "local",
      "command": ["uvx", "--from", "mempalace", "python", "-m", "mempalace.mcp_server"]
    }
  }
}
```

Restart OpenCode after changing the config.
## Cache and Data

```bash
uv cache clean                   # clear uvx cache
rm -rf ~/.mempalace              # delete palace data (irreversible)
du -sh ~/.cache/uv/              # cache size
du -sh ~/.mempalace/             # data size
```
## Diagnostics

### MCP error -32000: Connection closed

Server crashed on startup. Check:

```bash
uvx --from mempalace python -m mempalace.mcp_server
```
### No solution found: mempalace-mcp-server not found

Incorrect syntax. Use `--from`:

```bash
# Incorrect
uvx mempalace.mcp_server
# Correct
uvx --from mempalace python -m mempalace.mcp_server
```
### First run is slow

This is normal — downloading the package and building the venv. Subsequent runs are fast.
