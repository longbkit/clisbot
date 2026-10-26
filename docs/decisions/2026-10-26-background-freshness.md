# Background Freshness — "Open the app, the latest is already there"

- Date: 2026-10-26 · Status: proposal (Owner asked for the design; not yet approved for implementation)
- Goal: messaging-app feel. New messages "arrive" in the background; opening the app or a notification shows the newest content immediately. Must stay cheap with tens to hundreds of sandboxes.
- Builds on: `2026-10-25-offline-proposal.md` (O2 local store, O3 outbox, O4 lazy pool + Hub multiplexing), `2026-10-25-offline-storage-volume.md` (compact tiers, budgets).

## 1. Today (main da002ef07)

- Each daemon sends its own push (`packages/server/src/server/push/*`, token store per daemon). The payload is alert-only (`serverId/workspaceId/agentId/reason`). Tapping it opens the app, which then connects and loads (`docs/notifications.md`).
- Nothing is fetched in the background. With N sandboxes, each holds the device token and pushes independently. The client must connect to that sandbox before content appears.
- O2 is not built yet, so there is no durable local transcript to show instantly.

## 2. How messaging apps do it (and the platform limits)

- **iOS:** silent pushes (`content-available`) are throttled and not guaranteed. The reliable path is a **visible notification with `mutable-content` + a Notification Service Extension (NSE)**. The NSE gets about 30 s to fetch and store content into a shared App Group store before the banner shows. `BGAppRefreshTask` is opportunistic only.
- **Android:** FCM high-priority data messages can run a short handler (or an expedited WorkManager job) to fetch and store. Periodic WorkManager runs at most about every 15 min.
- **Desktop / Electron:** the app can keep one lightweight connection open in the background (tray).
- **Everyone:** one connection or feed per user to their own server, never one per conversation source. On open: render from the local DB, then one delta sync by cursor.

## 3. Design

### 3.1 One activity feed per user (fan-in), not N sandboxes

- Each sandbox/daemon publishes **compact events** to its Hub. An event contains session id, seq, kind (message / needs-me / failed / finished), a short text preview (≤ 200 chars) and ownership. Full transcripts and tool output stay on the sandbox.
- The Hub keeps a **per-user append-only feed with a cursor**, filtered to For me + watched + addressed-to-me. Others are excluded unless watched.
- The client syncs **one cursor per Hub** plus one per personal Host. The personal daemon implements the same small feed API for its own sessions. So 100 sandboxes cost **one** request, not 100 connections.
- This is the same Hub gateway decision as O4 (multiplexing). Do one ADR for both.

### 3.2 Push = wake-up + prefetch, coalesced

- The Hub, not every sandbox, sends **at most one push per user per burst**. Coalescing is per session, with a rate limit (e.g. ≤ 1 per session per 30 s, ≤ 1 per user per 5 s). Notifications only for Needs me, finished, and DM/group messages to me. Others stay silent.
- The push carries only ids plus a "has new content" flag. **Message content is not in the push payload**, because APNs/FCM are third parties.
- iOS NSE / Android data handler: one authenticated delta call to the feed (≤ ~50 KB), then write previews and the **compact tail of affected sessions** (text tier only, ≤ 20 sessions, ≤ 2 MB per run) into the shared local store (O2). Then the banner shows real text, and opening the notification renders instantly.
- Falls back gracefully. If prefetch fails or times out, the notification still opens the session and loads normally.

### 3.3 Opportunistic background refresh

- iOS `BGAppRefreshTask` and Android periodic WorkManager each make one feed delta call with the same budget. Skip on Low Power / metered + low battery. These are a bonus, not the guarantee.
- Desktop/Electron: keep one feed connection per Hub while running in the tray. Sandboxes stay disconnected until opened.

### 3.4 Foreground ("open the app")

1. Render Home / Chats / Work and any opened session from the local store immediately (O2). Stale sources are labeled with "last synced".
2. One feed delta per Hub/personal Host, prioritized: the session on screen, then For me with new activity.
3. Connect lazily only to the open session's sandbox for the live stream and gap repair by seq (existing timeline epoch/seq cursor). Other sandboxes stay cold (O4 pool ≤ ~8 sockets).

