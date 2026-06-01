import fs from "node:fs";
import path from "node:path";

import { PackManifest, PackResourceKind } from "../../../core/pack/pack-schema";
import type { DiagnosticCode } from "../../../core/diagnostics/codes";
import type { ResourceKind } from "../../../core/loader/file-loader";

export type ResolvedPackResource = {
  id: string;
  sourcePath: string;
  kind: ResourceKind;
};

const PACK_KIND_MAP: Record<PackResourceKind, ResourceKind> = {
  agents: "agent",
  skills: "skill",
  hooks: "hook",
  mcp: "mcp",
  commands: "command",
};

type PackageJson = {
  name?: string;
  version?: string;
};

const resolvedResourceOwners = new Map<string, string>();

export function resolvePackResources(
  packName: string,
  nodeModulesDir: string,
  declaredVersion?: string,
): ResolvedPackResource[] {
  const packDir = path.join(nodeModulesDir, ...packName.split("/"));
  assertDirectory(packDir, `Pack directory not found: ${packName}`);

  const packageJson = readPackageJson(packDir, packName);
  if (declaredVersion !== undefined && packageJson.version !== declaredVersion) {
    throw codedError(
      "WARN_PACK_VERSION_DRIFT",
      `Pack version drift: ${packName} installed ${packageJson.version ?? "unknown"}, configured ${declaredVersion}`,
    );
  }

  const manifestPath = path.join(packDir, "0xcraft-pack.json");
  assertFile(manifestPath, `Pack manifest not found: ${packName}/0xcraft-pack.json`);
  const manifest = PackManifest.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));

  const shortName = packShortName(packName);
  const resources = collectManifestResources(packDir, manifest, shortName);
  registerResolvedResources(packName, resources);

  return resources;
}

export function resetPackResolverStateForTests(): void {
  resolvedResourceOwners.clear();
}

function collectManifestResources(packDir: string, manifest: PackManifest, shortName: string): ResolvedPackResource[] {
  const resources: ResolvedPackResource[] = [];
  const seenIds = new Set<string>();

  for (const kind of PackResourceKind.options) {
    const patterns = manifest.resources[kind];
    if (patterns === undefined) {
      continue;
    }

    for (const pattern of patterns) {
      for (const resource of collectPatternResources(packDir, kind, pattern, shortName)) {
        if (seenIds.has(resource.id)) {
          throw codedError("ERR_PACK_ID_CONFLICT", `Duplicate pack resource id: ${resource.id}`);
        }
        seenIds.add(resource.id);
        resources.push(resource);
      }
    }
  }

  return resources.sort((left, right) => left.id.localeCompare(right.id));
}

function collectPatternResources(
  packDir: string,
  kind: PackResourceKind,
  pattern: string,
  shortName: string,
): ResolvedPackResource[] {
  const resourceRoot = resourceRootFromPattern(packDir, kind, pattern);
  if (!fs.existsSync(resourceRoot)) {
    return [];
  }

  const ids = new Set<string>();
  for (const filePath of walkFiles(resourceRoot)) {
    const relative = path.relative(resourceRoot, filePath);
    const [resourceId] = relative.split(path.sep);
    if (resourceId !== undefined && resourceId.length > 0) {
      ids.add(resourceId);
    }
  }

  return [...ids].sort().map((resourceId) => ({
    id: `${shortName}/${resourceId}`,
    sourcePath: path.join(resourceRoot, resourceId),
    kind: PACK_KIND_MAP[kind],
  }));
}

function resourceRootFromPattern(packDir: string, kind: PackResourceKind, pattern: string): string {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const globIndex = normalizedPattern.indexOf("/**");
  const basePattern = globIndex === -1 ? normalizedPattern : normalizedPattern.slice(0, globIndex);
  const baseSegments = basePattern.split("/").filter(Boolean);

  if (baseSegments.length === 0) {
    return path.join(packDir, kind);
  }

  return path.join(packDir, ...baseSegments);
}

function registerResolvedResources(packName: string, resources: ResolvedPackResource[]): void {
  for (const resource of resources) {
    const owner = resolvedResourceOwners.get(resource.id);
    if (owner !== undefined && owner !== packName) {
      throw codedError(
        "ERR_PACK_ID_CONFLICT",
        `Pack resource id conflict: ${resource.id} resolved by both ${owner} and ${packName}`,
      );
    }
  }

  for (const resource of resources) {
    resolvedResourceOwners.set(resource.id, packName);
  }
}

function readPackageJson(packDir: string, packName: string): PackageJson {
  const packageJsonPath = path.join(packDir, "package.json");
  assertFile(packageJsonPath, `Pack package.json not found: ${packName}/package.json`);
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function packShortName(packName: string): string {
  const segments = packName.split("/").filter(Boolean);
  return segments.at(-1) ?? packName;
}

function assertDirectory(directoryPath: string, message: string): void {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(message);
  }
}

function assertFile(filePath: string, message: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(message);
  }
}

function codedError(code: DiagnosticCode, message: string): Error & { code: DiagnosticCode } {
  const error = new Error(message) as Error & { code: DiagnosticCode };
  error.code = code;
  return error;
}
