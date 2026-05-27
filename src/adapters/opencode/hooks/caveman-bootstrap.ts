/**
 * Caveman bootstrap hook — injects caveman skill load instruction on first message.
 *
 * Token optimization: only injects on the FIRST user message.
 * The actual skill content is loaded lazily via the skill tool,
 * not injected into every message.
 */
const MARKER = "CAVEMAN_BOOTSTRAP_INJECTED";

export function createCavemanBootstrapHook() {
  return {
    buildBootstrap(): string {
      return `<!-- ${MARKER} -->
<EXTREMELY_IMPORTANT>
Caveman mode must be active for this OpenCode session.

Use the skill tool to load the "caveman" skill IMMEDIATELY — this is not optional. Call the skill tool with name="caveman" right now, before responding to any user message. The caveman skill contains the always-on communication rules that must be applied to every response.

Do NOT load the caveman skill again after this first load — it persists for the entire session.
</EXTREMELY_IMPORTANT>`;
    },
  };
}