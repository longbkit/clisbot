---
area: runtime, channels, slack, rename
summary: Live validation after a product rename must explicitly stop orphaned old runtimes, or both old and new services can consume the same Slack events and produce misleading duplicate behavior.
files:
  - src/channels/slack/service.ts
  - src/agents/runtime/runner-service.ts
  - src/runners/tmux/session-handshake.ts
---

# Product Rename Must Stop Old Runtimes Before Live Validation

## What happened

During live Slack validation after the `muxbot` to `clisbot` rename, the new `clisbot` runtime was healthy and able to create tmux sessions, but Slack threads still showed an old raw error first and a correct reply later.

The real cause was an orphaned old runtime process still running from the old repo path:

- `.../messaging-platforms/muxbot/src/main.ts serve-foreground`

That old process was still connected to the same Slack bot and consumed the same events in parallel with the new `clisbot` runtime.

## Why this was confusing

- the new runtime looked healthy in `clisbot status`
- tmux sessions were being created correctly by the new runtime
- Slack still showed old behavior because the old runtime posted first
- the resulting symptom looked like one unstable runtime instead of two competing runtimes

## What to do next time

- before live Slack or Telegram validation after a rename, search for old runtime processes by repo path, binary name, and old home directory
- do not trust only the new product's pid file; orphaned old runtimes may no longer have one
- verify there is exactly one live runtime connected to the target bot account before interpreting channel behavior

## Additional runtime lesson

Live tmux server loss can surface as:

- `can't find session: ...`
- `no server running on <socket>`

Recovery logic must treat both as the same missing-runner condition when deciding whether to recreate the tmux-backed runner.
