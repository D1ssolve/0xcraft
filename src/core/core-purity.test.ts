import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const CORE_DIR = resolve(__dirname);

const IMPORT_RE = /^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

type Violation = { file: string; line: number; importPath: string; reason: string };
type ImportLineViolation = { file: string; line: number; token: string };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function findImports(content: string): { path: string; line: number }[] {
  const results: { path: string; line: number }[] = [];
  const collect = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      results.push({ path: m[1]!, line });
    }
  };
  collect(IMPORT_RE);
  collect(DYNAMIC_IMPORT_RE);
  return results;
}

function checkImport(
  importPath: string,
  fromFile: string,
): { forbidden: true; reason: string } | { forbidden: false } {
  // Bare specifiers
  if (importPath === "@opencode-ai/plugin" || importPath.startsWith("@opencode-ai/plugin/")) {
    return { forbidden: true, reason: "@opencode-ai/plugin not allowed in core" };
  }
  if (importPath === "@opencode-ai/sdk" || importPath.startsWith("@opencode-ai/sdk/")) {
    return { forbidden: true, reason: "@opencode-ai/sdk not allowed in core" };
  }
  if (importPath.startsWith("@anthropic-ai/")) {
    return { forbidden: true, reason: "@anthropic-ai/* not allowed in core" };
  }
  if (importPath === "commander" || importPath.startsWith("commander/")) {
    return { forbidden: true, reason: "commander not allowed in core" };
  }
  if (importPath.includes("/dist/")) {
    return { forbidden: true, reason: "built artifact (/dist/) import not allowed" };
  }

  // Relative paths — resolve against fromFile and check if escapes core
  if (importPath.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), importPath);
    const rel = relative(CORE_DIR, resolved);
    if (rel.startsWith("..") || resolve(rel) === rel) {
      // Escaped core dir
      const lower = resolved.toLowerCase();
      if (lower.includes("/src/adapters/") || lower.includes("/adapters/")) {
        return { forbidden: true, reason: "import escapes into src/adapters/" };
      }
      if (lower.includes("/src/cli/") || lower.endsWith("/cli")) {
        return { forbidden: true, reason: "import escapes into src/cli/" };
      }
      if (lower.includes("/src/converter/") || lower.endsWith("/converter")) {
        return { forbidden: true, reason: "import escapes into src/converter/" };
      }
      return { forbidden: true, reason: "relative import escapes src/core/" };
    }
  }
  return { forbidden: false };
}

const FORBIDDEN_IMPORT_LINE_TOKENS = [
  'from "@opencode-ai/',
  'from "@anthropic-ai/',
  'from "commander"',
  'from "../adapters/',
  'from "../cli/',
  'from "../converter/',
] as const;

function scanFileForForbiddenImportLineTokens(file: string): ImportLineViolation[] {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const violations: ImportLineViolation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i]!.replaceAll("'", '"');
    for (const token of FORBIDDEN_IMPORT_LINE_TOKENS) {
      if (normalized.includes(token)) {
        violations.push({ file, line: i + 1, token });
      }
    }
  }
  return violations;
}

function scanFile(file: string): Violation[] {
  const content = readFileSync(file, "utf8");
  const imports = findImports(content);
  const violations: Violation[] = [];
  for (const { path: p, line } of imports) {
    const r = checkImport(p, file);
    if (r.forbidden) {
      violations.push({ file, line, importPath: p, reason: r.reason });
    }
  }
  return violations;
}

describe("core purity: forbidden import detection (fixtures)", () => {
  const fixtureFile = join(CORE_DIR, "fake.ts");
  const cases: Array<{ name: string; src: string; expectForbidden: boolean }> = [
    {
      name: "@opencode-ai/plugin",
      src: `import { x } from "@opencode-ai/plugin";`,
      expectForbidden: true,
    },
    {
      name: "@opencode-ai/sdk subpath",
      src: `import { x } from "@opencode-ai/sdk/foo";`,
      expectForbidden: true,
    },
    {
      name: "@anthropic-ai package",
      src: `import x from "@anthropic-ai/claude-code";`,
      expectForbidden: true,
    },
    {
      name: "relative ../adapters/",
      src: `import { x } from "../adapters/opencode/foo";`,
      expectForbidden: true,
    },
    {
      name: "relative ../../adapters/",
      src: `export { x } from "../../adapters/foo";`,
      expectForbidden: true,
    },
    {
      name: "relative ../cli/",
      src: `import { x } from "../cli/doctor";`,
      expectForbidden: true,
    },
    {
      name: "dist artifact",
      src: `import x from "some-pkg/dist/index.js";`,
      expectForbidden: true,
    },
    {
      name: "allowed: smol-toml",
      src: `import { parse } from "smol-toml";`,
      expectForbidden: false,
    },
    {
      name: "allowed: yaml",
      src: `import { parse } from "yaml";`,
      expectForbidden: false,
    },
    {
      name: "commander",
      src: `import { Command } from "commander";`,
      expectForbidden: true,
    },
    {
      name: "dynamic adapters import",
      src: `const m = await import("../adapters/foo");`,
      expectForbidden: true,
    },
    {
      name: "allowed: zod",
      src: `import { z } from "zod";`,
      expectForbidden: false,
    },
    {
      name: "allowed: node:fs",
      src: `import { readFileSync } from "node:fs";`,
      expectForbidden: false,
    },
    {
      name: "allowed: bun:test",
      src: `import { test } from "bun:test";`,
      expectForbidden: false,
    },
    {
      name: "allowed: relative within core",
      src: `import { x } from "./config/config-types";`,
      expectForbidden: false,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const imports = findImports(c.src);
      expect(imports.length).toBeGreaterThan(0);
      const anyForbidden = imports.some((i) => checkImport(i.path, fixtureFile).forbidden);
      expect(anyForbidden).toBe(c.expectForbidden);
    });
  }
});

