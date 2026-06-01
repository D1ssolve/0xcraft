import { basename } from "node:path";

export type SourceMap = Record<string, string>;

export interface SourceTracker {
  record(path: string, origin: string): void;
  recordObject(prefix: string, value: Record<string, unknown>, origin: string): void;
  sources(): SourceMap;
}

export function createSourceTracker(): SourceTracker {
  const map: SourceMap = {};

  return {
    record(path: string, origin: string): void {
      map[path] = origin;
    },
    recordObject(prefix: string, value: Record<string, unknown>, origin: string): void {
      Object.assign(map, flattenSourceMap(prefix, value, origin));
    },
    sources(): SourceMap {
      return { ...map };
    },
  };
}

export function basenameOrigin(file: string): string {
  return basename(file);
}

export function flattenSourceMap(prefix: string, value: Record<string, unknown>, origin: string): SourceMap {
  const map: SourceMap = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (isPlainRecord(nestedValue)) {
      Object.assign(map, flattenSourceMap(path, nestedValue, origin));
      continue;
    }

    map[path] = origin;
  }

  return map;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
