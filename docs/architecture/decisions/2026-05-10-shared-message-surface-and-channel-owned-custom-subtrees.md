# Shared Message Surface And Channel-Owned Custom Subtrees

## Status

Accepted

## Date

2026-05-10

## Purpose

Record the stable architecture decision for how `clisbot` should expose:

- the shared `message` CLI surface
- provider-specific public message extensions
- ownership of custom-subtree grammar
- reuse of help, validation, parsing, and examples

This is the stable decision record for this topic.

## Decision

Keep the public `message` CLI split into two layers:

- `clisbot message <action> --channel ...` for the shared stable message surface
- `clisbot message custom ... --channel ...` for a channel-owned public subtree

Apply these rules:

- the shared layer owns only the `message custom` gateway and dispatch contract
- the selected channel plugin owns the subtree grammar after `custom`
- subtree depth is not restricted by the shared layer
- one channel plugin may expose both shared `message` actions and a `message custom ...` subtree
- the custom subtree should reuse one shared toolkit instead of each channel hand-writing help, validation, parsing, and errors separately

## Rules

### 1. Shared Stable Surface

Use the shared `message` surface for message capabilities that fit the common product model.

Examples:

- `clisbot message send --channel telegram ...`
- `clisbot message poll --channel discord ...`

The shared surface owns:

- stable action names
- shared operator mental model
- shared help entrypoints
- shared dispatch into the selected channel plugin

### 2. Channel-Owned Custom Subtree

Use `message custom` as a public provider-extension surface for message-domain capabilities that do not yet have a clean shared home.

Examples:

- `clisbot message custom live --channel discord ...`
- `clisbot message custom poll create --channel discord ...`
- `clisbot message custom sync --channel zalo-personal ...`

The shared layer must:

- recognize `message custom`
- read `--channel <id>`
- dispatch the remaining subtree to the selected channel plugin

The shared layer must not:

- force one subtree grammar shape
- force one subtree depth
- force provider nouns into the top-level CLI tree

### 3. Ownership Boundary

After `message custom`, the channel plugin owns:

- subtree grammar
- subtree help
- subtree validation semantics
- subtree examples
- subtree capability truth
- subtree execution handlers

The shared layer owns only:

- the top-level `message` contract
- gateway discovery
- channel dispatch
- shared parsing and rendering utilities used by the custom toolkit

### 4. Reuse Mechanism

Do not solve this with a shared subtree grammar.

Instead, solve it with one shared subtree toolkit.

Each channel should declare one custom command tree spec, and the shared layer should reuse that same spec to provide:

- help text
- option parsing
- required-field validation
- unknown-command and unknown-flag errors
- examples
- capability listing
- dispatch skeleton

This keeps one source of truth for the custom subtree while preserving channel-owned semantics.

### 5. Spec Shape

Prefer a declarative-first command tree spec:

- tree shape declared as data or schema
- execution handlers still implemented as real functions

This keeps help, validation, parsing, and capability listing easy to derive while preserving enough runtime flexibility for channel-specific handlers.

### 6. Constraint Rule

Do not force a capability to choose exactly one of:

- shared `message`
- `message custom`

by default.

A channel plugin may expose both when that is the cleaner product shape.

Only add stricter exclusivity rules later if concrete evidence shows real operator confusion, help drift, or review-boundary problems.

### 7. Domain Guardrail

`message custom` is still a message-domain surface.

Do not hide unrelated workflows under it just because the subtree is flexible.

If a subtree no longer represents a message-domain capability, it needs a different architecture home.

## Why

This keeps the public CLI honest without forcing premature shared abstractions:

- shared actions remain small and stable
- provider-specific public extensions stay public without leaking provider nouns into top-level CLI groups
- review conflict drops because shared and provider-local concerns have a cleaner boundary
- help, validation, parsing, and capability listing can still stay DRY through one shared toolkit
- future channels such as Discord or Zalo Personal can move faster without forcing the shared surface to absorb unstable semantics too early

## Consequences

### Immediate

- architecture docs should describe `message custom` as a channel-owned subtree behind one shared gateway
- future custom-subtree design should prefer a declarative-first spec plus shared toolkit
- shared help should stop implying that every public message capability must live in the shared stable action list

### Later

- code can extend `ChannelPlugin` with a custom-tree contract when implementation starts
- shared message CLI can add a gateway dispatcher plus toolkit-driven help and validation
- provider-specific capabilities can later be promoted from `message custom` into the shared `message` surface when they gain a clean shared product meaning

## Related Docs

- [Architecture Overview](../architecture-overview.md)
- [Surface Architecture](../surface-architecture.md)
- [Domain Language](../domain-language.md)
- [Canonical Surface Concepts And Provider Capabilities](2026-05-10-canonical-surface-concepts-and-provider-capabilities.md)
