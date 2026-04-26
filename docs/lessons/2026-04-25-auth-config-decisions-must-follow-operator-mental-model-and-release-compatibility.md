---
title: Auth Config Decisions Must Follow Operator Mental Model And Release Compatibility
date: 2026-04-25
area: auth, configuration, security, control, docs, release
summary: Team auth config should start from the operator's security mental model, not schema neatness. Separate surface admission from sender policy, make disabled fully silent, keep naming simple across Slack and Telegram, and treat migration, help text, docs, tests, and release notes as part of the same security change.
related:
  - docs/tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md
  - docs/features/configuration/README.md
  - docs/user-guide/channels.md
  - docs/user-guide/cli-commands.md
  - docs/user-guide/auth-and-roles.md
  - docs/releases/v0.1.44.md
  - docs/tasks/features/configuration/2026-04-25-config-downgrade-and-restore-ux.md
  - docs/workflow/ai-agent-operating-preferences.md
  - docs/workflow/decision-and-struggle-patterns.md
  - docs/lessons/2026-04-14-auth-and-config-design-should-run-a-self-review-checklist-before-converging.md
  - docs/lessons/2026-04-14-feature-review-should-evaluate-product-contract-not-just-config-syntax.md
  - docs/lessons/2026-04-16-cross-cutting-refactors-need-explicit-scope-control-validation-tracking-and-surface-lockstep.md
---

## Context

This lesson came from the April 20-25, 2026 `clisbot` stability, auth config, migration, docs, and release cycle.

The repeated human feedback was not only "make `allowUsers` and `blockUsers` work." It was a stronger product and security correction:

- diagnose whether the broken path is the channel service, runner, route, or auth gate before proposing retries
- make the config understandable enough that an operator does not accidentally open a bot to a team
- make the CLI and docs concrete enough for both humans and AI agents to discover the right command
- preserve released `0.1.43` users with a smooth, automatic migration
- avoid concept sprawl, naming drift, unnecessary fallback behavior, and half-documented security semantics

The durable lesson is that auth config is a trust surface, not just a JSON shape.

## Core Lessons

### 1. Diagnose ingress before optimizing runtime recovery

When the symptom is "the bot does not listen" and `clisbot status show` says Slack or Telegram is down, the likely root cause is the channel service or route ingress path, not the runner.

Do not answer by talking only about worker retries, runner launch, or tmux recovery. First map the actual flow:

1. channel service receives the message
2. route/admission/auth decides whether it can enter
3. runtime session/runner receives the prompt
4. response is rendered back through the channel

If step 1 is down, later retry behavior does not matter. Future explanations should show the code or status path for the failing boundary, not hand-wave around "retry."

### 2. Separate group admission from sender policy inside the group

Two concerns look similar but must stay separate:

- admission: whether this Slack channel, Slack private group, Telegram group, or Telegram topic is allowed to use the bot at all
- sender policy: after the surface is admitted, which users inside it may talk or act

Final decision:

- `groupPolicy` and Slack `channelPolicy` are shared-surface admission gates
- `groups["*"].policy` and exact `groups["<id>"].policy` are sender policies inside admitted groups
- adding a group route under default `allowlist` admission should make that group usable immediately
- therefore the default sender policy inside admitted groups is `open`, not `disabled`

Reason:

- if an operator explicitly adds a group route, they expect the group to work
- if they want tighter behavior, they can set that exact group or `group:*` to `allowlist` or `disabled`
- making route-add still require a second enable step is secure-looking but counterintuitive friction

### 3. `disabled` must be fully silent

Final decision:

- `disabled` means nobody gets a reply on that surface
- this includes owner, admin, pairing replies, deny guidance, and any other helpful-looking message

Reason:

- if an operator disables a surface and still sees replies, they cannot trust the config
- security clarity beats owner/admin convenience here
- owner/admin convenience only applies after the surface is enabled and admitted

Future extension:

- an explicit setting may later control whether owner/admin auto-bypass sender allowlists on enabled surfaces
- that setting must not weaken the meaning of `disabled`

### 4. Naming must follow the operator's mental model

Final decision:

- use `directMessages` for one-person surfaces
- use `groups` for many-people surfaces
- use `group` in CLI for Slack channels, Slack private groups, Telegram groups, and Telegram topics when addressing many-people surfaces
- store raw provider-local ids plus `*` inside a bot-scoped provider config
- keep CLI ids prefixed as `dm:<id>`, `dm:*`, `group:<id>`, `group:*`, and `topic:<chatId>:<topicId>`

