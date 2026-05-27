---
name: pm-routing
description: Dynamic routing logic for Team Lead agent. Describes each subagent's role, inputs/outputs, and heuristics to decide which agents are needed for a given task. Enables the Team Lead to compose arbitrary agent chains rather than fixed pipelines.
---

## Available Subagents

### `research-agent`
- **Role**: Technical research specialist. Finds the best available solution for a concrete technical question by querying Context7 MCP for up-to-date library docs and searching the web for community consensus, benchmarks, CVEs, and changelogs.
- **Input**: A concrete technical question — library comparison, capability check, API usage, CVE verification, migration guide, or best practice query
- **Output**: `.ai/research.md` — structured report with direct answer, evidence, trade-offs, unknowns, and recommendation
- **When needed**:
  - The task involves selecting between two or more libraries or architectural approaches
  - The task requires validating that a technology supports a required capability before committing to it
  - An unknown or unfamiliar library/framework/SDK integration is involved
  - CVE, security advisory, or known regression check is needed
  - A migration between major versions of a dependency is planned
  - `system-architect` or `backend-developer` hits an unknown API or integration pattern mid-task
- **When NOT needed**:
  - The library and integration pattern are well-known and already established in the codebase
  - The answer is already present in `.ai/` artifacts or `AGENTS.md`
  - The task is about the local repository rather than an external dependency
- **Sequential constraint**: Runs before `system-architect` when the architectural decision depends on the research outcome. Can also run in parallel with `code-explorer` if both are needed independently.

### `code-explorer`
- **Role**: Read-only codebase discovery specialist. Locates where behavior lives, which files implement a flow, and what existing conventions/patterns the rest of the agent chain should rely on.
- **Input**: Natural-language question about code location, flow wiring, ownership, or existing implementation patterns
- **Output**: Actionable file paths, flow summary, and implementation context
- **When needed**:
  - The immediate task is codebase discovery rather than implementation
  - The Team Lead lacks enough repository context to choose between `spec-driven`, `system-architect`, or `backend-developer`
  - The user asks where a feature/behavior lives, how a flow is wired, or what existing pattern should be followed
- **When NOT needed**:
  - The target files and scope are already clear
  - The task is already fully specified and ready for implementation/review

### `spec-driven`
- **Role**: Translates requirements into structured specifications through iterative clarification and approval. Identifies ambiguities, pitfalls, and trade-offs before implementation.
- **Input**: Task description (natural language)
- **Output**: `.ai/spec.md` — PRD + Design Document with endpoints, parameters, error handling, and test cases
- **When needed**:
  - The task is described in vague, business, or user-facing terms
  - Requirements contain ambiguity, unstated actors, or unclear scope
  - The task introduces new workflows, actors, or business rules
  - No `.ai/spec.md` already exists that covers this task
  - The user wants explicit approval before implementation begins
- **When NOT needed**:
  - The task is a clear bug fix with a precise description
  - The task is a straightforward code change with obvious scope (e.g., "rename this field", "add this index")
  - A valid `.ai/spec.md` already exists and this is a continuation of that work
  - The task is purely technical with no business logic changes

### `spec-driven-gpt`
- **Role**: Generates a GPT candidate spec artifact for dual comparison.
- **Input**: Same as `spec-driven`
- **Output**: `.ai/spec.gpt.md`
- **When needed**: Used only by `spec-driven-dual`

### `spec-driven-sonnet`
- **Role**: Generates a Sonnet candidate spec artifact for dual comparison.
- **Input**: Same as `spec-driven`
- **Output**: `.ai/spec.sonnet.md`
- **When needed**: Used only by `spec-driven-dual`

### `spec-driven-dual`
- **Role**: Runs GPT and Sonnet spec candidates in parallel, scores both with a rubric, and synthesizes canonical spec output.
- **Input**: Same as `spec-driven`
- **Output**: `.ai/spec.gpt.md`, `.ai/spec.sonnet.md`, `.ai/spec.compare.md`, `.ai/spec.md`
- **When needed**:
  - Default for non-trivial requirement/specification work
  - User asks for model-vs-model comparison or best-of merge
- **When NOT needed**:
  - User explicitly requests single-model spec flow
  - Task is too small for dual-run overhead

