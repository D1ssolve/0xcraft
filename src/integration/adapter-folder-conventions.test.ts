import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  CLAUDE_CODE_MATRIX,
  CODEX_MATRIX,
  OPENCODE_MATRIX,
  type PlatformCapabilityMatrix,
} from "../adapters/_shared/capability-matrix";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const ADAPTERS_DIR = join(REPO_ROOT, "src", "adapters");

const ADAPTERS = ["opencode", "claude-code", "codex"] as const;
type Adapter = (typeof ADAPTERS)[number];

const FILESYSTEM_ADAPTERS = ["claude-code", "codex"] as const;

const MATRIX_BY_ADAPTER: Record<Adapter, PlatformCapabilityMatrix> = {
  opencode: OPENCODE_MATRIX,
  "claude-code": CLAUDE_CODE_MATRIX,
  codex: CODEX_MATRIX,
};

const MATRIX_PREFIX_TO_MAPPER = {
  agents: "agents.ts",
  skills: "skills.ts",
  hooks: "hooks.ts",
  mcp: "mcp.ts",
  permissions: "permissions.ts",
  commands: "commands.ts",
} as const;

function adapterDir(adapter: Adapter): string {
  return join(ADAPTERS_DIR, adapter);
}

function mappersDir(adapter: Adapter): string {
  return join(adapterDir(adapter), "mappers");
}

function emittersDir(adapter: (typeof FILESYSTEM_ADAPTERS)[number]): string {
  return join(adapterDir(adapter), "emitters");
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function listTsFiles(dir: string): string[] {
  if (!isDirectory(dir)) {
    return [];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((entry) => isFile(entry) && entry.endsWith(".ts"))
    .sort();
}

function listSourceTsFiles(dir: string): string[] {
  return listTsFiles(dir).filter((file) => !basename(file).endsWith(".test.ts"));
}

function walkTsFiles(dir: string): string[] {
  if (!isDirectory(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
    } else if (stat.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function relativeToRepo(path: string): string {
  return relative(REPO_ROOT, path);
}

function findMapperSuffixVariants(adapter: Adapter): string[] {
  return listSourceTsFiles(mappersDir(adapter))
    .filter((file) => basename(file).endsWith("-mapper.ts"))
    .map(relativeToRepo);
}

function findNonNounMapperFiles(adapter: Adapter): string[] {
  return listSourceTsFiles(mappersDir(adapter))
    .filter((file) => !/^[a-z][a-z0-9]*\.ts$/.test(basename(file)))
    .map(relativeToRepo);
}

function expectedMapperFilesForMatrix(matrix: PlatformCapabilityMatrix): string[] {
  const expected = new Set<string>();

  for (const [feature, cell] of Object.entries(matrix)) {
    if (cell.status === "drop-warn") {
      continue;
    }

    const prefix = feature.split(".")[0] as keyof typeof MATRIX_PREFIX_TO_MAPPER;
    const mapperFile = MATRIX_PREFIX_TO_MAPPER[prefix];
    if (mapperFile) {
      expected.add(mapperFile);
    }
  }

  return [...expected].sort();
}

function findMissingMatrixDrivenMapperFiles(adapter: Adapter): string[] {
  const dir = mappersDir(adapter);
  return expectedMapperFilesForMatrix(MATRIX_BY_ADAPTER[adapter])
    .filter((file) => !isFile(join(dir, file)))
    .map((file) => relativeToRepo(join(dir, file)));
}

function findMapperFilesWithoutExports(adapter: Adapter): string[] {
  return listSourceTsFiles(mappersDir(adapter))
    .filter((file) => !/^export\b/m.test(readFileSync(file, "utf8")))
    .map(relativeToRepo);
}

function findRootEmitterFiles(adapter: "codex"): string[] {
  return listSourceTsFiles(adapterDir(adapter))
    .filter((file) => basename(file).endsWith("-emitter.ts"))
    .map(relativeToRepo);
}

function findStubMapperFiles(adapterDirPath: string): string[] {
  return listSourceTsFiles(join(adapterDirPath, "mappers"))
    .filter((file) => readFileSync(file, "utf8").trim().length < 40)
    .map(relativeToRepo);
}

describe("adapter folder conventions", () => {
  test("each adapter has a mappers directory", () => {
    for (const adapter of ADAPTERS) {
      expect(isDirectory(mappersDir(adapter)), `${adapter} mappers directory`).toBe(true);
    }
  });

  test("opencode mapper files use no -mapper.ts suffix variants", () => {
    expect(findMapperSuffixVariants("opencode")).toEqual([]);
  });

  test("existing mapper source files export at least one named binding", () => {
    for (const adapter of ADAPTERS) {
      expect(findMapperFilesWithoutExports(adapter), `${adapter} mapper files without export`).toEqual([]);
    }
  });

  test("opencode has runtime directory and filesystem adapters do not", () => {
    expect(isDirectory(join(adapterDir("opencode"), "runtime"))).toBe(true);
    expect(isDirectory(join(adapterDir("claude-code"), "runtime"))).toBe(false);
    expect(isDirectory(join(adapterDir("codex"), "runtime"))).toBe(false);
  });

  test("adapter source files exist for cross-import sanity scan coverage", () => {
    for (const adapter of ADAPTERS) {
      expect(walkTsFiles(adapterDir(adapter)).length, `${adapter} TypeScript files`).toBeGreaterThan(0);
    }
  });

  test.todo("all adapter mapper files use plain domain noun filenames", () => {
    const violations = ADAPTERS.flatMap(findNonNounMapperFiles);
    expect(violations).toEqual([]);
  });

  test.todo("codex mapper files exist for every non-drop-warn matrix concern", () => {
    expect(findMissingMatrixDrivenMapperFiles("codex")).toEqual([]);
  });

  test.todo("claude-code mapper files exist for every non-drop-warn matrix concern", () => {
    expect(findMissingMatrixDrivenMapperFiles("claude-code")).toEqual([]);
  });

  test.todo("codex emitters directory exists", () => {
    expect(isDirectory(emittersDir("codex"))).toBe(true);
  });

  test.todo("claude-code emitters directory exists", () => {
    expect(isDirectory(emittersDir("claude-code"))).toBe(true);
  });

  test.todo("codex has no root-level *-emitter.ts files", () => {
    expect(findRootEmitterFiles("codex")).toEqual([]);
  });

  test.todo("claude-code has no generators directory", () => {
    expect(isDirectory(join(adapterDir("claude-code"), "generators"))).toBe(false);
  });

  test.todo("shared toml emitter moved out of _shared", () => {
    expect(isFile(join(ADAPTERS_DIR, "_shared", "toml-emitter.ts"))).toBe(false);
  });

  test.todo("codex internal toml emitter exists", () => {
    expect(isFile(join(adapterDir("codex"), "_internal", "toml-emitter.ts"))).toBe(true);
  });

  test.todo("no empty or stub mapper source files exist", () => {
    const stubs = ADAPTERS.flatMap((adapter) => findStubMapperFiles(adapterDir(adapter)));
    expect(stubs).toEqual([]);
  });
});
