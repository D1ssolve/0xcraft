/**
 * Skill definition — harness-agnostic.
 *
 * A skill is a static knowledge bundle (markdown prompt + optional MCP config)
 * that gets injected into the agent's context when activated.
 *
 * Token optimization: skills are loaded lazily — only when the agent
 * explicitly requests them via the `skill` tool. They are NOT injected
 * into every message.
 */
export interface SkillDefinition {
  /** Unique kebab-case identifier (e.g. "pm-routing") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description for skill selection */
  description: string;
  /** Path to SKILL.md relative to package root */
  skillFile: string;
  /** Optional MCP servers this skill requires (started on demand) */
  mcpServers?: McpServerConfig[];
  /** Tags for categorization and search */
  tags: string[];
  /** Whether this skill should be auto-loaded on session start */
  autoLoad?: boolean;
}

export interface McpServerConfig {
  /** Unique name for the MCP server */
  name: string;
  /** "local" (stdio) or "remote" (HTTP) */
  type: "local" | "remote";
  /** For local: command + args. For remote: URL */
  command?: string[];
  url?: string;
  /** Environment variables needed */
  env?: Record<string, string>;
  /** Headers for remote servers */
  headers?: Record<string, string>;
}

/**
 * Built-in skill registry.
 *
 * Skills are loaded on-demand. The `skillFile` path points to a markdown
 * file that contains the full skill instructions. When the agent invokes
 * the `skill` tool with a skill name, the corresponding SKILL.md content
 * is read and injected into the conversation.
 *
 * This design minimizes token waste: only the skill content for the
 * currently active skill is in context at any time.
 */
