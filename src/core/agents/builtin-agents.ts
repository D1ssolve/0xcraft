import type { AgentDefinition } from "./agent-types";

/**
 * Built-in agent registry.
 *
 * Agents are defined as plain data here. The OpenCode adapter
 * reads this registry and registers each agent via the plugin
 * `config` hook.
 *
 * Token optimization: only agents referenced in the user's config
 * are loaded. The rest stay as dormant definitions.
 */
export const builtinAgents: AgentDefinition[] = [
  {
    id: "team-lead",
    name: "Team Lead",
    description:
      "Analyzes incoming tasks, loads pm-routing skill, composes the right chain of subagents. Does not write business logic itself — delegates all substantive work.",
    mode: "primary",
    model: "opencode/glm-5.1",
    color: "accent",
    temperature: 0.2,
    permissions: {
      question: "allow",
      websearch: "allow",
      task: {
        "*": "deny",
        "research-agent": "allow",
        "code-explorer": "allow",
        "spec-driven": "allow",
        "spec-driven-gpt": "allow",
        "spec-driven-sonnet": "allow",
        "spec-driven-dual": "allow",
        "system-architect": "allow",
        "system-architect-gpt": "allow",
        "system-architect-sonnet": "allow",
        "system-architect-dual": "allow",
        "adr-reviewer": "allow",
        "backend-developer": "allow",
        "code-reviewer": "allow",
      },
    },
    promptFile: "agents/team-lead.agent.md",
  },
  {
    id: "backend-developer",
    name: "Backend Developer",
    description:
      "Implements server-side logic, REST/GraphQL APIs, database integrations, auth systems, and backend infrastructure. Tests are part of implementation, not separate.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "secondary",
    temperature: 0.3,
    permissions: {
      external_directory: { "~/.nuget/packages*": "allow" },
    },
    promptFile: "agents/backend-developer.agent.md",
  },
  {
    id: "code-explorer",
    name: "Code Explorer",
    description:
      "Read-only codebase search specialist. Finds where behavior lives, which files implement a flow, and what existing patterns the rest of the agent chain should rely on.",
    mode: "subagent",
    model: "github-copilot/gemini-3.5-flash",
    color: "info",
    temperature: 0.3,
    permissions: { edit: "deny", task: "deny", webfetch: "deny" },
    promptFile: "agents/code-explorer.agent.md",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description:
      "Production-readiness reviewer. Inspects code changes through a specified focus lens, runs relevant tests, and returns severity-ranked findings with a merge verdict.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "success",
    temperature: 0.3,
    permissions: { question: "allow", webfetch: "deny" },
    promptFile: "agents/code-reviewer.agent.md",
  },
  {
    id: "codebase-indexer",
    name: "Codebase Indexer",
    description:
      "Analyzes a project and generates or updates AGENTS.md with discovered patterns, architecture, layer structure, DTO/mapping contracts, naming conventions, and anything another agent needs to produce idiomatic code.",
    mode: "all",
    model: "github-copilot/gemini-3.5-flash",
    color: "info",
    temperature: 0.3,
    permissions: { question: "allow", edit: "allow", task: { "*": "deny", "code-explorer": "allow" } },
    promptFile: "agents/codebase-indexer.agent.md",
  },
  {
    id: "adr-reviewer",
    name: "ADR Reviewer",
    description:
      "Reviews architecture decisions in .ai/adr.md before implementation. Validates layering, pattern consistency, operational readiness, and technology relevance.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "warning",
    temperature: 0.4,
    permissions: {
      question: "allow",
      websearch: "allow",
      webfetch: "allow",
      edit: "deny",
      task: { "*": "deny", "codebase-indexer": "allow", "code-explorer": "allow", "research-agent": "allow" },
    },
    promptFile: "agents/adr-reviewer.agent.md",
  },
  {
    id: "research-agent",
    name: "Research Agent",
    description:
      "Technical research specialist. Finds the best available solution via Context7 MCP and web search. Produces .ai/research.md with evidence, trade-offs, and recommendations.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "info",
    temperature: 0.5,
    permissions: { edit: "deny", task: "deny", websearch: "allow", webfetch: "allow" },
    promptFile: "agents/research-agent.agent.md",
  },
  {
    id: "spec-driven",
    name: "Spec-Driven",
    description:
      "Translates requirements into structured .ai/spec.md through iterative, approval-gated process. Clarifies ambiguities, surfaces pitfalls and trade-offs before implementation.",
    mode: "all",
    model: "github-copilot/gpt-5.5",
    color: "info",
    temperature: 0.4,
    permissions: {
      question: "allow",
      websearch: "allow",
      webfetch: "allow",
      edit: "deny",
      task: { "*": "deny", "code-explorer": "allow" },
      external_directory: { "~/.config/opencode/templates/*": "allow" },
    },
    promptFile: "agents/spec-driven.agent.md",
  },
  {
    id: "system-architect",
    name: "System Architect",
    description:
      "Designs system architecture, decomposes features into actionable tasks, creates ADRs, and plans cross-service integrations. Produces .ai/adr.md and .ai/tasks.md.",
    mode: "all",
    model: "github-copilot/gpt-5.5",
    color: "warning",
    temperature: 0.4,
    permissions: {
      question: "allow",
      websearch: "allow",
      webfetch: "allow",
      edit: "deny",
      task: { "*": "deny", "code-explorer": "allow", "codebase-indexer": "allow", "research-agent": "allow" },
    },
    promptFile: "agents/system-architect.agent.md",
  },
  {
    id: "dotnet-mentor",
    name: ".NET Mentor",
    description:
      "Guided .NET/C# mentorship: concept explanation, debugging help, code review, step-by-step coaching. Teaching agent, not a hands-off implementer.",
    mode: "all",
    color: "info",
    model: "opencode/glm-5.1",
    temperature: 0.4,
    permissions: { question: "allow", write: "deny", edit: "deny", webfetch: "allow", task: "deny" },
    promptFile: "agents/dotnet-mentor.agent.md",
  },
  {
    id: "go-mentor",
    name: "Go Mentor",
    description:
      "Guided Go mentorship: concept explanation, debugging help, code review, step-by-step coaching. Teaching agent, not a hands-off implementer.",
    mode: "all",
    color: "info",
    model: "opencode/glm-5.1",
    temperature: 0.4,
    permissions: {
      question: "allow",
      bash: "deny",
      write: "deny",
      edit: "deny",
      webfetch: "deny",
      task: "deny",
      todowrite: "deny",
      todoread: "deny",
    },
    promptFile: "agents/go-mentor.agent.md",
  },
];

/**
 * Dual-mode agent definitions.
 * These are not standalone agents — they are routing configurations
 * that the team-lead uses to invoke two model candidates in parallel.
 */
export const dualModeAgents: Array<{
  id: string;
  name: string;
  description: string;
  candidates: [string, string]; // [gpt-variant, sonnet-variant]
}> = [
  {
    id: "spec-driven-dual",
    name: "Spec-Driven (Dual)",
    description: "Runs GPT and Sonnet spec candidates in parallel, scores both, and synthesizes canonical spec output.",
    candidates: ["spec-driven-gpt", "spec-driven-sonnet"],
  },
  {
    id: "system-architect-dual",
    name: "System Architect (Dual)",
    description: "Runs GPT and Sonnet architecture candidates in parallel, scores both, and synthesizes canonical architecture output.",
    candidates: ["system-architect-gpt", "system-architect-sonnet"],
  },
];

export function getAgentById(id: string): AgentDefinition | undefined {
  return builtinAgents.find((a) => a.id === id);
}

export function getPrimaryAgents(): AgentDefinition[] {
  return builtinAgents.filter((a) => a.mode === "primary");
}

export function getSubagents(): AgentDefinition[] {
  return builtinAgents.filter((a) => a.mode === "subagent");
}