### `system-architect`
- **Role**: Produces architectural decisions and a developer-ready task breakdown.
- **Input**: `.ai/spec.md` (or task description if spec-driven was skipped)
- **Output**: `.ai/adr.md` (architectural decisions) + `.ai/tasks.md` (task list with dependencies)
- **When needed**:
  - The task introduces new packages, services, or modules
  - The task requires architectural decisions (storage choice, API design, integration strategy)
  - There is a non-trivial dependency graph between implementation steps
  - No `.ai/tasks.md` already exists that covers this task
  - The task touches cross-service boundaries or shared contracts
- **When NOT needed**:
  - The task is a single-file change with no architectural impact
  - A valid `.ai/tasks.md` already exists and this is a continuation
  - The developer can determine the implementation approach independently from the task description

### `system-architect-gpt`
- **Role**: Generates GPT candidate architecture artifacts for dual comparison.
- **Input**: `.ai/spec.md` or task description
- **Output**: `.ai/adr.gpt.md`, `.ai/tasks.gpt.md`
- **When needed**: Used only by `system-architect-dual`

### `system-architect-sonnet`
- **Role**: Generates Sonnet candidate architecture artifacts for dual comparison.
- **Input**: `.ai/spec.md` or task description
- **Output**: `.ai/adr.sonnet.md`, `.ai/tasks.sonnet.md`
- **When needed**: Used only by `system-architect-dual`

### `system-architect-dual`
- **Role**: Runs GPT and Sonnet architecture candidates in parallel, scores both with a rubric, and synthesizes canonical architecture output.
- **Input**: `.ai/spec.md` (preferred), or task description
- **Output**: `.ai/adr.gpt.md`, `.ai/tasks.gpt.md`, `.ai/adr.sonnet.md`, `.ai/tasks.sonnet.md`, `.ai/arch.compare.md`, `.ai/adr.md`, `.ai/tasks.md`
- **When needed**:
  - Default for non-trivial architecture decomposition
  - User asks for model-vs-model comparison or hybrid synthesis
- **When NOT needed**:
  - User explicitly requests single-model architecture flow
  - Change has near-zero architecture risk

### `adr-reviewer`
- **Role**: Reviews `.ai/adr.md` before implementation. Validates layer integrity, pattern consistency with existing codebase, operational readiness, and external technology relevance.
- **Input**: `.ai/adr.md`, optional `.ai/spec.md`, `.ai/tasks.md`, `.ai/research.md`, `AGENTS.md`
- **Output**: `.ai/adr-review.md` with verdict: Approved | Approved with Conditions | Needs Revision
- **When needed**:
  - Non-trivial architecture change (new module/service, protocol choice, cross-service contract)
  - Risk of layer boundary violations or pattern drift
  - External technology/version assumptions materially affect architecture
  - User explicitly asks for ADR/architecture quality gate
- **When NOT needed**:
  - Tiny local change with no architectural decision
  - Existing ADR is already reviewed and unchanged
- **Sequential constraint**: Runs after `system-architect` and before `backend-developer`.

### `backend-developer`
- **Role**: Implements code. Reads `.ai/adr.md` + `.ai/tasks.md` if available, otherwise works from the task description.
- **Input**: `.ai/adr.md` and/or `.ai/tasks.md` and/or direct task description
- **Output**: Working source code
- **When needed**: Any task that requires writing or modifying code
- **Parallelism**: After reading `.ai/tasks.md`, identify tasks with no mutual dependencies and launch them in a single response as parallel Task calls. Tasks with dependencies must wait.

### `code-reviewer`
- **Role**: Reviews code changes for production readiness. Supports two modes:
  - **Single review** (default): Reviews all 8 dimensions in one pass — correctness, simplicity, consistency, architecture fit, security, performance, tests, naming/API.
  - **Focused lens review**: Reviews ONLY through a specified lens when invoked with a `FOCUS LENS` parameter. Enables parallel review where 6 focused reviewers each examine one domain deeply.
- **Input**: `WHAT_WAS_IMPLEMENTED`, `PLAN_OR_REQUIREMENTS`, `BASE_SHA`, `HEAD_SHA`, `DESCRIPTION`, optional `FOCUS LENS`
- **Output**: Review with Strengths, Issues (Critical/Important/Minor) tagged by dimension or lens, Test Results, and merge verdict
- **When needed**:
  - After each `backend-developer` task (mandatory in subagent-driven flow)
  - After completing a major feature
  - Before merge to main
  - When stuck or need fresh perspective on existing code
