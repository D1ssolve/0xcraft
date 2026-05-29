import type { AgentSpec } from "./agent-spec";

/**
 * Built-in agent registry.
 *
 * Agents are defined as plain data here. The OpenCode adapter
 * reads this registry and registers each agent via the plugin
 * `config` hook.
 *
 * Token optimization: only agents referenced in the user's config
 * are loaded. The rest stay as dormant definitions.
 *
 * Permission shape: canonical `PermissionSpec` (singular `permission`).
 * Adapters that still consume the legacy bucketed `permissions` derive
 * it from this canonical shape via T-12.6 mapper consolidation.
 */
export const builtinAgents: AgentSpec[] = [
  {
    id: "team-lead",
    name: "Team Lead",
    description:
      "Analyzes incoming tasks, loads pm-routing skill, composes the right chain of subagents. Does not write business logic itself — delegates all substantive work.",
    mode: "primary",
    model: "github-copilot/claude-opus-4.7",
    color: "accent",
    temperature: 0.2,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
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
    permission: {
      sandbox: "workspace-write",
      tools: {},
      bash: {},
      filesystem: {
        readableRoots: ["~/.nuget/packages*"],
        writableRoots: [],
      },
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
    permission: {
      sandbox: "read",
      tools: { edit: "deny", webfetch: "deny" },
      bash: {},
      delegation: { "*": "deny" },
    },
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
    permission: {
      sandbox: "workspace-write",
      tools: { webfetch: "deny", "ui.question": "allow" },
      bash: {},
    },
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
    permission: {
      sandbox: "workspace-write",
      tools: { edit: "allow", "ui.question": "allow" },
      bash: {},
      delegation: { "*": "deny", "code-explorer": "allow" },
    },
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
    permission: {
      sandbox: "read",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "deny",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "codebase-indexer": "allow",
        "code-explorer": "allow",
        "research-agent": "allow",
      },
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
    permission: {
      sandbox: "read",
      tools: {
        edit: "deny",
        websearch: "allow",
        webfetch: "allow",
      },
      bash: {},
      delegation: { "*": "deny" },
    },
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
    permission: {
      sandbox: "read",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "deny",
        "ui.question": "allow",
      },
      bash: {},
      delegation: { "*": "deny", "code-explorer": "allow" },
      filesystem: {
        readableRoots: ["templates/*"],
        writableRoots: [],
      },
    },
    promptFile: "agents/spec-driven.agent.md",
  },
  {
    id: "spec-driven-gpt",
    name: "Spec-Driven GPT",
    description:
      "Produces a high-rigor GPT candidate spec artifact at .ai/spec.gpt.md for dual-run comparison. Preserves full spec quality gates and evidence discipline.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "info",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: { "*": "deny", "code-explorer": "allow" },
      filesystem: {
        readableRoots: ["templates/*"],
        writableRoots: [],
      },
    },
    promptFile: "agents/spec-driven-gpt.agent.md",
  },
  {
    id: "spec-driven-sonnet",
    name: "Spec-Driven Sonnet",
    description:
      "Produces a high-rigor Sonnet candidate spec artifact at .ai/spec.sonnet.md for dual-run comparison. Preserves full spec quality gates and evidence discipline.",
    mode: "subagent",
    model: "github-copilot/claude-sonnet-4.6",
    color: "info",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: { "*": "deny", "code-explorer": "allow" },
      filesystem: {
        readableRoots: ["templates/*"],
        writableRoots: [],
      },
    },
    promptFile: "agents/spec-driven-sonnet.agent.md",
  },
  {
    id: "spec-driven-dual",
    name: "Spec-Driven Dual",
    description:
      "Runs spec-driven GPT and Sonnet candidates in parallel, compares with a strict rubric, and synthesizes canonical .ai/spec.md with provenance.",
    mode: "subagent",
    model: "github-copilot/claude-opus-4.7",
    color: "info",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "spec-driven-gpt": "allow",
        "spec-driven-sonnet": "allow",
      },
    },
    promptFile: "agents/spec-driven-dual.agent.md",
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
    permission: {
      sandbox: "read",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "deny",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "code-explorer": "allow",
        "codebase-indexer": "allow",
        "research-agent": "allow",
      },
    },
    promptFile: "agents/system-architect.agent.md",
  },
  {
    id: "system-architect-gpt",
    name: "System Architect GPT",
    description:
      "Produces a high-rigor GPT architecture candidate at .ai/adr.gpt.md and .ai/tasks.gpt.md for dual comparison.",
    mode: "subagent",
    model: "github-copilot/gpt-5.5",
    color: "warning",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "code-explorer": "allow",
        "codebase-indexer": "allow",
        "research-agent": "allow",
      },
    },
    promptFile: "agents/system-architect-gpt.agent.md",
  },
  {
    id: "system-architect-sonnet",
    name: "System Architect Sonnet",
    description:
      "Produces a high-rigor Sonnet architecture candidate at .ai/adr.sonnet.md and .ai/tasks.sonnet.md for dual comparison.",
    mode: "subagent",
    model: "github-copilot/claude-sonnet-4.6",
    color: "warning",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "code-explorer": "allow",
        "codebase-indexer": "allow",
        "research-agent": "allow",
      },
    },
    promptFile: "agents/system-architect-sonnet.agent.md",
  },
  {
    id: "system-architect-dual",
    name: "System Architect Dual",
    description:
      "Runs system-architect GPT and Sonnet candidates in parallel, compares with a strict rubric, and synthesizes canonical .ai/adr.md + .ai/tasks.md with provenance.",
    mode: "subagent",
    model: "github-copilot/claude-opus-4.7",
    color: "warning",
    temperature: 0.4,
    permission: {
      sandbox: "workspace-write",
      tools: {
        websearch: "allow",
        webfetch: "allow",
        edit: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: {
        "*": "deny",
        "system-architect-gpt": "allow",
        "system-architect-sonnet": "allow",
      },
    },
    promptFile: "agents/system-architect-dual.agent.md",
  },
  {
    id: "dotnet-mentor",
    name: ".NET Mentor",
    description:
      "Guided .NET/C# mentorship: concept explanation, debugging help, code review, step-by-step coaching. Teaching agent, not a hands-off implementer.",
    mode: "all",
    color: "info",
    model: "github-copilot/claude-opus-4.7",
    temperature: 0.4,
    // NOTE: legacy `write: "deny"` was dropped — `write` is not in the
    // installed SDK schema.
    permission: {
      sandbox: "read",
      tools: {
        edit: "deny",
        webfetch: "allow",
        "ui.question": "allow",
      },
      bash: {},
      delegation: { "*": "deny" },
    },
    promptFile: "agents/dotnet-mentor.agent.md",
  },
  {
    id: "go-mentor",
    name: "Go Mentor",
    description:
      "Guided Go mentorship: concept explanation, debugging help, code review, step-by-step coaching. Teaching agent, not a hands-off implementer.",
    mode: "all",
    color: "info",
    model: "github-copilot/claude-opus-4.7",
    temperature: 0.4,
    // NOTE: legacy `write: "deny"` and `todoread: "deny"` were dropped —
    // neither key is in the installed SDK schema.
    permission: {
      sandbox: "read",
      tools: {
        bash: "deny",
        edit: "deny",
        webfetch: "deny",
        "ui.question": "allow",
        "ui.todowrite": "deny",
      },
      bash: {},
      delegation: { "*": "deny" },
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

export function getAgentById(id: string): AgentSpec | undefined {
  return builtinAgents.find((a) => a.id === id);
}

export function getPrimaryAgents(): AgentSpec[] {
  return builtinAgents.filter((a) => a.mode === "primary");
}

export function getSubagents(): AgentSpec[] {
  return builtinAgents.filter((a) => a.mode === "subagent");
}
