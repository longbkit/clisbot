# Offline Experience — Storage Volume: Estimate, Analysis, Cleanup

- Date: 2026-10-25
- Measured on: Owner's primary Mac Host, read-only scan of one heavy user's daemon session logs and Electron profile. No files were modified.
- Scope: how much data an offline-first client would need to keep, how to bound it, and how to clean old data — on the client (phone/desktop/web) and on Hosts (sandboxes).

## 1. Measured baseline (one heavy user, one Host, 16 days: 2026-10-09 → 10-25)

| Metric                              | Value                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Session logs (`events.jsonl`)       | 1,273 files, **4.24 GB** raw                                                              |
| Session metadata (`*.json`)         | 4,274 files, 73 MB (median 0.5 KB)                                                        |
| Images stored with sessions         | 306 files, 74 MB                                                                          |
| New sessions per day (last 14 days) | **~88**                                                                                   |
| Raw log growth per day              | **~295 MB/day** (~9 GB/month per heavy Host)                                              |
| Raw size per session                | median 0.58 MB · p90 2.3 MB · p99 23 MB · max **1.42 GB** (long-lived CTO loop session)   |
| Electron client profile today       | 664 MB total, of which `blob_storage` 412 MB (origin not yet attributed), IndexedDB 18 MB |

### What the raw bytes are (sampled 81 sessions, 99k timeline rows)

| Item type             | Share of bytes | Avg row |
| --------------------- | -------------: | ------: |
| tool_call (running)   |          52.3% |  5.3 KB |
| tool_call (completed) |          38.3% |  5.5 KB |
| tool_call (failed)    |           1.4% |  4.5 KB |
| assistant_message     |           6.1% |  0.3 KB |
| reasoning             |           1.5% |  0.6 KB |
| user_message          |           0.4% |  1.2 KB |

- **~92% of raw bytes are tool-call payloads** (inputs/outputs: command output, file contents, diffs). Human-readable conversation (user + assistant + reasoning) is **~8%**.
- 14% of bytes are rows larger than 32 KB, almost all completed tool outputs.
- Why "running" tool rows are this large (duplicated input snapshots vs genuinely large inputs) is **not yet established**; worth checking because it could halve Host-side storage.

### Compact client representation

Keeping full text for messages/reasoning and a ~400-byte summary per tool call (name, status, short title/result line), with large outputs fetched on demand:

|                     | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| Compact / raw ratio | **~13%** (40 MB vs 307 MB in a 150-session sample)     |
| Compact per session | median **118 KB** · p90 476 KB · p99 3 MB · max 5.3 MB |

## 2. Estimates for the client

Assumptions: heavy user like the Owner; For me scope; Hubs with up to 100 sandboxes.

| Data                                                               | Size model           | Estimate                                            |
| ------------------------------------------------------------------ | -------------------- | --------------------------------------------------- |
| Directory metadata (every visible session/chat across all sources) | ~1 KB per row        | 100 sandboxes × 200 sessions = 20k rows ≈ **20 MB** |
| Transcripts, all For me sessions, compact                          | 88/day × ~270 KB avg | ≈ **24 MB/day**, ~700 MB/month if kept unbounded    |
| Transcripts with policy below (tail window + 30-day keep)          |                      | **~150–400 MB** steady state                        |
| Large tool outputs / attachments                                   | on demand, LRU       | capped by budget                                    |
| Outbox + drafts                                                    | tiny                 | < 1 MB, never evicted                               |

Conclusion: **a full mirror is not viable on phones; a bounded, compact, tail-first cache is.** Raw logs are ~8× larger than what the UI needs to render a conversation offline.

## 3. Proposed client storage policy (messaging-app style)

Tiers:

1. **Metadata** (all sources): session/chat rows, status, owner, last activity, unread/seen. Always kept while the source is registered and the item exists/accessible.
2. **Transcript text** (compact, per session): messages, reasoning, tool-call summaries. Kept for opened and For me sessions.
3. **Heavy payloads**: full tool outputs, diffs, images, attachments. Fetched on demand, cached by LRU.
4. **Pinned-forever local**: outbox, drafts, unsent approvals — never evicted.

Default limits (configurable in Settings → Storage):

| Setting                                     |                                                     Mobile | Desktop/Electron |                    Web |
| ------------------------------------------- | ---------------------------------------------------------: | ---------------: | ---------------------: |
| Total cache cap                             |                                                     500 MB |             2 GB | 300 MB (browser quota) |
| Per-session transcript tail window          | last 2 MB compact (~older pages fetched when scrolling up) |            10 MB |                   2 MB |
| Keep transcripts of sessions not opened for |                                                    30 days |          90 days |                14 days |
| Heavy payload cache                         |                                                 150 MB LRU |         1 GB LRU |                 100 MB |
| Pinned / opened in last 7 days              |            exempt from age eviction (still counted in cap) |                  |                        |

Eviction order when over cap: heavy payloads (LRU) → transcripts of archived sessions → transcripts of Others/All-only sessions → transcripts of For me sessions not opened longest. Metadata row and seen/dismissed state stay so the list remains stable. Eviction runs in the background with an immunity window (nothing touched in the last 10 minutes), never during scroll/send.

Hard rules: never evict outbox/drafts/unacked items; wipe a source's cache on sign-out, account switch or explicit 403/revocation; cache is keyed by account + source + session so identities never mix.

## 4. Analyze and clean (user-facing)

**Settings → Storage** (Telegram/WhatsApp pattern):

- Total used on this device vs cap; breakdown by tier (metadata / text / payloads / outbox).
- Breakdown by **source** (Local, Remote, each Hub) and **top sessions by size**, sortable.
- Actions: Clear payload cache · Clear cache for a source · Clear a session's offline copy · "Keep offline for" (7 / 30 / 90 days / Forever) · Max cache size.
- Clearing cache never deletes server data; a cleared session re-downloads when opened.
- Large-item review: sessions or payloads above 50 MB highlighted.

## 5. Host-side (sandbox) retention — the other half

The raw log grows ~9 GB/month on a heavy Host; a single loop session reached 1.42 GB. Across a Hub with tens to hundreds of sandboxes this is the larger cost, and large logs also slow catch-up sync.

Proposals (separate decision, Host/daemon change):

- **Archive compaction**: for archived/ended sessions older than N days, keep text + tool summaries, move full tool outputs to a compressed archive or drop above a size threshold (with a "output removed by retention" marker).
- **Long-lived session rotation**: loop/heartbeat sessions segment their log (e.g. per day or per 100 MB) so clients only sync the tail.
- **Investigate running tool rows** (52% of bytes) for duplicate snapshots; dedupe if confirmed.
- **Host storage report**: per-session/project usage exposed to the client so the Storage screen can show Host usage too, and admins can see Hub totals.
- User project files (workspaces/worktrees) are not app cache; a Host storage view may list them but never auto-cleans them.

## 6. Open items

- Attribute Electron `blob_storage` 412 MB (likely images/attachments retained by the renderer) before setting web/desktop defaults.
- Measure a typical non-heavy user and a company sandbox (likely far below 88 sessions/day) to set Hub-wide defaults.
- Benchmark chosen SQLite layer with a 5 MB / 50k-row session on a mid-range Android phone.
