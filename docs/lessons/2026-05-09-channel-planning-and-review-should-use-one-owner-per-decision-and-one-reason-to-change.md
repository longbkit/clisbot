---
title: Channel Planning And Review Should Use One Owner Per Decision And One Reason To Change
date: 2026-05-09
area: channels, architecture, planning, review, refactoring
summary: Channel work should be planned, implemented, and reviewed with two linked lenses: each module should have one clear reason to change, and each cross-channel decision should have one canonical owner. Duplicate decision paths are a stronger smell than duplicate lines.
related:
  - docs/features/channels/channel-integration-playbook.md
  - docs/tasks/features/channels/2026-05-09-channel-duplication-and-reuse-audit-for-new-integration-slices.md
  - docs/tasks/features/channels/2026-05-09-channel-behavior-config-target-binding-standardization.md
  - docs/tasks/features/channels/2026-05-09-channel-processing-indicator-adapter-standardization.md
  - docs/tasks/features/channels/2026-05-09-zalo-bot-target-normalization-and-reply-target-truthfulness.md
  - docs/tasks/features/auth/2026-05-09-pairing-access-matcher-standardization-across-channels.md
  - docs/tasks/features/auth/2026-05-09-pairing-allowlist-alias-cleanup-and-canonical-identity-naming.md
  - docs/architecture/surface-architecture.md
---

## Context

Recent channel work around Slack, Telegram, and `zalo-bot` surfaced a repeated structural problem:

- provider-specific code was not the only source of complexity
- the same cross-channel decisions were being re-encoded in multiple places
- some modules were carrying several reasons to change at once

Two design lenses turned out to be unusually useful together:

- the "one reason to change per module" lens associated with Robert C. Martin
- the "remove duplication of knowledge, not only duplication of lines" lens associated with Martin Fowler

For this repo, the important shift is practical, not philosophical:

- channel work should not only ask "does the new provider function"
- it should also ask "where does this decision live" and "who owns it"

## Lesson

For channel planning, code, and review, use these two rules together:

1. one module should have one dominant reason to change
2. one cross-channel decision should have one canonical owner

Named lenses for this repo:

- `Robert C. Martin lens`: one dominant reason to change per module
- `Martin Fowler lens`: one canonical owner per cross-channel decision; duplicate decision paths are a stronger smell than duplicate lines

If a module knows transport rules, policy rules, config merge rules, and target syntax at the same time, its boundary is dirty.

If the same decision is implemented separately in routing, CLI parsing, follow-up config, pairing, and reply-target logic, the repo is carrying duplicate knowledge even when the code does not look copy-pasted line-for-line.

In this repo, duplicate decision paths are often the stronger smell:

- they drift more quietly than obvious duplicate files
- they create inconsistent operator behavior
- they make new channel work look "almost done" while silently increasing blast radius

## Planning Lens

Before adding or expanding a channel, list the decisions first and name the intended owner for each.

At minimum, channel planning should classify these decisions:

- principal normalization
- target parsing
- route binding
- behavior-config binding
- processing indicator contract
- prompt-context shape
- operator target syntax
- transport delivery model such as polling, webhook, socket, or mixed

The planning mistake to avoid is framing work by provider files too early.

Bad framing:

- "add Telegram path here"
- "copy Slack branch and adapt it for Zalo"

Better framing:

- "define one canonical principal model"
- "define one canonical target model"
- "define which layer owns route binding"
- "define which layer owns operator-facing syntax and error rules"

If a planning pass cannot answer who owns one of those decisions, the task is not ready for implementation.

## Coding Lens

When coding channel behavior, keep provider adapters thin and keep cross-channel decisions centralized.

A provider-specific module should mostly own:

- transport API details
- provider payload parsing
- provider-native delivery or feedback mechanics
- provider-only surface quirks

A shared module should own:

- canonical naming rules
- canonical target parsing rules
- canonical binding rules from identity to persisted behavior
- canonical matcher or admission rules when the policy is not provider-specific

Dirty-boundary examples in this repo looked like:

- pairing code that both normalizes identity aliases and implements per-channel allow or block matching
- follow-up config code that both persists config and re-derives per-channel route binding rules
- CLI context code that both parses operator syntax and rebuilds provider-specific route semantics
- owner alert code that hardcodes a closed set of platforms plus each platform's target syntax

The coding rule is:

- if a file has to change because a new provider exists and also because the shared policy changed, that file likely owns too much

## Review Lens

For channel review, actively search for duplicated decisions, not only duplicated code blocks.

Ask:

1. where is principal normalization defined
2. where is target parsing defined
3. where is route binding defined
4. where is behavior-config binding defined
5. where is processing-indicator lifecycle defined

If the answer to any one of those is "in several places depending on channel," review should treat that as a structural finding even if tests still pass.

Useful review questions:

1. does this module have more than one reason to change
2. did this change add another per-channel branch for an already-shared decision
3. did operator syntax, reply-target logic, and loop or queue targeting stay on one model
4. did the new provider introduce another alias family without one canonical naming owner
5. did the change duplicate a decision path that should instead become a shared seam

## Smell Checklist

These smells should now trigger pushback during channel work:

- `isSlack*`, `isTelegram*`, `isZalo*` helper families that all encode the same policy shape
- per-channel ternary or `else` trees in shared control code for decisions that should be capability-driven
- separate target parsers for `message`, `loops`, `queues`, and reply-target resolution
- config persistence code that also reconstructs channel-specific route ownership
- alias prefixes such as `user:`, `tg:`, `zalo:`, and provider-specific forms being accepted in several layers without one naming rule owner
- "similar enough" provider branches copied into a new slice before the decision owner is identified

When those smells appear, the right response is usually not a broad rewrite. It is to:

1. name the duplicated decision explicitly
2. identify the missing owner seam
3. open a small standardization follow-up if the seam cannot be introduced safely in the current slice

## Practical Rule

Apply this checklist in order for future channel work:

1. write the provider truth inventory
2. list the cross-channel decisions involved
3. name one owner for each decision
4. verify that each touched module still has one dominant reason to change
5. review the diff for duplicated decision paths before looking for style cleanup
6. if the work introduces another duplicated decision, add a follow-up task immediately instead of normalizing the duplication in silence

This should be used in all three phases:

- planning: to choose the right task slices
- coding: to keep provider boundaries thin
- review: to catch structural drift before another channel inherits it
