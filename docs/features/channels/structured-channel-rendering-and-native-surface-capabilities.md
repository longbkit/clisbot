# Structured Channel Rendering And Native Surface Capabilities

## Summary

This feature gives `clisbot` a channel-native output layer for Slack and Telegram.

The goal is not just configurable text templates.

The goal is to control how a reply is rendered, updated, replied-to, and interacted with on each surface.

## Why It Exists

`clisbot` already has:

- channel routing
- bot-aware routing
- prompt templates
- agent reply wrappers

What it still lacks is a first-class model for structured, native surface output.

Without that layer:

- Slack misses Block Kit and richer interaction patterns
- Telegram misses safe HTML formatting and native command or button UX
- streaming stays noisier than it needs to be
- fallback behavior remains ad hoc instead of reviewable

## Scope

- a shared channel-render intent model for Slack and Telegram
- channel-owned renderers for structured output
- draft preview delivery by editing a single in-flight reply where supported
- reply-target rules that stay truthful per channel
- channel-native action surfaces such as buttons, menus, and lightweight status feedback
- explicit degraded or fallback behavior when a capability is not available
- truthful status or debug output for the active rendering path

## Non-Goals

- one universal cross-channel block schema
- replacing prompt-template configuration
- moving provider transport ownership out of channels
- implementing every advanced Slack or Telegram interaction on the first pass

## Core Product Shape

### Shared intent, channel-specific rendering

The shared layer should decide things like:

- whether a reply is plain text or structured
- whether preview edits are allowed
- whether a reply should target the current message or thread
- which interaction affordances are enabled

The channel layer should decide how that intent becomes real output.

### Fallback is a first-class behavior

Examples:

- Slack structured replies still need fallback text
- Telegram formatted replies still need plain-text retry
- preview edit flows need a truthful fallback to append-only delivery

### Status belongs to the feature

Operators should be able to see:

- which renderer won
- whether preview edits are active
- whether the reply used structured output or fallback
- which reply-target mode is active

## Channel Expectations

### Slack

`clisbot` should be able to support:

- Block Kit replies with fallback text
- single-message preview streaming by edit
- richer command or action menus when Slack supports them
- Slack-native processing feedback such as ack reactions or thread status

### Telegram

`clisbot` should be able to support:

- Telegram-safe HTML formatting
- plain-text fallback on parse failure
- single-message preview streaming by edit
- inline keyboards
- native command menu registration
- explicit reply-target behavior for message replies and topics

## Dependencies

- [Channels](README.md)
- [Message Actions And Bot Routing](message-actions-and-channel-accounts.md)
- [Agent Progress Reply Wrapper And Prompt](agent-progress-reply-wrapper-and-prompt.md)
- [Prompt Templates](prompt-templates.md)

## Related Research

- [OpenClaw Structured Channel Rendering Techniques For Slack And Telegram](../../research/channels/2026-04-14-openclaw-structured-channel-rendering-techniques.md)

## Related Task

- [Structured Channel Rendering And Native Surface Capabilities](../../tasks/features/channels/2026-04-14-structured-channel-rendering-and-native-surface-capabilities.md)
