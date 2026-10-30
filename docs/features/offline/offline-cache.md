# Offline cache (Offline O2, first slice)

Opening a chat or a session paints from the device at once, then the Host's answer replaces it.
The device never keeps more than a bounded, compact copy. Budgets and the phase plan come from the
2026-10-25 offline decisions (storage volume and proposal); this doc records what the app does.
[Connection resilience](connection-resilience.md) is O1.

The slice is behind `OFFLINE_CACHE_ENABLED` (`packages/app/src/runtime/replica-cache/offline-flag.ts`).
`EXPO_PUBLIC_CLISBOT_OFFLINE_CACHE=0` restores the 50-item timeline with whole-Host eviction,
hides Settings → Storage, and turns off preloading, the open shell and the hidden-session
release below.

## Opening never waits

Tapping a row shows its screen in the next frame. What fills it depends on what the app holds.

| Holds                             | Session                                                          | Chat                                                                                       |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Memory (opened in the last 5 min) | the timeline as it was; no fetch unless live events were dropped | the cached transcript query, then a delta                                                  |
| Device tail                       | the compact tail, then the Host's page                           | the 50-line tail, then the Host's page                                                     |
| Nothing                           | the directory row (title, status, provider) and a loading row    | the pressed row's title, no transcript, sending off, and a loading row (`open-preview.ts`) |

- The agent screen no longer holds an overlay until authoritative history lands; the empty stream
  shows `agent-history-loading-row` (`agent-stream/placeholder.ts`, `isStreamHistoryLoading`).
- A chat preview never authorizes anything. Sending needs the accepted record, and a refusal still
  replaces the screen.
- The open fetch is one bounded page: 40 projected items (`TIMELINE_FETCH_PAGE_SIZE`), tool payloads
  deferred. The daemon counts items, not turns, so "about 20 turns" is not expressible without a
  protocol change. Older pages load on scroll with `before`.
- Navigation does not await data, except a bot row whose direct chat is not in the cached rows: it
  needs the chat id from the Host first. Native Chats still dispatches the push in the next JS task
  ([mobile panels](../../mobile-panels.md#home-navigation)).

### The open shell

React Navigation renders a pushed screen inside the commit of the press that pushed it, so the
press's frame waits for the whole screen. On 2026-10-30 (production APK, Galaxy S23) a session row
took 367–533 ms to first change. Both rows push `h/[serverId]`; for a session the cost was the
workspace screen's mount, one component of several hundred hooks. With the phone tabs, a Chats row
pushes from the press itself (there is no list panel admission to defer it), and a chat took 833 ms
to first change.

- On native phones (`useOpenShellEnabled`) the pushed screen paints a shell in the press's frame
  and `OpenGate` (`navigation/open-gate.tsx`) mounts the screen in the next JS task; Back first
  cancels it. Web, desktop and tablets mount the screen at once.
- A session's deck entry shows `WorkspaceOpenShell`: the screen's compact header (Back, workspace
  title, project row) over the spinner the screen shows before its body.
- A chat shows `ChatOpenGate`'s shell (`clisbot/bots/chat/chat-open-gate.tsx`): the compact
  header with Back and the title the pressed row showed (`open-preview.ts`) over a spinner. The
  record, transcript and live heads subscribe when the route mounts, a task later. A reopen pushes
  a new route, so it shows the shell too, then the cached transcript.
- The tail is not in the shell. It paints when the screen mounts, from memory within the five
  minutes below, otherwise from the device tail. A second timeline renderer for one frame was not
  worth its drift.
- A layout change no longer saves in the press: native writes it 500 ms later, once for the
  changes in between (`writeAfter` in `validated-persist-storage.ts`). Each save validated and
  serialized every opened workspace's layout, 7.3 ms on Node with 300 workspaces, and opening a
  session saves at least twice.
- `navigation/open-gate.browser.test.tsx` presses a row in a real navigator: the press's commit
  holds the shell and zero renders of the screen; the screen renders in the scheduled task; Back
  before it means the screen never renders. `chat-open-gate.browser.test.tsx` does the same for a
  chat row, with the row's title in the shell, and again after Back.
- The shell paints only if nothing heavy renders in the same JS task. On 2026-10-30 a chat row
  still showed nothing for 1,000 ms and then the whole chat: Expo Router notifies every route
  reader from the push's state-change effect, inside the press's task, and the root chrome, the
  Chats pane, Work and Home's start screen read the whole route. They read a selected fact now
  ([route reads](../../expo-router.md#route-reads)); `navigation/route-source.browser.test.tsx`
  checks that the push's commit holds the shell and no tab, tab bar or Home row render.
- A device trace shows `clisbot.workspace.shell`, then `clisbot.workspace.mount`, and
  `clisbot.chat.shell` for a chat. Not yet measured on the S23 after these changes.

### Preload on intent

`open-preload/` starts the open's own fetch before the tap completes.

- Press-in on a Home, Inbox, Work or Chats row, and the top two Home rows while shown, request a
  preload. A session hydrates its device tail, then fetches the open tail; a chat fills the route's
  own transcript query (`chatTranscriptFetchInput`), so the route's first render already holds it.
- At most two run at once. A finished preload is not repeated for 30 s. Fetches cannot be aborted,
  so cancelling only drops queued work: a list drag drops the queue, and a row leaving the top
  drops its own.

### Hidden sessions

A session nobody is viewing keeps its retained pages for 5 minutes (`HIDDEN_TIMELINE_TTL_MS`),
then releases them (`timeline-page-retention.ts`). Its subscription stays, and it is marked like a
session whose events were dropped while hidden, so showing it again catches up. A preloaded session
that is never opened is released the same way. The 8 MB per session and 32 MB total byte budget
still evicts sooner when needed.

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
- Not done in this slice: idle prefetch of For me sessions beyond the top Home rows, an older-page
  cache, per-source and per-session sizes on the Storage screen, encryption at rest, a TTL for chat
  transcripts (the transcript store still keeps every chat for the app's lifetime).
- The agent stream's list owner (`AgentStreamView`) subscribes to the live head, so it re-renders
  per flushed chunk; its history rows and the panel header do not (`strategy-web.test.tsx`). The
  chat route itself no longer re-renders per chunk (`use-chat-live-heads.test.tsx`).
