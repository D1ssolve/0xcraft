/**
 * Converter purity guard (T-1.9, ADR §3).
 *
 * `src/converter/**` composes core and adapter ports. It must not depend on
 * Commander or import CLI implementation code. During Phase 6 this directory
 * may contain only this test; missing/empty implementation dirs pass cleanly.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const CONVERTER_DIR = resolve(__dirname);
const SRC_DIR = resolve(CONVERTER_DIR, "..");

const IMPORT_RE = /^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

type Violation = { file: string; line: number; importPath: string; reason: string };

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
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
  if (importPath === "commander" || importPath.startsWith("commander/")) {
    return { forbidden: true, reason: "converter must not import commander" };
  }

  if (importPath.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), importPath);
    const rel = relative(SRC_DIR, resolved);
    if (rel === "cli" || rel.startsWith("cli/")) {
      return { forbidden: true, reason: "converter must not import src/cli/" };
    }
  }

  return { forbidden: false };
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

describe("converter purity: fixture cases", () => {
  const fixtureFile = join(CONVERTER_DIR, "fake.ts");

  test("commander import is forbidden", () => {
    expect(checkImport("commander", fixtureFile).forbidden).toBe(true);
  });

  test("relative ../cli import is forbidden", () => {
    expect(checkImport("../cli/build", fixtureFile).forbidden).toBe(true);
  });

  test("relative core and shared adapter imports are allowed", () => {
    expect(checkImport("../core/ir", fixtureFile).forbidden).toBe(false);
    expect(checkImport("../adapters/_shared/artifact", fixtureFile).forbidden).toBe(false);
  });

  test("node and zod imports are allowed", () => {
    expect(checkImport("node:fs", fixtureFile).forbidden).toBe(false);
    expect(checkImport("zod", fixtureFile).forbidden).toBe(false);
  });
});

describe("converter purity: real scan", () => {
  test("src/converter/**/*.ts has zero CLI or commander imports", () => {
    if (!existsSync(CONVERTER_DIR)) {
      expect([]).toEqual([]);
      return;
    }

    const selfFile = resolve(__filename);
    const files = walk(CONVERTER_DIR).filter((f) => resolve(f) !== selfFile);
    const all: Violation[] = [];
    for (const f of files) {
      all.push(...scanFile(f));
    }
    if (all.length > 0) {
      const msg = all
        .map(
          (v) =>
            `${relative(CONVERTER_DIR, v.file)}:${v.line}: ${v.importPath} — ${v.reason}`,
        )
        .join("\n");
      console.error("Converter purity violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });
});
