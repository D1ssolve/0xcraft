/**
 * Built-in commands.
 *
 * Empty for Batch 1; populated in later batches as commands are
 * added. The empty array is the canonical initial state.
 */
import type { CommandSpec } from "./command-spec";

export const builtinCommands: CommandSpec[] = [];

export function getCommandById(id: string): CommandSpec | undefined {
  return builtinCommands.find((c) => c.id === id);
}
