# muxbot Surface Architecture

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Define the user-facing and operator-facing system surfaces
- **Status**: Working architecture

## Scope

This document covers:

- channels
- control
- how session output becomes visible at a surface

It does not define runner mechanics or Agent-OS internals.

## Surface Rule

Surfaces own presentation and interaction, not backend mechanics.

That means:

- channels decide what users see
- control decides what operators see and can do
- runners only provide normalized execution data

## Channels

`channels` is the feature area for all user-facing ingress and egress.

Examples:

- Slack
- Telegram
- API as a channel
- future Discord

Channel responsibilities:

- accept inbound input
- map replies and threads to the right conversation surface
- apply the default chat-first rendering policy for that surface
- recognize explicit transcript request commands for that surface when supported
- stream updates in a way that makes sense for the surface

## Channel Rendering Rule

Normal channel interaction should be chat-first.

That means:

- stream only meaningful new content during normal interaction
- suppress repeated runner chrome by default
- settle each interaction to a clean user-visible answer

Full session visibility should still exist, but only through an explicit transcript request command.

That command behavior is a channel concern even when the underlying data originated from tmux.

## Control

`control` is the operator-facing surface.

Control responsibilities:

- inspect state
- attach to sessions
- restart or stop sessions
- surface health and debug information

Control must not behave like a user-facing conversation channel.

## Testing Standard

Surface tests should verify:

- the exact visible output expected by users or operators
- thread and reply behavior
- default chat-first rendering behavior
- explicit transcript request behavior where supported
- separation between user channels and control actions