- **When NOT needed**:
  - Pure documentation or config changes with no logic
  - Trivial single-line fixes where regression risk is near zero
- **Sequential constraint**: Must run after `backend-developer` produces code.
- **Parallel mode**: For non-trivial changes, the Team Lead should load the `code-review-orchestrator` skill and launch 6 parallel focused reviews (SOLID & Design, Correctness, Security, Performance, Architecture, Tests), then aggregate results.

---

## Routing Heuristics

Apply these rules in order. Each "yes" adds that agent to the chain.

### Dual-mode default for planning stages

- If the chain requires specification work, prefer `spec-driven-dual` over `spec-driven`.
- If the chain requires architecture work, prefer `system-architect-dual` over `system-architect`.
- Fall back to single-model only when explicitly requested or when dual overhead is not justified.
- Degraded mode: if one dual branch fails, continue with the successful branch and require explicit failure notes in compare artifacts.

### 0a. Does the task need `research-agent`?
Ask yourself:
- Does the task require choosing between libraries or approaches that are not already established in the project?
- Is there an unfamiliar SDK, framework, or integration pattern involved?
- Does the task require a CVE check, version migration, or capability validation before architecture can be decided?
- Is `system-architect` or `backend-developer` likely to be blocked by an unknown API?

→ **Yes to any**: invoke `research-agent` before `system-architect`. Can run in parallel with `code-explorer` if both are needed.

### 0b. Does the task need `code-explorer` first?
Ask yourself:
- Is the user primarily asking where something lives in the codebase?
- Is the implementation path blocked by missing repository context?
- Do you need to discover existing patterns before selecting the main execution chain?

→ **Yes to any**: invoke `code-explorer` first as a read-only reconnaissance step. Then reassess whether the main chain needs `research-agent`, `spec-driven`, `system-architect`, `backend-developer`, and/or `code-reviewer`.

### 1. Does the task need `spec-driven`?
Ask yourself:
- Is the task described in vague, business, or user-facing terms?
- Are there multiple plausible interpretations of scope?
- Are actors or system boundaries unclear?
- Does the task involve new business logic or workflows?
- Is there no existing `.ai/spec.md` for this work?
- Would the user benefit from explicit approval before implementation?

→ **Yes to any**: include `spec-driven-dual` first (or `spec-driven` if single-model fallback applies).

### 2. Does the task need `system-architect`?
Ask yourself:
- Does the task span more than ~2 files or require creating new modules/packages?
- Are there meaningful architectural choices to make (e.g., where to put state, which pattern to follow)?
- Is there a non-obvious implementation order where some steps depend on others?
- Is there no existing `.ai/tasks.md` that covers this work?

→ **Yes to any**: include `system-architect-dual` (or `system-architect` if single-model fallback applies). It must run after spec stage and before `backend-developer`.

### 2b. Does the task need `adr-reviewer`?
Ask yourself:
- Does `.ai/adr.md` introduce/modify architecture with non-trivial trade-offs?
- Is there risk of violating existing layering or bounded-context boundaries?
- Are external tech assumptions version-sensitive or not yet validated?
- Did the user request stronger architecture governance?

→ **Yes to any**: include `adr-reviewer` after `system-architect` and before `backend-developer`.

### 3. Does the task need `backend-developer`?
→ Yes, unless the task is purely analytical, documentation, or infrastructure-as-config.

### 4. Does the task need `code-reviewer`?
Ask yourself:
- Did `backend-developer` just produce code?
- Is this a non-trivial change (more than a single line)?
- Would a second pair of eyes catch issues across the 8 dimensions?

→ **Yes to any**: include `code-reviewer` after `backend-developer`.

### 4b. Single review or parallel review?
- **Trivial change** (single-line fix, config update, near-zero regression risk): Use single `code-reviewer` call without focus lens.
- **Non-trivial change** (new feature, refactor, multi-file change, security-sensitive): Load `code-review-orchestrator` skill and launch 6 parallel focused reviews, then aggregate.

---

## Example Chains

