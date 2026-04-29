# Loops CLI

## Summary

`clisbot loops` is the operator-facing control surface for creating, inspecting, and cancelling loop work with the same parser family used by channel `/loop`.

It is also the source of truth that AI agents should inspect when users ask to create, schedule, repeat, remind, or run something later or periodically.

Examples:

- `clisbot loops list`
- `clisbot loops status`
- `clisbot loops status --channel slack --target group:C123 --thread-id 1712345678.123456`
- `clisbot loops create --channel slack --target group:C123 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops create --channel slack --target group:C123 --new-thread --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox`
- `clisbot loops --channel telegram --target -1001234567890 --topic-id 42 --sender telegram:1276408333 5m check CI`
- `clisbot loops --channel slack --target group:C123 --thread-id 1712345678.123456 --sender slack:U1234567890 3 review backlog`
- `clisbot loops cancel abc123`
- `clisbot loops cancel --channel slack --target group:C123 --thread-id 1712345678.123456 --all`
- `clisbot loops cancel --all`

## Routed Targeting

- `--target` chooses the routed surface, not the schedule:
- for Slack, `--target` accepts canonical `group:<id>` and `dm:<user-or-channel-id>`, plus raw `C...` / `G...` / `D...` ids
- legacy `channel:<id>` input still works for compatibility, but it is not the preferred contract
- for Telegram, `--target` is the numeric chat id
- `--thread-id` narrows a Slack route to one existing thread ts
- `--topic-id` narrows a Telegram route to one topic id
- omitting the sub-surface flag means the parent surface itself: Slack channel/group/DM or Telegram chat
- `--new-thread` is Slack-only and creates a fresh thread anchor in the target channel/group/DM before the loop starts
- `--sender <principal>` is required for loop creation and records the human creator as `slack:<user-id>` or `telegram:<user-id>`
- `--sender-name <name>` and `--sender-handle <handle>` optionally store readable creator context for scheduled prompts
- for Telegram forum groups, omitting `--topic-id` targets the parent chat surface; sends then follow Telegram's normal no-`message_thread_id` behavior, which is the General topic when that forum has one

## Scope

- global inventory of persisted managed loops across the app
- scoped loop creation for one routed Slack thread or Telegram chat/topic
- scoped session status matching `/loop status`
- scoped session cancellation matching `/loop cancel`
- operator-safe cancellation by loop id
- operator-safe cancellation of all persisted loops
- shared output format for global inventory and scoped session status

## Non-Goals

- immediate IPC into the live runtime process
- a shared cross-process queue for one-shot count loops

## Invariants

- `clisbot loops list` stays app-wide inventory
- bare `clisbot loops status` stays app-wide inventory, while scoped `status --channel ... --target ...` answers the same session-scoped question as `/loop status`
- recurring CLI-created loops are persisted into the same session store shape that channel `/loop` already uses
- CLI loop creation fails without `--sender` so delayed work keeps a real creator instead of rendering sender as unavailable
- omitting the prompt body keeps slash-command maintenance semantics by loading `LOOP.md` from the target workspace
- `clisbot loops cancel --all` without a routed target is app-wide
- scoped `clisbot loops cancel --all` clears one routed session
- scoped `clisbot loops cancel --all --app` matches `/loop cancel --all --app`
- output is global, so every rendered loop includes both `agentId` and `sessionKey`
- recurring loop creation reuses the same parse and persistence rules as `/loop`

## Implementation Notes

### Data Source

- the CLI reads persisted loop state from the session store at `session.storePath`
- default path is `~/.clisbot/state/sessions.json`
- when `CLISBOT_HOME` is set, the default path becomes `<CLISBOT_HOME>/state/sessions.json`
- the CLI intentionally loads config without channel token env resolution because loop inspection or creation should not fail just because Slack or Telegram tokens are unavailable in the current shell
- scoped loop creation resolves the routed session key from the same Slack and Telegram route/session logic used by the channel services

### Creation And Cancellation Model

- recurring interval and wall-clock loops created from the CLI are persisted first into the routed session entry
- CLI creation accepts the same loop expression families as `/loop`: interval, forced interval, times/count, and calendar wall-clock schedules
- CLI creation requires `--sender <principal>` and persists creator metadata on recurring loops
- if no wall-clock loop has been created successfully yet, the first wall-clock create command returns `confirmation_required` and does not persist a loop
- the confirmation-required output includes the proposed schedule, resolved timezone, next run, and the exact retry command with `--confirm`
- a confirmed retry creates the loop only when `--confirm` is present
- AI agents should not infer first-loop state; they should run the loops CLI and follow the confirmation output exactly
- the live runtime periodically reconciles persisted loop state, so a running service can pick up new operator-created recurring loops without a restart
- if runtime is stopped, recurring CLI-created loops activate on the next `clisbot start`
- one-shot count loops run synchronously inside the CLI because the top-level operator process still has no shared queue IPC with the long-lived runtime
- `clisbot loops cancel <id>` removes the matching loop record from persisted session state
- `clisbot loops cancel --all` clears all persisted loop records across all sessions
- runtime loop state updates use compare-on-write semantics, so a stale in-memory loop update cannot recreate a loop that the CLI already cancelled
- the live runtime scheduler now re-checks persisted loop existence before each scheduled tick
- this means operator CLI cancellation suppresses future runs without needing a separate loop-specific IPC channel
- cancellation does not interrupt a loop iteration that is already running

### Shared Rendering

- global inventory and scoped status reuse the same schedule rendering and prompt-summary rules as channel `/loop`
- each loop row includes:
  - loop id
  - agent id
  - session key
  - interval or wall-clock schedule
  - remaining run budget
  - next run timestamp
  - prompt summary

## Related Docs

- [Task Doc](../../tasks/features/control/2026-04-13-loops-cli-management.md)
- [User Guide](../../user-guide/README.md)
- [Control Test Cases](../../tests/features/control/README.md)
