# Clisbot Navigation V2 — Direction and Round 1 Brief

- Date: 2026-10-25
- Owner: Product owner; engineering lead (Atlas, CTO agent)
- Visual reference: Option B navigation prototype (design artifact, not in repo) (layout reference only; its details do not yet reflect all current features)
- Baseline audited: clisbot `main` da002ef07 (`packages/app/src`), read-only
- Status: Round 1 scope confirmed by Owner 2026-10-25 (decisions D1–D3 in 3.1b). Implementation authorized on an isolated branch; push, merge to main, release and rollout remain separately authorized.

> **Later decisions (2026-10-26):** the section called "Work" below is now named **Workspace**, the Home mode switch is **Chat · Workspace · All**, and Tasks is "Công việc" in Vietnamese. The Workspace list shows Bot sessions by default with a "Bots" toggle; quick chats follow the same list rules. See [README](README.md) decision log and the [Round 2 checklist](2026-10-26-navigation-v2-round-2-checklist.md).

---

## 1. Why this change

Clisbot is growing from "chat with agents" into a personal + work operating surface. The current navigation — one sidebar mixing destinations (Home, New workspace, Add project, Inbox, Automations, Connectors) with the session tree, and a 4-tab mobile bar (Home / Chat / Inbox / Automations) — does not scale. Every new capability would compete for the same sidebar rows. This change sets three directions.

### 1.1 A layout that scales to more first-class tools

Upcoming capabilities that matter for both work and personal life need their own top-level home, not a row inside the session list:

- **Tasks** — kanban / task management, with integrations
- **Notes** — Obsidian-like linked notes
- **Design** — Claude Design / Open Design style surfaces
- **Files** — file management across hosts and sandboxes
- **Schedules** — calendar + schedules + automations in one place (see 1.4)

Structure: a **primary navigation rail** (desktop, icon + short label) / **bottom tabs + More** (mobile) owns _where you are_; each section owns its own list and detail panes. Adding a capability = adding one rail/More entry, not reshuffling the app.

### 1.2 Stable, fast, offline-tolerant — like a messaging app

Target experience: every chat or agent session that is already open **stays available**. Losing the connection only means:

- you temporarily cannot interact (actions disabled with a clear per-source status), or
- outgoing messages sit in an **unsent** state with a **Retry** action — never silently lost, never blocking the UI.

Principles:

- **Local-first read path.** Opened sessions render from a persisted local store; the network refreshes it. A disconnect never unmounts, blanks or auto-routes away from an open session.
- **Outbox.** Messages and approvals created offline are queued per session with explicit states (`sending`, `unsent`, `failed`) and user-visible retry/discard.
- **Per-source health.** Each host/hub has its own status; one unreachable hub (e.g. VPN down) never blocks reachable ones.
- **Agent sessions are not plain chats.** Tool-call streams and command outputs can be huge. Store transcripts in tiers: message text + compact tool summaries are cached; large outputs, diffs and attachments are fetched on demand and evicted first. The server stays source of truth; sync is cursor-based.
- **Data hygiene, as in mainstream messaging apps.** Bounded cache per session (recent window) and globally; LRU eviction for sessions not opened recently; attachments evicted independently of text; a Storage screen showing usage per hub/host/session with "clear cache" per source; never evict unsent outbox items or unsynced drafts.

### 1.3 One or many company hubs, each with many sandboxes — without the noise

Connecting personal local + personal remote + company hubs (one hub may host dozens of sandboxes) must not flood the user with unrelated sessions.

- **For me (default)** = sessions owned by the signed-in user, plus local/sandbox sessions with unknown or no sender (provisionally treated as mine — the common case), plus sessions the user explicitly **Watches**.
- **Others** = sessions the user may view but does not own or watch. **All** = both.
- **Watch / Unwatch** is available on any session the user has permission to view.
- **Failed sessions** stop dominating: once opened, an error is **seen** and collapses into a "Seen" group instead of staying pinned as an alert forever. The user can **Mark as unread** to bring it back.
- **Needs action / approval** follows the same seen-and-collapse behavior. The badge counts _unseen_ items; seen-but-pending items remain reachable in their collapsed group.
- Counts, membership and filters are identical across Home, Chats and Work.

