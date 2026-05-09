# Agent Rules Review Draft

## Status

Working review draft.

This page captures durable operating preferences learned from real `clisbot` work. It is intentionally placed in `docs/workflow/` as a reviewable step before promoting selected rules into `AGENTS.md`.

Related workflow notes:

- [Decision And Struggle Patterns](decision-and-struggle-patterns.md)
- [Channel Planning And Review Should Use One Owner Per Decision And One Reason To Change](../lessons/2026-05-09-channel-planning-and-review-should-use-one-owner-per-decision-and-one-reason-to-change.md)
- [AI Review Checklist](ai-review-checklist.md)

## Why This Exists

The April 2026 auth config and release cycle showed that AI agents can produce locally plausible work while still missing the operator mental model, migration risk, or surrounding docs and CLI surfaces.

These preferences are not feature requirements by themselves. They are workflow rules that should shape how future AI agents inspect, decide, implement, validate, and report work in this repo.

## Core Preferences

### 1. Inspect the real repo before answering

For code, config, release, or root-cause questions, do not answer from memory if source can be inspected.

Check the relevant code path, status output, logs, docs, release notes, tests, and current git state before making a claim.

### 2. Explain by boundary and flow

When explaining a bug or design issue, map it to the real boundary:

- channel service ingress
- route matching or admission
- auth or policy resolution
- runtime session or runner
- renderer or outbound channel delivery
- config loading or migration

Avoid generic labels such as "worker retry" or "runtime issue" when the failing boundary is actually the channel service, route, auth, or config layer.

### 3. Optimize for operator mental model

Config, CLI, docs, and help text are product surfaces.

If a shape is technically correct but easy for an operator to misread, especially around auth or security, treat that as a design bug.

Prefer:

- one-person versus many-people mental models
- obvious defaults
- exact examples
- explicit precedence
- clear deny or silent behavior

Avoid config shapes where a field such as `allowUsers` appears without an obvious surface scope.

### 4. Keep one concept and one name

One concept should have one name across:

- persisted config
- CLI grammar
- CLI help
- status output
- docs
- tests
- release notes
- code

If names drift, pause and normalize before adding more behavior.

### 5. Use KISS and DRY as hard review lenses

Prefer the smallest design that keeps architecture, runtime truthfulness, and operator flow clear.

Avoid:

- concept sprawl
- near-duplicate wrappers
- unnecessary files
- unnecessary fallback paths
- compatibility modes that hide unsettled design
- copied mutation logic

If compatibility is needed for already released users, make it explicit as migration, not hidden fallback.

### 5a. Use named boundary lenses for channel and architecture-sensitive work

When work touches channels, shared control flow, config binding, or auth-style identity rules, explicitly apply:

- `Robert C. Martin lens`: one dominant reason to change per module
- `Martin Fowler lens`: one canonical owner per cross-cutting decision; duplicate decision paths are a stronger smell than duplicate lines

This means the agent should not only ask whether code works, but also:

- whether one file now mixes transport, policy, config binding, and syntax ownership
- whether the same decision was re-implemented in another branch or layer
- whether a new provider added another local branch where a shared seam should exist

### 6. Treat compatibility as a release safety mechanism

When a release has real installed users, compatibility is not optional polish.

For config changes that affect auth, security, routing, or startup:

- identify the last released shape
- create a versioned template or snapshot when useful
- auto-upgrade only when the schema version requires it
- write a backup first
- dry-run validate the target config
- log each stage
- skip the upgrade path completely when schema is already current
- document downgrade or restore gaps in backlog instead of half-implementing them

### 7. Move behavior, docs, help, tests, and release notes together

A user-visible behavior change is incomplete unless the relevant surrounding surfaces agree.

Check at least:

- feature docs
- user guide
- CLI help
- release note
- backlog or task doc
- tests, including compatibility tests when applicable

For AI-assisted operation, CLI help and docs should be concrete enough that another agent can discover safe usage without guessing.

### 8. Report implicit decisions explicitly

If an implementation makes a decision about defaults, precedence, migration, deny behavior, owner/admin bypass, or compatibility, list that decision back to the operator.

Do not let security-sensitive decisions exist only in code.

### 9. Name duplicated decisions early

When repeated channel work exposes the same decision in several places, report that as a first-class finding even if the current slice still works.

Examples:

- principal normalization
- target parsing
- route binding
- behavior-config binding
- processing-indicator lifecycle

Do not reduce those to "cleanup later" notes without naming the missing owner seam.

## How To Use This Draft

Use this file when a workflow rule looks durable enough to outlive one task, but is not yet ready to be promoted into `AGENTS.md`.

Use [AI Review Checklist](ai-review-checklist.md) for concrete review loops.

Use this draft for:

- durable repo-work preferences
- candidate operating rules
- rules that may later become hard `AGENTS.md` guidance

## Candidate `AGENTS.md` Additions

These rules are strong candidates to promote after review:

- For root-cause questions, inspect code/status/logs before answering and explain by the owning boundary.
- For auth/config/security changes, optimize for operator mental model before schema compactness.
- For user-visible behavior changes, update docs, CLI help, tests, and release notes in the same work bundle.
- For released config migrations, use explicit backup, validation, stage logging, and schema-version gating rather than hidden fallback behavior.
- For naming, enforce one concept and one name across config, CLI, docs, tests, and code.
