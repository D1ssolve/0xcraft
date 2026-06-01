/**
 * Command registry — harness-agnostic.
 *
 * Pure data + lookup helpers. Adapters consume the registry to emit
 * platform-native slash commands.
 */

import type { CommandSpec } from "./command-spec";

export interface CommandRegistry {
  list(): CommandSpec[];
  get(id: string): CommandSpec | undefined;
  add(command: CommandSpec): void;
}

/**
 * Create a fresh in-memory command registry, optionally seeded with
 * an initial command list.
 */
export function createCommandRegistry(initial: CommandSpec[] = []): CommandRegistry {
  const byId = new Map<string, CommandSpec>();
  for (const c of initial) {
    byId.set(c.id, c);
  }
  return {
    list(): CommandSpec[] {
      return Array.from(byId.values());
    },
    get(id: string): CommandSpec | undefined {
      return byId.get(id);
    },
    add(command: CommandSpec): void {
      byId.set(command.id, command);
    },
  };
}
