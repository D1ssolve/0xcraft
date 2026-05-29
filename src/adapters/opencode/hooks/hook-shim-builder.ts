import type { HookSpec } from "../../../core/hooks";
import { buildBootstrapByHookId } from "../../_shared/bootstrap-text";

/**
 * Local structural type for the OpenCode
 * `experimental.chat.messages.transform` handler. We deliberately do
 * NOT import `Hooks` from `@opencode-ai/plugin` here — the canonical
 * seam for that runtime type is `runtime/hook-bridge.ts`. Keeping the
 * shim builder structurally typed lets it stay out of the
 * `@opencode-ai/plugin` import graph (per AGENTS.md layer rules).
 *
 * Shape matches `Hooks["experimental.chat.messages.transform"]` in
 * `@opencode-ai/plugin@1.15.x`: an async function taking `(input,
 * output)` and mutating `output.messages` in place (no return value).
 */
export type ChatMessagesTransform = (
  input: unknown,
  output: unknown,
) => Promise<void>;

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface OcMessage {
  info?: { role?: string; [key: string]: unknown };
  parts?: MessagePart[];
  [key: string]: unknown;
}

interface TransformOutput {
  messages?: OcMessage[];
  [key: string]: unknown;
}

const KNOWN_MARKER_TOKENS = [
  "AGENTS_GUARD_INJECTED",
  "CAVEMAN_BOOTSTRAP_INJECTED",
  "GIT_WORKTREE_BOOTSTRAP_INJECTED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Build the OpenCode `experimental.chat.messages.transform` handler that
 * prepends bootstrap text from any enabled hooks to the first user
 * message on session start.
 *
 * Pure factory: holds no state. Each invocation of the returned
 * handler builds bootstrap text fresh by calling
 * `buildBootstrapByHookId` for every enabled hook.
 *
 * Marker guard: if the first user message already contains any of the
 * known marker comments, the handler is a no-op (prevents double
 * injection across re-rendered turns).
 */
export function createHookTransform(args: {
  hooks: HookSpec[];
  projectRoot: string;
}): ChatMessagesTransform {
  const { hooks, projectRoot } = args;

  return async (_input: unknown, output: unknown) => {
    if (!isRecord(output)) return;
    const messages = (output as TransformOutput).messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    const firstUser = messages.find(
      (m): m is OcMessage => isRecord(m) && isRecord(m.info) && m.info.role === "user",
    );
    if (!firstUser) return;
    if (!Array.isArray(firstUser.parts) || firstUser.parts.length === 0) return;

    const alreadyInjected = firstUser.parts.some(
      (p) =>
        isRecord(p) &&
        p.type === "text" &&
        typeof p.text === "string" &&
        KNOWN_MARKER_TOKENS.some((token) => (p.text as string).includes(token)),
    );
    if (alreadyInjected) return;

    const bootstrapParts: string[] = [];
    for (const hook of hooks) {
      const payload = buildBootstrapByHookId(hook.id, { projectRoot, platform: "opencode" });
      if (payload?.text) bootstrapParts.push(payload.text);
    }

    if (bootstrapParts.length === 0) return;

    const combinedBootstrap = bootstrapParts.join("\n\n");
    const referencePart = firstUser.parts[0];
    const basePart = isRecord(referencePart) ? referencePart : {};
    firstUser.parts.unshift({ ...basePart, type: "text", text: combinedBootstrap });
  };
}