### 3.5 Budgets and safety

- Text tier only in background; tool outputs and attachments are fetched on demand.
- Per-run caps (time, bytes, sessions); Wi-Fi/charging relaxes caps.
- Respect revocation and sign-out: the feed returns 403 → wipe that source (same rules as O1/O2). The device token is registered per account with the Hub, not with each sandbox.
- Accounting: feed calls, bytes and push counts are visible in the Storage/diagnostics screen.

## 4. Phasing (proposed)

| Phase | Outcome                                                                                                                      | Depends on                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| F1    | Open app → instant content from local store + one delta per source                                                           | O2 (local store)                   |
| F2    | Per-user activity feed on Hub (and personal daemon), cursor API; client uses it instead of N directory fetches for freshness | ADR with O4                        |
| F3    | Hub-coalesced push with NSE (iOS) / data handler (Android) prefetch into shared store                                        | F1, F2; iOS App Group + NSE target |
| F4    | Background refresh (BGAppRefresh / WorkManager), desktop tray feed                                                           | F2                                 |

## 5. Acceptance (draft)

- 100 synthetic sandboxes, 10 with new messages while the app is killed. After a push and a cold open, the newest message text is visible in ≤ 1 s with no network wait (airplane mode after push still shows it).
- At most 1 push per session per burst; Others produce no push.
- A background run stays within the byte/time/session budget; battery/network cost is measured on mid-range Android and an iPhone.
- Revoked Hub: the next feed call wipes that Hub's cached content.

## 6. Direct connections without a Hub (personal machine, one or many sandboxes)

### What already exists (main da002ef07)

- Every daemon already pushes **directly through a vendor push gateway** (Expo Push, `packages/server/src/server/push/push-service.ts` → `exp.host`), without any Hub. This is the same shape as a self-hosted Matrix homeserver → push gateway (Sygnal) → APNs/FCM. It is also how Home Assistant and Delta Chat reach phones from self-hosted servers: APNs/FCM keys belong to the app publisher, so a self-hosted server cannot talk to Apple/Google directly and must go through the publisher's small relay.
- A daemon can already front other Hosts ("connected hosts": A holds the link to B and routes scopes, `docs/connected-hosts.md`), and `clisbot hub start --personal` can run a personal Hub (`docs/hub.md`).

### Design: same model, smaller scale ("each source is a mini-homeserver")

1. **Every daemon implements the same tiny activity-feed API** (cursor + compact events for its own sessions). The client treats a direct Host exactly like a Hub with one sandbox. One code path, no special case.
2. **Push stays per daemon but becomes "id-only" + prefetch** (Matrix `event_id_only` pattern): the payload is `serverId + sessionId + seq`, with no content. The iOS NSE / Android handler fetches **only from the Host named in the push**, over its existing reachable route (direct, Tailscale or the E2E relay), with the same per-run budget. If that Host is unreachable from the phone at that moment, the notification still shows a generic line and the app syncs on open.
3. **Coalescing without a Hub:** each daemon coalesces per session (rate limit, `apns-collapse-id` / FCM collapse key = session id, `thread-id` = Host for grouping). The device registers its push token with each paired daemon (already the case). The app's notification settings let the user mute a Host.
4. **Many direct sandboxes (rule of thumb > ~5):** recommend designating one always-on personal daemon as the **aggregator**, using the existing connected-hosts link (A → B…) or `hub start --personal`. The aggregator exposes one merged feed and does the coalesced push, so the phone keeps 1 feed and 1 push source instead of N. This is the personal equivalent of the company Hub, and keeps 100-sandbox performance identical whether or not a company Hub exists.
5. **Android without Google Play (F-Droid build):** support **UnifiedPush** (e.g. ntfy) as the push transport for the same id-only payload. iOS has no equivalent; it always goes through APNs via the publisher relay.
6. **Desktop/Electron:** keep one feed connection per source (≤ a few for direct Hosts, one for an aggregator) while in the tray.