### 1.4 Schedules (EN) / Lịch (VI)

"Automations" is renamed **Schedules** / **Lịch**. Long-term it is a calendar-centric surface that unifies calendar events, schedules and automations — core to comprehensive personal work management.

---

## 2. Target navigation structure

Two levels only: the **primary navigation** (desktop rail / mobile tabs + More) says _where you are_; each section owns its own header, quick filters, list and detail. There is no global search bar, no global "New" button and no shared session sidebar.

- **Section header** = title + section actions as icons (search, new). Search and New belong to the section you are in, Telegram-style.
- **Quick filters** = compact tag chips under the header.
- **Display & filter row** = the existing display options and filters, kept as-is, directly under the quick-filter chips.
- **Pins** = no separate pinned group anywhere. In Chats and Work a pinned row simply floats to the top of the list with a pin icon; on Home pins show as compact tags. Only _my_ pins by default.

### Desktop

```
| Rail       | List pane (section-owned)            | Detail                |
|------------|--------------------------------------|-----------------------|
| Home       | — (single centered column)           |                       |
| Chats      | header · chips · pinned + chat rows  | Conversation          |
| Work       | header · chips · project > sessions  | Session / workspace   |
| Lịch       | section-owned                        | section-owned         |
| Connectors | section-owned                        | section-owned         |
| (plugins)  |                                      |                       |
| ...        |                                      |                       |
| Hosts • / Help / Settings (rail bottom)                                   |
```

### Mobile

Bottom tabs: **Home · Chats · Work · Lịch · More (···)**. More (Slack-style) lists the remaining features plus **Settings / Cài đặt**. Opening a chat or session is full-screen (tab bar hidden); Back returns to the originating tab.

---

## 3. Round 1 scope — layout and navigation structure only

Round 1 delivers the shell and moves existing features into their new homes. Deeper data semantics (1.2, 1.3) and new tools are later rounds.

### 3.1 Change

