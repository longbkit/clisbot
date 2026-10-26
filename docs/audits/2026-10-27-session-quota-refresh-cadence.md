# Session quota refresh cadence (2026-10-27)

The rail's quota (Navigation V2, [session quota](../features/navigation-v2/README.md#session-quota)) read the agent's usage once, when the opened session changed, and never again: the shared fetch query has no interval and refetch-on-focus is off. Only the reset countdown ticked; the percent froze for hours. This records what the providers allow and why the rail polls the way it does. The rules live in `packages/app/src/usage/refresh-policy.ts`.

## What the providers allow

| Source                                                | What is known                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude `GET api.anthropic.com/api/oauth/usage`        | Undocumented. [claude-code #31637](https://github.com/anthropics/claude-code/issues/31637): 429 after a short burst at 30-60 s polling, no `Retry-After`, retries at 30 s to 300 s kept failing for 30+ minutes; closed not planned. [#30930](https://github.com/anthropics/claude-code/issues/30930): 429 with `retry-after: 0` at 30, 60 and 120 s intervals. |
| Codex `GET chatgpt.com/backend-api/wham/usage`        | Undocumented, no published limit. Third-party tools poll it between every 30 s and a configurable interval, with a 15 s timeout.                                                                                                                                                                                                                                |
| [piaz-switch](https://github.com/Benpiaz/piaz-switch) | Same two endpoints (`anthropic-beta: oauth-2025-04-20`, `ChatGPT-Account-ID`). Reads every 5 minutes, sooner only 30 s after a limit resets; reads at least 30 s apart; a returning window rereads at most once a minute, also while the service refuses; a good reading stands in for failed reads for 15 minutes, with its real age shown.                    |

The Claude source (`plugins/claude-usage-source/server/usage.ts`) already keeps a per-token `Retry-After` hold that even a forced refresh does not skip. The Codex source has no hold; only the daemon's cache stands between it and the endpoint.

The daemon (`UsageSourceRegistry`) caches each report for five minutes, keyed by account and login, so several agents on one account share one entry, and it caches failures too. Whoever asks next after the TTL pays the provider call.

## Decision

- The rail never sends `forceRefresh`. Its reads are plain `usage.list_reports`, served from that cache, so any number of apps, windows and sessions cost one provider call per account per five minutes. Forcing on every finished turn would multiply calls by the number of devices and turns on an endpoint reported to answer 429 at 30 to 120 s polling.
- It polls every 2 minutes while the app is visible, rereads when the window comes back and when the agent's turn ends (at least 30 s apart), and pauses while hidden. Two minutes is under the TTL on purpose: a number is at most TTL + 2 minutes old (7 minutes) instead of up to twice the TTL, and a cache hit costs one WebSocket round trip. Polling faster than the TTL cannot make the data newer.
- While reads fail it asks every 5, then 10, then 15 minutes as the numbers age, and an event (focus, a finished turn) waits for the same interval. A failure never shortens the interval. The steps are constants so the query's interval timer is not restarted on every render.
- The daemon TTL stays at five minutes. Shrinking it would only move calls onto the endpoints that already refuse.
- A failed read keeps the last numbers. They are marked stale (dimmed, `~` before the percent, an extra phrase in the accessible label) only when the latest read failed and they are older than the TTL, so an ordinary cache gap and a short blip show nothing. The daemon's `lastSuccessful` supplies the numbers; for a daemon that predates it the rail keeps what it last showed.

## Not done

- The Claude source sends no `User-Agent`. A comment on #30930 claims the API buckets limits by it; unverified, and not changed here.
- A finished turn does not guarantee a fresh number: if the cache is younger than 5 minutes the daemon answers with it.
