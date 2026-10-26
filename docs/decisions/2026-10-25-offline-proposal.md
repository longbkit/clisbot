# Offline-First Experience — Proposal

- Date: 2026-10-25 · Baseline: clisbot `main` da002ef07 · Status: Owner approved 2026-10-25 — phase order O1 → O2 → O3 (O4 via separate ADR), default storage caps in `2026-10-25-offline-storage-volume.md` §3, queued approvals require re-confirmation after reconnect. O1 implementation authorized on an isolated branch in parallel with Navigation V2 Round 1; push/merge/release separately authorized.
- Companion docs: `2026-10-25-offline-pain-points.md` (problem), `2026-10-25-offline-storage-volume.md` (measured volume, budgets, cleanup)
- Evidence legend: [C] confirmed in code, [I] inference. Paths: `app/` = `packages/app/src/`, `client/` = `packages/client/src/`.

## 1. Why it breaks today (root causes, confirmed)

| #   | Root cause                                                                                                                                                                                 | Evidence                                                                                                      | Symptom                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R1  | **One socket + controller per Host, all started eagerly**, 2 s probe tick each, extra probe sockets; Hub sandboxes become N independent connections, each needing a Hub access-ticket POST | `app/runtime/host-runtime.ts:2959-3056, 940-968, 335`; `app/clisbot/hub/host-synchronization.tsx:110-175` [C] | 100 sandboxes = 100 sockets + 100 ticket calls; battery/CPU churn                                 |
| R2  | **Reconnect without jitter**; Hub-managed Hosts retry every 2 s with a fresh ticket and **no backoff**                                                                                     | `client/daemon-client.ts:1171-1172`; `host-runtime.ts:1488-1526, 1756-1758` [C]                               | Reconnect storms after VPN/network flip; Hub outage blocks even when direct/relay path works      |
| R3  | **Cold start restarts Hosts already connecting** when Hub bindings mount                                                                                                                   | `host-synchronization.tsx ~205` [C]                                                                           | Flicker / "connecting" twice on launch                                                            |
| R4  | **Managed Hosts hidden until the live Hub list loads** (Hub list not persisted)                                                                                                            | `app/clisbot/hub/host-inventory.ts:54-71` [C]                                                                 | Offline/VPN-off: company sessions vanish or route shows Unavailable while Home still lists them   |
| R5  | **Directory health is all-or-nothing**: any failed Host → "unavailable", any pending → "loading"; re-serializes every Host per event                                                       | `app/hooks/use-directory-health.ts:25-95` [C]                                                                 | Permanent spinner/error with one flaky sandbox; re-render churn at scale                          |
| R6  | **History waits for the slowest Host** (`Promise.allSettled`, 60 s RPC timeout), not persisted, refetched on every reconnect                                                               | `app/hooks/use-agent-history.ts:208-249`; `daemon-client.ts:1173` [C]                                         | Inbox/Home "stuck"                                                                                |
| R7  | **Thin offline cache**: 32 MiB total, evicts whole Hosts; timelines keep only last 50 items, only for the viewed session; items with images dropped                                        | `app/runtime/replica-cache/index.ts:77, 776-814, 1513-1563` [C]                                               | Opened sessions not readable offline; whole sandboxes go cold                                     |
| R8  | **No persistent outbox**; sending while disconnected fails immediately; **retry mints a new `clientMessageId`**                                                                            | `app/composer/submit.ts:67-99`; `app/composer/actions.ts:224`; `daemon-client.ts:2218-2250` [C]               | Unclear send outcome; manual retry can double-send                                                |
| R9  | **Hub HTTP calls have no timeout**; Hub list polled 60 s with `retry:false`                                                                                                                | `host-inventory.ts:24-33`; `hub/transport/create.native.ts:36-48` [C]                                         | A hung Hub request can block inventory indefinitely ("may never settle", `host-inventory.ts:139`) |
| R10 | Cache keyed by `serverId`, not account; unencrypted                                                                                                                                        | `replica-cache/row-store.ts:3-9`; `docs/data-model.md:621` [C]                                                | Account switch / shared device risk                                                               |

Already good and kept: Host route stays in place (no route-away), drafts persisted, open pane + draft survive transport loss, incremental directory sync with cursors/tombstones, timeline epoch/seq gap repair, server-side `messageId`/`idempotencyKey` dedupe, replica row store on SQLite (native) / IndexedDB (web).

## 2. Target experience