### Privacy and safety

- No message content in push payloads; content is fetched over the authenticated (E2E relay or TLS) path.
- Push tokens are per device per daemon; unpairing or revoking a device removes its token on that daemon.
- Background fetch is read-only and never sends, approves or replays anything (consistent with O3: approvals need re-confirmation).

### Sources (best practice research, 2026-10-26)

- Matrix Push Gateway API: the homeserver sends events to a separate push gateway, which submits to APNs/GCM; the `event_id_only` format sends only ids and counts — https://spec.matrix.org/v1.9/push-gateway-api
- Apple developer forums: background (silent) pushes are throttled and may not arrive; the Notification Service Extension runs only for visible notifications and is the recommended place to fetch/decrypt; do not rely on push as the only delivery path, fetch on start/foreground — https://developer.apple.com/forums/thread/664497 , https://developer.apple.com/forums/thread/745188
- Delta Chat notification proxy: a small relay that forwards device tokens to Apple/Google push services to wake the app; non-user-visible messages are filtered so they do not trigger pushes — https://github.com/deltachat/notifiers
- Home Assistant: default notifications go through Google/Apple; Android "local push" delivers directly from the server at the cost of a persistent WebSocket — https://www.home-assistant.io/blog/2022/02/11/android-february/
- UnifiedPush / ntfy: self-hostable push for Android without FCM (distributor + push server); not available on iOS — https://nextcloud.com/blog/unifiedpush-android-nextcloud-talk/ , https://etke.cc/help/extras/ntfy/

## 7. Owner decision (2026-10-26): always through a Hub

The Owner chose one model: **every source reaches the phone through a Hub**. A personal user with one or a few sandboxes also uses a Hub (a personal Hub). Several Hubs are supported (e.g. company + personal), but the product **encourages one Hub per user**. This supersedes the per-daemon "mini-homeserver" path in §6 as the target design.

Consequences:

- **One feed and push path in the client:** activity feed, cursor sync, coalesced push and prefetch exist only on the Hub. Daemons publish compact events to their Hub; they no longer need a phone-facing feed API.
- **Push moves to the Hub:** the device token is registered with the Hub account, not with each daemon. Today's per-daemon Expo push becomes a legacy fallback, used only while a Host is not enrolled in any Hub, and is deprecated afterwards.
- **Control plane vs data plane:** the Hub carries the feed, push and inventory (and, per O4, can multiplex sandbox channels). Live session streams may still go direct or over the E2E relay when that is faster. The Hub is not forced into every byte.
- **Personal Hub must be effortless:** `clisbot hub start --personal` (already exists) becomes the default personal setup. Onboarding offers "add this sandbox to your existing Hub" first, and creating a second Hub is an explicit, discouraged choice. Settings shows multiple Hubs and suggests consolidating.
- **Availability:** a personal Hub on a laptop that sleeps means no push while it sleeps. Recommend an always-on location (home server, VPS or a hosted Hub). The client still works from cache, and syncs on open when the Hub is reachable again. Hub health is shown as one source line (O1).
- **Same performance at any scale:** the phone holds 1 feed + 1 push source per Hub, whether that Hub fronts 1 or 100+ sandboxes.
- **ADR scope:** one ADR covering the Hub gateway (O4 multiplexing), the per-user activity feed (F2), Hub-side push with coalescing and id-only payloads (F3), personal-Hub defaults and onboarding, the legacy direct-push fallback and its deprecation, and multi-Hub UX.

## 8. Security and Hub load for enterprises (tens to hundreds of sandboxes)

Principle: **Hub = control plane (inventory, access, feed, push), not the data plane.** Today Hub already never relays app traffic (`docs/hub.md`, "Connection and authority"); keep that. Transcripts and tool output stay on sandboxes and travel direct or over the E2E relay. If O4 multiplexing goes through Hub, it forwards **E2E-encrypted channels** (existing relay Noise/E2EE), never plaintext.