Reason:

- operators mainly need to distinguish "one person" versus "many people"
- `groups` is clearer than `shared`
- inside `bots.slack.<botId>` or `bots.telegram.<botId>`, repeating `channel:` or `group:` prefixes adds noise and increases mistakes
- CLI commands still need prefixes because a compact command line needs unambiguous route ids

Avoid:

- ambiguous top-level `allowUsers` without a nearby surface scope
- provider-specific terms leaking into cross-provider user docs unless compatibility requires them
- one concept having several names across config, CLI, docs, help, and code

### 5. Security defaults should be fast to make safe

The operator should be able to express these common secure setups quickly:

- only I can use this bot
- nobody can use the bot in any group by default
- this one group is allowed
- in this group, only these users can talk or run actions
- this user is blocked across every admitted group

Final decision:

- `group:*` is a real default multi-user sender-policy node, not a throwaway alias
- `allowUsers` in a specific group node controls who can chat with that bot in that group
- shared allowlist failures are denied before runner ingress
- shared `blockUsers` wins over owner/admin sender allowlist bypass

Reason:

- security should shift left into config and CLI, before the runner receives the prompt
- the fastest safe config path is a product feature, not only admin convenience

### 6. Compatibility is part of the security release

Earlier lessons said this early product should avoid unnecessary compatibility modes. This release had a different constraint: `0.1.43` had already been installed by real users, and the changed surface is auth/security config.

Final decision:

- existing `0.1.43` config auto-upgrades on first read
- clisbot backs up the old config first
- clisbot logs each stage: backup, prepare, dry-run validate, apply, success
- if schema version is already current, the upgrade path does nothing and emits no upgrade logs
- downgrade and restore UX is tracked separately, not half-built into the release

Reason:

- asking users to manually migrate security config creates too much friction and breakage risk
- automatic migration is acceptable only if it is backed up, validated, visible in logs, and skipped when unnecessary
- compatibility here is not random fallback; it is a controlled release-safety mechanism

### 7. Docs and CLI help are part of the product contract

For this feature, "code works" is not done.

Done requires:

- README and feature docs front-load the mental model before migration details
- user guide explains exact command cases
- CLI help contains enough examples for AI agents to discover correct usage
- release notes explain defaults, migration, deny behavior, and compatibility
- tests cover current shape, legacy shape, and behavior

Reason:

- auth config is easy to misread
- a vague doc can become a security bug
- operators and AI agents both use local docs/help as the discovery surface

## Human Preferences Reinforced

Future work for this repository should preserve these preferences:

- use the real repo and real code path; do not answer from memory when source can be inspected
- explain root cause with the actual flow and exact file/function names when asked
- prefer KISS and DRY; do not create new concepts, names, files, or fallback paths without a clear need
- push important decisions into docs, release notes, backlog, tests, and CLI help, not only chat
- keep security decisions explicit and auditable
- do not make the operator guess defaults, precedence, or compatibility behavior
- test compatibility and end-to-end paths before claiming completion
- when a human pushes on mental model, treat that as design signal, not bikeshedding

The reviewable workflow form of these preferences is captured in [AI Agent Operating Preferences](../workflow/ai-agent-operating-preferences.md) and [Decision And Struggle Patterns](../workflow/decision-and-struggle-patterns.md). Use those files as staging points before promoting any of these rules into `AGENTS.md`.

## Reusable Checklist

Before changing auth, config, route policy, channel ingress, or security-related CLI:

1. What is the shipped behavior and who already depends on it?
2. Is the failing boundary channel service, route/admission, auth, runner, or renderer?
3. Are admission and sender authorization separate?
4. What does `disabled` do, and can any reply leak through?
5. Can the operator express "only me", "no groups by default", and "only this group/users" quickly?
6. Is each concept named once across config, CLI, docs, help, tests, and release notes?
7. Does a wildcard such as `*`, `dm:*`, or `group:*` have one clear meaning?
8. If compatibility is needed, is it an explicit migration with backup and validation, not an unbounded fallback?
9. Are defaults safe enough, but low-friction after an explicit route is added?
10. Would an AI agent using only local help/docs find the correct command without guessing?

If any answer is fuzzy, do not converge on syntax yet.
