---
name: context7
description: "Use this skill when you need up-to-date external library or framework documentation via MCP Context7. Best for implementation, architecture validation, and external contract verification. Triggers on tasks involving third-party SDKs, framework APIs, library configuration, version-specific syntax, or current docs/examples."
---

# Context7 Documentation Skill

Use this skill to query **current external documentation** for libraries, frameworks, and SDKs through MCP Context7.

This skill is primarily useful for:
- `backend-developer` — implementation against third-party libraries/frameworks/APIs
- `system-architect` — validating capabilities, constraints, and version-specific architecture assumptions
- `spec-driven` — verifying external API/SDK contracts when the specification depends on them

## When to Use

Use Context7 when any of the following is true:
- You are integrating with a third-party library, framework, SDK, or provider API
- You need the **current** or **version-specific** syntax for a library feature
- You need official examples for configuration, setup, usage patterns, or migration behavior
- You need to confirm whether a capability actually exists before designing around it
- You need to verify an external contract instead of relying on memory

## When NOT to Use

Do **not** use Context7 when:
- The task is about the **local repository** rather than an external library
- The answer is already clear from project code, `.ai/` artifacts, or user-provided requirements
- The task is generic programming knowledge and does not depend on a specific library/framework
- You are using it speculatively without a concrete documentation question

Prefer `code-explorer` for local codebase discovery.

## Mandatory Workflow

Always follow this sequence:

1. **Identify the library/package clearly**
   - Determine the official library/framework name from the task context
   - If ambiguous, ask the user before proceeding

2. **Resolve the library ID first**
   - Call `context7_resolve-library-id`
   - Do this before any docs query unless the user already provided a full Context7 ID in `/org/project` or `/org/project/version` format

3. **Choose the best match carefully**
   - Prefer exact name match
   - Prefer higher source reputation and better snippet coverage
   - If multiple plausible matches exist, acknowledge that briefly and choose the best-supported one

4. **Query only for the needed question**
   - Call `context7_query-docs` with a narrow, concrete question
   - Ask about the exact API, configuration, migration, or syntax you need

5. **Use the result minimally**
   - Extract only the facts needed for the current task
   - Do not dump large documentation excerpts into the response

## Token Discipline

To avoid wasting tokens:
- Use **one precise docs query** instead of several vague ones
- Avoid open-ended prompts like "tell me about X"
- Prefer targeted questions such as:
  - "How do I configure JWT auth in Express 5?"
  - "What is the NestJS v11 way to register a global interceptor?"
  - "How does Hangfire configure PostgreSQL storage in ASP.NET Core?"
- Do not call `context7_resolve-library-id` more than necessary
- Do not call `context7_query-docs` repeatedly for the same answer unless the first result is clearly insufficient

## Role-Specific Guidance

### For `backend-developer`
Use Context7 to confirm:
- exact API usage
- initialization/configuration syntax
- version-specific patterns
- official examples to avoid stale memory

### For `system-architect`
Use Context7 to confirm:
- whether a technology supports a required capability
- important constraints, limits, or supported integration patterns
- migration or version caveats that affect design decisions

Do **not** overuse it for low-level code details unless they materially affect architecture.

### For `spec-driven`
Use Context7 only when the specification depends on a real external contract, such as:
- request/response behavior of a third-party API
- supported auth flows
- payload, SDK, or integration constraints

Do **not** let external implementation details overtake the spec. Verify only what is necessary.

## Good Query Examples

### Good
- Resolve: `libraryName="Next.js"`, query about app router caching behavior
- Resolve: `libraryName="MassTransit"`, query about saga persistence with PostgreSQL
- Resolve: `libraryName="Serilog"`, query about ASP.NET Core request logging middleware

### Bad
- Querying docs without resolving the library first
- Asking broad questions like "Explain React"
- Using Context7 for facts already obvious from local code

## Response Expectations

When you use Context7, summarize the result in a task-oriented way:
- what capability exists or does not exist
- what syntax/pattern is correct
- any version-specific caveat that matters
- how it affects the current implementation/design/spec decision

Keep the summary short and actionable.