1. Every opened chat/session (and recent For me sessions) opens **instantly from the device**, online or not, also after restart.
2. **Failure unit = one source.** A sandbox or Hub being down shows a calm per-source status; everything else is fully usable. No global spinner, jump, reorder or route change.
3. Outgoing messages/approvals: `sending → sent`, or `unsent` with **Retry / Discard** — never lost, never duplicated.
4. Reconnect catches up **in place, incrementally**, without flicker.
5. Local data is **bounded, inspectable and self-cleaning** (Storage screen; `2026-10-25-offline-storage-volume.md`).
6. Errors name the source and next step ("Company Hub unreachable — check VPN"; "Sign in again to Hub X").

## 3. Design

### 3.1 Local-first read path

- Extend the existing `ReplicaRowStore` (not a new engine) into the single local source of truth for UI reads: metadata for all visible sessions, compact transcripts for opened/For me sessions, heavy payloads on demand.
- Timeline cache: from "last 50 items of the viewed session" to a **tail window per session (default 2 MB compact mobile / 10 MB desktop)**, including items with images (image bytes in the payload tier), plus older pages fetched when scrolling up.
- Prefetch on idle + Wi-Fi: compact tail of For me sessions with new activity, so sessions never opened are still readable offline.
- Persist the **Hub daemon list** (and its last-seen time) so managed Hosts stay visible and readable offline; mark them "last synced HH:MM" instead of hiding them. Revocation (explicit 403/`onAccessRevoked`/sign-out) still wipes.
- Key rows by **account + source + session**; encrypt at rest where the platform supports it (Keychain/Keystore-wrapped key; web best-effort).
- Budget-based eviction per `2026-10-25-offline-storage-volume.md` (per-session/LRU, never whole-Host eviction).

### 3.2 Connection manager for 10–100+ sources

- **Lazy connections**: keep live sockets only for (a) the session on screen, (b) sources with running/needs-action For me work, (c) a small pool of recently used sources. Everything else is served from cache and refreshed by periodic lightweight directory delta polls or push. Target: ≤ ~8 live sockets regardless of Host count (to be tuned).
- **Multiplex Hub sandboxes**: use the existing routed-channel mechanism (`hostMultiplexing` / `createHostChannelTransport`) so one connection to a Hub gateway carries many sandbox channels, instead of N sockets + N tickets. Needs a Hub-side gateway decision (separate ADR).
- **Backoff with full jitter** for every Host, managed or not (base 1–1.5 s, cap 60 s), with a global connect-concurrency limit (e.g. 4 in flight). Reuse cached access tickets until expiry; fetch tickets with backoff, not per 2 s tick.
- **Fix cold-start double connect** (R3): bindings adopt existing controllers instead of restarting them.
- **Timeouts everywhere**: Hub HTTP 10–15 s with abort; history fan-out returns per source as results arrive (stream, not `allSettled`), per-source timeout ~5 s, late sources merge in place.
- **Network awareness**: on OS network change / foreground, verify only live sockets; others wait for need.

### 3.3 Per-source health model and UI

- Status per source: `live` · `syncing` · `offline (last synced 10:42)` · `needs sign-in` · `access revoked`. Hub status summarizes its sandboxes ("Company Hub: 92/100 reachable").
- Aggregate health is never all-or-nothing: lists render whatever is cached + live; a compact source-status strip shows only degraded sources. Debounce state changes (show degraded after ~3 s) to avoid flicker.
- Replace the JSON.stringify-per-event health computation with per-source selectors (R5).
- Open session on an offline source: transcript readable, composer enabled for drafting, Send queues to outbox (3.4), approvals disabled with "will be available when X reconnects".
- Error copy distinguishes: unreachable (suggest VPN for company Hubs, without claiming VPN is off), 401 (sign in to that Hub), 403 (access removed → data hidden).

### 3.4 Outbox

- Persistent outbox (same SQLite/IndexedDB store) for messages, approvals/answers and simple session actions. Each item has a **stable client id generated once** and reused on every retry (fix R8 — today a retry mints a new id).
- States: `queued` (offline) → `sending` → `sent` (acked by daemon receipt) | `failed` (Retry / Discard / Copy text).
- Auto-send on reconnect for messages; **approvals and destructive actions require re-confirmation after reconnect** if the context may have changed (respect `docs/connected-hosts.md`: mutations are not blindly replayed).
- Ordered per session; one stuck item blocks only its own session, not the lane (lesson `2026-09-22-one-lost-sse-request-blocked-a-channel`).
- Never evicted; survives restart; visible in the conversation and as a small "n unsent" indicator.

