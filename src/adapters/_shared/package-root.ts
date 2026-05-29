/**
 * Resolves the 0xcraft package root by walking parents from `startDir`
 * looking for a directory that contains both `agents/` and `skills/`
 * sibling directories.
 *
 * Falls back to `cwd` if found; else falls back to `startDir`.
 *
 * Shared utility used by all adapters so they don't duplicate this
 * traversal logic.
 */

import fs from "node:fs";
import path from "node:path";

export interface ResolvePackageRootOptions {
  startDir?: string;
  cwd?: string;
}

const MAX_HOPS = 10;

export function resolvePackageRoot(options: ResolvePackageRootOptions = {}): string {
  const startDir = path.resolve(options.startDir ?? process.cwd());
  const cwd = path.resolve(options.cwd ?? process.cwd());

  let current = startDir;
  for (let i = 0; i < MAX_HOPS; i++) {
    if (hasPackageAssets(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (hasPackageAssets(cwd)) return cwd;
  return startDir;
}

export function hasPackageAssets(root: string): boolean {
  return fs.existsSync(path.join(root, "agents")) && fs.existsSync(path.join(root, "skills"));
}
