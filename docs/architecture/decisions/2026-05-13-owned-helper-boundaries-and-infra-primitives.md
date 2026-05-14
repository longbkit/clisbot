---
title: Owned Helper Boundaries And Infra Primitives
status: accepted
date: 2026-05-13
---

# Context

`src/shared` had become a mixed bag. It contained low-level helpers, operator
CLI helpers, config helpers, channel domain contracts, agent session replay
state, and runner transcript shaping.

That made ownership harder to read:

- channel integration contracts looked like global primitives
- agent session replay state looked generic
- runner transcript normalization looked like shared product state
- config and control helpers were hidden behind a broad folder name

# Decision

Remove `src/shared` as a domain dumping ground.

Move helpers to their owning systems:

- channel integration seams and owner-local helpers live in owner folders under
  `src/channels`, such as `integration`, `config`, `message`, `surface`, and
  `pairing`
- recent conversation replay state lives in `src/agents`
- transcript normalization, deltas, final-answer extraction, and rendering live
  in `src/runners/transcript`
- env reference helpers live in `src/config`
- CLI command-name and command-tree helpers live in `src/control`

Keep only low-level host primitives in `src/infra`:

- filesystem helpers
- path and home-dir resolution
- process helpers
- runtime logging helpers

# Why

This preserves the six product-system boundary while still giving cross-cutting
host primitives a small home.

It also avoids fake generic abstractions. A helper belongs where its behavior is
owned, even when another system consumes it.

# Consequences

Good:

- imports now point at the real owner of each concept
- future agents can navigate by product boundary instead of guessing what
  `shared` means
- owner-local common files use explicit names such as `surface-mode-config`,
  `channel-surface-contract-registry`, and `direct-message-route-resolution` instead of
  carrying a vague `shared` suffix; when a folder groups channel-provider seams,
  it uses the domain name `integration`
- runner transcript logic can evolve without pretending to be channel or config
  state
- channel integration helpers stay in the channel domain

Tradeoff:

- some cross-system imports remain because ownership and consumption are not the
  same thing; for example channels consume runner transcript rendering, and
  agents store channel-scoped sender identity for replay context