describe("core purity: real scan", () => {
  test("src/core/**/*.ts has zero forbidden imports", () => {
    const selfFile = resolve(__filename);
    const files = walk(CORE_DIR).filter((f) => resolve(f) !== selfFile);
    const all: Violation[] = [];
    for (const f of files) {
      all.push(...scanFile(f));
    }
    if (all.length > 0) {
      const msg = all
        .map((v) => `${relative(CORE_DIR, v.file)}:${v.line}: ${v.importPath} — ${v.reason}`)
        .join("\n");
      console.error("Core purity violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });

  test("src/core/**/*.ts import lines contain no forbidden platform or layer tokens", () => {
    const selfFile = resolve(__filename);
    const files = walk(CORE_DIR).filter((f) => resolve(f) !== selfFile);
    const all: ImportLineViolation[] = [];
    for (const f of files) {
      all.push(...scanFileForForbiddenImportLineTokens(f));
    }
    if (all.length > 0) {
      const msg = all
        .map((v) => `${relative(CORE_DIR, v.file)}:${v.line}: contains ${v.token}`)
        .join("\n");
      console.error("Core forbidden import-line token violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });
});

/**
 * Forbidden exported / referenced names that leak platform-native vocabulary
 * into the harness-agnostic core. Zero matches allowed outside `@deprecated`
 * alias carve-outs (none currently present — this test is the lock).
 *
 * Per ADR §2 and tasks T-0.0 acceptance criteria.
 */
const FORBIDDEN_NAMES = [
  "OpenCodeAgent",
  "OpencodeAgent",
  "ClaudeCodeAgent",
  "CodexAgent",
] as const;

type NameViolation = { file: string; line: number; name: string };

function scanFileForForbiddenNames(file: string): NameViolation[] {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const violations: NameViolation[] = [];
  let inBlockComment = false;
  let blockHasDeprecated = false;
  let prevLineHasDeprecated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inBlockComment) {
      const openIdx = line.indexOf("/*");
      if (openIdx !== -1) {
        inBlockComment = true;
        blockHasDeprecated = line.includes("@deprecated");
      }
    } else if (line.includes("@deprecated")) {
      blockHasDeprecated = true;
    }

    const currentHasDeprecated = line.includes("@deprecated");
    const carveOut =
      currentHasDeprecated ||
      prevLineHasDeprecated ||
      (inBlockComment && blockHasDeprecated);

    for (const name of FORBIDDEN_NAMES) {
      const re = new RegExp(`\\b${name}\\b`);
      if (re.test(line) && !carveOut) {
        violations.push({ file, line: i + 1, name });
      }
    }

    if (inBlockComment && line.includes("*/")) {
      inBlockComment = false;
      blockHasDeprecated = false;
    }
    prevLineHasDeprecated = currentHasDeprecated;
  }
  return violations;
}

describe("core purity: forbidden exported names", () => {
  test("src/core/**/*.ts contains no forbidden platform-native names (outside @deprecated)", () => {
    const selfFile = resolve(__filename);
    const files = walk(CORE_DIR).filter((f) => resolve(f) !== selfFile);
    const all: NameViolation[] = [];
    for (const f of files) {
      all.push(...scanFileForForbiddenNames(f));
    }
    if (all.length > 0) {
      const msg = all
        .map((v) => `${relative(CORE_DIR, v.file)}:${v.line}: ${v.name}`)
        .join("\n");
      console.error("Core forbidden-name violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });

  test("forbidden-name scanner: @deprecated single-line carve-out works", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const osMod = require("node:os") as typeof import("node:os");
    const tmp = join(osMod.tmpdir(), `0xcraft-scan-fixture-1-${process.pid}.ts`);
    try {
      const src = `// @deprecated alias — kept for one migration window\nexport type OpenCodeAgent = unknown;\n`;
      fs.writeFileSync(tmp, src, "utf8");
      const violations = scanFileForForbiddenNames(tmp);
      expect(violations).toEqual([]);
    } finally {
      try {
        require("node:fs").unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  });

  test("forbidden-name scanner: non-deprecated occurrence flagged", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const osMod = require("node:os") as typeof import("node:os");
    const tmp = join(osMod.tmpdir(), `0xcraft-scan-fixture-2-${process.pid}.ts`);
    try {
      const src = `export type OpenCodeAgent = unknown;\n`;
      fs.writeFileSync(tmp, src, "utf8");
      const violations = scanFileForForbiddenNames(tmp);
      expect(violations.length).toBe(1);
      expect(violations[0]!.name).toBe("OpenCodeAgent");
    } finally {
      try {
        require("node:fs").unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  });
});
