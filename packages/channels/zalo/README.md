# @getpaseo/channels-zalo

The in-repo Zalo Official Account (Bot API) channel vertical (goal ledger slice
16). Ported from `extensions/zalo/src@5d8067a4483` — see `upstream-sync.json` for
the file-by-file mapping, the deviations (`D-ZL-0xx`) and what is omitted.

Zalo ships no SDK: upstream hand-rolls its Bot API client over `fetch` and
depends only on `zod` (`4.4.3`, upstream's version), which is what this package
does too. `undici` is here for the proxy agent only, in a dynamic import, the
same shape the Discord vertical uses.

This is the **Official Account bot** channel (`bot-api.zaloplatforms.com`). Zalo
Personal (`zalouser`, the QR-login personal account) is a different upstream
extension and a different slice (17).

Hub wiring landed in a follow-up slice. [HUB-WIRING.md](HUB-WIRING.md) is the
handoff document it was built from and stays the record of what the Hub side owns;
`docs/channels-platform.md` describes the platform as built.

## What a live test needs

Provision these yourself and put them in the repo-root `.env`. This package never
reads `.env` and no value here is a real credential — only names. The
`ZALO_PERSONAL_TEST_*` ids already in `.env` belong to slice 17, not to this
channel.

### Zalo setup

1. Create (or use) a **Zalo Official Account** at
   [oa.zalo.me](https://oa.zalo.me).
2. In **Zalo Bot Creator** (`bot.zaloplatforms.com`) create a bot for that OA and
   copy its token. That token is the whole credential — there is no app id, no
   OAuth and no signing key.
3. Follow the bot from a personal Zalo account (the human tester), and add it to
   a test group if you want the group cases.
4. Polling mode needs nothing else. Webhook mode additionally needs a public
   HTTPS endpoint and a secret you choose (8–256 characters).

### Test surfaces

| Env var               | What it must be                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `ZALO_BOT_TOKEN`      | The bot-under-test's token from Zalo Bot Creator. Never commit it.                           |
| `ZALO_TEST_CHAT_ID`   | The DM chat id between the bot and the human tester (a `message.*.received` event shows it). |
| `ZALO_TEST_GROUP_ID`  | A group the bot was added to, for the group + mention cases.                                 |
| `ZALO_TEST_BOT_ID`    | The bot's own id (`getMe` → `result.id`), for the own-message filter.                        |
| `ZALO_TEST_BOT_NAME`  | The bot's `account_name`, which is what a group mention is matched against.                  |
| `ZALO_TEST_IMAGE_URL` | A public HTTPS image URL, for the outbound `sendPhoto` case.                                 |
| `ZALO_WEBHOOK_URL`    | Webhook mode only: the public HTTPS URL Zalo posts to.                                       |
| `ZALO_WEBHOOK_SECRET` | Webhook mode only: the 8–256-char token echoed in `x-bot-api-secret-token`.                  |
| `ZALO_API_URL`        | Optional. Overrides the API base (`https://bot-api.zaloplatforms.com`) for a fake server.    |

The driver / bot-under-test split is the rule every channel here follows
(CLAUDE.md, "Required Slack and Telegram E2E roles"): a direct `sendText` is an
outbound smoke test only. The required proof is **external sender → transport →
agent turn → reply in the same chat**, then a read-back matching the message id
the send returned. On Zalo the external sender is a **human Zalo account**
messaging the bot: the Bot API has no way for one bot to drive another, and it
has no read-back endpoint either (no `getMessages`, no history), so the read-back
side of the proof is the human's own client plus the `message_id` the send
returned.

**Live polling E2E is runnable today** with `ZALO_BOT_TOKEN` alone. Webhook E2E
is blocked on the public endpoint; see [HUB-WIRING.md §6](HUB-WIRING.md#6-the-public-endpoint-webhook-mode-only).

### Minimal account config

```yaml
channel: zalo
accountId: main
connectionId: <hub connection id>
# webhookUrl absent → long polling, which is the mode a dev host can run.
mediaMaxMb: 5
botNames: ["<ZALO_TEST_BOT_NAME>"] # group mention aliases
routes:
  - match: { kind: dm }
    agent: <agent>
    environment: <environment>
  - match: { kind: channel, ids: ["<ZALO_TEST_GROUP_ID>"] }
    agent: <agent>
    environment: <environment>
```

The bot token lives in the Hub connection's credentials under `botToken`, not in
this file.

## Supported today

**Inbound** — long polling (`getUpdates`) or the HTTP webhook, both admitting
durably before the transport moves on:

- `message.text.received` → a `message` turn, or a `command` turn when the body
  is a leading `/verb`.
- `message.image.received` → a `message` turn whose caption is the body and whose
  photo is downloaded into the account's media dir and folded in as
  `[Attached files]`. A failed or oversized download keeps upstream's
  `[zalo image attachment unavailable]` notice, so the agent still learns an
  image was sent.
- Direct chats and groups. A DM is always `wasMentioned`; a group message is
  mentioned when it names the bot (D-ZL-012).
- The bot's own messages and bot-authored messages are filtered unless
  `allowBots`.

Webhook requests are authenticated with a constant-time
`x-bot-api-secret-token` compare **before** the body is read, behind upstream's
rate-limit / method / content-type guards, and the 200 is written only after the
event is durably admitted — a failed admission answers 500 so Zalo redelivers, a
malformed envelope answers 400 so it does not.

Polling has no offset and no ack to hold back (the Bot API returns at most one
update and never re-serves it), so the loop admits durably before it issues the
next call, retries a failed admission in place, and drops the update with an
error-level line only once the budget is spent (D-ZL-015).

**Outbound**: text with upstream's 2000-char chunker and UTF-16-safe truncation;
an image by HTTPS URL through `sendPhoto` (with the text as its caption), behind
the SSRF host guard.

**Message tool actions**: `send` — the whole Zalo message API.

## Not supported

Named here so nothing above is read as more than it is. Most of these are
platform limits, not port gaps.

- **File upload** — the Bot API has no upload endpoint. `sendMedia` posts a
  visible notice and reports `mediaPosted: false` (D-ZL-016). Upstream's
  workaround (`outbound-media.ts`, hosting the file on the account's own webhook
  origin) needs a public HTTPS endpoint the Hub does not have, and is omitted.
- **Edit, delete, reactions, pins, polls, buttons, native commands, threads** —
  no endpoint exists. `supportsAction` refuses them so the Hub answers
  `unsupported_action` rather than a transport error.
- **Read-back / history** — no endpoint. Delivery is confirmed by the returned
  `message_id` only.
- **Stickers and unsupported message types inbound** — upstream logs them and
  starts no turn; this port keeps that behaviour rather than inventing a body.
- **Typing indicator** — `sendChatAction` is on the client and exported, but
  nothing drives it: upstream drives it from the omitted reply pipeline, and the
  Hub's progress surface has no Zalo transport yet.
- **Pairing, allowlists, dm/group policy enforcement** — the Hub owns access
  policy (goal ledger slice 23). The account's `dmPolicy` / `allowFrom` /
  `groupPolicy` are carried and reported, not enforced here; upstream's
  `group-access.ts` resolver is ported for the Hub to use.
- **Setup/doctor surfaces, approval auth, session routing** — the OpenClaw
  wizard, `doctor` tree, approval-auth capability and outbound session-route
  builder are omitted; the Hub owns onboarding, approvals and routing.

## Layout

```
src/
  api.ts timeouts.ts               ← upstream Bot API client + its deadlines
  token.ts accounts.ts types.ts    ← upstream token/account resolution
  probe.ts proxy.ts group-access.ts ← upstream probe, proxy cache, group policy
  send.ts actions.ts actions.runtime.ts ← upstream send path + message-tool adapter
  webhook-spool.ts monitor.webhook.ts   ← upstream envelope schemas + request handler
  runtime-api.ts runtime.ts             ← upstream host binding + runtime slot
  channel-actions.ts outbound.ts        ← Fusion: Hub drive surface
  lifecycle/start-account.ts            ← Fusion: L4 account lifecycle
  fusion/                               ← Fusion: every boundary, one per D-ZL-0xx
    account-config.ts   Hub account carrier → upstream account resolution
    admission.ts        durable admission before the ack / the next poll
    inbound-adapter.ts  update → ChannelInboundEvent (kind + facts)
    polling-session.ts  the getUpdates loop
    webhook-session.ts  the owned node:http listener
    ssrf.ts             the media-URL host guard
    proxy-fetch.ts      the proxy-agent fetch
    secret-file.ts      the credential-file reader
```
