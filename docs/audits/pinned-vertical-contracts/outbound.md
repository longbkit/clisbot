# Outbound — `plugin.outbound.sendText`

The relay's PostFn posts through the plugin's own outbound (host-agnostic; plan §7 `channel-outbound`). The Hub installs no send override at P0.

## Slack

`plugin.outbound.sendText(ctx)` (`slack/dist/channel-BjlsaGHn.js:758-776`) reads `ctx.{cfg, accountId, deps, replyToId, threadId}` → `resolveSlackSendContext` → the adapter's `sendText` (`slack/dist/outbound-adapter-DVoBfBW5.js:81-106`): `threadTs = resolveSlackThreadTsValue({replyToId, threadId})`, then `send(params.to, params.text, {cfg: params.cfg, threadTs, accountId, …})`. The native `sendMessageSlack` (`slack/dist/send-DKDXoeoV.js:721+`) requires a truthy `cfg`, resolves the account + token (bot token unless `config.userTokenReadOnly === false`), parses `to` as a channel `C…` or user `U…` id, and returns `{messageId: response.ts ?? "unknown", channelId, receipt}`. Empty text throws `"Slack send requires text, blocks, or media"`; a `NO_REPLY` answer is suppressed to `{messageId: "suppressed"`.

**Hub call shape:** `sendText({cfg, to, text, accountId, threadId})` — `threadId` is the native thread ts (or omitted at channel level). No `deps` needed: with `deps` undefined the Slack send falls back to its own runtime send module.

## Telegram

`plugin.outbound.sendText(params)` (`main/dist/outbound-adapter-CF1CXHOf.js:208-214`) → `resolveTelegramOutboundSendContext` (`:49-58`): `outboundTo = normalizeTelegramOutboundTarget(params.to)`, `send = resolveOutboundSendDep(deps) ?? (await loadTelegramSendModule()).sendMessageTelegram` (`:23`), `baseOpts = {verbose: false, cfg: params.cfg, messageThreadId: parseTelegramThreadId(params.threadId), replyToMessageId: parseTelegramReplyToMessageId(params.replyToId), accountId: params.accountId ?? undefined, …}` (`:27-45`). Then `send(outboundTo, params.text, baseOpts)`.

The native `sendMessageTelegram` (`main/dist/send-BgA996pw.js:1146+`) parses `to` (chat id — numeric, or `@username` for the default-to rewrite path), resolves + persists the chat id, and returns `{messageId: <last message id as string>, …}` (`:1278-1284` in the chunk; `lastMessageId = String(messageId)`).

**Hub call shape:** `sendText({cfg, to, text, accountId, threadId})` — `to` is the numeric chat id (forum or basic group), `threadId` the topic id (`message_thread_id`; the General topic posts as a plain message — Telegram rejects `thread_id=1`).

## Failure contract

Both throw on failure. The Hub's PostFn catches → `{ok: false, error}`; success → `{ok: true, nativeMessageId: String(result.messageId)}` (the delivery ledger dedupes restart replays by this id).

## Drive-time landmines (verified safe)

- **Telegram config write-back**: `resolveAndPersistChatId` → `maybePersistResolvedTelegramTarget` (`send-BgA996pw.js:795-825`) rewrites a legacy-username `defaultTo` target into the OpenClaw config file when `trustedInternalWriteback` (no `gatewayClientScopes` passed) — a native disk write. It only fires for a legacy-username rewrite (`resolveLegacyRewrite`); P0 posts numeric chat ids, so there is no rewrite and no write. Defensive: passing `gatewayClientScopes: []` also disables it (the admin-scope check then fails).
- **Sent-message dedupe cache**: `recordSentMessage` (`send-BgA996pw.js:1186`) → in-memory store + `persistSentMessage` → `openSentMessageStore()` (`main/dist/sent-message-cache-BGcQC26h.js:2509, 2575-2586`), which is a keyed-store seam (`plugin-state:…` namespace, `openKeyedStore` at `:2173`) — lands in the Hub's JSON keyed-store, not a native path.
- **Bot-info cache**: keyed-store seam (`telegram.bot-info-cache`), see `start-account.md`.
- **Slack**: no config write-back in the send path; dedupe runs in-memory.
