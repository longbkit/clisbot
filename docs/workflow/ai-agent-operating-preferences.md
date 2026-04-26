# AI Agent Operating Preferences

## Status

Working review draft.

This page captures durable operating preferences learned from real `clisbot` work. It is intentionally placed in `docs/workflow/` as a reviewable step before promoting selected rules into `AGENTS.md`.

Related workflow note:

- [Decision And Struggle Patterns](decision-and-struggle-patterns.md)

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

## Review Checklist

Before implementing broad config, auth, channel, route, runtime, or release work:

1. What source of truth did I inspect?
2. What boundary owns the problem?
3. What is current released behavior?
4. What is target behavior?
5. What user-facing surface could become misleading?
6. What naming or concept could drift?
7. What compatibility or migration path is required?
8. What docs, help text, tests, and release notes must move with the code?
9. What implicit decision should be reported explicitly?
10. Is this ready for `AGENTS.md`, or should it stay as workflow guidance?

## Candidate `AGENTS.md` Additions

These rules are strong candidates to promote after review:

- For root-cause questions, inspect code/status/logs before answering and explain by the owning boundary.
- For auth/config/security changes, optimize for operator mental model before schema compactness.
- For user-visible behavior changes, update docs, CLI help, tests, and release notes in the same work bundle.
- For released config migrations, use explicit backup, validation, stage logging, and schema-version gating rather than hidden fallback behavior.
- For naming, enforce one concept and one name across config, CLI, docs, tests, and code.
