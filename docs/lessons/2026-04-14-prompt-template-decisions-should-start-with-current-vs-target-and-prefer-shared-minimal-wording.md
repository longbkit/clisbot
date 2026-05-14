---
title: Prompt Template Decisions Should Start With Current Vs Target And Prefer Shared Minimal Wording
date: 2026-04-14
area: channels, prompts, docs
summary: When adjusting prompt templates, first show the current wording and a proposed target, then prefer the smallest shared wording that preserves intent instead of CLI-specific prompt hacks or overly forceful instructions.
related:
  - docs/features/channels/prompt-templates.md
  - docs/tasks/features/channels/2026-04-13-prompt-templates-and-overrides.md
  - src/channels/message/agent-prompt.ts
  - src/channels/message/interaction-processing.ts
  - test/agent-prompt.test.ts
  - test/interaction-processing/interaction-processing.test.ts
---

## Context

This lesson came from several prompt-template adjustment requests on April 14, 2026.

The requests covered:

- the routed `message-tool` prompt wording
- the steering prompt wrapper
- follow-up backlog review for queue and loop prompt templates

The repeated human feedback was not only about the final wording. It was also about the decision process used to get there.

## Explicit Preferences

The user repeatedly asked for these preferences directly:

- show the current prompt text first
- propose a target prompt before patching
- keep the prompt minimal but still effective
- use one shared wording pattern across tools when possible
- avoid CLI-specific prompt hacks unless there is strong evidence they are necessary
- avoid overly forceful instruction styles such as "execute, don't print" when a clearer workflow description can do the job
- keep the same `<system>` and `<user>` envelope style across related prompt types when that structure is already working
- carry related prompt-review follow-up into the backlog instead of leaving it implicit in chat

## Lesson

For this repository, prompt-template changes should be treated as product wording decisions, not only implementation details.

Preferred rules:

- before patching, show the current wording and one concrete target wording
- optimize for the smallest wording that still communicates the intended workflow
- prefer one shared template shape over tool-specific branches unless the product has already proven that the shared wording fails
- keep prompt structure consistent across normal, steering, and later template kinds when the same envelope helps readability
- when one template gets reviewed, check whether adjacent templates such as queue and loop should be reviewed too

## Practical Rule

When asked to change a prompt template:

1. Read the current template from source.
2. Show the current wording briefly.
3. Propose one target wording that matches the user’s stated style.
4. Prefer shared wording and minimal structure first.
5. Patch only after the direction is clear.
6. Add related review work to the backlog when the same decision likely applies to nearby templates.

## Applied Here

This lesson was applied by:

- replacing the Gemini-specific `message-tool` wording with a simpler shared template direction
- simplifying the steering prompt into the same `<system>` and `<user>` envelope used elsewhere
- avoiding stronger instruction phrasing once the user rejected it as bad prompt practice
- updating tests to match the simpler steering wrapper
- adding queue and loop prompt-template review to the prompt-template backlog task
