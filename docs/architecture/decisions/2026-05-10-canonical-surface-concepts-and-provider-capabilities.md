# Canonical Surface Concepts And Provider Capabilities

## Status

Accepted

## Date

2026-05-10

## Purpose

Record the stable architecture decision for how `clisbot` should talk about:

- canonical shared surface concepts
- provider-local labels
- provider capability truth
- topic nesting and inheritance shape

This is the stable decision record for this topic.

## Decision

Keep the shared surface vocabulary small and canonical:

- `dm`
- `group`
- `topic`

Apply these rules:

- `group` is the canonical shared concept for shared multi-user surfaces
- provider-local labels such as Slack `channel` map into `group`
- `topic` is a child surface of `group`, not a top-level peer concept
- capability truth lives at the provider-variant level, not only at the broad platform-family label

## Rules

### 1. Canonical Shared Concepts

Use only these shared surface concepts in common architecture and common config modeling:

- `dm`
- `group`
- `topic`

Do not promote provider-local nouns into the core shared model.

Examples:

- Slack `channel` maps to `group`
- Telegram group maps to `group`
- Telegram topic maps to `topic`

### 2. Provider Capability Truth

The shared vocabulary is a logical superset, not a promise of universal support.

Provider variants must declare what they actually support.

Examples:

- `zalo-bot`: `dm`
- `zalo-personal`: `dm`, `group`
- `telegram`: `dm`, `group`, `topic`

Unsupported concepts do not need fake runtime or config shape just to look aligned on paper.

### 3. Topic Nesting

`topic` is not a top-level peer to `group`.

It is:

- a child shared surface of one `group`
- a child config scope of one group-owned route
- a child inheritance boundary that defaults to group-owned config before topic-specific override

Shared schema direction should therefore prefer:

- `directMessages`
- `groups`
- `groups.<id>.topics`

instead of a top-level `topics` collection.

### 4. Shared Model Versus Provider Extension

The system should prefer:

- one canonical shared concept model
- one provider capability matrix
- provider extension areas only for native-only semantics outside the shared concept set

This avoids two failure modes:

- pretending every provider supports every concept
- splitting provider models so far apart that shared seams disappear

## Why

This gives `clisbot` one stable mental model while keeping support truth honest:

- common config and shared flows can align on `dm`, `group`, and `topic`
- providers still keep truthful capability boundaries
- Slack `channel` does not leak upward into the shared schema
- topic inheritance and route ownership become easier to model consistently

It also supports the broader refactor goal:

- adding a new channel should mostly add provider-owned code plus a smaller capability declaration
- shared code should not need repeated provider-specific noun handling

## Consequences

### Immediate

- shared architecture docs should prefer `dm`, `group`, and `topic`
- shared config design should treat `group` as the canonical shared-surface concept
- new seams should model capability truth per provider variant
- common route/config work should treat `topic` as a nested child of `group`

### Later

- code can still keep provider-native labels inside provider adapters and render surfaces
- CLI help may still mention provider-native words when operator clarity needs them
- future providers can add `group` or `topic` support without changing the canonical vocabulary

## Related Docs

- [Architecture Overview](../architecture-overview.md)
- [Surface Architecture](../surface-architecture.md)
- [Domain Language](../domain-language.md)
