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

## D-005 — outbound text is rendered with a markdown-aware `renderSlackMrkdwn`, not the full markdown front-end

The OpenClaw outbound pipeline renders agent markdown through the full
`format.ts` front-end (angle-token preservation, link → `<href|label>`
conversion, tables, CJK-width-aware bold boundaries). The in-repo P0 relay
posts one `text` field (Block Kit is out of scope — group E), so
`sendSlackText` renders the text through `renderSlackMrkdwn` (`src/mrkdwn.ts`):
a markdown-it parse whose token walk emits Slack mrkdwn for the supported
constructs (code spans / fenced blocks, links, bold `*…*`, italic `_…_`,
strikethrough `~…~`, blockquote, lists) and escapes only the XML-unsafe
chars (`&` `<` `>`) inside text leaves. A literal backslash the agent typed
is kept.

The earlier P0 behavior escaped every `\` `&` `<` `>` `([*_`~])`with
backslash prefixes (the verbatim port of the pinned`monitor/mrkdwn.ts`
`escapeSlackMrkdwn`); that also escaped the backtick delimiter itself, so a
legitimate `` `code` `` span posted as literal `\`code\`` with visible
backslashes — the markup the agent wanted to render was killed.

- effect: legitimate markdown renders as mrkdwn; a `\` or `&` in prose still
  cannot start a broken entity/mention.
- reason: mrkdwn is a strict subset of CommonMark for these constructs, so a
  shared parse-and-emit walk renders the intended markup while staying
  entity-safe; the full OpenClaw front-end remains out of scope (tables,
  angle-token preservation) for the P0 text path.
- upstream status: n/a (decision) — the walk is a new in-repo renderer;
  `escapeSlackMrkdwn` is no longer used outbound.

## D-006 — retired reply-text media parsing

The pinned OpenClaw vertical parses reply text for media paths through its
`reply-media-paths` runtime. The in-repo vertical retires that text parsing:
media is posted only through the Hub's explicit `send_file` MCP tool, which
routes into this vertical's `outbound.sendMedia`. `sendSlackText` posts text
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

## D-006 — native approval-card seam: `blocks` on send, `updateText` adapter, `block_actions` hand-off

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