| Task type | Chain |
|---|---|
| Codebase discovery / "where is X?" | `code-explorer` |
| Need repo reconnaissance before choosing a chain | `code-explorer` → reassess |
| "What is the best library/approach for X?" | `research-agent` |
| Unknown library integration, no architecture yet | `research-agent` → `system-architect-dual` → `backend-developer` → `code-reviewer` (parallel) |
| Non-trivial architecture with governance gate | `research-agent` (if needed) → `system-architect-dual` → `adr-reviewer` → `backend-developer` → `code-reviewer` (parallel) |
| Library comparison + vague feature request | `research-agent` + `code-explorer` (parallel) → `spec-driven-dual` → `system-architect-dual` → `backend-developer` → `code-reviewer` (parallel) |
| CVE / security advisory check | `research-agent` |
| Major version migration of a dependency | `research-agent` → `backend-developer` → `code-reviewer` (parallel) |
| Bug fix with clear reproduction steps | `backend-developer` → `code-reviewer` (single) |
| Bug fix with regression risk | `backend-developer` → `code-reviewer` (parallel) |
| New endpoint, spec already exists | `system-architect-dual` → `backend-developer` → `code-reviewer` (parallel) |
| Vague feature request | `spec-driven-dual` → `system-architect-dual` → `backend-developer` → `code-reviewer` (parallel) |
| Large feature from scratch | `spec-driven-dual` → `system-architect-dual` → `backend-developer` → `code-reviewer` (parallel) |
| Refactor existing logic | `backend-developer` → `code-reviewer` (parallel) |
| Architecture review only | `system-architect-dual` |
| Requirements analysis only | `spec-driven-dual` |
| Spec exists, simple implementation | `spec-driven-dual` → `backend-developer` → `code-reviewer` (single) |
| Code review only (existing code) | `code-reviewer` (single or parallel) |

The key principle: **any subset, any order that makes logical sense for the task**. Do not force the full pipeline if it adds no value.

---

## Artifact Flow

```
code-explorer      →  file paths + flow summary       (read-only discovery)
research-agent     →  .ai/research.md                 (context7 + web evidence, recommendation)
spec-driven        →  .ai/spec.md (PRD + Design Document with test cases)
system-architect   →  .ai/adr.md + .ai/tasks.md   (reads .ai/spec.md + .ai/research.md if present)
spec-driven-dual   →  .ai/spec.gpt.md + .ai/spec.sonnet.md + .ai/spec.compare.md + .ai/spec.md
system-architect-dual → .ai/adr.gpt.md + .ai/tasks.gpt.md + .ai/adr.sonnet.md + .ai/tasks.sonnet.md + .ai/arch.compare.md + .ai/adr.md + .ai/tasks.md
adr-reviewer       →  .ai/adr-review.md              (architecture quality gate before coding)
backend-developer  →  source code + tests          (reads .ai/adr.md + .ai/tasks.md + .ai/research.md if present)
code-reviewer      →  review report + test results (reads git diff + plan/spec, runs tests)
code-reviewer (×6)  →  6 focused lens reports       (parallel, each with one FOCUS LENS)
Team Lead          →  aggregated review report     (deduplicates + ranks 6 lens reports)
```

When passing context between agents, always reference the relevant `.ai/` files in the Task prompt.

---

## Parallelism Rule (for `backend-developer`)

After `system-architect` produces `.ai/tasks.md`:
1. Read all tasks and build the dependency graph from each task's `Dependencies` field.
2. Find the first batch of tasks with no unmet dependencies.
3. Launch them as **multiple Task calls in a single response** (parallel).
4. After each batch finishes, find the next unblocked batch.
5. Repeat until all tasks are complete.

---

## Approval Loop (for `spec-driven`)

The `spec-driven` agent operates in 3 stages with explicit user approval at each stage:

1. **Requirements Gathering**: Clarifies ambiguities, identifies pitfalls and trade-offs
2. **Requirements Approval**: Presents PRD, iterates until user approves
3. **Design Document**: Creates detailed design with endpoints, error handling, test cases

**Important**: The Team Lead should wait for `spec-driven` to complete all 3 stages before invoking `system-architect` or `backend-developer`. The agent will signal completion when `.ai/spec.md` has status `[FINAL]`.

## Dual Compare Rules

When dual planning agents are used:

1. Compare candidates with explicit weighted rubric scoring.
2. If score gap is >= 10 percentage points, pick winner wholesale.
3. If score gap is < 10 percentage points, use section-level hybrid merge.
4. Always produce compare artifacts (`.ai/spec.compare.md`, `.ai/arch.compare.md`) for traceability.
5. If one branch fails, continue in degraded mode and document branch failure + mitigation.
