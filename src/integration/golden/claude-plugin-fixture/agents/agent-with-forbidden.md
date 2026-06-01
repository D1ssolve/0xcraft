---
name: Agent With Forbidden Fields
description: Plugin agent that has fields not allowed in plugin mode
model: claude-opus-4-20250514
permissionMode: acceptEdits
hooks:
  PreToolUse:
    - type: command
      command: echo "hook"
mcpServers:
  - my-server
---
This agent has forbidden plugin fields that should be stripped on emit.
