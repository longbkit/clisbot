# Loop Effective Timezone Truthfulness And Operator Visibility

## Summary

Make loop scheduling truth clearer so operators and AI can tell which timezone a wall-clock loop is actually using, instead of having to guess from multiple inheritance layers.

## Status

Planned

## Why

The runtime already resolves wall-clock loop timezone in a defined order:

- route override
- `control.loop.defaultTimezone`
- host timezone

This task remains valid for loop status and acknowledgement visibility, but the broader timezone configuration decision is now tracked separately in:

- [Timezone Config CLI And Loop Resolution](../configuration/2026-04-26-timezone-config-cli-and-loop-resolution.md)

But that does not automatically mean the behavior is obvious to operators or to the AI running in the routed session.

This is a likely source of confusion:

- the user thinks in one timezone
- the route may override it silently
- the app default may differ from the host
- status often shows `nextRunAt` in UTC ISO, which is truthful but not always cognitively easy

So the bug is not only scheduling logic. It is visibility and prompt truth.

## Scope

- audit where effective loop timezone is shown during `/loop` and `clisbot loops` creation, status, and cancellation flows
- review whether routed prompt context gives the AI a clear current timezone when it reasons about calendar loops
- expose the effective resolved timezone more explicitly in loop acknowledgements and status surfaces
- make route-timezone inheritance easier to inspect from operator help or status output
- add regression coverage for calendar-loop acknowledgement and stored-timezone visibility

## Current Truth

- wall-clock loop timezone already resolves from route override, then `control.loop.defaultTimezone`, then host timezone
- the effective timezone is already frozen onto the persisted wall-clock loop record at creation time
- the remaining confusion appears to be operator and AI visibility, not only raw scheduler correctness
- current Slack and Telegram message payloads do not provide a reliable sender timezone, so loop creation should not silently infer user timezone from each message

## Non-Goals

- redesigning the loop parser
- making old loops silently shift when config timezone changes later
- replacing UTC timestamps in status output entirely

## Exit Criteria

- operators can see the effective timezone without reading code or guessing inheritance
- the AI has enough prompt or status context to avoid timezone confusion for wall-clock loops
- loop acknowledgements and status surfaces show timezone truth clearly enough for routine debugging

## Related Docs

- [Loop Slash Command](2026-04-12-loop-slash-command.md)
- [Channels Feature: Loop Slash Command](../../../features/channels/loop-slash-command.md)
- [Timezone Config CLI And Loop Resolution](../configuration/2026-04-26-timezone-config-cli-and-loop-resolution.md)
