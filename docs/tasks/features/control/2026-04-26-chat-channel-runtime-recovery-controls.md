# Chat Channel Runtime Recovery Controls

## Summary

Add chat-surface recovery commands so an authorized user can restart or reset a broken current runner session from Slack or Telegram without shelling into the server.

## Status

Planned

## Priority

P0

## Why

Chat channels should be the most reliable control surface for day-to-day operation.

Today, when a tmux-backed runner starts with bad environment, stale CLI auth, broken key configuration, or a wedged CLI prompt, the user may have no practical recovery path from the same Slack channel, Telegram group, or topic. The fallback becomes logging into the server and running broad commands such as `clisbot stop --all`, which is too coarse and too dependent on terminal access.

The product should let authorized users recover the affected conversation or runner from the chat surface where the failure is visible.

## Outcome

- Users can invoke a chat command to recover the current broken runner/session.
- The default recovery target is the current conversation session, not the whole app.
- App-wide runtime restart remains explicit, high-permission, and clearly named.
- The same recovery semantics are available through operator CLI and chat commands without duplicating implementation paths.
- Chat help and status explain the difference between interrupt, runner/session restart, and app/runtime restart.

## Scope

- define chat command names and grammar for recovery actions
- define the target hierarchy:
  - current conversation session
  - current channel/group/topic route
  - current bot
  - whole app runtime
- define what `restart`, `stop`, and `reset` mean across:
  - chat slash commands
  - operator CLI commands
  - runner backend actions
- implement one shared control path consumed by both CLI and channel commands
- enforce owner/admin permission checks before destructive recovery actions
- add user-visible status/result messages that explain what was restarted or stopped
- add tests for current-session recovery from Slack and Telegram command parsing boundaries

## Open Questions

- Does chat `/restart` mean restart only the current runner session, or should the safer name be `/reset` for current-session recovery?
- Should `/stop` continue to mean interrupt current active run only, while `/restart` or `/reset` handles runner process recreation?
- Should app-level restart require an explicit scope such as `/restart app` and owner-only permission?
- Should route-level recovery close every session under the current Slack channel, Telegram group, or Telegram topic, or only the session matching the current thread/topic key?
- How should ACP or SDK runners map the same recovery verbs when there is no tmux process to kill?

## Suggested Direction

- Keep existing `/stop` as an interrupt command for the current active run.
- Add a separate recovery command for runner/session recreation rather than overloading `/stop`.
- Make the no-argument recovery command target the current conversation session only.
- Require explicit scope words for anything broader than the current session.
- Prefer `control` as the semantic owner, with `channels` acting only as an authorized command ingress.
- Reuse `SessionService` and `RunnerService` ownership boundaries so tmux-specific recovery stays inside the runner layer.

## Non-Goals

- replacing the operator CLI
- adding unauthenticated channel control
- making every chat user able to restart shared infrastructure
- hiding the fact that some failures still require server access

## Done Criteria

- documented command names and scope semantics
- shared implementation path for CLI and channel recovery actions
- owner/admin permission checks covered by tests
- current-session recovery tested for Slack and Telegram
- help text and user guide updated
- recovery result messages include the resolved target and whether runner state was recreated, interrupted, or left unchanged

## Related Docs

- [Control Feature](../../../features/control/README.md)
- [Agent Commands](../../../features/agents/commands.md)
- [Runtime Architecture](../../../architecture/runtime-architecture.md)
- [Surface Architecture](../../../architecture/surface-architecture.md)
- [Auth-Aware CLI Mutation Enforcement And Runner Command Guardrails](2026-04-14-auth-aware-cli-mutation-enforcement-and-runner-command-guardrails.md)
- [Operator Control Surface And Debuggability](2026-04-04-operator-control-surface-and-debuggability.md)