### 8.1 Security

| Risk                                                                     | Required control                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub becomes a high-value store of content                                | Feed holds **metadata + short preview only**; an org policy "metadata-only" turns previews off. Previews are **encrypted to the recipient's device keys** by the sandbox (Hub stores ciphertext) where feasible; otherwise a short TTL (e.g. 7 days) + secret redaction; tool output never enters the feed |
| A compromised/malicious sandbox spams or injects into other users' feeds | Sandbox authenticates with its own relationship credential and may publish **only for its own serverId**; **Hub decides recipients from its ACL**, never from sandbox-provided recipients; schema/size validation; per-sandbox rate limit and coalescing                                                   |
| Leaking that a session exists to someone without access                  | Feed and counts are computed after Hub's access check (same policy as Host access/managed tickets); Others visibility follows org policy                                                                                                                                                                   |
| Revocation lag                                                           | Revoke user/device/Host → immediately purge that user's feed entries for the source, invalidate cursors and push tokens; next client call gets 403 → client wipes that source (O1/O2 rule)                                                                                                                 |
| Content in APNs/FCM                                                      | Push is **id-only**; content fetched over authenticated TLS/E2E                                                                                                                                                                                                                                            |
| Lost device                                                              | Device revocation in Hub → no push, feed 401/403, app wipes cache on next start; encrypted local store (O2)                                                                                                                                                                                                |
| Multi-tenant Hub                                                         | Strict org isolation in feed tables/keys; per-org encryption keys at rest; audit log for access, revocation, device registration                                                                                                                                                                           |
| Push provider / data residency                                           | Enterprise self-hosted Hub may need its own push relay credentials (enterprise build) instead of the shared Expo push service; document both                                                                                                                                                               |

### 8.2 Load estimate (to verify with real org data)

Assume 100 sandboxes, 50 active sessions each per day, and feed events at **turn-level granularity** (agent turn finished, needs-me, failed, message from someone else), not every streaming/tool row: ~10–20 events per session per day.

| Item                                           | Estimate                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Feed events                                    | 100 × 50 × 20 = **100k/day** ≈ 1.2/s average; bursts of tens/s                                                                                |
| Fan-out                                        | owner + watchers + addressed, typically 1–3 recipients per event                                                                              |
| Storage                                        | ~500 B/entry → ~50 MB/day; 30-day TTL ≈ 1.5 GB (partition by day in Postgres)                                                                 |
| Push                                           | coalesced ≤ 1 per session per 30 s, per-user cap → far below event count                                                                      |
| Client sync                                    | one indexed cursor query `(user_id, seq)` per open/push; cheap                                                                                |
| **Contrast:** routing live streams through Hub | measured raw log growth ~295 MB/day for one heavy Host → up to tens of GB/day for 100 sandboxes. **This is why the data plane stays off Hub** |

### 8.3 Stability under load

- **Reconnect storms:** after a Hub restart or network flip, 100 sandboxes and N clients reconnect. Use jittered backoff (O1, already on the client; add the same on daemons), admission concurrency limits, and **cursor resume** (no full resync).
- **Noisy sandbox isolation:** per-sandbox event quota + coalescing (a 1.4 GB loop session must not flood feeds).
- **Hub outage = degraded, not down:** sandboxes keep running; clients work from cache and can still open live streams via direct/relay; feed and push resume from cursors. The feed is a **cache rebuildable from sandbox seq cursors**, so Hub state loss is recoverable.
- **Scale-out:** stateless API/gateway nodes behind a load balancer, Postgres primary + backups (partitioned feed), queue for push. Enterprise deployment ≥ 2 instances.
- **Observability:** per-sandbox events/s, feed lag, push success/failure, queue depth, reconnect rate, per-org storage. Alerts on lag and on rejected/invalid publishes.

### 8.4 For the ADR to decide

