# In-Repo Channel Verticals — the `packages/channels/telegram` Re-Implementation Direction (S2)

Date: 2026-08-26. Subject: re-implementing the Telegram **and** Slack channel verticals as new in-repo packages (`packages/channels/telegram`, `packages/channels/slack`, shared `packages/channels/shared`), following the drive contract the pinned `openclaw/slack` vertical defines, with a merge strategy that keeps OpenClaw updates cheap. After this work the channel plane no longer loads a pinned OpenClaw vertical for either channel — the pinned dists become **sync references only**. All claims in §1–§3 are verified against the pinned dists (scout checkout `/tmp/openclaw-scout`: `main/` = `openclaw@2026.7.1-2`, `slack/` = `@openclaw/slack@2026.7.1`, `zalouser/` = `@openclaw/zalouser@2026.7.1`) and the in-repo Hub loader; §5 carries the machine check.

This doc answers one question and records one decision:

- **Decision (user, 2026-08-26):** pull Telegram **and Slack** into the repo as first-party verticals (level **S2** — own the slice, both channels in one work item, fully replacing the pinned-OpenClaw mechanism for both), keep the pinned OpenClaw dists as sync references, and generalize the package shape so zalouser can be pulled the same way later. Priority order: (1) customer experience — deviations from upstream are allowed when needed; (2) maximizing the ability to re-sync OpenClaw updates; (3) owning the parts we must fix.

## 1. What "the same contract as openclaw/slack" actually is

The Hub drives a channel vertical through **four surfaces**, and they belong to two different families:

| Surface                                                                                            | Family              | Carried by                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| Drive: `plugin.gateway.startAccount` + `plugin.outbound.sendText`                                  | Hub (supervisor)    | the **plugin chunk** (`pin.plugin.{specifier,exportName}`) |
| Entry object: `defineBundledChannelEntry` result with `setChannelRuntime`                          | Hub (loader)        | the **entry module** (`pin.entry`)                         |
| Alias seam: `openclaw/plugin-sdk/*` subpaths, one bound (`channel-inbound`) + 95 passthrough       | **OpenClaw supply** | dist that imports the SDK                                  |
| Install/supply: tarball + `dist.integrity` + `gitHead` + `loadMode` (`"published"` \| `"bundled"`) | **OpenClaw supply** | `channel-pins.json`                                        |

Surfaces 3–4 exist **because Slack is opaque OpenClaw code**: the loader aliases Slack's `openclaw/plugin-sdk/channel-inbound` import into the bound seam so the Hub can intercept OpenClaw's inbound dispatch and hand it to the plane. An in-repo Hub-authored package is **Hub code** — aliasing its own imports to a seam the Hub then intercepts would be a pointless loop. The bundled Telegram closure is already alias-free and calls `hostRuntime.onInboundReply` directly (`hosts/telegram-monitor.ts`); that is the model.

**"Same contract" = surfaces 1 + 2 (the drive surface and the entry object) plus the loader lifecycle (load-trace, `setChannelRuntime`, `dispose`).** Not the alias seam, not the tarball pin. This is the part that must survive every re-implementation, for every channel, or the supervisor/loader stops being channel-agnostic.

## 2. The three verticals against the contract (dist-verified)

Verified 2026-08-26 against the pinned supply. The drive contract holds **3/3**:

