# Offline cache (Offline O2, first slice)

Opening a chat or a session paints from the device at once, then the Host's answer replaces it.
The device never keeps more than a bounded, compact copy. Budgets and the phase plan come from the
2026-10-25 offline decisions (storage volume and proposal); this doc records what the app does.
[Connection resilience](connection-resilience.md) is O1.

The slice is behind `OFFLINE_CACHE_ENABLED` (`packages/app/src/runtime/replica-cache/offline-flag.ts`).
`EXPO_PUBLIC_CLISBOT_OFFLINE_CACHE=0` restores the 50-item timeline with whole-Host eviction and
hides Settings → Storage.

## What a tail keeps

| Row          | Kept                                                                                               | Never kept                                                         |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `timeline`   | user and assistant text; reasoning cut to 2 KB; tool calls as callId, name, status, one-line title | tool inputs and outputs, diffs, file contents, images, attachments |
| `transcript` | the accepted Chat record and its last 50 lines: id, seq, sender, text, time, image count           | image bytes (shown as a localized `[Image]` placeholder)           |

- One session tail is at most 256 KB, newest items first (`replica-cache/timeline-tail.ts`).
- A tail that dropped anything stores `range: null`. That is the lossy mark: the open path paints
  it, claims no coverage, and fetches the real tail. Only a text-only tail that fits keeps its
  range and catches up with an `after` fetch.
- A chat tail is written only from a page the Host accepted for the current admission. The saved
  record shows the chat before the Host answers but never authorizes a send; a refusal or removal
  still hides it (`use-chat-record.ts`, `use-chat-transcript.ts`).
- The open fetch sends `allowDeferredPayloads` (`openTimelineFetch`), so entries above the
  daemon's 64 KiB inline limit arrive as descriptors and load through `agent.timeline.payload.get`
  when shown. While a retained item is deferred, live events for that session become catch-up
  fetches instead of local merges ([agent session storage](../agent-session-storage/implementation.md)).

## Keeping it bounded

| Rule          | Value                                                            | Where                                |
| ------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Total budget  | 32 MB of row payload                                             | `MAX_CACHE_BYTES`                    |
| Eviction      | tails, least recently opened first                               | `tail-retention.ts`                  |
| Never evicted | session, workspace and project rows while the Host is registered | same                                 |
| Save window   | a tail is written only if opened in the last 7 days              | `ReplicaCache.tailSaveOpenedAt`      |
| Age sweep     | tails not opened for 30 days, when the store is first used       | `ReplicaRowStore.deleteOpenedBefore` |

Reading a tail is opening it: `readTimeline` and `readChatTail` record the open, and the row
stores it as `opened_at`. The schema moved to version 2 for that column and the `transcript`
kind, so an upgrade rebuilds the cache once.

## Clearing

- Settings → General → Storage shows the bytes in use (row payloads plus downloaded files) and
  clears both after a destructive confirmation.
- Hub sign-out and removing a Hub profile clear that Hub's Hosts. They are found from the
  remembered daemon list, so the clear starts before that list is forgotten.
- Clearing drops the rows, the cache's in-memory index and pending writes, the chats in the
  transcript store, and the cached chat queries. A connected Host is then marked invalidated, the
  same guard eviction uses: its directory deltas are ignored until the next full baseline,
  otherwise a later delta would checkpoint a partial directory.
- Live session timelines in the session store are not cleared; a removed Host's session state goes
  with the Host (`HostRuntimeStore.clearHostReplica`).
- Native downloads now land in `cache/clisbot-downloads/` so they can be measured and removed.
  Files downloaded before this change sit in the cache root and are not cleared.

## Measured

Node, synthetic session shaped like the 2026-10-25 sample (70% shell calls of ~5.4 KB, 20%
assistant 0.3 KB, 10% reasoning 0.6 KB); not device evidence.

| Session items | Raw JSON | Before (50-item tail) | After             | Write + persist | Read + decode |
| ------------- | -------- | --------------------- | ----------------- | --------------- | ------------- |
| 50            | 204 KB   | 204 KB, 50 items      | 18 KB, 50 items   | 1.0 ms          | 0.9 ms        |
| 200           | 816 KB   | 204 KB, 50 items      | 71 KB, 200 items  | 1.2 ms          | 1.8 ms        |
| 1,000         | 4.1 MB   | 204 KB, 50 items      | 261 KB, 728 items | 3.6 ms          | 8.1 ms        |

## Gotchas

- Runtime helpers shared by the row stores live in `row-store-schema.ts`. Platform resolution maps
  `./row-store` to `row-store.web.ts` or `.native.ts`, which re-export only types and schema
  values; a function exported from `row-store.ts` is `undefined` at runtime.
- Rows are keyed by `serverId`, not account (R10 in the proposal); clearing on sign-out is what
  keeps one account's tails from another for now.
- Not done in this slice: idle prefetch of For me sessions, an older-page cache, per-source and
  per-session sizes on the Storage screen, encryption at rest.
