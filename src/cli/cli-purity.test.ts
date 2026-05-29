/**
 * CLI purity guard (T-0.0, ADR §3).
 *
 * `src/cli/**` must remain platform-SDK-free: it composes core + adapters into
 * commander commands. Direct imports of `@opencode-ai/*` or `@anthropic-ai/*`
 * are forbidden — CLI talks to platforms through the adapter ports only.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const CLI_DIR = resolve(__dirname);

const IMPORT_RE = /^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

type Violation = { file: string; line: number; importPath: string; reason: string };

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
): { forbidden: true; reason: string } | { forbidden: false } {
  if (importPath === "@opencode-ai/plugin" || importPath.startsWith("@opencode-ai/")) {
    return { forbidden: true, reason: "CLI must not import @opencode-ai/* directly" };
  }
  if (importPath.startsWith("@anthropic-ai/")) {
    return { forbidden: true, reason: "CLI must not import @anthropic-ai/* directly" };
  }
  return { forbidden: false };
}

function scanFile(file: string): Violation[] {
  const content = readFileSync(file, "utf8");
  const imports = findImports(content);
  const violations: Violation[] = [];
  for (const { path: p, line } of imports) {
    const r = checkImport(p);
    if (r.forbidden) {
      violations.push({ file, line, importPath: p, reason: r.reason });
    }
  }
  return violations;
}

describe("cli purity: fixture cases", () => {
  test("@opencode-ai/plugin is forbidden", () => {
    expect(checkImport("@opencode-ai/plugin").forbidden).toBe(true);
  });
  test("@opencode-ai/sdk is forbidden", () => {
    expect(checkImport("@opencode-ai/sdk").forbidden).toBe(true);
  });
  test("@anthropic-ai/claude-code is forbidden", () => {
    expect(checkImport("@anthropic-ai/claude-code").forbidden).toBe(true);
  });
  test("commander is allowed", () => {
    expect(checkImport("commander").forbidden).toBe(false);
  });
  test("relative core / adapter imports are allowed", () => {
    expect(checkImport("../core/config/config-loader").forbidden).toBe(false);
    expect(checkImport("../adapters/codex").forbidden).toBe(false);
    expect(checkImport("./_shared").forbidden).toBe(false);
  });
});

describe("cli purity: real scan", () => {
  test("src/cli/**/*.ts has zero direct platform-SDK imports", () => {
    const selfFile = resolve(__filename);
    const files = walk(CLI_DIR).filter((f) => resolve(f) !== selfFile);
    const all: Violation[] = [];
    for (const f of files) {
      all.push(...scanFile(f));
    }
    if (all.length > 0) {
      const msg = all
        .map((v) => `${relative(CLI_DIR, v.file)}:${v.line}: ${v.importPath} — ${v.reason}`)
        .join("\n");
      console.error("CLI purity violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });
});
