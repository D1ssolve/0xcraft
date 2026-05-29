import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createPlugin, createPluginHooks, resolvePackageRoot, resolvePluginRoot } from "./index";
import { createCavemanBootstrapHook } from "./hooks/caveman-bootstrap";

type PluginInput = Parameters<typeof createPlugin>[0];

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeLocalConfig(projectRoot: string, config: Record<string, unknown>): void {
  const configDir = path.join(projectRoot, ".opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "0xcraft.json"), JSON.stringify(config));
}

function makePackageRoot(): string {
  const root = makeTempDir("0xcraft-package-");
  fs.mkdirSync(path.join(root, "agents"));
  fs.mkdirSync(path.join(root, "skills"));
  return root;
}

function makeLogger() {
  const events: Array<{ body: { service: string; level: string; message: string; extra: Record<string, unknown> } }> = [];
  return {
    events,
    client: {
      app: {
        log(event: { body: { service: string; level: string; message: string; extra: Record<string, unknown> } }) {
          events.push(event);
        },
      },
    },
  };
}

function makePluginInput(overrides: {
  worktree?: string;
  directory?: string;
  client?: unknown;
}): PluginInput {
  return {
    client: overrides.client,
    project: {},
    directory: overrides.directory ?? process.cwd(),
    worktree: overrides.worktree ?? overrides.directory ?? process.cwd(),
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {},
  } as unknown as PluginInput;
}

async function createIsolatedPlugin(overrides: {
  worktree?: string;
  directory?: string;
  client?: unknown;
}) {
  return createPluginHooks(makePluginInput(overrides), { homeDir: makeTempDir("0xcraft-home-") });
}

describe("OpenCode adapter root resolution", () => {
  test("uses non-empty worktree before directory and logs when they differ", () => {
    const { events, client } = makeLogger();
    const worktree = makeTempDir("0xcraft-worktree-");
    const directory = makeTempDir("0xcraft-directory-");

    const resolved = resolvePluginRoot({ worktree, directory }, client);

    expect(resolved).toBe(path.resolve(worktree));
    expect(events[0]?.body).toEqual({
      service: "0xcraft",
      level: "info",
      message: "OpenCode worktree and directory differ; using worktree.",
      extra: {
        code: "opencode.root.worktree_directory_differ",
        worktree: path.resolve(worktree),
        directory: path.resolve(directory),
      },
    });
  });

  test("uses directory when worktree is missing", () => {
    const { events, client } = makeLogger();
    const directory = makeTempDir("0xcraft-directory-");

    const resolved = resolvePluginRoot({ worktree: "   ", directory }, client);

    expect(resolved).toBe(path.resolve(directory));
    expect(events).toHaveLength(0);
  });

  test("falls back to cwd for invalid roots and logs one warning", () => {
    const { events, client } = makeLogger();

    const resolved = resolvePluginRoot({ worktree: null, directory: 42 }, client);

    expect(resolved).toBe(process.cwd());
    expect(events).toHaveLength(1);
    expect(events[0]?.body.level).toBe("warn");
    expect(events[0]?.body.extra.code).toBe("opencode.root.fallback.cwd");
  });
});

describe("OpenCode adapter package root resolution", () => {
  test("resolves the current repository package root", () => {
    const { events, client } = makeLogger();

    const resolved = resolvePackageRoot({
      startDir: path.dirname(new URL(import.meta.url).pathname),
      cwd: process.cwd(),
      client,
    });

    expect(resolved).toBe(process.cwd());
    expect(events).toHaveLength(0);
  });

  test("logs warning and returns best fallback when assets are missing", () => {
    const { events, client } = makeLogger();
    const startDir = makeTempDir("0xcraft-no-assets-start-");
    const cwd = makeTempDir("0xcraft-no-assets-cwd-");

    const resolved = resolvePackageRoot({ startDir, cwd, client });

    expect(resolved).toBe(startDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.body.level).toBe("warn");
    expect(events[0]?.body.extra.code).toBe("opencode.package_root.not_found");
  });

  test("uses cwd fallback only when it contains package assets", () => {
    const { events, client } = makeLogger();
    const startDir = makeTempDir("0xcraft-start-without-assets-");
    const cwd = makePackageRoot();

    const resolved = resolvePackageRoot({ startDir, cwd, client });

    expect(resolved).toBe(cwd);
    expect(events).toHaveLength(0);
  });
});

describe("createPlugin", () => {
  test("creates hooks without OpenCode client", async () => {
    const hooks = await createIsolatedPlugin({
      worktree: process.cwd(),
      directory: path.join(process.cwd(), "src"),
    });

    expect(hooks.config).toBeFunction();
    expect(hooks["experimental.chat.messages.transform"]).toBeFunction();
  });

  test("config hook reads built-in prompts in normal layout after root selection", async () => {
    const hooks = await createIsolatedPlugin({ worktree: process.cwd() });
    const inputConfig: Record<string, unknown> = {};

    const configHook = hooks.config as (inputConfig: Record<string, unknown>) => Promise<void>;
    await configHook(inputConfig);

    const agents = inputConfig.agent as Record<string, Record<string, unknown>>;
    expect(agents["team-lead"]?.prompt).toContain("# Team Lead");
  });

  test("returns only config hook when all bootstrap hooks are inactive", async () => {
    const projectRoot = makeTempDir("0xcraft-disabled-bootstrap-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "caveman-bootstrap", "git-worktree-bootstrap"] }
    });

    const hooks = await createIsolatedPlugin({ worktree: projectRoot });

    expect(Object.keys(hooks).sort()).toEqual(["config"]);
    expect(hooks.config).toBeFunction();
    expect(hooks["experimental.chat.messages.transform"]).toBeUndefined();
  });

  test("disabledHooks suppresses active bootstrap hook registration", async () => {
    const projectRoot = makeTempDir("0xcraft-disabled-hooks-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "caveman-bootstrap", "git-worktree-bootstrap"] }
    });

    const hooks = await createIsolatedPlugin({ worktree: projectRoot });

    expect(Object.keys(hooks).sort()).toEqual(["config"]);
  });

  test("returns config and transform hooks when at least one bootstrap remains active", async () => {
    const projectRoot = makeTempDir("0xcraft-enabled-combo-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "git-worktree-bootstrap"] }
    });

    const hooks = await createIsolatedPlugin({ worktree: projectRoot });

    expect(Object.keys(hooks).sort()).toEqual(["config", "experimental.chat.messages.transform"]);
    expect(hooks.config).toBeFunction();
    expect(hooks["experimental.chat.messages.transform"]).toBeFunction();
  });

  test("absent AGENTS.md plus caveman enabled prepends expected markers in one text part", async () => {
    const projectRoot = makeTempDir("0xcraft-bootstrap-inject-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["git-worktree-bootstrap"] }
    });
    const hooks = await createIsolatedPlugin({ worktree: projectRoot });
    const transform = hooks["experimental.chat.messages.transform"] as (input: unknown, output: Record<string, unknown>) => Promise<void>;
    const originalImagePart = { type: "image", source: "example.png" };
    const originalTextPart = { type: "text", text: "Original request" };
    const output = {
      messages: [{ info: { role: "user" }, parts: [originalImagePart, originalTextPart] }],
    };

    await transform({}, output);

    const parts = output.messages[0]?.parts;
    const injectedText = parts?.[0]?.type === "text" && "text" in parts[0]
      ? parts[0].text
      : undefined;
    expect(parts).toHaveLength(3);
    expect(parts?.[0]).toMatchObject({ type: "text" });
    expect(injectedText).toContain("AGENTS_GUARD_INJECTED");
    expect(injectedText).toContain("CAVEMAN_BOOTSTRAP_INJECTED");
    expect(injectedText).toContain("\n\n<!-- CAVEMAN_BOOTSTRAP_INJECTED -->");
    expect(parts?.[1]).toBe(originalImagePart);
    expect(parts?.[2]).toBe(originalTextPart);
  });

  test("existing marker in first user text part prevents duplicate injection and preserves order", async () => {
    const projectRoot = makeTempDir("0xcraft-bootstrap-dedupe-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["git-worktree-bootstrap"] }
    });
    const hooks = await createIsolatedPlugin({ worktree: projectRoot });
    const transform = hooks["experimental.chat.messages.transform"] as (input: unknown, output: Record<string, unknown>) => Promise<void>;
    const firstPart = { type: "text", text: "Already has CAVEMAN_BOOTSTRAP_INJECTED" };
    const secondPart = { type: "text", text: "Original request" };
    const output = {
      messages: [{ info: { role: "user" }, parts: [firstPart, secondPart] }],
    };

    await transform({}, output);

    expect(output.messages[0]?.parts).toEqual([firstPart, secondPart]);
  });

  test("marker scan only checks first user message", async () => {
    const projectRoot = makeTempDir("0xcraft-bootstrap-first-user-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "git-worktree-bootstrap"] }
    });
    const hooks = await createIsolatedPlugin({ worktree: projectRoot });
    const transform = hooks["experimental.chat.messages.transform"] as (input: unknown, output: Record<string, unknown>) => Promise<void>;
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "First user request" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "CAVEMAN_BOOTSTRAP_INJECTED later" }] },
      ],
    };

    await transform({}, output);

    expect(output.messages[0]?.parts[0]?.text).toContain("CAVEMAN_BOOTSTRAP_INJECTED");
    expect(output.messages[0]?.parts[1]?.text).toBe("First user request");
  });

  test("malformed transform outputs do not throw", async () => {
    const projectRoot = makeTempDir("0xcraft-bootstrap-malformed-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "git-worktree-bootstrap"] }
    });
    const hooks = await createIsolatedPlugin({ worktree: projectRoot });
    const transform = hooks["experimental.chat.messages.transform"] as (input: unknown, output: unknown) => Promise<void>;

    await expect(transform({}, undefined)).resolves.toBeUndefined();
    await expect(transform({}, null)).resolves.toBeUndefined();
    await expect(transform({}, {})).resolves.toBeUndefined();
    await expect(transform({}, { messages: "bad" })).resolves.toBeUndefined();
    await expect(transform({}, { messages: [{ info: { role: "assistant" }, parts: [] }] })).resolves.toBeUndefined();
    await expect(transform({}, { messages: [{ info: { role: "user" } }] })).resolves.toBeUndefined();
    await expect(transform({}, { messages: [{ info: { role: "user" }, parts: "bad" }] })).resolves.toBeUndefined();
  });

  test("root diagnostics flow through mock logger during plugin creation", async () => {
    const { events, client } = makeLogger();
    const worktree = makeTempDir("0xcraft-root-diag-worktree-");
    const directory = makeTempDir("0xcraft-root-diag-directory-");
    writeLocalConfig(worktree, {
      disabled: { hooks: ["agents-guard", "caveman-bootstrap", "git-worktree-bootstrap"] }
    });

    const hooks = await createIsolatedPlugin({ worktree, directory, client });

    expect(hooks.config).toBeFunction();
    expect(events.some((event) => event.body.extra.code === "opencode.root.worktree_directory_differ")).toBe(true);
  });

  test("logger failure does not prevent returned hooks", async () => {
    const projectRoot = makeTempDir("0xcraft-logger-failure-");
    writeLocalConfig(projectRoot, {
      disabled: { hooks: ["agents-guard", "caveman-bootstrap", "git-worktree-bootstrap"] }
    });
    const client = { app: { log() { throw new Error("sink failed"); } } };

    const hooks = await createIsolatedPlugin({
      worktree: projectRoot,
      directory: path.join(projectRoot, "nested"),
      client,
    });

    expect(Object.keys(hooks).sort()).toEqual(["config"]);
    expect(hooks.config).toBeFunction();
  });

  test("caveman bootstrap marker remains stable for manual transform verification", () => {
    expect(createCavemanBootstrapHook().buildBootstrap()).toContain("CAVEMAN_BOOTSTRAP_INJECTED");
  });
});
