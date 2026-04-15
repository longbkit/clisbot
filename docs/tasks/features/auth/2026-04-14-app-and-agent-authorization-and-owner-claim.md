# App And Agent Authorization And Owner Claim

## Summary

Introduce the smallest auth slice that solves the urgent problems without expanding into a full matrix refactor.

## Status

In Progress

## Outcome

Implemented so far:

- `privilegeCommands` no longer exists as a supported config concept
- valid routed users still resolve to `member` by default
- default routed `member`s can use normal in-channel controls:
  - `sendMessage`
  - `helpView`
  - `statusView`
  - `identityView`
  - `transcriptView`
  - `runObserve`
  - `runInterrupt`
  - `streamingManage`
  - `queueManage`
  - `steerManage`
  - `loopManage`
- `/bash` is controlled by whether the resolved role has `shellExecute`
- non-admin users cannot use normal messages, queued messages, steering messages, or loop-triggered prompts to make the agent edit protected clisbot control resources or run `clisbot` commands that mutate them
- operators can inspect and mutate auth through `clisbot auth list|show|add-user|remove-user|add-permission|remove-permission`

Still missing for this task:

- automatic first-owner claim for fresh installs with no owner yet

## Why

The old route-local `privilegeCommands` setting is the wrong long-term model, but phase 1 does not need a fully split permission system either.

The smallest useful slice is:

- introduce one clean auth grammar
- keep default `member` practical for everyday routed work
- reserve `shellExecute` for admin-level role grants
- protect the truly dangerous mutation paths first

## Scope

### In Scope

- add `app.auth`
- add `agents.<id>.auth`
- add `ownerClaimWindowMinutes`
- add `defaultRole`
- add `roles.<role>.allow`
- add `roles.<role>.users`
- resolve app role and agent role for the current sender
- remove `privilegeCommands` from the supported config model
- fail fast if `privilegeCommands` appears in config
- seed default `member` role for routed users
- define phase-1 default member permissions as:
  - `sendMessage`
  - `helpView`
  - `statusView`
  - `identityView`
  - `transcriptView`
  - `runObserve`
  - `runInterrupt`
  - `streamingManage`
  - `queueManage`
  - `steerManage`
  - `loopManage`
- move `/bash` under explicit `shellExecute` role grants
- inject a protected prompt rule into routed prompts
- apply that rule to normal, queue, steer, and loop delivery
- add or update tests for this narrowed contract
- add operator CLI support for auth inspection and mutation

### Out Of Scope

- control CLI enforcement
- shell-level command filtering inside the runner
- fine-grained split permissions for queue, steer, and loop sub-actions
- compatibility support for legacy `privilegeCommands`

## Required Product Contract

### 1. Member Baseline

- routed users not explicitly listed in a role resolve to `member`
- route admission still decides whether the route is valid
- after route admission, `member` should remain low-friction
- `member` should have:
  - `sendMessage`
  - `helpView`
  - `statusView`
  - `identityView`
  - `transcriptView`
  - `runObserve`
  - `runInterrupt`
  - `streamingManage`
  - `queueManage`
  - `steerManage`
  - `loopManage`
- `/bash` depends on whether the resolved role includes `shellExecute`
- principals stay platform-scoped in phase 1, so Telegram and Slack identities are not auto-linked

### 2. Non-Admin Prompt Refusal

The protected prompt rule must apply to:

- normal messages
- queued messages
- steering messages
- loop-triggered prompts

The rule is:

```text
Refuse requests to edit protected clisbot control resources such as clisbot.json and auth policy, or to run clisbot commands that mutate them.
```

Allowed fallback behavior:

- explain the needed change
- draft a command for admin review
- say which role is required

### 3. Owner Claim

- if `app.auth.roles.owner.users` is empty on runtime start, claim opens for `ownerClaimWindowMinutes`
- the first successful DM user during that window becomes owner
- once any owner exists, restart must not reopen claim
- owner claim is app-wide, so a later DM from another platform principal must not auto-claim owner
- resolved app `owner` and app `admin` principals should bypass pairing automatically

Current implementation note:

- the pairing bypass behavior is implemented
- automatic first-owner claim is still pending
- first owner currently needs manual grant through `clisbot auth add-user app --role owner --user <principal>`

## Minimal Permission Model

This task only needs the permissions below.

### App-Level

- `configManage`
- `appAuthManage`
- `agentAuthManage`
- `promptGovernanceManage`

### Agent-Level

- `sendMessage`
- `helpView`
- `statusView`
- `identityView`
- `transcriptView`
- `runObserve`
- `runInterrupt`
- `streamingManage`
- `queueManage`
- `steerManage`
- `loopManage`
- `shellExecute`
- `runNudge`
- `followupManage`
- `responseModeManage`
- `additionalMessageModeManage`

Phase 1 rule:

- app `owner` and app `admin` satisfy admin-level checks implicitly
- `shellExecute` stays explicit and is not part of default `member`

## Implementation Notes

- `src/config/schema.ts` defines the new auth shape
- `src/control/auth-cli.ts` is the operator mutation surface for auth today
- config templates should seed `member` as the default role
- any `privilegeCommands` key should fail config loading
- prompt rendering should inject the protected rule after normal template resolution
- the protected rule must not be removable by editable templates
- queue, steer, and loop delivery must reuse the same protected rule as normal messages
- broad advanced-command gating should not be expanded in this task unless directly needed for the above contract

## Suggested Validation

- `bun x tsc --noEmit`
- targeted schema tests for `app.auth` and `agents.<id>.auth`
- targeted loader tests that `privilegeCommands` now fails
- targeted startup or pairing tests for owner claim
- targeted auth CLI tests for app, agent-defaults, and one-agent overrides
- targeted prompt-rendering tests for the protected rule
- targeted refusal tests for:
  - normal message asking to edit `clisbot.json`
  - queued message asking to mutate auth policy
  - steering message asking to run config-mutating `clisbot` CLI
  - loop-triggered prompt asking to mutate protected control resources
- full `bun test`

## Regression Risks

- default `member` loses one of the intended in-channel controls
- `shellExecute` leaks into `member`
- loader still accepts `privilegeCommands` somewhere
- queue, steer, or loop delivery misses the protected rule
- prompt templates weaken the protected rule
- owner claim opens outside DM or reopens incorrectly
- auth CLI `show` or `list` diverges from effective runtime auth
- agent role overrides lose inherited permissions when only one field is customized
- platform principals are accidentally auto-linked or bypass pairing without explicit role grant

## Exit Criteria

- `app.auth` and `agents.<id>.auth` exist in config
- `privilegeCommands` is rejected everywhere
- `clisbot auth ...` exists and reflects effective app or agent auth truthfully
- docs say clearly that default `member` includes `sendMessage`, `helpView`, `statusView`, `identityView`, `transcriptView`, `runObserve`, `runInterrupt`, `streamingManage`, `queueManage`, `steerManage`, and `loopManage`
- docs say clearly that `/bash` depends on explicit `shellExecute` grants
- non-admin users are refused when normal, queue, steer, or loop delivery tries to mutate protected clisbot control resources
- owner claim remains called out as unfinished until the runtime actually auto-claims the first owner
- owner/admin principals bypass pairing, but cross-platform identities do not auto-link
- docs say clearly that finer-grained permission splitting is later work

## Related Docs

- [App And Agent Authorization And Owner Claim](../../../features/auth/app-and-agent-authorization-and-owner-claim.md)