| #   | Change                                                                                                                                                                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Desktop primary rail** (icon + short label): Home, Chats, Work, Lịch/Schedules, Connectors, plugin sections; bottom: Usage (if enabled), Hosts (status dot), Help, Settings                                                                                                                                                                | Rail is a registry (id, icon, label, route, badge, visibility); a future section = one entry                                                                                                                                                                    |
| C2  | **The current sidebar is retired.** Its Pinned section and its Bots / Groups / Projects groups are removed. Chats and Work each render their own list                                                                                                                                                                                        | Pins, bots, groups and projects remain as data; only the old grouping UI goes                                                                                                                                                                                   |
| C3  | **Chats = one mixed list, Telegram-style**: bot DMs and group chats together, most recent activity first with stable ordering (no jumpy reorder while reading); my pinned chats float to the top with a pin icon, no separate Pinned group                                                                                                   | Quick-filter chips: All · Unread · Bot DM · Groups · Personal · Company. Separate DM/Groups views stay an option for later, not the default                                                                                                                     |
| C4  | **Work = work sessions only**, structured as today (Paseo-like project → workspace → session), with light project captions instead of the old collapsible sidebar group. My pinned sessions float to the top of the list with a pin icon (row subtitle shows project · host), no separate Pinned group                                       | Quick-filter chips: All · Needs me · Running · Done · Failed                                                                                                                                                                                                    |
| C5  | **Section headers own Search and New** as icons: Home `🔍`; Chats `🔍 ✎` (new chat: message a bot, create a group); Work `🔍 +` (new workspace; menu also has Add project, Import session)                                                                                                                                                   | No standalone search bar or New button row. ⌘K stays as a keyboard shortcut opening search                                                                                                                                                                      |
| C6  | **Inbox removed as a destination; Home absorbs it.** Home = composer at top → quick starts → quick-filter tag chips → my pins as tags → feed                                                                                                                                                                                                 | `/sessions` stays as a redirect to Home                                                                                                                                                                                                                         |
| C7  | **Home quick filters as tag chips** (from the existing Inbox activity filter): All · Needs me · Running · Updated · Failed                                                                                                                                                                                                                   | Re-skin of existing filter logic, not a rewrite. Host/source lives in the row below, not as a chip                                                                                                                                                              |
| C7a | **Existing display options + filters stay, directly under the chips** in Home, Chats and Work: `Display ▾` (grouping, sort, title source, show checks/background), Host filter, Project filter, Workspace labels, plus removable active-filter chips; Home keeps the Inbox host filter and search                                            | Same components and stored preferences as today (`sidebar/display-preferences`, Inbox filter row); each section shows only the options that apply. Chats' grouping option is where a user can opt into DM / Groups grouping; default stays Telegram-style mixed |
| C8  | **Pins as compact tags on Home; only my pins by default.** Others' pins collapse into a single `+N · Show` tag                                                                                                                                                                                                                               | Ownership uses data available today; unknown/no author counts as mine                                                                                                                                                                                           |
| C9  | **Mobile tabs**: Home · Chats · Work · Lịch · More (replaces Home · Chat · Inbox · Automations). Needs badge moves to Home                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                 |
| C10 | **Mobile More**: Connectors, Hosts (status dot), plugin sections, Usage (if enabled), Help, then Settings / Cài đặt                                                                                                                                                                                                                          | Settings is not a tab                                                                                                                                                                                                                                           |
| C11 | **Rename** Automations → Schedules (EN) / Lịch (VI) everywhere                                                                                                                                                                                                                                                                               | Route `/schedules` unchanged; calendar UI later                                                                                                                                                                                                                 |
| C12 | **For me / Others / All** scope tabs on Home, Chats and Work, above the quick-filter chips. For me = items owned by the signed-in user + local/sandbox items with unknown or no author (provisionally mine). Others = viewable but not mine. All = both. Default For me. Counts and membership identical across Home, Chats, Work and badges | Watch is Round 2: the For me predicate must accept "watched" as a third input later without restructuring                                                                                                                                                       |
| C13 | **Home mode switch Chat / Work / Hybrid** in the Home header. Chat = only DM/group items; Work = only work sessions; Hybrid = both. Applies to the Home feed, decision cards, pin tags and counts. Only Home is affected                                                                                                                     | Keep per-mode composer target and draft; switching mode never loses a draft                                                                                                                                                                                     |
| C15 | **Others' failures stay in Others.** A failed or needs-action item that is not For me never appears in For me lists, chips, pin tags or badges; it is visible only under Others / All                                                                                                                                                        | Direct consequence of C12; stated explicitly because it is the main noise source today                                                                                                                                                                          |
| C16 | **Failure lifecycle (mine)** — see 3.1c. Failures are seen, acted on and leave; they never stay in "Failed" forever with no next step                                                                                                                                                                                                        | Seen/dismissed state keyed by session + failure occurrence, so a _new_ failure resurfaces                                                                                                                                                                       |
| C14 | **Tasks on the desktop rail and in mobile More**, badged "In development" / "Đang phát triển". Opens a simple placeholder page saying the feature is in development; no fake data or actions                                                                                                                                                 | Registry entry with a preview status so it can be switched on later                                                                                                                                                                                             |

### 3.1a Old sidebar footer → new home

Today's footer: `[+] New menu · Search ⌘K · Usage · Hosts • · Help · Settings`.

