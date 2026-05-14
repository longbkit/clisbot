# Channel Observer Delivery Must Not Own Run Lifecycle

## Summary

Do not let Slack or Telegram delivery failures terminate active-run supervision.

## Problem

`clisbot` originally allowed channel observer delivery errors to bubble out of active-run observer updates.

That coupled transient surface transport failures such as:

- Telegram `fetch failed`
- `ETIMEDOUT`
- `ENETUNREACH`
- Slack post or edit failures

to the same path that owns tmux run monitoring and run settlement.

The result was the wrong failure mode:

- one transport outage could terminate the process
- one observer failure could look like a run failure
- manual restart was needed before polling recovery mattered

## Lesson

The run lifecycle is authoritative.

Channel delivery is best-effort.

That means:

- runner monitoring must stay alive when one surface cannot currently render updates
- observer delivery should classify retryable transport failures separately from non-retryable observer bugs
- retryable transport failures should use bounded retry or degraded delivery rules
- non-retryable observer bugs should detach that observer instead of taking down the run monitor
- final settlement truth matters more than preserving every intermediate live update

## Applied Rule

For active-run observers:

- transient transport failures keep a bounded retry budget
- successful delivery resets the failure budget
- terminal updates do not get infinite retries
- non-retryable observer errors detach immediately

## Where This Matters

- `docs/architecture/runtime-architecture.md`
- `docs/architecture/surface-architecture.md`
- `docs/architecture/transcript-presentation-and-streaming.md`
- `src/agents/session/session-service.ts`

## Reuse

Apply the same boundary to any future channel:

- Discord
- API streaming
- future operator-facing live observers
