# packages/channels/slack DEVIATIONS

One entry per behavioral deviation from the OpenClaw source. The upstream
baseline, the per-file source mapping and the provenance deviations (`D-011`
and up, "this local file gathers these upstream files") live in
`upstream-sync.json`; this file carries the behavioral reasoning. Structural
re-targets are recorded as permanent; no silent drift.

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

## D-038/D-039 — the Bolt provider and its ack-after-admission receiver wrapper

Supersedes the retired D-003 (which described the hand-rolled
`transport/socket-mode.ts` driving `@slack/socket-mode` directly, plus the
retired `socket-pool.ts` / `socket-reconnect.ts`, D-020 / D-021). Slice 21
replaces that transport with upstream's own stack: `@slack/bolt@5.0.0`, the
verbatim `monitor/provider-support.ts` (`createSlackBoltApp`,
`startSlackSocketAndWaitForDisconnect`, the socket logger and the native
reconnect-failure observer) and the verbatim `monitor/reconnect-policy.ts`
(backoff policy, shared-connection diagnostics, auth-error classification,
disconnect waiter).

- **The ack order is the load-bearing fact.** Bolt acks Events API envelopes
  BEFORE the listener chain runs (`App.js`: "Events API requests are
  acknowledged right away"). That is ack-before-admission, which the Fusion
  inbound contract forbids. `monitor/ingress.ts` keeps upstream's own
  `wrapReceiver` seam — the wrapper swaps the receiver's app for a shim — and
  the Fusion shim hands Bolt a DEFERRED ack, so the real Socket Mode envelope
  is acked only after `app.processEvent` resolved, i.e. after the listener's
  Hub admission returned. A listener fault rejects `processEvent`
  (`app.error` rethrows), the receiver's `processEventErrorHandler` is the
  upstream `async () => false`, and the envelope is redelivered. Pinned by
  `src/monitor/provider.test.ts` ("does not ack until the Hub handoff
  resolved", "never acks when the Hub handoff fails").
- **Interactive components and slash commands ack FIRST.** Slack closes their
  response window after 3s, far below a durable write plus an agent turn.
  Upstream's wrapper makes the same exception: non-`event_callback` payloads
  pass straight through to the listener's own `ack()`. This is the documented
  exception to admission-before-ack (D-041).
- **Bolt's authorize is the account's probed identity.** Bolt's single-token
  authorize calls `auth.test` on the first event. The account lifecycle already
  ran exactly that call (`probeSlackAuth`), so `provider.ts` installs the
  probed identity instead. `createSlackBoltApp` stays byte-identical.
- **The cut point.** Everything upstream's provider does after
  `createSlackBoltApp` — the OpenClaw config graph, `SlackMonitorContext`, the
  `monitor/message-handler` prepare/dispatch tree — is out: the Hub owns
  config, authorization, routing and the agent. The Fusion listeners build a
  `ChannelInboundEvent` and admit it.
- upstream status: this is now the upstream SDK and the upstream construction;
  the hand-rolled transport is retired.

## D-040/D-041 — inbound system events and interactive callbacks

Upstream's `monitor/events/{reactions,members,channels,pins}.ts` register on
the OpenClaw monitor context and publish through `enqueueRoutedSystemEvent`;
`interactions.block-actions.ts` decodes a payload and then drives OpenClaw's
approval gates, question finalization and command runner. Fusion has neither
bus, so the port keeps the part that is protocol truth and cuts the rest:

- `monitor/events/system-events.ts` reproduces the notification TEXT and the
  dedupe CONTEXT KEY character for character (`Slack reaction added: :x: by U
in C msg TS from U2`, `Slack: U joined C.`, `Slack channel renamed: #n.`,
  `Slack: U pinned a message in C.`) and emits a `ChannelInboundEvent` whose
  `body` is that text, `externalMessageId` is that context key and
  `wasMentioned` is false — a reaction or a join never addresses the bot, so a
  mention-gated conversation ignores it and an always-reply conversation sees
  it, which is what `enqueueRoutedSystemEvent` does once its route resolves.
- `message_changed` / `message_deleted` go through the VERBATIM
  `monitor/events/message-subtype-handlers.ts` registry for sender, thread and
  context key; only `describe()` is rendered locally. Before slice 21 both
  subtypes produced an empty body and were dropped.
- `monitor/events/interactions.ts` keeps the decode half only: actor id,
  action id, element value (button value, selected option(s), date, user),
  conversation, message ts, thread ts, trigger id. It admits them as an inbound
  event with `wasMentioned: true` (a click on the bot's own card IS an address
  to the bot). The native approval seam (`transport/approval-card.ts` →
  `channelRuntime.approvalAction`, D-010) runs from the same listener,
  unchanged.
- upstream status: in-repo decision — permanent while the Hub owns routing and
  approvals.

## D-004 — `WebClient` loaded through a dynamic import

client/web-api.ts loads the `WebClient` ctor via `await import("@slack/web-api")`
inside the client factories so the module's pure surface (probe, error
shaping, constants, token-cache-key) stays importable and testable without the
pinned dep present at import time.

- reason: keeps the probe/error tests hermetic; the write/read client factories
  are the only sites that touch the dep.
- upstream status: n/a (structural) — permanent.

## D-026 — outbound text renders through the upstream `format.ts`

`sendSlackText` and the Block Kit `mrkdwn` field render both call
`normalizeSlackOutboundText` (`src/format.ts`, ported verbatim from
`extensions/slack/src/format.ts@5d8067a4483`). The in-repo
`src/mrkdwn.ts` / `renderSlackMrkdwn` markdown-it front end it replaces is
deleted, together with the earlier D-005 and D-013 entries that described it.

- effect on the wire: one behavior change. Upstream escapes all three
  XML-unsafe characters in text leaves, so `1 < 2 & 3 > 0` now posts as
  `1 &lt; 2 &amp; 3 &gt; 0`; the retired renderer left `>` literal. Everything
  the retired renderer produced for code spans, fenced blocks, links,
  emphasis, strikethrough, blockquotes and lists is unchanged, and the
  upstream renderer additionally carries the angle-token preservation
  (`<@U…>`, `<!here>`, `<#C…|name>`, `<url|label>`), CJK-width-aware bold
  boundaries, table modes and assistant-transcript role-header protection the
  in-repo renderer never had.
- test migration: `src/mrkdwn.test.ts` is deleted. Its two production-path
  cases moved into `src/outbound.test.ts` (the render-through-`sendSlackText`
  assertion and the "no unescaped entity chars" assertion, the latter updated
  for `&gt;`). The remaining unit cases are covered on the new production path
  by the upstream `src/format.test.ts` (25 cases, ported verbatim); the
  round-trip case `renderSlackMrkdwn(decodeSlackEntities(wire)) === wire` is
  dropped because the decode half now lives in `src/fusion/slack-entities.ts`
  (D-024) and the render half is upstream's, whose own suite pins the
  angle-token round trip.
- reason: the goal is the upstream source, not a local equivalent. See
  `docs/audits/2026-09-07-openclaw-channel-port-goal.md`.
- upstream status: this is now the upstream implementation; the local one is
  retired.

## D-024 — inbound entity decode stays Fusion-owned

Upstream keeps its mirror of this decode private inside `format.ts`
(`decodeSlackMrkdwnEntities`, `&amp;`/`&lt;`/`&gt;` only), so there is no
upstream symbol to import. `src/fusion/slack-entities.ts` keeps the in-repo
`decodeSlackEntities` — which also decodes `&quot;` and `&#39;`, both of which
Slack emits in some payloads — for the L2 transport's inbound boundary
(`transport/socket-event-filter.ts`).

- upstream status: n/a (structural) — permanent until the inbound port
  (slice 21) brings the upstream inbound normalizer in.

## D-023 — package tsconfig drops two strict flags for the ported source

`exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature` are off
for this package so the ported OpenClaw files compile verbatim; OpenClaw's own
tsconfig sets neither. Mirrors the Telegram package's D-TG-001.

- upstream status: n/a (build configuration) — permanent while ported source
  is present.

## D-025 — nested lint override for ported source

`.oxlintrc.json` (copied from `packages/channels/markdown-core/.oxlintrc.json`)
turns off the stylistic rules the root config enforces but OpenClaw's lint
config does not. Enforcing them would mean editing every ported file and
losing the upstream diff. Correctness, suspicious and perf rules still apply.

- upstream status: n/a (lint configuration) — permanent while ported source is
  present.

## D-006 — retired reply-text media parsing

The pinned OpenClaw vertical parses reply text for media paths through its
`reply-media-paths` runtime. The in-repo vertical retires that text parsing:
media is posted only through the Hub's `message` MCP tool media params
(`attachments`/`media`/`buffer`), which route into this vertical's
`outbound.sendMedia`. `sendSlackText` posts text
only; G7–G11 semantics remain on `sendMedia`.

- effect: reply text containing a local path stays a text post.
- reason: media delivery requires an explicit Hub-side action.
- upstream status: in-repo decision — the pinned runtime's reply-text parsing
  is retired.

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

## D-010 — native approval-card seam: `blocks` on send, `updateText` adapter, `block_actions` hand-off

Renumbered 2026-09-07: this entry was a second `D-006` (duplicate id).

The pinned vertical's outbound surface is one `text` field; the in-repo P0
adds the native card seam (2026-08-27, COMPAT(clisbot-control-plane)):
`sendSlackText` accepts a `blocks` payload (posted verbatim, the plain `text`
is the `fallback` field) and reports `cardPosted`, `updateSlackText` does the
card's in-place `chat.update` (the pinned @slack/web-api method name; `blocks: []` clears the actions when
`clearCard`), and the L2 transport's `block_actions` Socket Mode envelope is
parsed by `transport/approval-card.ts` (`parseApprovalCardClick`) and handed
to the hub through the `onInteractive` / `channelRuntime.approvalAction`
seam. The hub owns ONLY the card-value scheme (`parseCardValue`); the
vertical owns the wire envelope. Inert by default: with the seam unwired the
transport still acks every `block_actions` and dispatches nothing.