| Control                                                                       | Desktop                                                                                                                     | Mobile                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `+` New menu (New workspace, Add project, New bot, New group, Import session) | Split into section header icons: Chats `✎` (New bot chat, New group); Work `+` (New workspace, Add project, Import session) | Same icons in the Chats / Work headers     |
| Search ⌘K                                                                     | `🔍` in each section header (scoped to that section, can widen to all); ⌘K opens it                                         | `🔍` in each tab header                    |
| Usage (opt-in)                                                                | Rail bottom, only when enabled                                                                                              | More                                       |
| Hosts + status dot                                                            | Rail bottom, keeps the dot                                                                                                  | More → Hosts; dot mirrored on the More tab |
| Help                                                                          | Rail bottom                                                                                                                 | More                                       |
| Settings                                                                      | Rail bottom, last                                                                                                           | More → Settings / Cài đặt                  |

### 3.1b Owner decisions (2026-10-25)

- **D1** For me / Others / All ships in Round 1; Watch moves to Round 2.
- **D2** Home mode switch ships in Round 1: Chat = chats/groups only, Work = work sessions only, Hybrid = both (Home only).
- **D3** Tasks is visible now, marked "In development".
- **D4** Must be in Round 1: others' failures only under Others; a clear failure lifecycle so failures can be seen, acted on and disappear (3.1c).

### 3.1c Failure and needs-action lifecycle (Round 1)

```
 new failure ──► UNSEEN ──open──► SEEN ──┬─ recovers / next run OK ──► leaves Failed (normal row)
   (badge +1,      │                     ├─ user Retry / sends message ─► Running
    Failed chip)   │                     ├─ user Dismiss ───────────────► leaves Failed
                   │                     ├─ session archived ───────────► gone
                   │                     └─ seen > 7 days ──────────────► auto-leaves Failed
                   └─ Mark unread ◄────── SEEN
```

- **Unseen**: counted in the Home badge and the Failed chip; shown in the feed.
- **Seen** (user opened it): no longer counted in badges; in the Home feed it moves into one collapsed row "Seen issues (n)" at the bottom; in the Failed chip view seen items sit below unseen ones, dimmed. "Mark all as seen" is available.
- **Every failed row/card shows its next step**: Open · Retry (when the session supports retry/continue; otherwise Open only) · Dismiss · Archive. A failure is never a dead end.
- **Leaves Failed** when the session recovers or the next run succeeds, the user retries/sends, dismisses, archives it, or it has been seen for more than 7 days. The session itself stays in its normal Chats/Work list with its error status visible.
- **Mark unread** brings a seen item back to Unseen.
- **Needs action / approval**: stays in "Needs me" while it is actually actionable; once seen it stops counting in the badge. It leaves Needs me automatically when resolved, expired, the session stopped, or the user lacks permission to act; Dismiss is available for stale ones.
- **Storage (Round 1)**: per-user, persisted locally per device, keyed by `sessionId + failure/request occurrence id`; a new failure on a dismissed session reappears as Unseen. Cross-device sync is Round 2.

### 3.1d Feature flag and removal milestone

- Round 1 ships behind `NAVIGATION_V2_ENABLED` (nested under `HOME_V2_ENABLED`, default on) only so the old layout can be compared and rolled back during acceptance.
- **Removal milestone:** once Round 1 has Owner acceptance and has shipped in one stable release with no rollback for 7 days, remove the flag **as the first task of Round 2, before any Round 2 feature merges**. Remove `NAVIGATION_V2_ENABLED`, the old sidebar/tab/Inbox code paths it guards, their tests/testIDs, and `HOME_V2_ENABLED` where it only guards the pre-V2 layout.
- To keep removal mechanical, Round 1 keeps old and new paths in separate components with the flag checked at a few entry points, not scattered conditionals. Round 1 delivery includes a removal checklist (files, components, tests, env/localStorage overrides).

### Cross-platform and native-mobile rule (Owner, 2026-10-25)

