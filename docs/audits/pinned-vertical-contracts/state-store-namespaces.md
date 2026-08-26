# Channel state-store namespaces (dist-verified)

The per-key durable state seam (`runtime.state.openKeyedStore` / `openSyncKeyedStore`)
carries each channel's **evictable transport state** — cursors, lookup caches,
dedup/marker stores. No row identity, no status, no permanent custody: everything
here may be dropped and rebuilt. The plane's record of record (inbound + outbound
event ledger) lives elsewhere (`delivery_ledger`); this file is only what flows
through the seam. All facts below were read from the pinned dists (scout checkout
`/tmp/openclaw-scout`); `main/…` = `openclaw@2026.7.1-2`, `slack/…` =
`@openclaw/slack@2026.7.1`. Hashed chunk names are part of the pin — re-verify on
re-pin.

## Purpose and admission rule (decided 2026-08-26)

One-sentence use case: `channel_state_entries` is **channel-agnostic, keyed,
TTL/evictable storage for derived transport state that is disposable and
rebuildable**. It answers "what did the channel transport know that the vendor
API or the ledger does not already tell me, and that I can afford to re-learn?"
It is not a message store, not a session store, and not a record store.

When you are planning to store something new, run it through the test. The row
goes here **only if every line is yes**:

1. **Derived or rebuildable** — it can be re-derived from the vendor API, a
   re-sync, or the ledger if this row is evicted. Losing it costs a re-fetch,
   never a lost fact.
2. **No row identity, no status machine** — it is not something you `consume`,
   `post`, `retry`, recall, or replay. Those verbs belong to the ledger.
3. **Channel-agnostic by key, not by logic** — it is one row per
   (org, account, namespace, key) where the channel is encoded in the namespace;
   the channel code writes it through the seam and never reads the table. If the
   value is only meaningful to one channel and that channel must query it with
   channel-specific logic, it is a namespace in here — not a new table.
4. **Bounded and evictable** — it has a `maxEntries` cap and a TTL; it is safe
   for an evict-oldest sweep to delete it.

If any line is no, the data belongs elsewhere:

| Fails line                                                                                  | Where it goes instead                                                                                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1 or 2 — a fact you must keep, with a status                                                | the **event ledger** (`delivery_ledger`), inbound or outbound                                                              |
| 1 — an agent turn's body                                                                    | the **agent's own event store** (the plane keeps id links only)                                                            |
| 1 and 2 — external identity ↔ Hub identity (no API returns it; has a bind/unbind lifecycle) | the **canonical layer** principal/member tables; until that lands, a **plane-owned permanent table** (no TTL, no eviction) |
| 2 or 3 — an auth/session credential                                                         | its own provider store (e.g. `zca-js` for zalouser); never the seam                                                        |

The three roles that pass the test are the ones enumerated below: **cursors**
(how far the transport has read), **lookup caches** (re-fetch a vendor object
without a round-trip — this is also where id → label mappings live: channel id →
channel name, user id → display name / profile, fetched from the vendor API and
TTL-cached because labels change), and **dedup/marker stores** (remember "I
did/claimed X" inside a TTL window). A new feature adds a namespace here only by
naming which role it is; if it fits none of the three, it is not this table. The
one mapping that does **not** pass is external identity ↔ Hub identity (e.g.
Slack user id ↔ Hub user): the plane creates that binding, no vendor API returns
it, so it fails line 1 (not derivable) and line 2 (it has a bind/unbind
lifecycle) — it is cross-channel structural state that goes to the canonical
layer's principal/member tables (or a plane-owned permanent table until that
layer lands), never here.

Forward planning: zalouser adds namespaces the day it needs the seam (today it
persists through `zca-js`); the canonical layer and any `message_map` table
graduate from the ledger's id links, not from here. Nothing in here is backfilled
into the canonical store — this table is deliberately a dead end, not a pipeline.

## Seam limits (apply to every namespace)