1. Preview policy default (metadata-only vs encrypted preview vs TTL plaintext) per org.
2. Device-key encryption of previews: feasible now with existing device-access keys?
3. Event granularity contract (which events enter the feed).
4. Whether O4 multiplexing is needed at all, or only the control plane plus direct/relay data plane.
5. Push provider options for self-hosted enterprise Hubs.
6. Load test plan: 100–500 synthetic sandboxes, 1k users, reconnect storm, noisy sandbox; target numbers.

## 9. Owner decisions and Atlas recommendations (2026-10-26)

### 9.1 Preview default per organization — Owner: metadata-only or device-encrypted

- Org setting `feedPreview`: `metadata-only` (default for organizations) or `device-encrypted`. Plaintext previews on Hub are not offered.
- Personal Hubs default to `device-encrypted` (the user is the only reader).

### 9.2 Existing device keys — yes, feasible (verified in source, main da002ef07)

- **Device signing key:** `packages/device-access/src/proof.ts` `createDeviceKey` = Ed25519 (`nacl.sign`), kept in secure storage, used for pairing/hello/http proofs and bound at first pairing redemption (`docs/features/access/device-pairing.md`).
- **E2E box primitives:** `@clisbot/relay/e2ee` uses `nacl.box` key pairs (X25519); daemons/services already hold pinned box keys (`device-access/src/service-key.ts`, `~/.clisbot/daemon-keypair.json`).
- **Plan:** add a per-device **encryption key pair (X25519, `nacl.box`)** generated next to the existing signing key. Keep separate keys for signing and encryption, which is standard practice. Register its public key with the Hub, **signed by the device signing key**, so the Hub cannot substitute keys unnoticed. The sandbox (or Hub, for the metadata-only → encrypted toggle) encrypts each preview as a sealed box per recipient device; the Hub stores ciphertext only. The iOS NSE reads the private key from the shared App Group keychain; Android reads it from the Keystore-wrapped store.
- Revoking a device removes its public key, so new previews are no longer encrypted for it.

### 9.3 Feed events — Owner: user-friendly content only

Included:

- the agent's **final reply text of a turn** (assistant message), truncated for the preview;
- **messages from other people** in shared chats/groups;
- **needs-me** (approval/question) with its human-readable prompt;
- **turn finished / failed** as one short status line.

Excluded: tool calls and tool output, reasoning/thinking, streaming deltas, compaction and other internal events. This matches the measured split: tool payloads are ~92% of raw bytes; user-facing text is ~8%.

### 9.4 O4 multiplexing through Hub — Atlas recommendation: do not build a Hub data plane now

- **Hub = control plane:** inventory, access, tickets, activity feed and push. This keeps the existing rule that "Hub never relays app traffic", keeps Hub load small and predictable (§8.2: ~100k events/day vs tens of GB/day of streams), and keeps plaintext off Hub.
- **Data plane:** direct when reachable, otherwise the existing E2E relay (already zero-knowledge, per-serverId). The N-socket problem (R1) is solved client-side by the **lazy connection pool** (only open/active sessions connect, ≤ ~8 sockets). The feed removes the need to poll every sandbox.
- **Revisit only on evidence:** if enterprise networks prevent phones from reaching sandboxes or the relay, add an **ingress that forwards E2E ciphertext** (relay semantics at the Hub edge), never plaintext multiplexing. That needs a measured case first.
- **Ticket cost stays bounded:** one access ticket per actual connection to an opened session (single-use, 60 s); the feed and push need none.

### 9.5 Push for self-hosted Hubs — clarified

- Self-hosting a Hub does **not** mean building a separate app. Every Hub (cloud, self-hosted enterprise, personal) sends id-only push requests (optionally with a device-encrypted preview) to the **Clisbot push gateway** (today Expo Push), which delivers to the one published Clisbot app via APNs/FCM. The gateway sees only ids and ciphertext.
- Only an organization shipping its **own white-label app** would need its own APNs/FCM credentials. They would configure the same gateway interface with their keys, as the Owner does for Clisbot. Out of scope now.
- An option for air-gapped organizations: push disabled; the feed syncs on open and over the desktop tray connection.
