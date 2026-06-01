export * from "./agent";
export * from "./skill";
export * from "./hook";
export * from "./mcp";
export * from "./command";
export * from "./permission";
export * from "./references";

import type { AgentIR } from "./agent";
import type { CommandIR } from "./command";
import type { HookIR } from "./hook";
import type { McpServerIR } from "./mcp";
import type { SkillIR } from "./skill";

export type IRResource = AgentIR | SkillIR | HookIR | McpServerIR | CommandIR;
