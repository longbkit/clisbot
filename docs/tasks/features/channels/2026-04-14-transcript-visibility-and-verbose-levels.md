# Transcript Visibility And Verbose Levels

## Summary

Move transcript inspection from privilege gating to a route-level `verbose` policy so monitoring stays easy by default while real privileged actions remain protected.

## Status

Done

## Outcome

After this task:

- `/transcript` is enabled by default through `verbose: "minimal"`
- routes can disable transcript inspection explicitly with `verbose: "off"`
- `/bash` remains auth-gated through `shellExecute`
- Slack and Telegram route status surfaces show the active `verbose` state
- detached-run fallback copy no longer assumes `/transcript` is always available

## Why

The current behavior over-gates transcript inspection.

Users who simply want to monitor an active run should not need the same escalation path as someone trying to execute shell commands.

This feature keeps the architecture cleaner:

- monitoring visibility is a channel policy
- shell execution remains an auth decision

## Scope

- add `verbose` to shared Slack and Telegram channel-route config
- support `off` and `minimal`
- default top-level Slack and Telegram config to `minimal`
- gate `/transcript` from `verbose`
- keep `/bash` under resolved agent auth through `shellExecute`
- update help, status, whoami, and transcript-adjacent copy
- add regression coverage for route inheritance and slash-command behavior

## Non-Goals

- adding richer verbose levels beyond `minimal`
- introducing a new CLI subcommand for editing `verbose`
- changing broader auth semantics beyond wiring `/bash` to `shellExecute`
- implementing `customer-support` bot type in this slice

## Implementation Notes

- `src/config/core/schema.ts` owns the persisted shape
- `src/channels/config/route-policy.ts` resolves inheritance
- `src/channels/message/interaction-processing.ts` gates `/transcript`
- `src/runners/transcript/transcript-rendering.ts` must not assume transcript visibility on detached notes
- `customer-support` remains backlog-only as the later bot type that can seed safer defaults like `verbose: "off"`

## Validation

- `bun x tsc --noEmit`
- targeted tests for interaction processing, route resolution, config defaults, and transcript rendering copy
- full `bun test`

## Exit Criteria

- `/transcript` works on the default route without enabling privilege commands
- `/transcript` is denied when `verbose: "off"`
- `/bash` still requires `shellExecute`
- Slack and Telegram route inheritance reflect `verbose` correctly
- docs explain the split between `verbose` and auth-gated shell execution