- value ≤ **64 KB** (the seam's `MAX_VALUE_BYTES`), one JSON value per entry.
- TTL: `ttlMs` / `defaultTtlMs`, expiry = `now + ttlMs`, **enforced on every read
  and swept on every write**.
- `maxEntries` eviction: `evict-oldest` by `createdAt` then key, or `reject-new`
  (throws).
- one row per (org, account, namespace, key); channel code sees only the seam.

## Which channels use the seam

- **telegram** (bundled in `main`): the 7 namespaces below.
- **slack** (published): 2 namespaces.
- **zalouser**: **0 call sites** — its session/auth persists through its own
  `zca-js` SDK, not the seam. No `channel_state_entries` rows for zalouser today.
- `telegram.http` is **not** a namespace — it is only a log-flag name
  (`diagnostics.flags`). `telegram.thread-bindings` exists in the main dist but
  stays out: the plane owns `thread_bindings` (`schema.ts:1265`) and the pulled
  vertical does not write vendor thread state (group E, §3 of the audit).

## Telegram namespaces

`scopeKey` throughout = `sha256(sessionStorePath).digest("hex").slice(0,24)`.

### Cursor

- **`telegram.update-offsets`** (`update-offset-store-BY5gVDOT.js`) — long-poll
  cursor. `openKeyedStore({namespace, maxEntries:1e3})`. key = normalized
  accountId. value =
  `{storeVersion:3, lastUpdateId, botId, tokenFingerprint}`. The record of "how
  far the poll has read." Rebuildable from a `getUpdates` re-sync.

### Lookup caches

- **`telegram.bot-info-cache`** (`state-migrations-DYbWXxuv.js`) — `getMe`
  result. `openKeyedStore({namespace, maxEntries:128, defaultTtlMs:864e5})` (24
  h). value is parsed back by `parseCachedTelegramBotInfo`, which **requires**
  `tokenFingerprint` + `fetchedAt` (a value missing either parses to `null`).
- **`telegram.sticker-cache`** (`sticker-cache-store-DC3gW-5Z.js`) — cached
  stickers for search. **sync** store, `maxEntries:1e4`. key =
  `sticker.fileUniqueId`; value = the normalized cached sticker (description,
  emoji, setName — used by `searchSticker` fuzzy match).
- **`telegram.topic-name-cache`** (`topic-name-cache-DRmp4Kbo.js`) — forum
  topic names per scope. `maxEntries:2048`. key = `` `${chatId}:${threadId}` ``;
  value = the merged topic object `{name, iconColor?, iconCustomEmojiId?,
closed?, …}`.
- **`telegram.message-cache`** (`sent-message-cache-BGcQC26h.js`) — the one cache
  that holds **message content**. key =
  `` `${scopeKey}:${accountId}:${chatId}:${messageId}` `` (scopeKey here =
  `sha256(scope).hex.slice(0,24)`); persisted value =
  `{sourceMessage: <full raw Telegram message: text, from, …>, threadId?}` —
  `toPersistedCacheValue` writes the raw `msg` in, so a lookup returns the message
  body without a `getHistory` round-trip. Persistent cap 3000 (`evict-oldest`).
  Use case: build inbound context (quotes, reply-to, recent history) offline.

### Dedup / marker (minimal values on purpose)

- **`telegram.sent-messages`** (`sent-message-cache-BGcQC26h.js`) — record of
  "the bot sent message N in chat C." **sync** store, `maxEntries:1e4`,
  `ttlMs` 24 h. key =
  `sha256(`${scopeKey}\0${chatId}\0${messageId}`).hex.slice(0,32)`; value =
  `{scopeKey, chatId, messageId: String(messageId), timestamp}`. Written by
  `recordSentMessage(chatId, messageId)` **after** a successful send
  (`resolveTelegramMessageIdOrThrow` first — the id only exists post-send). The
  only reader is `wasSentByBot(chatId, messageId)`, used to gate
  `reactionNotifications` mode `own`: when a user reacts to a message, the
  vertical checks whether that message was sent by the bot before dispatching the
  reaction event. That is the entire read path — which is why the value is
  deliberately just an id + timestamp (membership + TTL anchor), no content.
  It is **not** a pre-send dedup (the id does not exist before send) and is not
  the outbound record (that is the ledger's `external_message_id`).
- **`telegram.message-dispatch-dedupe`** (`message-dispatch-dedupe-IsUYRf5N.js`)
  — inbound update replay guard (claim **before** dispatch). Shared
  `createClaimableDedupe` helper (same family as the Nextcloud guard). key =
  `JSON.stringify(["account", accountId, replayKey])`; value = a claim marker.
  State cap 50000; default replay TTL 24 h (`DEFAULT_REPLAY_TTL_MS`). The
  plane's inbound ledger row replaces this as the durable record (§2.4 item 1);
  it remains the vendor-side in-flight dedup.

## Slack namespaces

Both are `createPersistentDedupeCache` instances (dist
`provider-C1-DFSpw.js` / `send-DKDXoeoV.js`), TTL 24 h.

- **`slack.inbound-deliveries`** — inbound delivery dedup. `maxEntries:2e4`.
  key = `` `${accountId}:${channelId}:${ts}` `` (`makeKey`); value = a
  recorded-at timestamp. Read by `hasSlackInboundMessageDelivery` (skip already
  delivered), written by `recordSlackInboundMessageDeliveries`. Same class as
  `telegram.message-dispatch-dedupe` — the ledger inbound row replaces both.
- **`slack.thread-participation`** — "already replied in this thread" dedup.
  `maxEntries:1e3`. key =
  `` `${accountId}:${channelId}:${threadTs}` ``; value = a recorded-at
  timestamp.

## What is not in the seam

- **auth sessions** — no namespace stores a bot/user auth token (zalouser's
  session lives in `zca-js`).
- **agent-turn bodies** — the canonical record of an agent turn stays the
  agent's own event store; the plane keeps id links + state.
- **the ledger** — inbound/outbound records with row identity + status +
  permanent custody are `delivery_ledger`, not the seam. The two `inbound-*`
  dedup stores above are TTL mirrors of what the ledger makes structural.
