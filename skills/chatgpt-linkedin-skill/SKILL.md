---
name: chatgpt-linkedin-skill
description: Generate and save LinkedIn-style engineering article when task contains non-default or user-requested work
metadata:
  founder_story: references/founder_story.md
  engineering_case_study: references/engineering_case_study.md
  framework_article: references/framework_article.md
  myth_busting: references/myth_busting.md
  linkedin-style-analysis: references/linkedin-style-analysis.md
---

# Purpose

Create LinkedIn-style engineering article for notable work.

Save article into separate markdown file.

# Trigger

Run when:

- user requests article
- implementation is non-default
- workaround discovered
- technical insight emerged
- architecture decision made
- debugging produced reusable lesson
- migration/refactor/performance work
- engineering story worth sharing

# Quality Gate

Do not generate or save article unless ALL are true:

- real insight exists
- concrete change happened
- transferable lesson present

# Output

Create:

.ai/linkedin/<date>-<slug>.md

# Writing Style

Use:

- first-person narrative
- engineering founder tone
- strong hook
- practical insight
- concise paragraphs
- technical depth
- lesson-driven storytelling

Avoid:

- marketing language
- generic AI wording
- exaggerated claims
- fake metrics
- corporate tone

# Structure

1. Hook title
2. Context
3. Problem
4. Investigation
5. Solution
6. Technical details
7. Results
8. Lessons
9. Discussion CTA

# Images

If visual helpful:

[IMAGE_PROMPT]
Describe image prompt here
[/IMAGE_PROMPT]

Do not generate images.

# File Saving

Always save final article as standalone markdown.
