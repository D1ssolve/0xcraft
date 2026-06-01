import { z } from "zod";

const StringRecord = z.record(z.string(), z.unknown());

const RunCommandAction = z.object({
  type: z.literal("run_command"),
  command: z.string(),
  shell: z.string().optional(),
  timeoutMs: z.number().int().optional(),
}).strict();

const RunExecAction = z.object({
  type: z.literal("run_exec"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().optional(),
}).strict();

const RunScriptAction = z.object({
  type: z.literal("run_script"),
  path: z.string(),
  runner: z.string().optional(),
  args: z.array(z.string()).optional(),
}).strict();

const HttpRequestAction = z.object({
  type: z.literal("http_request"),
  url: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.union([StringRecord, z.string()]).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
}).strict();

const CallMcpToolAction = z.object({
  type: z.literal("call_mcp_tool"),
  server: z.string(),
  tool: z.string(),
  input: StringRecord.optional(),
}).strict();

const InvokePromptAction = z.object({
  type: z.literal("invoke_prompt"),
  prompt: z.string(),
  model: z.string().optional(),
}).strict();

const InvokeAgentAction = z.object({
  type: z.literal("invoke_agent"),
  agent: z.string().optional(),
  prompt: z.string(),
  model: z.string().optional(),
}).strict();

const RuntimeCodeAction = z.object({
  type: z.literal("runtime_code"),
  runtime: z.string(),
  file: z.string().optional(),
  body: z.string().optional(),
  entry: z.string().optional(),
}).strict().refine(
  (action) => (action.file === undefined) !== (action.body === undefined),
  { message: "runtime_code requires exactly one of file or body" },
);

export const HookActionIR = z.discriminatedUnion("type", [
  RunCommandAction,
  RunExecAction,
  RunScriptAction,
  HttpRequestAction,
  CallMcpToolAction,
  InvokePromptAction,
  InvokeAgentAction,
  RuntimeCodeAction,
]);

export const HookActionType = z.enum([
  "run_command",
  "run_exec",
  "run_script",
  "http_request",
  "call_mcp_tool",
  "invoke_prompt",
  "invoke_agent",
  "runtime_code",
]);

export type HookActionIR = z.infer<typeof HookActionIR>;
export type HookActionType = z.infer<typeof HookActionType>;
