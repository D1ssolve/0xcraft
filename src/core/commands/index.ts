export {
  type CommandSpec,
  type CommandArgumentSpec,
  commandSpecSchema,
  commandArgumentSpecSchema,
} from "./command-spec";
export { type CommandRegistry, createCommandRegistry } from "./command-registry";
export { builtinCommands, getCommandById } from "./builtin-commands";