- Follow existing repo patterns so every change works on iOS, Android, web and Electron from the first commit: existing platform-split files (`*.native.ts` / `*.web.ts`), shared stores/hooks, Unistyles theme tokens, existing primitives and Expo Router navigation. No web-only DOM/CSS or desktop-only shortcuts as the only path.
- Mobile app prioritizes a smooth native experience: native stack/tab transitions and gestures (swipe back, Android hardware back), virtualized lists, safe areas and keyboard handling, ≥44 pt touch targets, no layout jumps on load/reconnect, no heavy work on the JS thread during navigation/scroll (persistence/eviction off the interaction path).
- Acceptance includes native iOS + Android smoke on the changed journeys, not only browser/phone-web.

### 3.2 Keep (must not regress)

- New workspace flow (`/new`) and its shortcut, Add project, Import session, new bot / new group flows — only their entry points move.
- **Quick starts** (with `quickStarts` host feature gating), composer and target/agent pickers.
- Existing Inbox filter logic, needs count and cards — moved into Home, not rewritten.
- Existing display options and filters (grouping, sort, title source, show checks/background, host, project, workspace labels, active-filter chips) and their persisted preferences — placed under the quick-filter chips.
- Work's project/workspace/session model and row behavior; chat rows; status indicators; Connectors, Settings, host settings, Help, Usage (opt-in).
- Pins as data and the user's ability to pin/unpin.
- Routes and deep links (`/open-project`, `/chat`, `/sessions` → Home, `/schedules`, `/h/[serverId]/...`) and notification taps.
- Stability protections already shipped: stable cache, no auto-route-away on disconnect, retained workspace/tab state, mobile Back return path, native back handling.
- Plugin sidebar groups and user order/visibility preferences — remapped onto rail/More, not dropped.
- `HOME_V2_ENABLED` gating so the old layout remains reachable until acceptance.

### 3.3 Not in Round 1

- Watch / Unwatch and the "Following" chip; cross-device sync of seen/dismissed state — Round 2.
- Offline outbox, tiered cache, Storage screen (1.2) — Round 2/3.
- Real Tasks functionality; Notes, Design, Files sections; calendar view inside Lịch.
- Optional split views (separate DM / Groups lists) for Chats.

### 3.4 Acceptance for Round 1

- Desktop (≥1024 px) and compact (320 / 390 / 430 px) render the new structure; every former destination and footer control is reachable in ≤2 taps/clicks (checklist from 3.1a).
- Chats shows bot DMs and groups in one stable list; Work shows only work sessions; no Bots/Groups/Projects/Pinned sections remain; pinned rows sit at the top with a pin icon.
- Home shows only my pins by default; others' pins appear only after `+N · Show`.
- Back, deep links and notification taps land correctly (including old `/sessions` links).
- Existing navigation/sidebar/mobile-tab tests updated, not deleted; new tests for rail registry, More, Chats/Work filtering and pin visibility.
- Browser E2E for desktop + mobile journeys; native (iOS/Android) smoke before any release. Unrun checks are reported as unrun.

---

## 4. Round 1 wireframes (ASCII)

### Desktop — Home (single centered column, no list pane)

```
+------------+----------------------------------------------------+
|            |  Clisbot           [Chat | Work | Hybrid]      Q   |
|  Home      |  +----------------------------------------------+  |
|  Chats     |  | Ask a bot or hand off a task...              |  |
|  Work      |  | [Nia - Local v]                  clip   (^)  |  |
|  Lich      |  +----------------------------------------------+  |
|  Tasks dev |  Quick start  [ ... ] [ ... ] [ ... ]              |
|  Connectors|                                                    |
|  (plugins) |  [ For me 15 | Others 4 | All 19 ]                 |
|            |  (All) (Needs me 3) (Running) (Updated 3) (Failed) |
|            |  [Display v] [Host: All v]  x active filter        |
|            |  [N Nia] [Fix Android image .] [+2 others - Show]  |
|            |                                                    |
|            |  Needs me 3                                        |
|  Usage*    |  [ decision card ]                                 |
|  Hosts .   |  Recent                                            |
|  Help      |  row / row / row ...                               |
|  Settings  |                                                    |
+------------+----------------------------------------------------+
 * only when enabled   . host status dot   [..] pin tags, mine only
 Tasks dev = Tasks entry badged "In development"
 Mode: Chat = chats/groups only, Work = work sessions only, Hybrid = both
```

