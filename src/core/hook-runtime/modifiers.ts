import { z } from "zod";

import { HookActionIR } from "./primitives";

const HookActionList = z.array(z.lazy(() => HookActionIR));

const FilterFilesModifier = z.object({
  type: z.literal("filter_files"),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).strict();

const MatchToolModifier = z.object({
  type: z.literal("match_tool"),
  tools: z.array(z.string()),
}).strict();

const SetEnvModifier = z.object({
  type: z.literal("set_env"),
  env: z.record(z.string(), z.string()),
}).strict();

const SetCwdModifier = z.object({
  type: z.literal("set_cwd"),
  cwd: z.string(),
}).strict();

const TimeoutModifier = z.object({
  type: z.literal("timeout"),
  timeoutMs: z.number().int(),
}).strict();

const FlowParallelModifier = z.object({
  type: z.literal("flow.parallel"),
  actions: HookActionList,
}).strict();

const FlowSerialModifier = z.object({
  type: z.literal("flow.serial"),
  actions: HookActionList,
}).strict();

const FlowPipedModifier = z.object({
  type: z.literal("flow.piped"),
  actions: HookActionList,
}).strict();

const FailureFailFastModifier = z.object({
  type: z.literal("failure.fail_fast"),
  enabled: z.boolean(),
}).strict();

const DecisionAllowModifier = z.object({
  type: z.literal("decision.allow"),
  reason: z.string().optional(),
}).strict();

const DecisionDenyModifier = z.object({
  type: z.literal("decision.deny"),
  reason: z.string().optional(),
}).strict();

const DecisionContinueModifier = z.object({
  type: z.literal("decision.continue"),
}).strict();

const DecisionAddContextModifier = z.object({
  type: z.literal("decision.add_context"),
  context: z.string(),
}).strict();

const DecisionRewriteInputModifier = z.object({
  type: z.literal("decision.rewrite_input"),
  transform: z.string(),
}).strict();

export const HookModifierIR = z.discriminatedUnion("type", [
  FilterFilesModifier,
  MatchToolModifier,
  SetEnvModifier,
  SetCwdModifier,
  TimeoutModifier,
  FlowParallelModifier,
  FlowSerialModifier,
  FlowPipedModifier,
  FailureFailFastModifier,
  DecisionAllowModifier,
  DecisionDenyModifier,
  DecisionContinueModifier,
  DecisionAddContextModifier,
  DecisionRewriteInputModifier,
]);

export const HookModifierType = z.enum([
  "filter_files",
  "match_tool",
  "set_env",
  "set_cwd",
  "timeout",
  "flow.parallel",
  "flow.serial",
  "flow.piped",
  "failure.fail_fast",
  "decision.allow",
  "decision.deny",
  "decision.continue",
  "decision.add_context",
  "decision.rewrite_input",
]);

export type HookModifierIR = z.infer<typeof HookModifierIR>;
export type HookModifierType = z.infer<typeof HookModifierType>;
