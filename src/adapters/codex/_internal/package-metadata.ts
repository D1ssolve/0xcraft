/**
 * package.json reader for the Codex `.codex-plugin/plugin.json` manifest
 * mapper. Mirrors the sibling Claude Code reader so both adapters agree
 * on field extraction, but lives privately under `codex/_internal/`
 * to keep the cross-adapter import rule clean.
 *
 * Returns a `name`-only fallback when `package.json` is missing or
 * unparsable, and pushes a `codex.package_json.{missing,invalid}`
 * diagnostic onto the collector.
 */

import fs from "node:fs";
import path from "node:path";

import type { DiagnosticCollector } from "../../_shared/diagnostic-collector";

import type { CodexPluginManifestPackageMetadata } from "../mappers/plugin";

export function readCodexPackageMetadata(
  packageRoot: string,
  collector: DiagnosticCollector,
): CodexPluginManifestPackageMetadata {
  const fallback: CodexPluginManifestPackageMetadata = { name: "0xcraft" };
  const packageJsonPath = path.join(packageRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    collector.warn(
      "codex.package_json.missing",
      "package.json was not found; using fallback Codex plugin metadata.",
      { packageRoot },
    );
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
    return {
      name: stringValue(parsed.name) ?? fallback.name,
      ...optional("version", stringValue(parsed.version)),
      ...optional("description", stringValue(parsed.description)),
      ...optional("author", typeof parsed.author === "string" ? parsed.author : undefined),
      ...optional("homepage", stringValue(parsed.homepage)),
      ...optional("repository", readRepository(parsed.repository)),
      ...optional("license", stringValue(parsed.license)),
      ...(Array.isArray(parsed.keywords)
        ? { keywords: parsed.keywords.filter((v): v is string => typeof v === "string") }
        : {}),
    };
  } catch (err) {
    collector.warn(
      "codex.package_json.invalid",
      `package.json could not be parsed; using fallback Codex plugin metadata: ${(err as Error).message}`,
      { packageRoot },
    );
    return fallback;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRepository(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return undefined;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, string>>);
}