### 3.5 Sync on reconnect

- Directory: existing `{generation, afterSeq}` delta cursors, per source, prioritized: on-screen session → For me active → rest.
- Timeline: existing epoch/seq `after` cursor from the cached tail; merge in place; epoch change replaces history only for that session.
- Push / silent notifications used as wake-up hints ("session X changed"), then pull by cursor.

### 3.6 Host side (separate decision)

Archive compaction, log rotation for long-lived sessions, dedupe of large `tool_call: running` rows, Host storage report — see `2026-10-25-offline-storage-volume.md` §5. These reduce catch-up time and Hub-wide disk cost.

## 3.7 Cross-platform and native-mobile rule (Owner, 2026-10-25)

- Follow existing repo patterns so every change works on iOS, Android, web and Electron from the first commit: existing platform-split files (`*.native.ts` / `*.web.ts`), shared stores/hooks, Unistyles theme tokens, existing primitives and Expo Router navigation. No web-only DOM/CSS or desktop-only shortcuts as the only path.
- Mobile app prioritizes a smooth native experience: native stack/tab transitions and gestures (swipe back, Android hardware back), virtualized lists, safe areas and keyboard handling, ≥44 pt touch targets, no layout jumps on load/reconnect, no heavy work on the JS thread during navigation/scroll (persistence/eviction off the interaction path).
- Acceptance includes native iOS + Android smoke on the changed journeys, not only browser/phone-web.

## 4. Phased plan

| Phase                                           | Outcome                                                                     | Main changes                                                                                                                                                                                                                                                                      | Risk                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **O1 — Stop the bleeding** (small, high impact) | One bad sandbox no longer freezes or flickers the app                       | Jittered backoff incl. managed Hosts + ticket reuse (R2); fix cold-start restart (R3); Hub HTTP timeouts (R9); per-source health instead of all-or-nothing (R5); history streams per source with timeout (R6); persist Hub daemon list so managed Hosts stay visible offline (R4) | Low–medium; mostly client                         |
| **O2 — Readable offline**                       | Opened + recent For me sessions open instantly offline, incl. after restart | Tail-window timeline cache incl. images, idle prefetch, account-keyed rows, budget eviction per session (R7, R10)                                                                                                                                                                 | Medium; storage schema migration                  |
| **O3 — Never lose a send**                      | Unsent/Retry like messaging apps                                            | Persistent outbox, stable client ids, re-confirm approvals (R8)                                                                                                                                                                                                                   | Medium; daemon receipt semantics must be verified |
| **O4 — Scale to 100+ sandboxes**                | Bounded sockets and Hub load                                                | Lazy connection pool, Hub multiplexing gateway (R1)                                                                                                                                                                                                                               | High; Hub/daemon protocol + ADR                   |
| **O5 — Storage hygiene**                        | Bounded, inspectable, self-cleaning                                         | Settings → Storage, keep-for-N-days, caps; Host retention/compaction                                                                                                                                                                                                              | Medium; Host change is separate                   |

Recommended order: O1 → O2 → O3 in sequence (each independently shippable and testable), O5 client part alongside O2, O4 after an ADR. Navigation V2 Round 2 (Watch, sync of seen state) can share O2's account-keyed store.

## 5. Acceptance journeys (draft)

1. Personal local + remote + Hub with 100 synthetic sandboxes, 10 unreachable: Home/Chats/Work render immediately from cache; only a source strip shows "Company Hub 90/100"; no global spinner; ≤ N live sockets.
2. VPN off mid-session: transcript stays; composer drafts; Send → `queued`; VPN on → auto `sent` exactly once (daemon receipt), no duplicate.
3. Airplane mode cold start: last opened 20 sessions and all For me sessions active in last 7 days open with content; managed Hosts visible with "last synced".
4. Network flip with 100 sources: connect attempts are jittered, concurrency-limited, no Hub ticket storm (measured).
5. Revoked access / sign-out / account switch: affected source data hidden and wiped; other accounts unaffected.
6. Storage: cap enforced under a 5 MB, 50k-row session on mid-range Android; Storage screen totals match disk usage ±10%.

## 6. Owner decisions (approved 2026-10-25)

1. Approve phase order O1 → O2 → O3 (client-only first), with O4 (Hub multiplexing) as a separate ADR.
2. Default storage caps and keep-for periods (`2026-10-25-offline-storage-volume.md` §3).
3. Whether queued approvals auto-send on reconnect or always require re-confirmation (recommendation: re-confirm).