Wire fact (live-verified 2026-08-29, the original dead-button bug): the
Socket Mode ENVELOPE type of a Block Kit click is `"interactive"` —
`block_actions` is the PAYLOAD's type — and @slack/socket-mode emits
non-events_api envelopes on the envelope type, so the transport listens on
`"interactive"` and filters `body.type === "block_actions"` (every other
interaction — modal, Home tab, `block_suggestion` — is acked and dropped
before the seam). The second live failure that day: `parseApprovalCardClick` read the conversation id from `message.channel` — the stored `message` object carries NO channel field; the id is the payload's top-level `channel.id` (fallback `container.channel_id`). Fixed + pinned by `transport/approval-card.test.ts` against the real wire shape.

- effect: an approver's button click reaches the hub's exactly-once
  resolver as `cardValue` + sender + conversation location.
- reason: channel-open typing — the hub package keeps zero
  `@getpaseo/channels-*` imports, so the payload crosses the plane as a plain
  record and the wire-specific parsing stays in the vertical.
- upstream status: in-repo decision (P0 slice; the pinned vertical has no
  card surface — it is the OpenClaw plugin host's, out of scope here).

## D-007 — inbound media fold (F-06, G5+G6): `files[]` download + shared manifest, trimmed to the P0 admission surface

The OpenClaw inbound-media pipeline (`monitor/media.ts`) is a full
concurrency-pooled, audio-preflight, fresh-URL-refetching download engine.
The in-repo vertical (2026-08-28, COMPAT(clisbot-control-plane)) ports the
P0 fold only — `transport/media.ts`: a message event's `files[]` are
extracted (`extractSlackFileAttachments`), each downloaded in order through
the SHARED stream-to-disk helper (`downloadMediaFile`, Bearer bot token, the
shared `MEDIA_DOWNLOAD_TIMEOUT_MS` 10-minute floor) into
`<dataDir>/channels/<accountId>/downloads`, and the `[Attached files]`
manifest (shared `buildAttachedFilesManifest`) is folded into the inbound
body in `socket-mode.ts`'s `handleEnvelope` BEFORE the L3 handoff. Admission
semantics match the Telegram vertical exactly (the G-parity contract): a
per-file failure or an external/host-not-Slack file is a logged skip, a
media-only message is admitted with a manifest-only body (G6), and a
message whose files ALL fail and has no text trims its body to `""` → dropped
(the L3's empty-body drop would catch it too).

- effect: an agent sees inbound Slack attachments as absolute local paths in
  the `[Attached files]` manifest, the same shape as Telegram.
- reason: DRY — the download-to-disk + manifest + body-fold are shared with
  the Telegram vertical (`packages/channels/shared/src/media.ts`); the
  vertical owns only the Slack wire specifics (`files[]` shape, the
  `url_private_download` → `url_private` preference, the Slack host
  allowlist, the Bearer-token header). The OpenClaw extras (audio preflight,
  `fetchFreshSlackFileUrl` refetch, `MAX_SLACK_MEDIA_CONCURRENCY` pool,
  `maxBytes` size cap) are NOT the P0 fold's concern.
- upstream status: in-repo decision — mirrors the OpenClaw download URL +
  host-allowlist + Bearer-token facts, trimmed to the P0 surface.

## D-008 — native media outbound (`plugin.outbound.sendMedia`, G7–G11): 3-step external upload, one post per file

The 2026-08-28 wave-3 addition ports the one-file media post so the Hub can
deliver an agent-produced local media file. `sendMedia` (one call = one file)
runs the shared G11 gate FIRST (`evaluateOutboundMedia` in
`packages/channels/shared/src/media-policy.ts`), which is size-only (amended
2026-08-29: the Slack API accepts arbitrary file types, so an unknown
extension posts as `application/octet-stream` rather than being refused): an
oversized file (over `SLACK_MAX_MEDIA_BYTES` = 250 MB) is not dropped — the
in-channel notice (`"Could not post media <name>: too large (Slack limit
250 MB)"`) is posted through `chat.postMessage` (the plain `sendSlackText`
path, `thread_ts` threaded when given) and `mediaPosted` reports false; a
transport fault (missing local file, upload fault) throws so the Hub's
`failDelivery` owns it. The file is posted through the
3-step external upload (`uploadSlackFile` in `outbound-media.ts`), a verbatim
mirror of OpenClaw `extensions/slack/src/client-delivery.ts` `uploadSlackFile`
(2026.7.1): `files.getUploadURLExternal({filename, length})` → `POST` the raw
bytes to the returned `upload_url` (only after the host passes the Slack-host
allowlist — `isSlackUploadUrl`, `https://` + `slack.com`/`slack-edge` suffix;
a non-Slack host refuses before any byte is sent) →
`files.completeUploadExternal({files:[{id,title}], channel_id,
thread_ts?, initial_comment?})`.

- effect: an agent-produced local file reaches the external conversation as a
  Slack attachment; `threadTs` targets a thread when given.
- reason: DRY — the 250 MB cap + notice wording + ext→mime + format gate live
  in the shared `media-policy.ts` (ONE home, shared with the Telegram
  vertical's 50 MB cap + notice); the vertical owns only the Slack wire
  specifics (the 3-step external-upload shape, the upload-host allowlist).
- sent-message record keys on the file id (`completeUploadExternal` returns the
  file id, not a new message ts) — a file post's channel-native id; the
  `recordSlackSentMessage` write-back is the same seam as `sendText` (D-001).
- upstream status: in-repo decision — mirrors the OpenClaw 3-step
  external-upload + host-allowlist facts; the OpenClaw extras (the legacy
  `files.upload` single-call path, `DNS request retry` wrapper, the
  `resolveSlackUploadTimeoutLogUrl` redaction log, audio-video transcode
  preflight) are NOT the P0 fold's concern.

## D-042 — the socket client is flagged shutting-down when the abort fires

`monitor/provider.ts` sets Bolt's `shuttingDown` flag from an `abort` listener
(`markSlackSocketShuttingDown`, split out of `gracefulStopSlackApp` in the
otherwise verbatim `monitor/provider-support.ts`) instead of only in the
`finally` after `startSlackSocketAndWaitForDisconnect` resolves.

Upstream's patched reconnect scheduler reads `shuttingDown` when its timer
fires. Setting it after the disconnect await left a window where a stopping
account's socket reconnected and kept consuming events; the account's monitor
was already gone, so those events had nowhere to land.

- reason: a stop must be a stop — the Hub supervisor's abort is the only stop
  signal an account gets, and the fix is a two-line reordering, not new
  behavior.
- upstream status: candidate for an upstream PR — permanent until then.

## D-009 — `plugin.outbound.typing`: the `sync.progress` liveness surface

The pinned vertical sets the thread status from inside its own pipeline
(`provider-C1-DFSpw.js:278-295` `setSlackThreadStatus`, the
`SLACK_THREAD_LOADING_MESSAGES` rotation at
`pipeline.runtime-rpVpay59.js:620-625`); the in-repo vertical has no pipeline
around the turn, so the drive surface owns the wire and the Hub owns the
lifecycle: `outbound.typing({cfg, accountId, to, action, indicator, threadId,
messageId, reactionEmoji})`.

- effect: `indicator` → `assistant.threads.setStatus` with `status:
"is typing..."` + the rotation, cleared with `status: ""`; `reactionEmoji` →
  `reactions.add` / `reactions.remove` on the sender's own marker (the receipt
  the message was taken). The status anchors on the reply thread, else on the
  sender's own message `ts` — a root message's `ts` is a valid `thread_ts`, so
  an unthreaded ask still shows liveness under itself instead of going silent.
  Only a turn with neither (a slash command's synthetic marker id) attempts
  nothing.
- reason (repeat cost): one set and one clear per surface. Slack holds an
  assistant status for ~2 minutes and clears it itself when the bot answers, so
  the Hub's 60s lease TTL needs no re-push; a repeat `start` for a surface this
  process already opened is a no-op. (The pinned host re-sends on a 3s
  keepalive because its callback is shared with Telegram, whose action DOES
  lapse — that cadence is Telegram's, not Slack's.)
- reason (failure posture): the pinned path swallows every error (`logVerbose`).
  In-repo a wire fault THROWS so the Hub's breaker counts it, and `missing_scope`
  logs once per account naming both ways out (add the scope, or set
  `sync.progress.typingIndicator: false`). A silently-failing status call is how
  a misconfigured app stays misconfigured.
- scope: `assistant.threads.setStatus` is served by `chat:write` (already
  required); `assistant:write` is the compatibility scope Slack still accepts,
  kept OUT of `SLACK_REQUIRED_BOT_SCOPES` (it is `SLACK_OPTIONAL_BOT_SCOPES`) so
  an app without it still verifies. `reactions:write` was already required.
- upstream status: in-repo decision. The vendor's separate
  `channels.slack.typingReaction` key (`docs/channels/slack.md:1204-1215`) is
  folded into the shared `sync.progress.messageReaction` leaf rather than
  mirrored as a Slack-only transport key. Contract:
  `docs/audits/pinned-vertical-contracts/typing.md`.
