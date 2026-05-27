---
name: linkedin-article
description: >
  Use when a task produced something non-trivial, novel, or explicitly requested by the user to write about.
  Writes a LinkedIn-style article and saves it to a .md file.
  Triggers automatically after completing work that involves: a non-obvious architectural decision,
  an interesting debugging story, a performance improvement with metrics, a migration, a tool built from scratch,
  a lesson learned from failure, or anything the user says "write an article about".
  Do NOT trigger for routine CRUD, boilerplate, or trivial tasks.
---

# LinkedIn Article Skill

## Overview

Write a LinkedIn article that tells the story of what was built or learned.
Save it as a standalone `.md` file.
If visuals would strengthen the article, write **image generation prompts** instead — never embed actual images.

## Save Location

Save to: `.ai/linkedin/YYYY-MM-DD-<kebab-case-title>.md`

Example: `.ai/linkedin/2026-05-26-how-i-cut-api-latency-by-70-percent.md`

If `.ai/linkedin/` does not exist, create it. If the user specifies a different path, use that.

---

## Article Structure

Every article follows this spine regardless of style:

```txt
[HOOK — 1-3 lines, must fit before "see more"]

[BLANK LINE]

[BODY — story, insights, steps, or argument]

[BLANK LINE]

[TAKEAWAY — the one thing the reader should remember]

[BLANK LINE]

[CTA — a question that invites comments]

[BLANK LINE]

[HASHTAGS — 3-5, lowercase, relevant]
```

**Formatting rules (LinkedIn renderer):**
- Paragraphs: max 2-3 sentences. One idea per paragraph.
- Blank line between every paragraph.
- No markdown headers (`#`, `##`) in the final article — LinkedIn ignores them; use bold text (`**word**`) sparingly for emphasis instead.
- Bullet lists are fine. Keep them short (3-6 items).
- Emojis: 0-3 total. Only if they add clarity. Never decorative spam.
- Length: 600–1400 words. Sweet spot is ~900 words.
- No corporate jargon, no passive voice.
- Write in first person.

---

## Style Selection

Choose the style that best matches the work. When unsure, default to **Case Study**.

| Style | Best for | Tone |
|---|---|---|
| **Storytelling** | Personal journey, failures, aha-moments | Warm, reflective |
| **Case Study** | Technical problem → solution → results | Professional, precise |
| **Listicle** | Multiple lessons from one project | Direct, scannable |
| **Hot Take** | Contrarian opinion backed by evidence | Bold, confident |
| **Tutorial** | Step-by-step how to do X | Helpful, practical |

Reference examples for each style are in `references/`.

---

## Hook Writing Rules

The hook is the most important part. LinkedIn truncates posts after ~3 lines.
If the hook doesn't stop the scroll, nobody reads the rest.

**Hook formulas that work:**

- **Contrast:** "Everyone told me X. They were wrong."
- **Outcome first:** "We cut deploy time from 45 minutes to 3. Here's exactly how."
- **Confession:** "I spent 3 days chasing the wrong bug. The real cause was a single line."
- **Challenge:** "Here's a question most engineers can't answer about [topic]."
- **Surprising stat:** "One change. 70% less memory. No refactoring."

**Bad hooks:**
- "In this post I will talk about..." → delete immediately
- "Today I want to share..." → generic, invisible
- Long preamble before the point → reader is gone

---

## Image Prompts

If a visual would make a concept clearer (architecture diagram, before/after, flow chart, metric chart), write an image prompt block instead of embedding an image:

```txt
[IMAGE PROMPT: A clean technical diagram showing a request flowing through an API gateway, 
then splitting into two async workers via a message queue. Use a dark background with 
blue and white lines. Include labels: "API Gateway", "Queue", "Worker A", "Worker B", 
"Database". Flat design, no gradients. 1200x630px, suitable for LinkedIn feed.]
```

Place the prompt where the image would appear in the article. One prompt per image. Max 3 images per article.

---

## Quality Checklist

Before saving, verify:

- [ ] Hook fits in 3 lines and creates curiosity or stakes
- [ ] Body delivers on the hook's promise
- [ ] At least one concrete detail: a number, a specific error, a real file name, a tool name
- [ ] No paragraph longer than 3 sentences
- [ ] Takeaway is one clear, memorable sentence
- [ ] CTA is a genuine question (not "what do you think?")
- [ ] 3–5 hashtags, no more
- [ ] Image prompts placed correctly (if any)
- [ ] File saved to correct path

---

## Output Format

The saved `.md` file must have this structure:

```markdown
---
title: [Article title]
style: [storytelling | case-study | listicle | hot-take | tutorial]
date: YYYY-MM-DD
tags: [comma-separated hashtag topics]
---

[Full article text here]
```

After saving, output a one-line summary:
> Article saved to `.ai/linkedin/YYYY-MM-DD-<title>.md` — [style], ~[word count] words.
