/**
 * Cross-adapter purity guard (T-1.9, ADR §3).
 *
 * Each v3 adapter (`opencode/`, `claude/`, `codex/`) may import from `core/`
 * and `_shared/` — never from a sibling adapter. Empty placeholder adapter dirs
 * are skipped during early phases.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ADAPTERS_DIR = resolve(__dirname);
const SIBLINGS = ["opencode", "claude", "codex"] as const;
type Adapter = (typeof SIBLINGS)[number];

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

function adapterOf(file: string): Adapter | null {
  const rel = relative(ADAPTERS_DIR, file);
  const first = rel.split("/")[0];
  if (first === "opencode" || first === "claude" || first === "codex") {
    return first;
  }
  return null;
}

function checkImport(
  importPath: string,
  fromFile: string,
  owner: Adapter,
): { forbidden: true; reason: string } | { forbidden: false } {
  // v3 adapters are filesystem emit/import adapters. No OpenCode runtime SDKs.
  if (importPath === "@opencode-ai/plugin" || importPath.startsWith("@opencode-ai/")) {
    return {
      forbidden: true,
      reason: `${owner} adapter must not import @opencode-ai/*`,
    };
  }
  if (owner !== "claude") {
    if (importPath.startsWith("@anthropic-ai/")) {
      return {
        forbidden: true,
        reason: `${owner} adapter must not import @anthropic-ai/*`,
      };
    }
  }

  // Relative path: resolve and check sibling.
  if (importPath.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), importPath);
    const rel = relative(ADAPTERS_DIR, resolved);
    if (rel.startsWith("..") || resolve(rel) === rel) {
      // Escapes adapters/ entirely — allowed only into core (handled by core-purity).
      return { forbidden: false };
    }
    const first = rel.split("/")[0];
    if (
      (first === "opencode" || first === "claude" || first === "codex") &&
      first !== owner
    ) {
      return {
        forbidden: true,
        reason: `${owner} adapter must not import sibling adapter '${first}'`,
      };
    }
  }
  return { forbidden: false };
}

function scanFile(file: string, owner: Adapter): Violation[] {
  const content = readFileSync(file, "utf8");
  const imports = findImports(content);
  const violations: Violation[] = [];
  for (const { path: p, line } of imports) {
    const r = checkImport(p, file, owner);
    if (r.forbidden) {
      violations.push({ file, line, importPath: p, reason: r.reason });
    }
  }
  return violations;
}

describe("cross-adapter purity: fixture cases", () => {
  const fixtureCodex = join(ADAPTERS_DIR, "codex", "fake.ts");
  const fixtureOpencode = join(ADAPTERS_DIR, "opencode", "fake.ts");
  const fixtureClaude = join(ADAPTERS_DIR, "claude", "fake.ts");

  test("codex importing relative ../opencode/ is forbidden", () => {
    const r = checkImport("../opencode/index", fixtureCodex, "codex");
    expect(r.forbidden).toBe(true);
  });

  test("claude importing relative ../codex/ is forbidden", () => {
    const r = checkImport("../codex/index", fixtureClaude, "claude");
    expect(r.forbidden).toBe(true);
  });

  test("opencode importing relative ../claude/ is forbidden", () => {
    const r = checkImport("../claude/index", fixtureOpencode, "opencode");
    expect(r.forbidden).toBe(true);
  });

  test("codex importing @opencode-ai/plugin is forbidden", () => {
    const r = checkImport("@opencode-ai/plugin", fixtureCodex, "codex");
    expect(r.forbidden).toBe(true);
  });

  test("claude importing @opencode-ai/sdk is forbidden", () => {
    const r = checkImport("@opencode-ai/sdk", fixtureClaude, "claude");
    expect(r.forbidden).toBe(true);
  });

  test("codex importing @anthropic-ai/* is forbidden", () => {
    const r = checkImport("@anthropic-ai/claude-code", fixtureCodex, "codex");
    expect(r.forbidden).toBe(true);
  });

  test("opencode importing @opencode-ai/plugin is forbidden in v3", () => {
    const r = checkImport("@opencode-ai/plugin", fixtureOpencode, "opencode");
    expect(r.forbidden).toBe(true);
  });

  test("any adapter importing relative ../_shared/ is allowed", () => {
    expect(checkImport("../_shared/diagnostic", fixtureCodex, "codex").forbidden).toBe(false);
    expect(checkImport("../_shared/frontmatter", fixtureClaude, "claude").forbidden).toBe(
      false,
    );
    expect(
      checkImport("../_shared/package-root", fixtureOpencode, "opencode").forbidden,
    ).toBe(false);
  });

  test("any adapter importing relative ../../core/ is allowed", () => {
    expect(checkImport("../../core/agents", fixtureCodex, "codex").forbidden).toBe(false);
    expect(checkImport("../../core/config", fixtureOpencode, "opencode").forbidden).toBe(false);
  });

  test("within-adapter relative imports are allowed", () => {
    expect(checkImport("./filesystem", fixtureCodex, "codex").forbidden).toBe(false);
    expect(checkImport("./hooks/foo", fixtureOpencode, "opencode").forbidden).toBe(false);
  });
});

describe("cross-adapter purity: real scan", () => {
  test("src/adapters/{opencode,claude,codex}/**/*.ts has zero sibling imports", () => {
    const selfFile = resolve(__filename);
    const all: Violation[] = [];
    for (const owner of SIBLINGS) {
      const ownerDir = join(ADAPTERS_DIR, owner);
      // Phase 0: adapter dirs may be empty placeholders. Skip non-existent.
      let dirExists = false;
      try {
        dirExists = statSync(ownerDir).isDirectory();
      } catch {
        dirExists = false;
      }
      if (!dirExists) continue;
      const files = walk(ownerDir).filter((f) => resolve(f) !== selfFile);
      for (const f of files) {
        all.push(...scanFile(f, owner));
      }
    }
    if (all.length > 0) {
      const msg = all
        .map(
          (v) =>
            `${relative(ADAPTERS_DIR, v.file)}:${v.line}: ${v.importPath} — ${v.reason}`,
        )
        .join("\n");
      console.error("Cross-adapter purity violations:\n" + msg);
    }
    expect(all).toEqual([]);
  });

  /**
   * T-9.2 — literal substring scan.
   *
   * Defence-in-depth on top of the import-AST scan above: catches sibling
   * adapter references that hide in string literals, JSDoc, script paths,
   * etc. — anywhere a leaky vocabulary could survive a refactor.
   */
  test("no per-adapter source file mentions a sibling adapter path substring", () => {
    const selfFile = resolve(__filename);
    type SubstringViolation = {
      file: string;
      line: number;
      forbiddenSubstring: string;
      excerpt: string;
    };
    const violations: SubstringViolation[] = [];

    for (const owner of SIBLINGS) {
      const ownerDir = join(ADAPTERS_DIR, owner);
      let dirExists = false;
      try {
        dirExists = statSync(ownerDir).isDirectory();
      } catch {
        dirExists = false;
      }
      if (!dirExists) continue;
      const files = walk(ownerDir).filter((f) => resolve(f) !== selfFile);
      const forbiddenSubstrings = SIBLINGS
        .filter((s) => s !== owner)
        .map((s) => `adapters/${s}`);
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          for (const sub of forbiddenSubstrings) {
            if (line.includes(sub)) {
              violations.push({
                file,
                line: i + 1,
                forbiddenSubstring: sub,
                excerpt: line.trim().slice(0, 120),
              });
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(
          (v) =>
            `${relative(ADAPTERS_DIR, v.file)}:${v.line}: contains "${v.forbiddenSubstring}" — ${v.excerpt}`,
        )
        .join("\n");
      console.error("Cross-adapter substring violations:\n" + msg);
    }
    expect(violations).toEqual([]);
  });
});