|                       | Slack                                                                                                    | Telegram                                                                                                                              | zalouser                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supply today          | `@openclaw/slack@2026.7.1` (`loadMode: "published"`, own tarball, integrity-pinned; `gitHead 2d2ddc43…`) | inlined in `openclaw@2026.7.1-2` (`loadMode: "bundled"`)                                                                              | **dual**: bundled alias-free in main `dist` _and_ published `@openclaw/zalouser@2026.7.1` (same `gitHead 2d2ddc43…`; integrity `sha512-klg0…Gw==`; deps `zca-js@2.1.2`, `zod`, `typebox`) |
| Entry                 | `dist/index.js` → `defineBundledChannelEntry({id:"slack", plugin:{…}, runtime:{setSlackRuntime}, …})`    | `dist/extensions/telegram/index.js` → `defineBundledChannelEntry({id:"telegram", …exportName:"telegramPlugin", …setTelegramRuntime})` | published `dist/index.js` → `defineBundledChannelEntry({id:"zalouser", plugin:{exportName:"zalouserPlugin"}, runtime:{setZalouserRuntime}})`                                              |
| Drive surface         | `slackPlugin.gateway.startAccount` + `slackPlugin.outbound.sendText`                                     | `telegramPlugin.…` (identical)                                                                                                        | `zalouserPlugin.gateway.startAccount` (published `dist/channel-C0ARGeer.js:572-573`) + `outbound`                                                                                         |
| Inbound transport     | **Socket Mode** (WebSocket; `@slack/socket-mode`, bundled in the package's `node_modules`)               | `getUpdates` long-poll (Hub-owned, `hosts/telegram-monitor.ts`)                                                                       | **user-client bridge** — `zca-js` personal-account client (QR login, persisted session; `ZaloQrLogin`/`ZaloGroups`/`ZaloFriends` symbols)                                                 |
| Inbound routing today | through the **bound seam** (dist imports `openclaw/plugin-sdk/channel-inbound`)                          | host-monitor override (option A) — alias-free closure                                                                                 | the **published** dist imports `channel-inbound` (seam-routable); the bundled-in-main form is alias-free like telegram                                                                    |
| Outbound layer        | `@slack/web-api` via bundled `node_modules`                                                              | `dist/send-BgA996pw.js` (87.9KB)                                                                                                      | published `dist/send-D1GpX8wV.js` (single import: the `zalo-js` client chunk)                                                                                                             |

### 2.1 The Telegram outbound layer: not import-free (correction to the working assumption)

`send-BgA996pw.js` is **not** a zero-import leaf. It pulls **33 import specifiers: 30 relative leaf chunks** (all main-dist: `string-coerce`, `number-coercion`, `redact`, `retry-policy`, `request-timeouts`, `polls`, `markdown-tables`, `media-runtime`, `sent-message-cache`, `io`/`config` for write-back, …) **plus three bare third-party specifiers: `grammy`, `@grammyjs/runner`, `@grammyjs/transformer-throttler`**. It carries the per-account throttler, retry/timeout policy, rich markdown/HTML plan builders, inline keyboards, native-quote handling, `resolveAndPersistChatId` (×13 — the config write-back that persists resolved chat ids via `readConfigFileSnapshotForWrite`/`replaceConfigFile`), and the `telegram.sent-messages`/`telegram.message-cache` keyed-store calls (via the imported `sent-message-cache` chunk, which opens both an async and a sync keyed store).

Implications:

1. **Pulling the slice is a 30-leaf + grammy closure port, not a single-file copy.** The leaf chunks are boring (coercion, redaction, retry), so the port is mechanical — but the sync-manifest must record the _closure_, not just the top chunk, or a re-sync misses a leaf.
2. **The `sent-message-cache` import is the storage seam.** That chunk is where `telegram.sent-messages`/`telegram.message-cache` get written through `openKeyedStore`/`openSyncKeyedStore`. Once Hub-owned, the writer is ours — the cache keeps its seam-namespace target (§2.4), and what lands on the plane's **channel event ledger** instead is the inbound record (dedupe + consume-mark) the monitor writes around the handoff.
3. **The `grammy` stack is importable, not required.** The chunk _imports_ grammy for throttler/runner utilities; the Bot API calls themselves go through an injected fetch (`asTelegramClientFetch`, `createTelegramClientFetch` — zero `fetch(` literals in the chunk). The in-repo port keeps the same injectable-transport shape and **keeps the grammy stack as pinned deps** (decided §7.2) — no local reimplementation, so no B2 entry for it.
4. **Config write-back is a behavior we now own.** `resolveAndPersistChatId` mutates the channel config file. In-repo, that write-back becomes a Hub-owned operation (target: the plane's storage, not an OpenClaw config file) — first entry in the deviation ledger (§4.3).

### 2.2 zalouser is dual-supply, and the published form is seam-routable

The published `@openclaw/zalouser` dist imports **37 distinct** `openclaw/plugin-sdk/*` subpaths — including the **bound** `channel-inbound` (in `dist/monitor-D3DfqQDG.js` + `dist/runtime-api.js`). So a published-zalouser load routes inbound through the same bound seam Slack uses; the Hub seam already knows how to serve it. **Six of the 37 subpaths are not classified in the in-repo seam matrix** (fail-closed today): `channel-config-schema`, `core`, `setup`, `state-paths`, `temp-path`, `tool-results`. All six are real `./plugin-sdk/*` exports of `openclaw@2026.7.1-2` (323 exported in total), so they are clean **passthrough** additions — +6 lines in `PASSTHROUGH_SUBPATHS`, same class as the existing 95. This is the one Hub-side prerequisite for ever loading a published zalouser vertical, and it applies to _any_ future pinned channel that uses those subpaths.

The bundled-in-main zalouser closure (relative imports only) is the same code shape as bundled Telegram — alias-free, monitor-overridable. Both supply forms are available; the pin manifest picks one. For the in-repo direction it doesn't matter which pinned form is the sync reference: the sync reference is the **upstream source shape**, and both forms agree on the drive surface.

**Upstream source location (verified 2026-08-26):** `https://github.com/openclaw/openclaw` — `extensions/zalouser/` in the main repo, exactly parallel to `extensions/telegram/`. The pinned `gitHead` `2d2ddc43…` resolves there, and `extensions/zalouser/package.json` at that commit is `@openclaw/zalouser@2026.7.1` (matches the published tarball's version). The main npm tarball does not ship the extension source (`package.json` files: `!dist/extensions/zalouser/**`), but the dist chunks carry `//#region extensions/zalouser/src/<file>.ts` markers naming every upstream source file (`send.ts`, `monitor.ts`, `setup-core.ts`, `qr-temp-file.ts`, …), which is what the `SYNC.md` manifest (§4.2) needs as its port map. The published `node_modules/zca-js` (the Zalo protocol client) is a separate npm package — source available, no pin needed beyond the version in the published package's deps. `zca-js` is a pure JS library (no `bin`, no CLI; zero `child_process`/`spawn` anywhere in the zalouser dist) — the vertical never shells out to a tool.

**Pull the Clisbot reference surface, not OpenClaw's thin surface (decided 2026-08-26).** The pinned zalouser's tool surface is the thinnest of the three verticals — dist-verified: message actions = `react` only (`describeMessageTool` → `{actions:["react"]}`, `supportsAction` accepts only `react`), plus `sendMessageZalouser`, four directory queries (`getZaloUserInfo`, `listZaloFriendsMatching`, `listZaloGroupsMatching`, `listZaloGroupMembers`), the QR lifecycle (`startZaloQrLogin`/`waitForZaloQrLogin`, `probeZalouser`, `logoutZaloProfile`), and `monitorZalouserProvider`. The in-repo **Clisbot zalo-personal** vertical (reference: the Clisbot T3Claw fusion repo, `src/channels/zalo-personal/`, ~3.7K LoC across 31 files — same `zca-js` user-client, same QR-login model) is materially richer on the identical protocol:

| Surface        | Clisbot zalo-personal                                                                   | OpenClaw zalouser            |
| -------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| send           | md→native render + styles + mentions                                                    | plain send                   |
| media          | attachments + upload listener                                                           | not surfaced in the vertical |
| voice          | `sendVoice` (upload → voiceUrl)                                                         | —                            |
| react          | add **and remove** (`rType 75` / `-1`)                                                  | add only                     |
| read history   | `getGroupChatHistory` (group-only, DM rejected with an explicit error)                  | —                            |
| delete         | `deleteMessage`, confirm-gated, `msgId:cliMsgId:uidFrom` locator                        | —                            |
| directory      | online/favorite/**label** filters, friend invites, single contact, **resolve-by-phone** | four basic queries           |
| inbound        | media-group coalescing + attachment download                                            | monitor only                 |
| lifecycle gate | risk-warning + confirm before QR login                                                  | —                            |
| operator       | CLI surface (`bots add/login/logout/status/me`, contacts/groups commands)               | —                            |

The zalouser pull implements the **Clisbot reference surface** (scoped in §3: send/voice/react±/read/delete, media-group inbound, QR lifecycle — the extended directory and operator CLI are deferred) — it is the customer experience already verified live (`ZALO_PERSONAL_TEST_*` credentials), and it costs no extra merge risk: the drift surface is the Zalo protocol either way. Two consequences for the merge mechanics: (1) zalouser's **sync reference is `zca-js@2.1.2` + the Zalo protocol, with the OpenClaw zalouser dist as secondary reference** — most of the owned surface has no OpenClaw counterpart to diff against, so its `DEVIATIONS.md` starts _thicker than upstream_ and the ledger records "deliberately beyond OpenClaw" entries instead of bugfix entries; (2) the operator CLI surface is **deferred** — open item §7.8.

### 2.3 Auth/startAccount shapes differ per channel

- Telegram: `botToken` + probe `getMe` (stateless, one-shot).
- Slack: `botToken` + `appToken` (Socket Mode), probe = `auth.test`.
- zalouser: **QR login + persisted user session** (`writeQrDataUrlToTempFile`, session restore, `checkZcaAuthenticated`). No token probe; the "probe" is a session-validity check against a personal-account client.

`startAccount` therefore cannot be one shared implementation; it is a **per-channel lifecycle module** behind the same drive-surface signature. The startAccount subset the plane actually needs (probe/verify → guard → monitor handoff) is the small, stable part; the setup-wizard/pairing/doctor machinery is group-E (§3) and out of scope.

### 2.4 Storage, re-derived from the two requirements

Start from the requirement, not the existing tables:

- **Inbound:** record what arrives; mark it consumed, and when; idempotent across restarts and vendor redelivery; recall/replay when needed; keep context (external conversation + message id → which turn consumed it).
- **Outbound:** record what was sent; mark it posted or failed; idempotent retry; keep context (which turn produced it, the external message id confirmation).

Exactly two storage concepts satisfy these. T3Claw's channel store (T3Claw fusion `docs/internals/clisbot-channels.md` §4, verified 2026-08-26) is the worked proof: it is the same two concepts, already bidirectional.

**1. The channel event ledger — one table, both directions.** The record with row identity and a status machine. The long-term standard is the Hub's `delivery_ledger` (`schema.ts:1324`, pglite) extended to both directions:

- a `direction` column (`in` | `out`);
- inbound rows: unique on (channel, account, `external_conversation_id`, `external_message_id`) — dedup becomes structural and survives restarts, replacing the vendor-side TTL cache (`telegram.message-dispatch-dedupe`, 24 h) as the plane's record; status `recorded → consumed` + `consumedAt` + the turn reference it dispatched to;
- outbound rows: as today (`recorded → posted/failed`, per-turn sequence, `externalMessageId` — the rename of `nativeMessageId`, §2.4.4), plus an `attempts` counter for retry accounting.

T3Claw's ledger carries exactly this shape — `op_id` PK, `direction`, inbound unique on `provider_event_id`, `operation_hash`, `provider_receipt`, attempts/cursor — so the extension is not a guess. It also answers the "share the existing pglite `delivery_ledger`?" question: extend the one pglite table that already exists; no third store. The plane writes both directions: the shared L3 monitor records the inbound row before the `onInboundReply` handoff and marks it consumed when the dispatch settles (`dispatched: true`; T3Claw's ACK boundary — applied only after the agent command is accepted). The outbound wrapping in `channels/relay/index.ts` / `channels/approvals/index.ts` around `plugin.outbound.sendText` is unchanged.

Recall is a property of the data now, a command later: a consumed inbound row is permanent and re-dispatchable; the recall surface ships with the work-chat model, not this pull.

**2. Per-key transport state — the keyed-store seam, unchanged.** Poll offsets, lookup caches (bot-info, sticker, topic-name, message-content), dedup/marker stores (sent-messages, dispatch-dedupe, Slack's two): per-key, TTL/evictable, no row identity, no status — no auth session and no agent-turn body ever enters the seam. The table's one-sentence use case and the admission test for any future data (derived + rebuildable, no identity/status, channel-agnostic by key, bounded + evictable) are recorded in the pinned contract [state-store-namespaces.md](pinned-vertical-contracts/state-store-namespaces.md) — that test is the gate for planning anything new into the table. T3Claw keeps the same split — its `plugin_state_entries` (64 KB value cap, entry-count cap) is this concept, and the Hub seam already mirrors that surface (64 KB value cap, TTL + eviction semantics). The `resolveAndPersistChatId` write-back (D-001) re-targets here, as before. Target backing: pglite `channel_state_entries` behind the existing `KeyedStoreBackend` (`load`/`save`), a drop-in replacement with the same semantics — a Hub-side commit, independent of the pull (§6.6). The table is **channel-agnostic**: one row per (org, account, namespace, key) with the channel in the namespace (`telegram.update-offsets`, `telegram.bot-info-cache`, `slack.inbound-deliveries`, …); a new channel adds namespaces, not tables, and channel code never sees the backing (only the seam). The full dist-verified inventory — every namespace, key/value shape, TTL, and the dedup-vs-record split — lives in the pinned contract [state-store-namespaces.md](pinned-vertical-contracts/state-store-namespaces.md); note zalouser opens no keyed-store namespaces today (its session persists via `zca-js`), so "a new channel adds namespaces" is a design property, not a current fact. The vendor `telegram.thread-bindings` namespace stays out: the plane owns `thread_bindings` (`schema.ts:1265`), and the pulled vertical does not write vendor thread state (group E, §3).

The split is by requirement, not by table name: the ledger keeps what must survive and be replayed (per-message records with a status); the seam keeps what may be dropped and rebuilt (cursors, caches). Folding one into the other — evictable dedup as the record, or a record in a TTL cache — fails one of the two requirements; that is the test for whether the split is right.

**Considered and rejected: one table for both.** A single `kind in ('ledger','state')` table with two partial unique indexes is technically buildable, and it is the most-gommed shape. It fails the test: the two row kinds need opposite operations on the same table — state rows get TTL sweeps and cap-based eviction (delete/scan), ledger rows must never be deleted (recall) and are scanned for replay/audit — so under pglite's single writer every sweep/cap run scans and writes on the table that holds the custody ledger, and every writer branches on `kind` for the rest of the plane's life. In/out merge because they pass the test (same row identity, same status machine, same custody requirement — two directions of one event channel); ledger/state do not (state has no row identity, no permanent survival, no replay). T3Claw reaches the same split from the other side: `delivery_ledger` and `plugin_state_entries` live in the same state dir, in separate files. "Gom chung" happens at the plane/DB layer (one pglite DB, one owner, one seam contract — the state backing can move without touching channel code), not at the row layer.

**3. Where this stops: the canonical layer is designed, not built.** Ledger rows + T3Claw's `message_map` (external message id ↔ internal message/activity id, "never bodies") are one seed: external↔internal id links. The product vision's work-chat model (`docs/overview/product-vision.md` §2: members, conversations, authored messages, multi-agent rooms) is where that seed graduates — T3Claw's own words for its §4b→§6 path are "a graduation, not a migration," the directory tables kept out of the operational schema and provider-native shapes on purpose. Because the ledger rows already carry the external conversation + message id + turn reference in both directions, the canonical store builds on top of them instead of backfilling from vendor state. Channel storage deliberately does not become a body store: the canonical record of an agent turn stays the agent's own event store; the channel plane keeps id links + state.

**What this pull does not build** (designed, not built): the canonical conversation + message layer (product-vision scope); the recall/replay command (data shape ready, surface later); a message-level `message_map` table (the ledger rows carry the link; a separate table earns its place when two internal objects map to one external id — in-place edit/update — or when the canonical store lands).

**4. Naming alignment: `external_*` for every vendor-assigned id (decided 2026-08-26).** The current ledger mixes three styles for what is all channel-assigned identity: `conversation_id` (unprefixed), `external_thread_id`, `native_message_id`. "Native" and "external" are the same meaning — two names for one concept — and the unprefixed `conversation_id` is that same concept wearing no name. Align on one prefix: **every id the channel assigns gets `external_`** — `conversation_id → external_conversation_id`, `native_message_id → external_message_id`, `external_thread_id` unchanged, "native" dropped from the whole plane. Two proofs this is the right word, not a new one: the plane already uses `external_` (`thread_bindings.external_thread_id`, `channel_accounts.external_identity`), and T3Claw's reference uses the same family (`external_conversation_id`, `external_message_id`, `external_user_id`, `external_thread_key`). Long-term alignment (Mode B): when the canonical layer arrives, the ids the Hub owns stay unprefixed (`conversation_id`, `message_id`) and `external_*` becomes exactly the link column between a canonical object and its vendor object — the pull's rename is what makes that graduation zero-cost instead of a second rename. Scope: `delivery_ledger` (both columns) + `thread_bindings.conversation_id` (same concept, same table family).

**Decided 2026-08-26:** extend `delivery_ledger` to both directions (§6.7) and ship it with the pull — the shared L3 monitor is new Hub-owned code anyway, and shipping it without the inbound record would leave the plane's only dedup in a vendor-side TTL cache, the exact gap this re-derivation starts from. No third table.

## 3. The pull scope (S2): what moves, what stays pinned

Per vertical, the in-repo package owns **four layers** and leaves the rest as upstream:

| Layer                 | Telegram source chunks                                                                                                                               | Shared/partner notes                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **L1 Bot API client** | `send-BgA996pw.js` + its 30-leaf closure + the grammy stack                                                                                          | per-channel; injected fetch; per-account throttler                                                             |
| **L2 transport**      | long-poll `getUpdates` loop (today: `hosts/telegram-monitor.ts`)                                                                                     | per-channel: poll loop / Socket Mode / user-client subscription                                                |
| **L3 monitor**        | offset store, in-flight dedupe, mention gating, `ctxPayload` build, **inbound ledger record + consume-mark** (§2.4), `onInboundReply` handoff        | **channel-agnostic** — the one genuinely shareable implementation (CLAUDE.md "one shared implementation path") |
| **L4 lifecycle**      | startAccount subset (probe → bot-info cache → duplicate-token guard → monitor handoff) + outbound sendText + chatid resolution + `recordSentMessage` | per-channel lifecycle; shared outbound record hook                                                             |

**Per-vertical L-layer notes.** The four layers are channel-agnostic; their contents differ per channel:

- **Slack:** L1 = `@slack/web-api` (bundled `node_modules`, ~80 packages — vendor as a first-party dep), L2 = Socket Mode (WebSocket), L3 = shared, L4 = `auth.test` probe.
- **zalouser:** L1 = `zca-js` user-client wrapper (pure library, no CLI), L2 = user-client subscription (not poll, not WS to the channel), L3 = shared (media-group coalescing lives here, channel-agnostic), L4 = QR-login lifecycle + session restore + the risk-confirm gate. **The owned surface for zalouser is the Clisbot reference surface (§2.2), not the thin OpenClaw zalouser surface** — send/voice/react±/read/delete + media-group inbound + the QR lifecycle. The extended contact/group directory queries and the operator CLI surface are **not** part of the vertical pull: they ride with the operator-surface decision (§7.8), keeping group E's directory exclusion intact. This makes the zalouser L-layers larger than their OpenClaw source chunks imply, and the sync reference is `zca-js` + the Zalo protocol rather than an OpenClaw dist (see §4.2).

**Group E (out of scope, never pulled):** pairing, exec-approvals, thread-bindings, config doctor/migrations, security-audit, directory, setup wizard, model-selection keyboards (`interactive-dispatch`), `allow-from` policy machinery, secret contracts. This is the part of OpenClaw that changes most often — keeping it out is what keeps the sync delta small. The plane has its own equivalents (approvals, bindings, state stores) where needed.

**Sync reference:** the pinned OpenClaw dists stay in `channel-pins.json` after the pull. They stop being the Telegram _runtime supply_ and become the _sync reference_ — the "upstream/main" the fork diffs against, exactly as a fork tracks an upstream. The pin's `integrity`/`gitHead` keep pinning that reference.

## 4. The merge strategy: cheap re-sync, ledgered deviations

### 4.1 Drift tiers — where to live

Deviating from upstream has levels; the level determines the price of the next sync:

| Tier                                          | Drift at                                                                                             | Sync price                                                                                                         | Stance                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **B0** supply source only (S0/S1: re-pin)     | nothing in our code                                                                                  | 0 — a one-line pin bump                                                                                            | no right to fix bugs in their code; not S2 |
| **B1** at the stable boundary (S2 + manifest) | our code, but each module maps to the **stable Bot-API/transport boundary**, not the OpenClaw kernel | per-module diff; delta usually small because most releases touch group E                                           | **target state**                           |
| **B2** behavior drift (customer-first fixes)  | our code deviates from upstream _behavior_ (fixes they haven't made)                                 | **does not self-resolve** — must be ledgered (§4.3)                                                                | allowed, with a record                     |
| **B3** drive-contract drift                   | `plugin.gateway.startAccount` / `plugin.outbound.sendText` shapes                                    | highest, permanent — supervisor/loader become channel-specific; Slack/Telegram/zalouser stop being interchangeable | **never**                                  |

S2 lives at B1 with B2 entries recorded, and B3 is structurally excluded by the contract gate (§4.4). "Customer experience first" is B2 — legitimate — and the ledger is what keeps B2 updates cheap instead of tribal knowledge.

### 4.2 Sync manifest (per package)

`SYNC.md` maps each in-repo module to its upstream chunk + symbol + version stamp, and names the out-of-scope set (as load-bearing as the in-scope set — it answers "does this hunk matter?" in seconds during a diff):

```
# packages/channels/telegram SYNC (reference: openclaw@2026.7.1-2, gitHead 2d2ddc43…)
src/client/bot-api.ts       ← dist/send-BgA996pw.js   (+30 leaf chunks, enumerated below)
src/client/leaves/*.ts      ← string-coerce / number-coercion / redact / retry-policy /
                              request-timeouts / polls / markdown-tables / … (30, enumerated)
src/client/grammy-deps      ← grammy / @grammyjs/runner / @grammyjs/transformer-throttler
                              (kept as pinned deps of the in-repo package — decided, §7)
src/transport/poll.ts       ← hosts/telegram-monitor.ts long-poll loop (Hub option-A, pre-existing)
src/monitor.ts              ← shared L3 (offset store, dedupe, mention gate, ctxPayload,
                              inbound ledger record + consume-mark — Hub-owned, §2.4)
src/lifecycle/start-account.ts ← dist/channel-DP5CkqKN.js [subset: probe→bot-info→guard→handoff]
src/lifecycle/probe.ts      ← dist/probe-bGTVpKvS.js [subset: getMe + getUpdates + bot-info]
src/outbound.ts             ← sendText + resolveAndPersistChatId + recordSentMessage
                              (write-back re-targeted to plane storage — see DEVIATIONS D-001)
# OUT OF SCOPE (group E): pairing, exec-approvals, thread-bindings, doctor, security-audit,
# directory, setup-wizard, interactive-dispatch, allow-from, secret contracts
```

The zalouser manifest maps differently — the sync reference is **`zca-js@2.1.2` + the Clisbot T3Claw fusion repo's `src/channels/zalo-personal/`** (the already-ported reference surface), with the OpenClaw zalouser dist as secondary reference for anything we share with it:

```
# packages/channels/zalouser SYNC (reference: zca-js@2.1.2; Clisbot zalo-personal;
#                                              secondary: @openclaw/zalouser@2026.7.1, gitHead 2d2ddc43…)
src/client/zca.ts           ← zca-js API surface (session login, send, reactions, history)
src/actions/                ← send (md→native + mentions), voice, react add/remove, read, delete
                              (Clisbot reference: zalo-personal/message-actions.ts)
src/transport/subscribe.ts  ← user-client subscription (OpenClaw: monitor-ZalouserProvider shape)
src/monitor.ts              ← shared L3 + media-group coalescing (Clisbot: media-group.ts);
                              inbound ledger record + consume-mark as telegram (§2.4)
src/lifecycle/qr-login.ts   ← QR start/wait + session restore + risk-confirm gate
src/outbound.ts             ← sendText + recordSentMessage (seam namespaces: zalouser.*)
# OUT OF SCOPE: group E; the extended contact/group directory and the operator CLI surface
# ride with the operator-surface decision (§7.8), not this vertical
```

zalouser's re-sync loop (§4.4) diffs against `zca-js` releases instead of OpenClaw releases: a zca-js bump is the "upstream bump", and the Clisbot reference repo is re-read only when _we_ want to adopt one of its own improvements. The deviation ledger therefore records "deliberately beyond OpenClaw zalouser" entries (voice, read, delete, react-remove) with upstream status `n/a — by design`, plus the protocol-drift constraint (user-side Zalo protocol can change outside any release cadence).

### 4.3 Deviation ledger (per package)

`DEVIATIONS.md`, one entry per behavioral deviation:

```
D-001 — chatid/sent-message write-back targets the plane's keyed-store seam,
        not the OpenClaw config file (see §2.4 — storage, re-derived from the
        two requirements; no third table)
        reason: customer state stays in the plane; the config file is not ours
        upstream status: n/a (structural, not a bugfix) — permanent
D-002 — <behavior fix not in upstream>
        reason: <customer-impacting symptom>
        upstream status: open / fixed-in-2026.8.x → REVERT THIS LOCAL FIX ON SYNC
```

Operating rule: **at every sync, walk the ledger.** Entry fixed upstream → delete the local deviation (we re-join upstream there). Entry unfixed/wontfix → keep, update status. This is the mechanism that makes "we deviate when we must" survive repeated re-syncs.

### 4.4 The re-sync loop

1. Re-extract the bumped OpenClaw tarball(s) under the scout dir; bump the pin reference in `channel-pins.json`.
2. Diff each manifest-listed module: in-scope hunk → port; out-of-scope (group E) → ignore; new surface (new tool, new endpoint) → decide whether the plane exposes it; if yes, add to the package + manifest.
3. Walk the deviation ledger (revert where upstream caught up).
4. Gate: `npm run test:contract:native` (pinned verticals + any in-repo package, §4.5) + targeted unit tests + live E2E on the fixed dev home per CLAUDE.md. A sync that lands without a green gate is not a sync.
5. Bump the version stamps in `SYNC.md`.

Cost concentrates in step 2. The pinned-dist evidence bounds it: most of an OpenClaw release lands in group E (ignored), and the L1/L2 surfaces track the stable Bot-API/transport boundary.

### 4.5 Contract gate, extended

`vertical-contract.native.ts` (today: loads the pinned Slack + Telegram verticals, asserts `plugin.gateway.startAccount` + `plugin.outbound.sendText` on the plugin and `entry.gateway === undefined`, asserts the Slack graph is seam-routed and the bundled Telegram graph is seam-free) gains, per in-repo package:

- the **same drive-surface assertions** (B3 guard);
- **seam-free load-trace** for a Hub-authored package (no `__hub__/` seam URL in the loaded set — it must call `onInboundReply` directly, never through the bound seam);
- the **static pin-supply contract test** (§5), which keeps every structural claim in this doc machine-checked against the pinned bytes.

## 5. Self-verification

`packages/hub/src/channels/pin-supply.contract.test.ts` (vitest, static — no loader hooks needed) re-derives every structural claim in §1–§3 from the pinned supply on disk and fails if one drifts:

- the pinned pin manifest carries all three verticals with the expected `loadMode`/entry/plugin shapes;
- each pinned entry is a `defineBundledChannelEntry` result carrying the right `id`/`plugin`/`runtime` references;
- each plugin chunk re-exports the drive surface under the pinned export name;
- the pinned zalouser package's 37 SDK subpaths classify as **exactly** 30 passthrough + `channel-inbound` (bound) + 6 unclassified (the +6 passthrough additions named in §2.2);
- the telegram L1 closure inventory (30 relative imports + 3 bare, including `sent-message-cache`; bare set = `grammy`/`@grammyjs/*`) matches §2.1;
- main's `package.json` exports the 6 unclassified subpaths as real `./plugin-sdk/*` entries (they are passthrough-class, not typos).

Skips cleanly when the pinned supply is not staged under `OPENCLAW_SCOUT` (default `/tmp/openclaw-scout`), same convention as `vertical-contract.native.ts`. Run it: `npx vitest run packages/hub/src/channels/pin-supply.contract.test.ts --bail=1`.

## 6. Hub-side changes the pull requires (summary; no code yet)

1. **`loadMode` gains a third value** (e.g. `"in-repo"` / `"workspace"`) in `pins.ts` (`LoadModeSchema`), with `install-channel.ts` taking a no-tarball branch (repo code is trusted — no integrity gate; a content-hash marker is optional) and `load-channel.ts` admitting the in-repo package dir as a load-trace allowlist root.
2. **Supervisor drops the host-monitor override** (`channel.telegram.monitorTelegramProvider`) once `startAccount` in the package owns the monitor — one fewer special case.
3. **Schema — channel keys:** pulling Telegram reuses the `"telegram"` channel key — the three `in ('slack', 'telegram')` check constraints (`schema.ts:1256/1309/1356`) are untouched. Pulling zalouser as a _new_ channel key would widen all three; that decision is deferred to zalouser's own pull. Storage: one pglite channel event ledger extended to both directions (§6.7) + the keyed-store seam (§2.4) — no third table.
4. **Seam matrix:** +6 passthrough subpaths for zalouser (§2.2) — independent of the Telegram pull, needed before any published-zalouser load.
5. **Docs/security reframe:** `pinned-vertical-contracts/telegram-monitor.md` and the install-supply topic gain a "first-party" note for the in-repo vertical; the trust boundary moves from "integrity-pin external supply" to "our code, contract-gated".
6. **Keyed-store backing → pglite** (§2.4): one `channel_state_entries` DB table behind the existing `KeyedStoreBackend` interface. Independent of the pull (channel code is identical on JSON-file or DB backing), so it may land in its own commit before/after.
7. **`delivery_ledger` → the bidirectional channel event ledger** (§2.4, decided): a `direction` column (`in` | `out`); inbound rows unique on (channel, account, external conversation, external message id) with `consumedAt` + the turn reference the row dispatched to; outbound rows gain an `attempts` counter; the status check widens to include `consumed`. **Plus the vendor-id rename (§2.4.4, same clean cut):** `conversation_id → external_conversation_id`, `native_message_id → external_message_id` on `delivery_ledger`, and the same on `thread_bindings.conversation_id` (same concept, same table family — the plane stops carrying a third style for channel-assigned ids). Migration: column renames + new columns + existing rows are `direction = 'out'`, `attempts = 1`. The shared L3 monitor writes the inbound row before the `onInboundReply` handoff and marks it consumed when the dispatch settles. Lands **with** the pull, not in a separate commit.

## 6.5 The pull blueprint (implementation contract for the agent doing the pull)

**Status (2026-08-26): pull executed.** The wiring checklist landed: pins gained `loadMode: "in-repo"` with the no-tarball install branch (`pins.ts` / `install-channel.ts`); the loader admits the in-repo package dirs as load-trace allowlist roots (`load-channel.ts`); the supervisor dropped the `channel.telegram.monitorTelegramProvider` override and wires the shared L3's `inboundLedger` (record + consume-mark); `channel-pins.json` flipped both channels to `in-repo`, keeping their `channel` pins as upstream sync references. Deviations are recorded in `packages/channels/slack/DEVIATIONS.md` and `packages/channels/telegram/DEVIATIONS.md`. Verification: live E2E pending. The plan text below is the historical record.

Self-contained enough to work from without re-deriving. Hard rules first:

1. **Zero OpenClaw imports in either package** — no `openclaw/*` / `openclaw/plugin-sdk/*` specifier, static or dynamic, and no loader alias-route applied to them. Inbound of both packages calls `hostRuntime.onInboundReply` directly (model: `hosts/telegram-monitor.ts`, alias-free). After the pull, the bound `channel-inbound` seam and the alias-route in `loader/hooks.ts` serve **zalouser pinned only** — Slack's seam routing disappears with its vertical.
2. **Drive surface shape is immutable (B3):** each package exposes `plugin.gateway.startAccount` + `plugin.outbound.sendText` under the pinned export name (`telegramPlugin` / `slackPlugin`), plus a `defineBundledChannelEntry`-shaped entry (`id`, `plugin`, `runtime`). Entry/plugin types are declared in-repo (shared) — never imported from OpenClaw.
3. **The pinned dists become sync references, not supply.** `channel-pins.json` keeps all entries (integrity + gitHead stay) with the two pulled channels' `loadMode` moved to `"in-repo"` pointing at the built in-repo dist; no tarball fetch, no integrity gate for them (trusted first-party). zalouser is untouched in this work item.

Package layout (both channels + shared):

```
packages/channels/shared/          # channel-agnostic, no channel name in the code
  src/entry.ts                     # defineBundledChannelEntry shape + type
  src/plugin.ts                    # ChannelPlugin type {gateway:{startAccount}, outbound:{sendText}}
  src/monitor.ts                   # L3: offset store, in-flight dedupe, mention gating,
                                   #      ctxPayload build (per docs/audits/pinned-vertical-contracts/inbound.md),
                                   #      inbound ledger record + consume-mark (Hub-owned, §2.4),
                                   #      onInboundReply handoff
packages/channels/telegram/
  src/entry.ts, src/plugin.ts      # thin: id + export name + runtime setter
  src/client/                      # L1: Bot API — port of send-* chunk + 30 leaf closure (§2.1)
                                   #      npm deps: grammy, @grammyjs/runner, @grammyjs/transformer-throttler
  src/transport/poll.ts            # L2: getUpdates long-poll (move hosts/telegram-monitor.ts here)
  src/lifecycle/start-account.ts   # L4: probe getMe → bot-info cache → duplicate-token guard → handoff
  src/outbound.ts                  # sendText + chatid resolution + recordSentMessage
                                   #      (write-back → keyed-store seam, D-001)
  SYNC.md, DEVIATIONS.md
packages/channels/slack/
  src/entry.ts, src/plugin.ts
  src/client/web-api.ts            # L1: thin wrapper over npm dep @slack/web-api (PIN THE NPM DEP —
                                   #      do NOT vendor the tarball's bundled node_modules ~80 packages)
  src/transport/socket-mode.ts     # L2: port of the Socket Mode client handler (@slack/socket-mode
                                   #      npm dep; socket reconnect/redelivery semantics per §1 table)
  src/lifecycle/start-account.ts   # L4: auth.test probe (botToken+appToken), duplicate-token guard,
                                   #      monitor handoff
  src/outbound.ts                  # sendText + recordSentMessage (same seam contract as telegram)
  SYNC.md, DEVIATIONS.md           # Slack manifest maps modules → pinned dist chunks + the two npm deps
```

Hub-side wiring (§6, restated as a checklist):

- [ ] `pins.ts`: `LoadModeSchema` += `"in-repo"`; slack + telegram entries point at the built in-repo dists, `loadMode: "in-repo"`.
- [ ] `install-channel.ts`: in-repo branch — no tarball, no integrity; optional content-hash marker.
- [ ] `load-channel.ts`: admit the in-repo package dirs as load-trace allowlist roots.
- [ ] `supervisor/index.ts`: drop the `channel.telegram.monitorTelegramProvider` host override.
- [ ] schema: channel keys unchanged; `delivery_ledger` gains `direction` + inbound uniqueness + `consumedAt`/turn reference + `attempts`, status check += `consumed`; vendor-id rename `external_conversation_id`/`external_message_id` on `delivery_ledger` + `thread_bindings` (§2.4.4, §6.7).
- [ ] `seam-matrix.ts`: no change for this work item (zalouser's +6 passthroughs are deferred with the zalouser pull).

Verification checklist (all must be green before the pull is done):

- [ ] extended `vertical-contract.native.ts`: drive-surface assertions + **seam-free load-trace** for both in-repo packages; zalouser pinned still loads seam-routed (regression).
- [ ] extended `pin-supply.contract.test.ts`: pin manifest shapes for the new `loadMode` values.
- [ ] per-layer unit tests (telegram L1/L2/L4, slack L2/L4, shared L3 — incl. inbound ledger record/consume-mark: duplicate external message id → one row, no second dispatch; restart replay → consumed rows not re-dispatched), targeted files only per CLAUDE.md.
- [ ] typecheck + lint + format.
- [ ] live E2E on `~/.clisbot-dev` per CLAUDE.md guardrails — Telegram: master bot = external sender, `TELEGRAM_DEV_BOT_TOKEN` bot under test, API read-back match; Slack: `slack-cli` (user credential) post with mention, `conversations-replies` read-back, thread matched.

## 7. Decisions (2026-08-26) + remaining open items

**Decided:**

1. **Package placement:** `packages/channels/telegram` — a multi-channel channel package dir, not a per-channel `packages/channel-telegram`. Leaves room for `packages/channels/slack`, `packages/channels/zalouser`, and a shared module (`packages/channels/shared`) as the home for the channel-agnostic L3 monitor.
2. **L1 port style:** keep the grammy stack. The 3 bare imports (`grammy`, `@grammyjs/runner`, `@grammyjs/transformer-throttler`) stay as pinned deps of the in-repo package; no local reimplementation of the throttler/runner utilities, so no B2 entry for it.
3. **Storage re-target: ship with the pull; the pglite backings are separate commits.** (a) The `resolveAndPersistChatId` / `sent-message-cache` write-back re-target (§2.4) lands **with** the pull, as B2 entry D-001 in the deviation ledger — the in-repo L1 must point its writes at the plane's keyed-store seam, not at an OpenClaw config file we no longer own. (b) The keyed-store **backing** swap to pglite (`channel_state_entries`, §2.4) is a Hub-side commit, independent of the pull — channel code is identical on JSON-file or DB backing, so it lands in its own commit.
4. **Zalouser pull: Clisbot reference surface, `zca-js` as the primary sync reference.** The in-repo zalouser vertical implements the already-verified Clisbot zalo-personal surface (send/voice/react±/read/delete, media-group inbound, QR lifecycle with risk-confirm gate) instead of the thin OpenClaw zalouser surface; the sync reference is `zca-js` + the Zalo protocol, with the OpenClaw dist as secondary reference. No CLI/tool dependency to track — `zca-js` is a pure library.
5. **Storage concept: re-derived from the two requirements (§2.4); the ledger becomes bidirectional with the pull.** The pull starts from "inbound: record + consume-mark + recall-ready + context; outbound: record + retry + context," checked against T3Claw's channel store (the same two concepts, already bidirectional) rather than from the existing table names. Result: one pglite channel event ledger extended to both directions (§6.7, shipped with the pull — the shared L3 monitor writes the inbound row), the keyed-store seam unchanged (backing swap is a separate commit), and the canonical work-chat layer designed but not built — T3Claw's §4b "seed crystal" pattern, "a graduation, not a migration." No third table.

6. **Vendor-id naming: `external_*` everywhere a channel assigns an id.** `conversation_id → external_conversation_id` and `native_message_id → external_message_id` on `delivery_ledger` (and the same on `thread_bindings`); "native" dropped as a synonym — `external_` and `native_` were two names for one concept. Lands with the ledger extension (§6.7), so one clean cut covers both.

**Still open:**

7. **Pull order:** **Telegram + Slack together, in one work item** (this doc's scope, §6.5 blueprint) — both fully replace their pinned-OpenClaw mechanism. zalouser comes later, reusing the §4 mechanics + the Clisbot reference surface (§2.2, §7.4); its user-client means protocol drift is not on a release cadence.
8. **Zalouser operator surface (deferred, decide before that pull):** the Clisbot reference repo has an operator CLI layer (extended contact/group directory queries, `bots add/login/logout/status/me`, contacts/groups commands) that the vertical pull does not carry (§2.2, §3). Decide whether Hub exposes an equivalent operator surface (routes/CLI) or leaves it to the Clisbot CLI.