### Desktop — Chats

```
+------------+----------------------+-----------------------------+
|            | Chats          Q  ✎  | Nia                         |
|  Home      | [Me | Others | All]  |                             |
| >Chats     | (All)(Unread 2)(Bot  |    ... conversation ...     |
|  Work      |  DM)(Groups)(Pers.)  |                             |
|  Lich      | [Display v][Host v]  |                             |
|  Tasks dev |----------------------|                             |
|  Connectors| ^ Nia           9:41 |                             |
|            | ^ Cuoi tuan Da Lat   |                             |
|            |   Rin - Research 8:30| +-------------------------+ |
|  Hosts .   |   Clisbot CEO   8:02 | | composer                | |
|  Help      |   ...                | +-------------------------+ |
|  Settings  |                      |                             |
+------------+----------------------+-----------------------------+
 ^ = pin icon: my pinned chats float to the top, no separate group;
   DMs and groups mixed, newest first, stable
```

### Desktop — Work

```
+------------+----------------------+-----------------------------+
|            | Work           Q  +  | Fix Android image upload    |
|  Home      | [Me | Others | All]  |                             |
|  Chats     | (All)(Needs me 2)    |    ... session ...          |
| >Work      | (Running)(Done)      |                             |
|  Lich      | (Failed)             |                             |
|  Tasks dev | [Display v][Host v]  |                             |
|  Connectors| [Project v][Labels v]|                             |
|            |----------------------|                             |
|            | ^ Fix Android image  |                             |
|            |   Clisbot - Local    |                             |
|            | Clisbot - Local      |                             |
|            |   Release notes      | +-------------------------+ |
|  Hosts .   | AnyApp - Hub         | | composer                | |
|  Help      |   Weekly report      | +-------------------------+ |
|  Settings  |                      |                             |
+------------+----------------------+-----------------------------+
 ^ = pin icon: pinned sessions float above the project captions, subtitle shows project - host
 + -> New workspace / Add project / Import session
```

### Mobile

```
 Home                 Chats                Detail               More
+------------------+ +------------------+ +------------------+ +------------------+
| Clisbot [C|W|H] Q| | Chats      Q  ✎  | | < Nia            | | More             |
+------------------+ +------------------+ +------------------+ +------------------+
| +--------------+ | |[Me|Others|All]   | |                  | | Tasks        dev |
| | Ask a bot... | | |(All)(Unread)(Bot>| |   conversation   | | Connectors       |
| | [Nia v]  (^) | | |[Display v][Host v| |                  | | Hosts          . |
| +--------------+ | |------------------| |                  | | (plugins)        |
| Quick start ...  | |^ Nia        9:41 | |                  | | Usage*           |
| [Me|Others|All]  | |^ Cuoi tuan Da Lat| | +--------------+ | | Help             |
| (All)(Needs 3).> | |  Clisbot CEO 8:02| | | composer     | | | ---------------- |
| [Display v][Host>| |  ...             | | +--------------+ | | Cai dat          |
| [Nia][Fix..][+2] | |                  | |   (no tab bar)   | |                  |
| Needs me / feed  | |                  | |                  | |                  |
+------------------+ +------------------+ +------------------+ +------------------+
| Home Chats Work  | | Home Chats Work  |                      | Home Chats Work  |
|   Lich   ...     | |   Lich   ...     |                      |   Lich   ...     |
+------------------+ +------------------+                      +------------------+
 Work tab = same shape as Chats: "Work  Q  +", scope tabs, status chips, display/filter row, project > sessions
```
