import path from "path";
import fs from "fs";

/**
 * Agents Guard hook — checks for AGENTS.md on first message.
 *
 * Token optimization: only injects on the FIRST user message of a session.
 * The injected text is minimal — just enough to trigger the codebase-indexer
 * agent. The full agent prompt lives in the agent definition, not in the
 * injected text.
 */
const MARKER = "AGENTS_GUARD_INJECTED";

export function createAgentsGuardHook(args: { projectRoot: string }) {
  const { projectRoot } = args;

  return {
    buildBootstrap(): string | null {
      // Check if AGENTS.md exists — if it does, no injection needed
      const agentsPath = path.join(projectRoot, "AGENTS.md");
      if (fs.existsSync(agentsPath)) return null;

      return `<!-- ${MARKER} -->
<EXTREMELY_IMPORTANT>
AGENTS.md is missing from the project root (${projectRoot}).

You MUST run the codebase-indexer agent NOW, before doing anything else.
Do NOT start on the user's request until AGENTS.md has been written to disk.

Steps:
1. Invoke the \`codebase-indexer\` agent for this project (root: ${projectRoot}).
2. Wait until it writes AGENTS.md.
3. Read AGENTS.md.
4. Then fulfill the user's original request using the conventions documented there.
</EXTREMELY_IMPORTANT>`;
    },
  };
}