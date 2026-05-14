---
title: Platform Surfaces Need Platform-Specific Rules
date: 2026-04-08
area: channels, rendering, control
summary: Shared channel logic should stay shared only at the policy level; rendering, command menus, and follow-up behavior must still respect Slack and Telegram differences explicitly.
related:
  - docs/features/channels/README.md
  - docs/user-guide/channels.md
  - src/channels/message/rendering.ts
  - src/channels/message/interaction-processing.ts
  - src/channels/slack/service.ts
  - src/channels/telegram/service.ts
---

## Context

This lesson comes from recurring Codex feedback in the `clisbot` project around Telegram versus Slack behavior.

It was confirmed against local Codex session history captured during project work, where Telegram-specific issues around group routing, `/whoami`, `/start`, command menus, and rendering kept surfacing separately from Slack thread behavior.

The repeated issues were:

- Telegram showing `_Working..._` style output that made sense for Slack but not for Telegram
- command discovery and `/whoami` expectations differing between routed and unrouted Telegram groups
- Slack follow-up behavior depending on Slack event subscriptions in ways that do not map cleanly onto Telegram groups or topics
- confusion caused by treating one channel's behavior as the default mental model for another

## Lesson

The project should share policy concepts across channels, but not force one platform's UX rules onto another.

Good shared concepts:

- follow-up policy
- privilege command gating
- routed versus unrouted surfaces
- session ownership

Good platform-specific behavior:

- rendering style
- command registration and menus
- mention requirements
- event-subscription assumptions
- status indicators and temporary progress text

## Practical Rule

When a new shared channel behavior is added:

1. define the shared policy concept
2. define the platform-specific signals each channel uses to implement it
3. document the differences explicitly
4. test Slack and Telegram independently instead of assuming parity

## Applied Here

This lesson was applied by:

- making rendering platform-aware
- documenting Slack event-subscription requirements separately from Telegram routing rules
- adding safe unrouted Telegram command behavior instead of reusing routed Slack assumptions
