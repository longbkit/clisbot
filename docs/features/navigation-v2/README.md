# Navigation V2 — Round 1

IMPLEMENTED on `feat/navigation-v2-round1`, 2026-10-25; awaiting CTO review and Owner acceptance.
Contract: the Owner-confirmed Round 1 brief (C1–C16, D1–D4, 3.1a–3.1d). This doc maps the brief
onto the app and records the decisions the brief leaves to engineering.
[Home and Inbox](../home-and-inbox/README.md) describes the Home V2 layout this replaces while the
flag can still turn it back on.

## Gate

`NAVIGATION_V2_ENABLED` (`packages/app/src/clisbot/navigation/feature.ts`) is
`HOME_V2_ENABLED && EXPO_PUBLIC_CLISBOT_NAVIGATION_V2 !== "0"`, on by default and nested in the
Home V2 gate:

| `EXPO_PUBLIC_CLISBOT_HOME_V2` | `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2` | Layout                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------ |
| unset                         | unset                               | Navigation V2 (rail, Chats/Work, More)                 |
| unset                         | `0`                                 | Home V2: one sidebar, Home/Chat/Inbox/Automations tabs |
| `0`                           | any                                 | upstream sidebar                                       |

One browser can switch without a rebuild: the web-only `localStorage` key `@clisbot:navigation-v2`
set to `"0"` turns it off (`"1"` or absent leaves the build's choice). Native builds read only the
env. New code lives in `clisbot/navigation/`. Old and new navigation are separate components; shared
files branch on the flag at their entry point only (see [Flag removal](#flag-removal)).

## Structure

The primary navigation says where you are; each section owns its header, filters and list.

- **Section registry** (`sections.ts`): id, icon, label key, route, rail placement (`primary` or
  `bottom`), phone placement (`tab` or `more`) and status (`ready` or `preview`).
  `resolveNavigationSections` builds the rail, the phone tabs and More from it, so a new section is
  one entry. Plugin `header`/`footer` sidebar items join in the reader's existing
  `sidebarNavItems`/`sidebarFooterItems` order and visibility; Usage shows while the footer's Usage
  icon is on.
- **Desktop** (`rail.tsx`, `list-panel.tsx`): the rail sits beside the content and owns the
  window's top-left corner. Chats and Work open the existing resizable list pane
  (`components/desktop-sidebar-frame.tsx`, shared with the Home V2 sidebar); clicking the active
  one, or ⌘B, hides or shows it. Home, Schedules, Tasks, Connectors and More have no list pane.
- **Phone** (`clisbot/home/mobile-navigation.tsx`, `mobile-tabs.tsx`): tabs Home · Chats · Work ·
  Lịch · More. Chats and Work are both list tabs: the same retained `agent-list` panel shows the
  Chats or Work list, so native presentation, the pending-detail shell and the Back return path
  stay one implementation (`isListTabPath`, `currentListTabPath`). More is the `/more` page.
- **One component per job** across Home, Chats and Work: `SectionHeader`, `SectionControls` (For
  me / Others / All, chips, then the Display row, on one inset), `DisplayMenuTrigger`
  ("Display ▾", with a dot while a filter is in force), `HostsDisplayItems`, `ChipRow` /
  `ChipButton` (filter chips and pin tags), `PinMark`, `ListState` (empty and error) and Home's
  `ActivityPlaceholder` skeleton (Chats loading too). Menus open at `DISPLAY_MENU_WIDTH`.
- **Chats and Work stay mounted** once opened (`ListContent` in `list-panel.tsx`) and swap
  visibility, so switching between them never rebuilds a 500-row list. Their rows are memoized and
  compare entries by value: a rename or a new message re-renders that row only.

## Change map

| #   | Status | Where                                                                                                                                              |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | done   | `rail.tsx` from the registry; bottom Usage (when on), Hosts with its dot, Help, Settings                                                           |
| C2  | done   | `list-panel.tsx` replaces `LeftSidebar`; no Pinned, Bots, Group chats, Projects sections or footer in V2                                           |
| C3  | done   | `chats-pane.tsx`, `chat-list.ts`, `use-chat-entries.ts`, `held-order.ts`                                                                           |
| C4  | done   | `work-pane.tsx` wraps `SidebarWorkspaceList` with `pinPresentation="float"`; Quick chats lead the list                                             |
| C5  | done   | `section-header.tsx`; Home 🔍, Chats 🔍 ✎, Work 🔍 +; ⌘K unchanged                                                                                 |
| C6  | done   | `home-layout.tsx`; `/sessions` redirects to Home; Home 🔍 shows Inbox's history in place (`InboxHistory`)                                          |
| C7  | done   | `home-controls.tsx` chips over Home's existing activity buckets                                                                                    |
| C7a | done   | one Display ▾ per list: Chats (order, split, Hosts), Work (the sidebar display menu; grouping tabs and active-filter chips under it), Home (Hosts) |
| C8  | done   | `pin-tags.tsx`, `pin-tags-model.ts`                                                                                                                |
| C9  | done   | phone tabs from the registry; Home carries the unseen-issue badge                                                                                  |
| C10 | done   | `more-screen.tsx`                                                                                                                                  |
| C11 | done   | rail, tabs and the `/schedules` landing title read Schedules / Lịch; routes unchanged                                                              |
| C12 | done   | `ownership.ts`, `scope-tabs.tsx` on Home, Chats and Work                                                                                           |
| C13 | done   | `home-header.tsx` switch; `home-mode-target.ts` moves the composer target                                                                          |
| C14 | done   | Tasks entry with `status: "preview"`, `tasks-screen.tsx`                                                                                           |
| C15 | done   | the scope applies before chips, pin tags, counts and badges (`home-feed.ts`, `homeBadgeCount`)                                                     |
| C16 | done   | `issues.ts`, `issue-store.ts`, `activity.tsx`, `issue-actions.tsx`, `home-feed-view.tsx`                                                           |

## Old controls → new home (3.1a)

| Before                                   | Desktop                                         | Phone                         |
| ---------------------------------------- | ----------------------------------------------- | ----------------------------- |
| Sidebar Home row                         | Rail Home                                       | Home tab                      |
| New workspace row, footer `+` New        | Work header `+` (the `/new` shortcut stays)     | Work header `+`               |
| Add project row / footer icon            | Work `+` → Add project (shortcut stays)         | same                          |
| Import session (footer, Inbox header)    | Work `+` → Import session; Home status line     | same                          |
| New bot, New group                       | Chats header ✎                                  | Chats header ✎                |
| Inbox row and tab                        | Home (feed, 🔍 opens the full history)          | Home tab                      |
| Search row / footer search, ⌘K           | 🔍 in each section header; ⌘K                   | 🔍 in each tab header         |
| Automations row and tab                  | Rail Schedules / Lịch                           | Lịch tab                      |
| Connectors row                           | Rail Connectors                                 | More → Connectors             |
| Plugin header/footer rows                | Rail entries; a plugin's own row opens from it  | More rows                     |
| Pinned section                           | Pinned rows on top of Chats/Work; Home pin tags | same                          |
| Bots, Group chats sections               | Chats list                                      | Chats tab                     |
| Projects section, display menu, view bar | Work list and its filter rows                   | Work tab                      |
| Usage (opt-in)                           | Rail bottom while the Usage icon is on          | More → Usage                  |
| Hosts + dot (Host picker)                | Rail bottom Hosts, same picker, status dot      | More → Hosts; dot on More tab |
| Help menu                                | Rail bottom Help                                | More → Help                   |
| Settings                                 | Rail bottom, last                               | More → Settings / Cài đặt     |
| Account / Hub top row                    | Settings → Hub                                  | Settings                      |

## For me / Others / All

`resolveOwnership({ createdBy, accounts, watched })` returns `mine` or `others`:

- No author, a non-user author (automation, system), or a user author with no Hub origin (a
  direct connection): **mine** (provisional, brief 1.3).
- A user author from a Hub this device is not signed in to: **mine** — the app cannot tell.
- A user author matching that Hub's signed-in account (`isOwnActor`: member id, else user id):
  **mine**; any other user: **others**.
- `watched === true` (Round 2) makes anything **mine**; the predicate already takes the input.

Authors come from data available today. Agent snapshots carry no `createdBy`, so a session takes
its workspace's `createdBy`, a Bot session its Chat's (`ChatPayload.record.createdBy`), and a Bot
row without a chat the Host's `isOwner` projection, else the Bot's `owner`. Work rows read the
workspace's `createdBy`. Gaps: Hosts older than session authorship send no `createdBy`, so all of
their work is For me; a channel-started session is the reader's only when its snapshot carries the
reader's verified `memberId`.

## Home

Order: header (mode switch, 🔍) → a connection notice only when something is wrong → composer and
its context row → Status & Setup and Import session → quick starts → scope tabs → chips → Display
(Hosts, when there are several) → pin tags → feed. Hosts live on the rail and in More; Home has no Hosts block and no
floating updates bar (held updates show as an inline "Show N updates" above the feed). The
composer is at the top on phones too, with its pickers opening downward; a phone's header row is
the mode switch and search (the tab bar already says Home).

- **Connection notice** (`connection-notice.tsx`): `useHomeConnectionNotice()` is the adapter seam
  — today it reads the Hosts strip's issue model; a per-source health summary can replace its body
  without touching `ConnectionNotice` or Home.

- **Mode** (C13). Chat = sessions with a Bot label (`clisbot.bot-id`), Work = projects and Quick
  chats, the daemon Inbox Type filter's split. It filters the feed, issue cards, pin tags and
  counts on Home only. Switching to Chat points the composer at the last Bot used in Chat mode;
  switching to Work returns to the last project or Quick chat. The start switcher offers only the
  mode's starts (Chat: Bot; Work: Quick chat and Project; Hybrid: all), so the two controls never
  disagree; on phones unselected segments show only their icon, so all three fit 320pt. The
  composer has one draft per screen, so switching never loses it.
- **Chips** (C7). All · Needs me · Running · Updated · Failed. Needs me is Home's existing Needs you
  bucket — approvals and failures — limited to unseen issues; Failed lists failures with seen ones
  below, dimmed. Counts are the reader's scope; Needs me and Failed count unseen only.
- **Feed**. Home's activity layout (`useActivityLayout`) takes the filtered rows and a bucket per
  row, adding a `seen` group. Background changes still wait behind Show updates; a change the
  reader makes (a filter, Mark as seen, Dismiss, Archive) applies at once.
- **Reading position**. Content above the feed that changes height by itself — the connection
  notice, the Show updates / Mark all as seen line — sits in `HoldReadingPosition`: while the reader
  is scrolled, the scroll moves by the same amount, so no row moves under them. At the top the
  change is simply shown.
- **Pins** (C8). Every resource pin as a tag, the reader's own first; other members' pins fold into
  `+N · Show`. Ownership follows the rules above.

## Failure and needs-action lifecycle (3.1c)

The daemon's per-agent attention (`requiresAttention`, `attentionReason`, `attentionTimestamp`) is
the existing seen/unread state; opening a session clears it. It stays the source. The device adds
one persisted store per principal (`issue-store.ts`, the resource-pin principal scope) for what the
daemon cannot hold per reader: Mark as seen without opening, Mark unread, Dismiss, and when an
occurrence was seen.

- **Occurrence id**: the `attentionTimestamp` of the failure or permission request, captured while
  it is unread. The daemon clears it when the session is opened, so the record keeps the last
  occurrence per session; a new failure or request sets a new timestamp and resurfaces as Unseen,
  even on a dismissed session. Limits: a failure first observed after someone opened it is keyed
  `seen@<lastActivityAt>` and treated as seen; attention is per agent on the Host, so another
  device or member opening the session also makes it seen here.
- **Unseen → Seen**: opened (daemon attention cleared, or the row's Open marks it), or Mark as
  seen / Mark all as seen. Seen issues leave the badge and Needs me, and collapse into **Seen
  issues (n)** at the bottom of the feed.
- **Leaves**: the session recovers or runs again (no longer `error`), the reader sends or reloads,
  Dismiss, Archive, or 7 days after it was seen. The session stays in Chats/Work with its status.
- **Mark unread** returns a seen issue to Unseen.
- **Needs action**: in Needs me while the daemon still reports a pending request; seen ones stop
  counting; resolved, expired or stopped requests leave on their own; Dismiss hides a stale one
  until a new request.
- **Next steps** (`issue-actions.tsx`): the row opens it; Reload, Dismiss and a menu with Mark as
  seen/unread and Archive. The daemon has no "re-run the failed turn" RPC; Reload is the workspace
  tab's Reload agent (`refresh_agent_request`), which reattaches the provider session so the reader
  can continue. It is offered only for failures on agents with a persistence handle.

## Decisions within the brief

- **Search**: Home 🔍 swaps the feed for Inbox's history (search, Host/Type/Date, Load more), so
  history beyond the loaded directory stays reachable. Chats 🔍 filters the list by title. Work 🔍
  opens the Command Center, the cross-Host search ⌘K opens everywhere.
- **Bot home projects in Work**: hidden by default; the Display menu's **Bot projects** switch
  turns them on. V2 keeps its own switch (`showBotProjectsInWork`), so the Home V2 sidebar's stored
  choice is untouched.
- **Chats display**: one `Display ▾` for the mixed list: sort (recent activity or name), an opt-in
  "Separate bot chats and groups" (off by default), and Hosts when there are several. The Home V2
  sidebar's Bots and Group chats display menus are not used in V2.
- **Chip rows** scroll sideways on one line everywhere, with a fade on the trailing edge while more
  chips are off screen (`FilterChips scroll`, `EdgeFade edge="right"`).
- **Chats order**: newest activity first with pins on top; while the pointer, a touch or a scroll
  is on the list the order holds and only new rows enter at the top (`held-order.ts`).
- **Hosts strip** stays above the composer on Home; it carries the connection-issue actions.
- **Schedules**: the destination is Schedules / Lịch. Inside it, the Hub **Automations** tab keeps
  its name: the glossary defines Automation as the Hub Trigger/Workflow, a different thing.
- **Native pins without Bots**: on a Host without the Bots feature, pinned workspaces
  (`pinnedAt`) stay inside their project in Work instead of floating. Resource pins float.

## Flag removal

Removal is the first task of Round 2, after Owner acceptance and one stable release with 7 days
without rollback (brief 3.1d). Do not remove it before.

Delete or collapse to the V2 branch:

| File                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/navigation/feature.ts`                                            | delete; replace imports with nothing (always V2)                                                                                                                                                                                                                                                                                                                                    |
| `app/_layout.tsx`                                                          | `SidebarChrome` always renders `NavigationChrome`; drop `LeftSidebar`, keep `/work`, `/more`, `/tasks` chrome paths                                                                                                                                                                                                                                                                 |
| `clisbot/navigation/chrome-layout.ts`                                      | keep only the V2 return                                                                                                                                                                                                                                                                                                                                                             |
| `app/work.tsx`, `app/more.tsx`, `app/tasks.tsx`                            | drop the `Redirect` fallback                                                                                                                                                                                                                                                                                                                                                        |
| `app/sessions.tsx`                                                         | becomes a plain redirect to Home                                                                                                                                                                                                                                                                                                                                                    |
| `screens/sessions-screen.tsx`                                              | keep only `InboxHistory` (embedded); drop the standalone screen and its `MenuHeader`                                                                                                                                                                                                                                                                                                |
| `screens/new-workspace-screen.tsx`                                         | `StartLayout` always uses `NavigationHomeLayout` for Home                                                                                                                                                                                                                                                                                                                           |
| `clisbot/home/home-header.tsx`                                             | always `NavigationHomeHeader`; delete `MobileToolbar` (`clisbot/home/mobile-toolbar.tsx`)                                                                                                                                                                                                                                                                                           |
| `clisbot/home/mobile-navigation.tsx`                                       | drop `HOME_V2_TABS` and the `/sessions` badge/label branch; `LIST_TAB_PATHS` = Chats, Work                                                                                                                                                                                                                                                                                          |
| `clisbot/home/list-tab-page.tsx`                                           | drop the non-V2 branches                                                                                                                                                                                                                                                                                                                                                            |
| `clisbot/home/activity-state.tsx`                                          | Needs link always sets the chip; label "Needs me"                                                                                                                                                                                                                                                                                                                                   |
| `clisbot/home/activity-preview.tsx`                                        | delete `HomeActivity` (replaced by `home-feed-view.tsx`)                                                                                                                                                                                                                                                                                                                            |
| `clisbot/automations/screen.tsx`                                           | title always Schedules / Lịch                                                                                                                                                                                                                                                                                                                                                       |
| `clisbot/bot-projects/preferences.ts`                                      | `useShowBotProjects` returns the Work switch; delete the legacy store and its key `sidebar-bot-projects`                                                                                                                                                                                                                                                                            |
| `clisbot/navigation/work-filter.ts`, `home-mode-target.ts`, `activity.tsx` | drop the flag guard                                                                                                                                                                                                                                                                                                                                                                 |
| `components/left-sidebar.tsx`                                              | delete, with `components/sidebar/sidebar-nav-rows.tsx`, `sidebar-footer.tsx`, `sidebar-new-menu.tsx`, `clisbot/hub/sidebar-nav-group.tsx`, `clisbot/bots/sidebar/sections.tsx` (keep `CreationSheets`, `useSidebarCatalog`, `useDefaultCreationServerId` by moving them), `clisbot/bots/sidebar/bots-section.tsx`/`chats-section.tsx` section components (keep `BotRow`, `ChatRow`) |
| `components/sidebar-workspace-list.tsx`                                    | drop `pinPresentation="section"` and the Pinned section; `FusionPinnedSection` always `float`                                                                                                                                                                                                                                                                                       |

`HOME_V2_ENABLED` checks that only guard the pre-V2 sidebar layout and go with it:
`components/left-sidebar.tsx` (all), `components/sidebar/sidebar-nav-rows.tsx` (all),
`clisbot/hub/sidebar-nav-group.tsx`, the compact `showMobileAgent` branch in
`components/sidebar/sidebar-footer-controls.tsx`, `components/sidebar/empty-states.tsx`,
`clisbot/home/open-sidebar-on-home.ts`, and every V1 branch in `screens/sessions-screen.tsx`. Checks that guard Home V2 behavior V2 keeps
(`mobile-panels/provider.tsx`, `navigation/settings-navigation.ts`,
`navigation/host-runtime-bootstrap.ts`, `use-chat-list-navigation.ts`,
`pending-chat-presentation.tsx`, `use-start-destination.ts`, `components/terminal-pane.tsx`,
`screens/workspace/workspace-header-menu.tsx`, `clisbot/quick-chats/quick-chats-section.tsx`) collapse to their true branch when Home V2's own
flag goes.

Tests, test ids and overrides:

- Unit tests that pin the old layout with `vi.mock("@/clisbot/navigation/feature", …false)`:
  `clisbot/home/chat-list-presentation.test.tsx`, `clisbot/bot-projects/controls.test.tsx`
  (legacy case). Delete those cases; keep the V2 ones.
- Test ids only the old layout renders: `sidebar-home`, `sidebar-sessions`, `sidebar-schedules`,
  `sidebar-global-new-workspace`, `sidebar-nav-add-project`, `sidebar-search`, `sidebar-footer`,
  `sidebar-footer-search`, `sidebar-new`, `sidebar-new-menu`, `sidebar-settings`, `mobile-toolbar`,
  `sidebar-unified-pinned`, `sidebar-pinned-section`, `sidebar-chats-section`. E2E specs that still use them move to the rail/More/section ids
  (`navigation-rail-*`, `more-*`, `chats-*`, `work-*`, `home-*`).
- E2E: the `navigationV2` fixture option (`e2e/support/fixtures.ts`) seeds the override `"0"` for
  every spec written against the Home V2 sidebar (59 of them read sidebar rows, the footer or the
  Chat/Inbox tabs) and `navigation-v2.spec.ts` opts in. Removal migrates those specs to the rail,
  More and section ids, then deletes the option and its init script.
- Env and storage overrides: `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2`, the `@clisbot:navigation-v2`
  localStorage key and `NAVIGATION_V2_OVERRIDE_KEY` (and, when Home V2's flag goes,
  `EXPO_PUBLIC_CLISBOT_HOME_V2`). Persisted keys: `clisbot-navigation-preferences` and
  `clisbot-navigation-issues` stay; `sidebar-bot-projects` and the Home V2 sidebar's collapsed
  section state (`useSectionCollapsed` keys `pinned`, `projects`, `chats`, `bots`, `quickChats`) can
  be dropped.

## Verification

Unit: `clisbot/navigation/*.test.ts` (registry, ownership, Chats ordering/filtering, Home feed
scope/mode/chips/badge including C15, every lifecycle transition, pin tags, mode target),
`clisbot/home/use-chat-list-navigation.test.tsx` (Work as a list tab),
`clisbot/bot-projects/controls.test.tsx` (both flag states). Browser:
`e2e/browser/navigation-v2-journeys.spec.ts` (Work + creates a workspace, a session opens from
Work and sends, a Bot DM opens from Chats and sends, a needs-action card opens from Home and is
approved, Settings from the rail and More, `/sessions` redirect) and
`e2e/browser/navigation-v2.spec.ts` at 1440×900 and 390×844 (rail, Home lifecycle with Seen
issues, Chats, Work, Tasks, `/sessions` redirect, phone tabs and More). Set
`E2E_NAV_V2_SCREENSHOTS_DIR` to keep its screenshots. `e2e/browser/navigation-v2-stability.spec.ts`
(acceptance S1, S3, S6 at 1440 and 390: rows hold within 1px while a rename, a new arrival, a new
failure and a Host going offline land; one notice; counts agree across Home, Chats, Work and the
badge).

Opt-in measurement specs:

- `navigation-v2-performance.spec.ts` (`CLISBOT_NAV_V2_PERF_E2E=1`): an isolated daemon with 500
  sessions and 500 group chats; rail and tab switch time to the first frame of the new section with
  blank-frame detection, wheel-scroll frame gaps on Chats, Work and a 200-item Home feed, and row
  re-renders after one change (render profiler). Set `E2E_STATIC_APP_DIR` to a production
  `expo export --platform web` for switch and scroll numbers; re-render counts need the dev bundle,
  because React reports `Profiler` renders only in development. `CLISBOT_NAV_V2_PERF_CPU=<testID>`
  adds a CPU profile of one switch.
- `navigation-v2-matrix.spec.ts` (`E2E_NAV_V2_MATRIX_DIR=<folder>`): every acceptance screen at
  1440, 1024, 320, 390 and 430 in light/dark × en/vi.

Native iOS/Android were not run.

## Native

Everything is shared React Native code with Unistyles tokens and the existing primitives; there is
no DOM path. Phones keep the Home V2 native model: peer tabs replace their route, Chats and Work
are the retained list panel with its pending-detail shell, Android Back follows the tab rules, and
iOS swipe-back is the native stack's. Chats is a virtualized `FlatList`; Work is the existing
workspace list; the Home feed keeps Home's existing scroller and its fixed row height. Chips and pin
tags stay visually compact and reach 44pt through `hitSlop`. On web only, a tab that opens the
list panel changes the route one frame after presenting the panel, because the panel presents a
frame after the store changes and the outgoing page would otherwise leave one blank frame; native
keeps its own presentation. `HoldReadingPosition` compensates from `onLayout`, which on native can
land a frame after the change, so a native recording should confirm S1; the scope and mode switches use the
44pt segmented size on phones. The issue store persists only when a record changes (a new occurrence or a reader mark), as one small JSON write through AsyncStorage; observing an unchanged directory writes nothing. Native iOS/Android builds were not run for
Round 1.

## Not in Round 1

Watch/Unwatch and Following; cross-device sync of seen/dismissed; offline outbox, tiered cache and
Storage; real Tasks; Notes, Design, Files; calendar inside Lịch; split DM/Group lists in Chats.
