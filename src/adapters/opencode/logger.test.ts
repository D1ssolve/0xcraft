import { describe, expect, test } from "bun:test";
import { createOpenCodeLogger } from "./logger";

describe("createOpenCodeLogger", () => {
  test("sends structured diagnostics through OpenCode app log", () => {
    const events: unknown[] = [];
    const logger = createOpenCodeLogger({
      client: {
        app: {
          log(event: unknown) {
            events.push(event);
          },
        },
      },
    });

    logger.log({
      level: "debug",
      code: "opencode.root.worktree_directory_differ",
      message: "OpenCode worktree and directory differ; using worktree.",
      extra: { worktree: "/repo", directory: "/repo/sub" },
    });

    expect(events).toEqual([
      {
        body: {
          service: "0xcraft",
          level: "debug",
          message: "OpenCode worktree and directory differ; using worktree.",
          extra: {
            code: "opencode.root.worktree_directory_differ",
            worktree: "/repo",
            directory: "/repo/sub",
          },
        },
      },
    ]);
  });

  test("does not throw when OpenCode log sink throws", () => {
    const logger = createOpenCodeLogger({
      client: {
        app: {
          log() {
            throw new Error("sink failed");
          },
        },
      },
    });

    expect(() => logger.log({
      level: "warn",
      code: "opencode.root.fallback.cwd",
      message: "OpenCode root missing; using process.cwd().",
    })).not.toThrow();
  });

  test("does not throw when OpenCode log sink rejects", async () => {
    const logger = createOpenCodeLogger({
      client: {
        app: {
          log() {
            return Promise.reject(new Error("sink failed"));
          },
        },
      },
    });

    logger.log({
      level: "error",
      code: "opencode.package_root.not_found",
      message: "Unable to resolve package root.",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
