# Decision And Struggle Patterns

## Status

Working review draft.

This page captures decision patterns and recurring AI struggle patterns observed during real `clisbot` work. It is a staging document for future `AGENTS.md` improvements, not a stable architecture contract.

## Why This Exists

Several recent `clisbot` threads converged only after repeated human correction. The corrections were not random preferences. They exposed a repeatable decision style and repeatable AI failure modes.

The goal of this page is to make those patterns explicit so future agents can self-correct earlier.

## Decision Patterns To Respect

### 1. Push implementation questions up to product contract

When a discussion starts from code, config, or retry behavior, expect the actual decision to depend on:

- current shipped behavior
- target behavior
- operator mental model
- security consequence
- migration path
- CLI and docs discoverability
- end-to-end user workflow

Do not decide from implementation convenience alone.

### 2. Ask for current shape before target shape

For config and CLI changes, the review needs both:

- what released users already have
- what the target should become

Useful artifacts include:

- full current JSON shape
- full target JSON shape
- compatibility rules
- command examples
- default values
- deny, silent, or failure behavior
- migration and rollback notes

If these are fuzzy, implementation is not ready.

### 3. Treat ambiguity as a defect

Ambiguity in config, auth, CLI, status, docs, or release notes is not cosmetic.

It can cause:

- unsafe access
- wrong rollout assumptions
- broken upgrades
- operators distrusting the config
- AI agents discovering the wrong command later

If a surface needs explanation every time, simplify or document it more concretely.

### 4. Balance security and friction deliberately

The preferred decision is not always the most locked-down default and not always the shortest flow.

The decision should answer:

- where is the real safety boundary?
- after that boundary is clear, what default makes the product usable?
- can the operator quickly make it stricter?
- will the user trust what the config says?

Example from auth config:

- group admission defaults to allowlist
- after a group is explicitly admitted, sender policy can default to open
- disabled still means fully silent for everyone

### 5. Challenge with evidence, not vibes

The assistant should push back when the observed code, logs, or runtime flow shows a different root cause than the human's current hypothesis.

But the challenge must cite concrete evidence:

- filenames
- functions
- status output
- logs
- config path
- actual runtime flow

Abstract disagreement is not useful.

## Struggle Patterns To Avoid

### 1. Answering from memory instead of inspection

For root-cause, config, release, or CLI questions, inspect the repo and current state first when practical.

Do not rely on prior memory if code, docs, logs, or status can be checked.

### 2. Solving the wrong boundary

Do not optimize runner retry when the channel service is down.

Do not patch auth docs when the route admission code is wrong.

Do not discuss config syntax when the real issue is operator mental model.

First name the owning boundary.

### 3. Implementing before the decision model is stable

If the human is still testing names, mental models, compatibility rules, or default semantics, stay in design-review mode.

Implementation should start after:

- the current shape is known
- target behavior is clear
- migration policy is explicit
- operator examples are concrete

### 4. Leaving adjacent surfaces stale

A behavior change is not done if only code changes.

Check the adjacent surfaces:

- docs
- CLI help
- release notes
- backlog or task docs
- tests
- templates
- migration snapshots
- status or error text

### 5. Adding fallback drift

Fallbacks, aliases, and compatibility branches are risky when they hide an unsettled concept.

Use compatibility only when it protects real released users, and make it explicit as migration with backup, validation, and documentation.

### 6. Stopping too early

Repeated prompts such as "continue", "còn gì nữa", "tiếp tục rà soát", "simplify", and "no side effect" usually mean:

- keep auditing adjacent surfaces
- simplify concept and naming drift
- find side effects before the human does
- write unresolved findings down
- validate before reporting done

They do not mean "make one more small patch and stop."

### 7. Staying abstract when exact artifacts are needed

When the human asks for exactness, provide exactness:

- filenames
- functions
- commands
- JSON shape
- policy values
- status fields
- logs
- test names

Do not replace exact artifacts with a high-level explanation.

## Reusable Pre-Implementation Gate

Before broad auth, config, runtime, channel, CLI, or release work, answer:

1. Have I inspected the source of truth?
2. What is the failing or changing boundary?
3. What is current shipped behavior?
4. What is the target operator mental model?
5. What ambiguity can become a security, migration, or support bug?
6. What exact command or JSON shape would the operator use?
7. What compatibility path is needed for installed users?
8. What docs/help/tests/release notes must move together?
9. What side effects or implicit decisions should be reported?
10. Is this implementation-ready, or still design-review?

If the answers are not concrete, keep reviewing before coding.
