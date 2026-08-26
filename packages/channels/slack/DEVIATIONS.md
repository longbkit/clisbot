# packages/channels/slack DEVIATIONS

One entry per behavioral deviation from the OpenClaw source reference
(`extensions/slack/src/` @ 2026.7.1). Structural re-targets are recorded as
permanent; no silent drift.

## D-001 — sent-message write-back targets the plane's keyed-store seam

`recordSlackSentMessage` (outbound.ts) persists "the bot sent message N in
conversation C" through the plane's keyed-store seam
(`runtime.state.openKeyedStore`, namespace `slack.sent-messages`,
`maxEntries` 10 000), not an OpenClaw config file / global-singleton cache.
Mirrors the OpenClaw `sent-thread-cache.ts` `recordSlackThreadParticipation`
seam write but re-aimed at the in-repo `HostKeyedStore` contract
(blueprint §2.4, decisions §7.3; state-store-namespaces.md §Slack).

- reason: customer state stays in the plane; the OpenClaw config file /
  global singleton is not ours once the vertical is in-repo.
- upstream status: n/a (structural) — permanent.

## D-002 — L1 client is a straight `@slack/web-api` WebClient

The pinned vertical resolves its Web API clients through
`openclaw/plugin-sdk` fetch/proxy helpers. In-repo the client is a plain
`WebClient` (client/web-api.ts) with the pinned retry/timeout policy and the
`SLACK_API_URL` env override. No `openclaw/*` specifier, static or dynamic.

- reason: zero OpenClaw imports is a hard rule (blueprint §6.5 rule 1); the
  pinned npm dep `@slack/web-api@7.18.0` is the client.
- upstream status: n/a (structural) — permanent.

## D-003 — L2 transport talks to `SocketModeClient` directly

The pinned vertical rides on `@slack/bolt`'s `SocketModeReceiver` + its
patched native-reconnect failure observer (`installSlackNativeReconnectFailureObserver`).
In-repo the transport (transport/socket-mode.ts + socket-reconnect.ts) drives
the pinned npm dep `@slack/socket-mode@2.0.7` `SocketModeClient` directly,
keeping the pinned backoff/abort/auth-error semantics and dropping the Bolt
`App`/HTTP-receiver surface (Socket Mode only).

- reason: no `@slack/bolt` dep (out of the pinned two); the socket loop's
  behavior is ported, not the receiver plumbing.
- upstream status: n/a (structural) — permanent.

## D-004 — `WebClient` loaded through a dynamic import

client/web-api.ts loads the `WebClient` ctor via `await import("@slack/web-api")`
inside the client factories so the module's pure surface (probe, error
shaping, constants, token-cache-key) stays importable and testable without the
pinned dep present at import time.

- reason: keeps the probe/error tests hermetic; the write/read client factories
  are the only sites that touch the dep.
- upstream status: n/a (structural) — permanent.

## Confirmed (not a deviation) — inbound `To` / `OriginatingTo` is the conversation id

The OpenClaw source builds the inbound delivery `to` from the channel id, not
the message ts: `monitor/events/messages.ts:38`
(`from = slack:${workspaceId}:channel:${channelId}:user:${userId}`) and the
interaction tests pin `to: "channel:C1"` / `to: "team:T9:channel:C1"`. The
in-repo transport therefore does NOT carry a `replyTo` field on the inbound
event, so the shared L3 `buildInboundCtxPayload` defaults
`To` / `OriginatingTo` to `externalConversationId` (the channel id) — never a
message ts. (The prior in-repo draft set `replyTo: ts`, which would have made
`To` a ts; that was removed.) `MessageSid` remains the message ts.
