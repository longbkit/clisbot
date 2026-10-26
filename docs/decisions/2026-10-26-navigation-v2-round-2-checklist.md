# Navigation V2 — Round 2 master checklist (Owner real-app review, 2026-10-26)

Source: Owner review of the Mac/Android builds from `integration/nav-v2-offline-o1` 83eb7e5f8 against a real company Hub (~4,900 sessions). Every item must be closed (done + test + screenshot where visual) or explicitly deferred by the Owner. Owner: "improve every point discussed, do not miss any".

## A. Scope, pins and ordering

- [ ] A1. For me hides other people's sessions, **including pinned ones**. Scope first; pins only reorder inside the scope. Others' pins appear only under Others/All. Applies to every grouping (Project, Workspace, Session), Chats, Home pin tags, counts and badges. Root-cause the bypass; add a regression test with Hub sessions authored by other members.
- [ ] A2. One pin mark (shared `PinMark`) at a fixed position aligned with the title. Unpinned rows show no gutter pin. Pin/unpin lives in the row menu or hover, not as a permanent right-side button. Same on Workspace, Chats and Home.
- [ ] A3. Session/Workspace grouping is one flat list ordered by last update (stable while interacting). The "Hiện thêm / Show more" collapse is removed; use the virtualized full list, with "Load more" only at the end if paging is needed.
- [ ] A4. Quick chats follow the same rules as every session. In Project grouping they form one "Quick chat" project; in Session/Workspace grouping they are interleaved by time. No separate "Quick chats" section.
- [ ] A5. The grouping control has an accurate heading or label and reads as one control.

## B. Bots and the Chat/Workspace rule

- [ ] B1. One rule by session: a session with a Bot label is a Chat session. Used by Home mode, counts, search and the Chats section.
- [ ] B2. The Workspace list shows Bot sessions **by default**.
- [ ] B3. A quick "Bots" toggle chip next to the grouping control: default ON, persisted per device. It hides or shows Bot sessions and Bot projects in one tap, and counts follow it. It replaces the Display-menu "Bot projects" item. No flash while Bot data loads (label-based).
- [ ] B4. Remove the "Active / Đang hoạt động" filter (redundant with last-update ordering), with a store migration.
- [ ] B5. Home mode: Chat = Bot sessions, Workspace = non-Bot sessions, All = both. The Chats section is unchanged.

## C. Naming (Owner decision)

- [ ] C1. The section formerly called "Work" is **Workspace** (EN and VI). The Home mode switch reads **Chat · Workspace · All / Tất cả** ("Hybrid" removed). Tasks is **Tasks** in EN and **Công việc** in VI. The New button reads "New workspace / Workspace mới".
- [ ] C2. In VI, "Công việc" means Tasks only; no other string may use it. In every locale, the Workspace and Tasks words must not collide. Report any locale where a choice had to be made, and check that "All" in the mode switch and "All" in the scope tabs read clearly.
- [ ] C3. Internal routes and keys stay stable. i18n key tests fail on missing keys.

## D. Performance and stability at real scale

- [ ] D1. Workspace list and counts at ~5,000 sessions: virtualized list, memoized rows, counts computed once per change. Prod web numbers for scroll fps, filter/scope switch latency and tab switch.
- [ ] D2. Acceptance items still open from Round 1:
  - V2: one shared list-row component where feasible (today three inherited row components).
  - V3: consistent row heights.
  - V5: screenshot of the Chats error-with-Retry state.
  - S2: no route jumps on disconnect/reconnect/revoke.
  - S5: Back, deep links and notification taps, including `/sessions`.
  - S7: cold start with existing `main` user data (prefs, pins, sidebar prefs) migrates without loss, and the flag off restores the old layout.
- [ ] D3. Global search known limits:
  - Phone 390 px: an out-of-scope project's subtitle truncation.
  - A Hub signed in with no visible Host should still be findable or explained.
- [ ] D4. (Atlas) Native iOS/Android measurement: tab switch, memory and hidden-tab requests. This decides whether mobile tabs move to a real tab navigator with lazy mount + `freezeOnBlur` + focus-gated data (all tabs), instead of an ad-hoc "keep Home alive".
- [ ] D5. (Atlas) Hub-unreachable browser journey once a Hub test fixture exists.

## E. Explicitly deferred (Owner)

- ADR-001 implementation (Hub activity feed, Hub push, device-encrypted previews, personal Hub default): documentation only until the Owner accepts the current build.
- Offline O2 (local store), O3 (outbox), F1, Storage screen.
- Flag removal (first task of the round after acceptance + one stable release with 7 days and no rollback).
- Ticket reuse (needs Hub change) and native NetInfo (O2).
