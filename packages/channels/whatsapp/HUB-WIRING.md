# Hub wiring for `@clisbot/channels-whatsapp`

What the Hub reads from this vertical and where each piece is wired. The
operator view is [public-docs/hub/channels/whatsapp.md](../../../public-docs/hub/channels/whatsapp.md);
the platform rules are [docs/features/channels/README.md](../../../docs/features/channels/README.md).
Every boundary decision has a `D-WA-*` row in `upstream-sync.json`.

## 1. Catalog, pin, config

| Piece      | Where                                                     | Value                                                                                                                                                            |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog    | `packages/hub/src/channels/catalog.ts`                    | `auth: "qr"`, one `qr` transport with no required config, capabilities without thread/edit/delete                                                                |
| Pin        | `packages/hub/channel-pins.json`                          | `in-repo`, entry `./dist/index.js`, plugin `./dist/plugin.js` → `whatsappPlugin`                                                                                 |
| Config     | `channels/config/schema.ts` `WhatsappAccountConfigSchema` | `enabled`, `name`, `mediaMaxMb`, `textChunkLimit`, `sendReadReceipts`, `selfChatMode`, `replyToMode` (chunk mode is `streaming.chunkMode`, as upstream reads it) |
| Connection | `db/schema.ts` `whatsapp_connections` (migration `0090`)  | stores only the non-secret `name` label                                                                                                                          |
| Carrier    | `channels/supervisor/account-carriers.ts`                 | `{ accountId, name? }`; `fusion/account-config.ts` is the single reader                                                                                          |

There is no token. `authDir` is never authored: the vertical pins it to the
account's virtual directory in the encrypted store and replaces any authored
value (D-WA-025).

## 2. The encrypted namespace

`channels/state/encrypted-namespaces.ts` routes the keyed-store namespace
`auth` to `channel_state_secrets`. It holds Baileys' `creds.json` and every
Signal key file as one snapshot. The keyed store caps a value at 64KB and a
freshly paired device holds ~800 pre-keys, so the snapshot is split into parts
(`auth-dir@<generation>#<n>`) and the header `auth-dir` names the generation;
the header moves last, so creds and keys always read back as one consistent
set (`fusion/auth-fs.ts`). Writes are coalesced for 25 ms and an awaited write
is durable. The Hub backing rewrites the whole envelope per mutation, so one
persist costs one upsert per part plus the header and the old parts' deletes.

Nothing is stored before a scan. Logout clears the entry.

## 3. QR verbs and `needs-login`

`plugin.setup` publishes the five verbs `supervisor/qr-login.ts` calls
(`startQrLogin`, `pollQrLogin`, `cancelQrLogin`, `relinkQrLogin`, `logout`) and
`bindAccountSession`. The Hub passes the account id as `profile` and as
`accountId`, and the account's own `hostRuntime`. The vertical is imported once
per channel, so its channel-wide runtime slot is the last-loaded account's:
credential I/O goes through `accountHostRuntime` (`runtime-store.ts`) — the
passed runtime, else the one the account started with, else an error.

- `poll` returns the newest QR image when WhatsApp rotated it.
- `bindAccountSession` on an account that is already running keeps the live
  auth copy; it never reloads over it.
- An account with no login, or one WhatsApp logged out, fails its start with
  `… is not logged in …` — the phrase `supervisor/needs-login.ts` matches (it
  still accepts the older `is not linked`). The app calls QR sign-in **Log in**
  / **Log out**; "link" is kept for a Channel identity and `/link`.
  `needs-login.test.ts` drives the real built vertical to pin it.

## 4. Inbound

Push family (§ durable admission in the platform doc). Kinds emitted:
`message`, `command` for a leading `/verb` after any @mentions, `poll_answer`
for a decrypted vote, and `callback` for a reaction on a card prompt (§5).