export const builtinSkills: SkillDefinition[] = [
  {
    id: "brainstorming",
    name: "Brainstorming",
    description:
      "MUST use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.",
    skillFile: "skills/brainstorming/SKILL.md",
    tags: ["planning", "creative", "requirements"],
  },
  {
    id: "caveman",
    name: "Caveman",
    description:
      "Ultra-compressed communication mode. Cuts token usage ~75% by speaking like caveman while keeping full technical accuracy. Supports intensity levels: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra.",
    skillFile: "skills/caveman/SKILL.md",
    tags: ["communication", "token-optimization"],
    autoLoad: true, // injected by caveman hook on session start
  },
  {
    id: "chatgpt-linkedin-skill",
    name: "ChatGPT LinkedIn Skill",
    description:
      "Generate and save LinkedIn-style engineering article when task contains non-default or user-requested work.",
    skillFile: "skills/chatgpt-linkedin-skill/SKILL.md",
    tags: ["writing", "linkedin"],
  },
  {
    id: "code-review-orchestrator",
    name: "Code Review Orchestrator",
    description:
      "Orchestrates parallel code reviews. Selects mode based on change scope, launches focused sub-reviews via code-reviewer, aggregates into a unified verdict.",
    skillFile: "skills/code-review-orchestrator/SKILL.md",
    tags: ["review", "orchestration"],
  },
  {
    id: "collection-codebase-patterns",
    name: "Collection Codebase Patterns",
    description:
      "Use when changing Collection .NET layered app, especially export/session/plugin/DAL/Backend/BLL/S3 code. Checklist prevents review mistakes around layer boundaries, exceptions, filters, constraints, streaming, and contracts.",
    skillFile: "skills/collection-codebase-patterns/SKILL.md",
    tags: ["dotnet", "patterns", "checklist"],
  },
  {
    id: "context7",
    name: "Context7",
    description:
      "Use when you need up-to-date external library or framework documentation via MCP Context7. Best for implementation, architecture validation, and external contract verification.",
    skillFile: "skills/context7/SKILL.md",
    tags: ["documentation", "research", "mcp"],
    mcpServers: [
      {
        name: "context7",
        type: "remote",
        url: "https://mcp.context7.com/mcp",
      },
    ],
  },
  {
    id: "csharp-scripts",
    name: "C# Scripts",
    description:
      "Run single-file C# programs as scripts for quick experimentation, prototyping, and concept testing.",
    skillFile: "skills/csharp-scripts/SKILL.md",
    tags: ["dotnet", "scripts", "experimentation"],
  },
  {
    id: "implementation-patterns",
    name: "Implementation Patterns",
    description:
      "Concrete implementation patterns for .NET backend systems. Lease pattern, race-free duplicate detection, streaming exports without MemoryStream, etc.",
    skillFile: "skills/implementation-patterns/SKILL.md",
    tags: ["dotnet", "patterns", "backend"],
  },
  {
    id: "linkedin-article",
    name: "LinkedIn Article",
    description:
      "Use when a task produced something non-trivial, novel, or explicitly requested. Writes a LinkedIn-style article and saves it to a .md file.",
    skillFile: "skills/linkedin-article/SKILL.md",
    tags: ["writing", "linkedin"],
  },
  {
    id: "mempalace",
    name: "MemPalace",
    description:
      "Use whenever the user asks about mempalace CLI commands, how to run mempalace, how to use mempalace MCP server, or anything related to mempalace memory system.",
    skillFile: "skills/mempalace/SKILL.md",
    tags: ["memory", "mcp"],
    mcpServers: [
      {
        name: "mempalace",
        type: "local",
        command: [
          "uvx",
          "--from",
          "mempalace",
          "python",
          "-m",
          "mempalace.mcp_server",
        ],
      },
    ],
  },
  {
    id: "microbenchmarking",
    name: "Microbenchmarking",
    description:
      "Activate when BenchmarkDotNet is involved — creating, running, configuring, or reviewing BDN benchmarks. Also for .NET performance questions requiring measurement.",
    skillFile: "skills/microbenchmarking/SKILL.md",
    tags: ["dotnet", "performance", "benchmarking"],
  },
  {
    id: "migrate-dotnet9-to-dotnet10",
    name: "Migrate .NET 9 to .NET 10",
    description:
      "Migrate a .NET 9 project to .NET 10 and resolve all breaking changes.",
    skillFile: "skills/migrate-dotnet9-to-dotnet10/SKILL.md",
    tags: ["dotnet", "migration"],
  },
  {
    id: "nlm-skill",
    name: "NotebookLM",
    description: `Expert guide for the NotebookLM CLI (\`nlm\`) and MCP server - interfaces for Google NotebookLM. Use this skill when users want to interact 
with NotebookLM programmatically, including: creating/managing notebooks, adding sources (URLs, YouTube, text, Google Drive), generating content 
(podcasts, reports, quizzes, flashcards, mind maps, slides, infographics, videos, data tables), conducting research, chatting with sources, or 
automating NotebookLM workflows. Triggers on mentions of "nlm", "notebooklm", "notebook lm", "podcast generation", "audio overview", or any 
NotebookLM-related automation task.`,
    skillFile: "skills/nlm-skill/SKILL.md",
    tags: ["notebooklm", "mcp", "research"],
    mcpServers: [
      {
        name: "notebooklm-mcp",
        type: "local",
        command: ["uvx", "--from", "notebooklm-mcp-cli", "notebooklm-mcp"],
      },
    ],
  },
  {
    id: "pm-routing",
    name: "PM Routing",
    description:
      "Dynamic routing logic for Team Lead agent. Describes each subagent's role, inputs/outputs, and heuristics to decide which agents are needed for a given task.",
    skillFile: "skills/pm-routing/SKILL.md",
    tags: ["orchestration", "routing", "planning"],
  },
  {
    id: "receiving-code-review",
    name: "Receiving Code Review",
    description:
      "Use when receiving code review feedback, before implementing suggestions. Requires technical rigor and verification, not performative agreement or blind implementation.",
    skillFile: "skills/receiving-code-review/SKILL.md",
    tags: ["review", "feedback"],
  },
  {
    id: "systematic-debugging",
    name: "Systematic Debugging",
    description:
      "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.",
    skillFile: "skills/systematic-debugging/SKILL.md",
    tags: ["debugging", "methodology"],
  },
  {
    id: "test-driven-development",
    name: "Test-Driven Development",
    description:
      "Use when implementing any feature or bugfix, before writing implementation code.",
    skillFile: "skills/test-driven-development/SKILL.md",
    tags: ["testing", "methodology", "tdd"],
  },
  {
    id: "topaz-js",
    name: "Topaz JS",
    description:
      "Write, review, and debug Topaz JavaScript scripts for EventService. Use when the user mentions Topaz, EventService, KafkaEvent, or HttpRequestEvent.",
    skillFile: "skills/topaz-js/SKILL.md",
    tags: ["javascript", "topaz", "eventservice"],
  },
  {
    id: "verification-before-completion",
    name: "Verification Before Completion",
    description:
      "Use when about to claim work is complete, fixed, or passing, before committing or creating PRs. Evidence before assertions always.",
    skillFile: "skills/verification-before-completion/SKILL.md",
    tags: ["verification", "quality"],
  },
  {
    id: "writing-plans",
    name: "Writing Plans",
    description:
      "Use when you have a spec or requirements for a multi-step task, before touching code.",
    skillFile: "skills/writing-plans/SKILL.md",
    tags: ["planning", "methodology"],
  },
  {
    id: "efcore-postgres-enum",
    name: "EF Core PostgreSQL Enum",
    description:
      "Mandatory workflow for PostgreSQL enum synchronization across C# enums, Npgsql token mappings, NpgsqlContributor registration, and EF Core migrations. Trigger on: enum value add/remove, new enum type creation, ALTER TYPE, CREATE TYPE, EnumTokens or NpgsqlContributor changes, or migration errors like '22P02 invalid input value for enum'.",
    skillFile: "skills/efcore-postgres-enum/SKILL.md",
    tags: ["dotnet", "postgres", "efcore", "migration"],
  },
  {
    id: "opencode-plugin-development",
    name: "Opencode plugin development",
    description:
      "Use when creating, maintaining, reading, or debugging OpenCode plugins. Triggers on any work involving @opencode-ai/plugin, plugin hooks, custom tools for OpenCode, or opencode.json plugin configuration.",
    skillFile: "skills/opencode-plugin-development/SKILL.md",
    tags: ["opencode", "plugin", "ai"],
  },
];

export function getSkillById(id: string): SkillDefinition | undefined {
  return builtinSkills.find((s) => s.id === id);
}

export function getSkillsByTag(tag: string): SkillDefinition[] {
  return builtinSkills.filter((s) => s.tags.includes(tag));
}

export function getAutoLoadSkills(): SkillDefinition[] {
  return builtinSkills.filter((s) => s.autoLoad === true);
}

export function getSkillsWithMcp(): SkillDefinition[] {
  return builtinSkills.filter((s) => s.mcpServers && s.mcpServers.length > 0);
}
