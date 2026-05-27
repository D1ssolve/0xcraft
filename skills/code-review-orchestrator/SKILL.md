---
name: code-review-orchestrator
description: >
  Orchestrates parallel code reviews. Selects mode based on change scope, launches
  focused sub-reviews via code-reviewer, aggregates into a unified verdict.
---

# Code Review Orchestrator

## Mode Selection

```text
trivial change? (config, comments, <20 lines, no logic)
  └─ YES → Minimal: 1 agent, no lens
  └─ NO  → Standard: agents A + B + C
```

## Agents

| Agent | Lens | Covers |
|-------|------|--------|
| A | Design & Architecture | SOLID principles, layering, coupling, module boundaries |
| B | Correctness & Verification | Logic, edge cases, error handling, test coverage and quality |
| C | Quality & Performance | N+1, complexity, memory, concurrency, naming/API |

## Step 1 — Gather Context

```text
WHAT_WAS_IMPLEMENTED  — what changed
PLAN_OR_REQUIREMENTS  — expected behavior / acceptance criteria
BASE_SHA / HEAD_SHA   — commit range
CHANGED_FILES         — optional
```

Read if present: `.ai/spec.md`, `.ai/adr.md`, `.ai/tasks.md`

## Step 2 — Launch in Parallel

Fire all agents in a **single response**. Each is a `Task(code-reviewer, ...)` call.

**Task prompt template:**

```text
FOCUS LENS: [Lens Name]

Review ONLY through this lens. Other reviewers handle remaining areas.

WHAT_WAS_IMPLEMENTED: ...
PLAN_OR_REQUIREMENTS: ...
BASE_SHA: ...
HEAD_SHA: ...
CHANGED_FILES: ...
```

## Step 3 — Aggregate

1. Deduplicate issues that appear across lenses — keep once, combine tags
2. Rank: Critical → Important → Minor
3. Preserve `file:line` references and concrete fix suggestions
4. Merge strengths with lens attribution

## Aggregated Report Format

```markdown
## Code Review

### Summary
[1–2 sentences]

### Critical
- **[Tag]** `file:line` — what · why · fix

### Important
- **[Tag]** `file:line` — what · why · fix

### Minor
- **[Tag]** `file:line` — what · fix

### Strengths
- **[Tag]** `file:line` — what's well done

### Per-Lens
| Lens        | Critical | Important | Minor |
|-------------|----------|-----------|-------|
| Design      | —        | —         | —     |
| Correctness | —        | —         | —     |
| Quality     | —        | —         | —     |

### Verdict
**Ready to merge?** Yes / With fixes / No
**Reasoning:** [1–2 sentences]
```

## Step 4 — Fixes

Load `receiving-code-review` skill to evaluate findings.
Launch `backend-developer` for Critical and Important issues.