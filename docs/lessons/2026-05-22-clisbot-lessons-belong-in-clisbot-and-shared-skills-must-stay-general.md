---
title: Clisbot Lessons Belong In Clisbot And Shared Skills Must Stay General
date: 2026-05-22
area: ai-workflow, lessons, skills, channel-work, queue-workflow
summary: Lessons learned from clisbot channel and queue work should be recorded in clisbot docs, while reusable AI workflow skills must stay repo-agnostic unless a skill is intentionally clisbot-specific.
related:
  - docs/lessons/2026-05-09-channel-planning-and-review-should-use-one-owner-per-decision-and-one-reason-to-change.md
  - docs/features/channels/channel-integration-playbook.md
  - docs/architecture/surface-architecture.md
  - docs/architecture/runtime-architecture.md
  - docs/architecture/domain-language.md
---

# Clisbot Lessons Belong In Clisbot And Shared Skills Must Stay General

## Context

Recent work on queued prompts, attachment handling, streaming settlement,
processing indicators, and Slack / Telegram / Zalo behavior produced useful
lessons for future `clisbot` work.

The first attempt captured those lessons in cross-repo AI workflow skills such
as `implement` and `queue-workflow`. That was the wrong owner boundary.

Those skills are reusable across many repositories. If they absorb
clisbot-specific examples, channel names, runtime paths, or bug histories, they
become less portable and start forcing one repo's architecture into unrelated
work.

## Lesson

Keep the lesson at the narrowest durable owner:

- `clisbot` product, channel, queue, attachment, settlement, and runtime lessons
  belong in `clisbot/docs/lessons/` or the relevant `clisbot` feature/task docs.
- Reusable AI workflow skills may keep general process rules, but must not
  hard-code clisbot-specific channel behavior, command names, runtime homes, or
  bug histories unless the skill is explicitly a clisbot-only skill.
- If a lesson is learned while working on clisbot but applies broadly, rewrite
  it into repo-neutral language before touching a shared skill.
- If repo-neutral wording loses the important detail, do not put it in the
  shared skill. Link or record it in the owning repo instead.

The practical smell is simple:

- if a future non-clisbot repo would read the skill and wonder why Slack,
  Telegram, Zalo, `/queue`, or `CLISBOT_HOME` is being prescribed, the lesson is
  in the wrong place.

## Clisbot-Specific Rules To Preserve Here

For future `clisbot` channel and queue work:

- Slash commands, queued prompts, attachment payloads, recent-message catch-up,
  final settlement, and processing indicators should pass through shared
  channel or agents seams by default.
- Channel-specific code should mostly express provider capabilities and
  transport details, such as whether the provider can edit a message, retract a
  message, stream live content, show typing or processing indicators, or attach
  files.
- Queue start notification should be an independent notification and should not
  become the mutable streaming message unless the behavior is explicitly
  designed and documented for that surface.
- Settlement should follow normal message delivery first: send or edit the final
  user-visible answer through the channel path; use pane or transcript fallback
  only when channel delivery cannot provide a final answer.
- Attachments must be bound to the actual prompt payload after command parsing,
  including queued prompts and prompts with one or more files but no text.
- Telegram media groups may arrive as multiple provider messages at the same
  timestamp; the channel should preserve all attachments without injecting stale
  command text into later prompts.
- Processing indicators must be lifecycle-scoped and best-effort. A stuck or
  failed indicator update must not change run truth, and a completed run must
  clear or settle the visible indicator where the surface supports it.

## Review Checklist

Before calling channel or queue work done, check:

1. Did the behavior go through the shared channel or agents seam unless a
   provider capability required otherwise?
2. Did any provider branch duplicate command parsing, prompt construction,
   attachment binding, settlement, or indicator lifecycle logic?
3. Did queue start notification remain independent from streaming content?
4. Did final settlement use the normal channel delivery path before fallback?
5. Did queued attachment payloads work with one file, multiple files, and no
   accompanying text?
6. Did multi-attachment Telegram input avoid stale-message replay and prompt
   contamination?
7. Did Slack, Telegram, and Zalo behavior differ only at the capability or
   transport surface layer?

## Skill Update Rule

When a future agent wants to update an AI workflow skill after clisbot work:

1. First ask whether the learning is clisbot-local or repo-general.
2. If it is clisbot-local, update `docs/lessons/`, feature docs, task docs, or
   architecture docs in this repo.
3. If it is repo-general, remove clisbot nouns and runtime specifics before
   patching a shared skill.
4. If both are needed, write the detailed clisbot lesson here and add only the
   abstract reusable rule to the shared skill.