| Field                    | Value                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `externalConversationId` | the chat jid (`…@g.us`, `…@s.whatsapp.net`, `…@lid`); also `replyTo`      |
| `externalMessageId`      | the WhatsApp message id; `externalEventId` is `<jid>/<id>`                |
| `senderId`               | E.164 when WhatsApp exposes it, else the participant jid                  |
| `wasMentioned`           | DM always; group when a mentioned jid or the quoted author is the account |
| media                    | saved under `ctx.mediaDownloadDir`, listed in `[Attached files]`          |
| location, contacts, ad   | upstream's labeled JSON blocks after the body (`formatContextJsonBlock`)  |

## 5. Outbound and actions

`outbound.sendText` / `sendMedia` / `typing` post through upstream `send.ts`
(formatting, 4000-char chunks, group @mentions, media). The message tool
exposes `react` and `poll` (`fusion/message-actions.ts`); files go through `send`.

- **Quote.** With `replyToMode: first|all|batched` (upstream's key, default
  `off`) an answer quotes the message it answers (`fusion/quotes.ts`). A
  `replyToId` on `sendText` quotes that message in any mode; the Hub passes the
  message tool's `replyTo` as `OutboundPostParams.replyToId`. Inbound, the quoted text leads the body as `[Reply to <who>] …`.
- **Typing.** The Hub calls `outbound.typing` with `start` once per accepted
  inbound and `stop` when the turn ends; `fusion/typing.ts` re-sends
  "composing" every 6 s in between (WhatsApp drops it after ~25 s and on every
  message this account sends) and sends "paused" on `stop`.
- **Files.** `sendMedia` sends a staged file under the Hub's `fileName` /
  `mimeType`; audio always posts as a voice note. The message tool's
  `forceDocument` (image/video as a document) and `gifPlayback` ride the staged
  file (`StagedChannelMedia`) to `sendMedia`.
- **Cards as reactions.** For `channel === "whatsapp"` the approval engine
  (`approvals/index.ts` `cardFor`) hands the prompt's buttons over as
  `cardButtons`, with no `inlineButtons` opt-in. `fusion/reaction-cards.ts`
  appends the 👍/👎/1️⃣–4️⃣ legend and stores the message id in the keyed-store
  namespace `cards` (7 days); `fusion/card-intake.ts` turns a matching reaction
  into a `callback` event whose `value` is the button's, so
  `execution.ts` `handleInboundCallback` resolves it as a click. There is no
  `updateText`, so the engine posts the outcome as a reply quoting the prompt.
- **Location.** `plugin.agentTools` publishes `whatsapp_send_location`
  (`fusion/tools.ts`), mounted on the channel-reply MCP server; it posts to the
  bound conversation only.
- **Poll votes** are decrypted in the vertical (`fusion/polls.ts`) and arrive as
  `poll_answer` events (`EventFacts.pollAnswer`), which the Hub records. The
  keyed-store namespace `polls` (plain, 30-day TTL) holds each poll's secret.
- **Log out.** `logout` stops the running account first, also between
  connections (the controller runs on a signal Log out aborts), clears nothing
  until it has stopped,
  (`stopWhatsAppAccountForUnlink`: socket logout, then wait for the listener to
  exit), then clears the `auth` entry.
- **Proxy.** `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` apply, with upstream's rules
  (`fusion/proxy-agents.ts`).

## 6. Not wired

- The `upload-file` action (upstream advertises it; `send` covers files).
- Threads: WhatsApp has none.
- `updateText`: adding it would turn on the streaming driver as well as card
  updates; answers post whole.
- Upstream's `whatsapp_login` / `whatsapp_call` agent tools, ack reactions,
  debounce, pairing replies — Hub-owned or
  out of scope (see `omitted` in `upstream-sync.json`).

## 7. Open review findings

The 2026-10-06 review's findings, ranked, with fixes and test gaps, are in
[docs/audits/2026-10-06-whatsapp-channel-review.md](../../../docs/audits/2026-10-06-whatsapp-channel-review.md).
W1 (QR verbs bound the last-loaded account's store, §3) and W2 (Log out during
a reconnect backoff, §5) are fixed.
