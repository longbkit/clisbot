# Navigation V2

Round 1 IMPLEMENTED on `feat/navigation-v2-round1`, 2026-10-25. Round 2 (the Owner's real-app
review, items A1–D7) IMPLEMENTED on `integration/nav-v2-offline-o1`, 2026-10-26; awaiting Owner
acceptance. Contract: the Owner-confirmed Round 1 brief (C1–C16, D1–D4, 3.1a–3.1d) and the Round 2
checklist. This doc maps both onto the app and records the decisions they leave to engineering.
[Home and Inbox](../home-and-inbox/README.md) describes the Home V2 layout this replaces while the
flag can still turn it back on.

## Gate

`NAVIGATION_V2_ENABLED` (`packages/app/src/clisbot/navigation/feature.ts`) is
`HOME_V2_ENABLED && EXPO_PUBLIC_CLISBOT_NAVIGATION_V2 !== "0"`, on by default and nested in the
Home V2 gate:

| `EXPO_PUBLIC_CLISBOT_HOME_V2` | `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2` | Layout                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------ |
| unset                         | unset                               | Navigation V2 (rail, Chats/Workspace, More)            |
| unset                         | `0`                                 | Home V2: one sidebar, Home/Chat/Inbox/Automations tabs |
| `0`                           | any                                 | upstream sidebar                                       |

One browser can switch without a rebuild: the web-only `localStorage` key `@clisbot:navigation-v2`
set to `"0"` turns it off (`"1"` or absent leaves the build's choice). Native builds read only the
env. New code lives in `clisbot/navigation/`. Old and new navigation are separate components; shared
files branch on the flag at their entry point only (see [Flag removal](#flag-removal)).

**Names.** The section the code calls `work` reads **Work** in the rail, the phone tab and Home's
mode switch (Chat · Work · All; vi: Chat · Work · Tất cả); its route (`/work`), ids and test ids keep
`work`. It was Workspace until 2026-10-29. Tasks is Tasks / Công việc, and in Vietnamese "Công việc"
names Tasks only. Korean and Vietnamese keep the English word because their natural word for work is
the word they use for Tasks.
Other locales use their word for work and a different word for tasks
(`i18n/resources/navigation.ts`; `navigation-naming.test.ts` checks that every locale has every key
and that the two never collide). The mode switch's All and the scope tabs' All share one word; each
sits in its own labelled control.

## Structure

The primary navigation says where you are; each section owns its header, filters and list.

- **Section registry** (`sections.ts`): id, icon, label key, route, rail placement (`primary` or
  `bottom`), phone placement (`tab` or `more`) and status (`ready` or `preview`).
  `resolveNavigationSections` builds the rail, the phone tabs and More from it, so a new section is
  one entry. Plugin `header`/`footer` sidebar items join in the reader's existing
  `sidebarNavItems`/`sidebarFooterItems` order and visibility; Usage shows while the footer's Usage
  icon is on.
- **Desktop** (`rail.tsx`, `list-panel.tsx`): the rail sits beside the content and owns the
  window's top-left corner. Chats and Workspace open the existing resizable list pane
  (`components/desktop-sidebar-frame.tsx`, shared with the Home V2 sidebar); clicking the active
  one, or ⌘B, hides or shows it. Home, Schedules, Tasks, Connectors and More have no list pane.
- **Phone** (`clisbot/home/mobile-navigation.tsx`, `mobile-tabs.tsx`, `app/(tabs)`): tabs Home ·
  Chats · Work · Lịch · More in one retained tab navigator ([phone tabs][phone-tabs]). Chats and
  Work render their lists as the tab screen (`PhoneListTab`); details push above the tabs and Back
  pops to them ([route topology][phone-tab-routes]). More is the `/more` tab.
- **One component per job** across Home, Chats and Workspace: `SectionHeader`, `SectionControls` (For
  me / Others / All, chips, then the Display row, on one inset), `DisplayMenuTrigger`
  ("Display ▾", with a dot while a filter is in force), `HostsDisplayItems`, `ChipRow` /
  `ChipButton` (filter chips and pin tags), `PinMark`, `ListState` (empty and error). Each list's
  loading skeleton is drawn with its own row's styles (`BotsSidebarRowSkeleton`,
  `ActivityPlaceholder`), so loaded rows land where the placeholders were. Menus open at
  `DISPLAY_MENU_WIDTH`.
- **One row geometry.** Chats rows, Workspace rows and session lines, and Home feed rows share the
  Workspace row's two-line height (`SIDEBAR_TWO_LINE_ROW_HEIGHT`, 52px). In the flat lists
  (Chats, Home, Workspace's Session and Workspace grouping) the mark column starts at the
  controls' 12px inset and the title at 52px; rows pull their fill out to `FLAT_ROW_FILL_INSET`
  rather than the lists changing a padding their headers share. Project grouping keeps one step in
  under each project header (title at 64px), which is the hierarchy. The three row components
  stay separate: the Workspace rows are upstream's, so they share geometry tokens instead of one
  component. A `FlatList`'s `contentContainerStyle` gets no Unistyles class on web
  ([unistyles](../../unistyles.md#main-gotcha-contentcontainerstyle)), so Chats and the flat
  Workspace list use theme-free `SPACING` insets.
- **Retention**: a visited section stays mounted, so a switch only flips visibility and keeps
  scroll position. On desktop Chats and Work are retained panels in the list pane (`ListContent` in
  `list-panel.tsx`); on phones every tab is ([phone tabs][phone-tabs]). A hidden list holds its
  inputs (`useHeldWhileInactive`): desktop Work reads the sidebar model through
  `RetainedSidebarModel`, a phone's Work tab holds its own provider's inputs (`holdWhileInactive`),
  Chats holds its catalog and unread agents in `ChatsPane`, and a phone's hidden Home holds the
  navigation activity. Host updates skip a hidden section; its first render back uses the latest
  data. Until 2026-10-30 a phone tab switch replaced the route (and Android also unmounted hidden
  lists), so every switch rebuilt the screen: 2 s or more on a production build, about 2 s for
  Work on a Galaxy S23 with 14 Hosts.

[phone-tabs]: ../../mobile-panels.md#phone-tabs
[phone-tab-routes]: ../../expo-router.md#phone-tabs

## Change map

| #   | Status | Where                                                                                                                                                                                                     |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | done   | `rail.tsx` from the registry; bottom Usage (when on), Hosts with its dot, Help, Settings                                                                                                                  |
| C2  | done   | `list-panel.tsx` replaces `LeftSidebar`; no Pinned, Bots, Group chats, Projects sections or footer in V2                                                                                                  |
| C3  | done   | `chats-pane.tsx`, `chat-list.ts`, `use-chat-entries.ts`, `held-order.ts`                                                                                                                                  |
| C4  | done   | `work-pane.tsx` wraps `SidebarWorkspaceList` with `pinPresentation="float"`; see [Workspace list](#workspace-list)                                                                                        |
| C5  | done   | `section-header.tsx`; Home 🔍, Chats 🔍 ✎, Workspace 🔍 +; ⌘K unchanged                                                                                                                                   |
| C6  | done   | `home-layout.tsx`; `/sessions` redirects to Home; Home 🔍 shows Inbox's history in place (`InboxHistory`)                                                                                                 |
| C7  | done   | `home-controls.tsx` chips over Home's existing activity buckets                                                                                                                                           |
| C7a | done   | one Display ▾ per list: Chats (order, split, Hosts), Workspace (the sidebar display menu; grouping tabs and the Bots chip under it); Home's Host chip leads its controls; see [Host filter](#host-filter) |
| C8  | done   | `pin-tags.tsx`, `pin-tags-model.ts`                                                                                                                                                                       |
| C9  | done   | phone tabs from the registry; Home carries the unseen-issue badge                                                                                                                                         |
| C10 | done   | `more-screen.tsx`                                                                                                                                                                                         |
| C11 | done   | rail, tabs and the `/schedules` landing title read Schedules / Lịch; routes unchanged                                                                                                                     |
| C12 | done   | `ownership.ts`, `scope-tabs.tsx` on Home, Chats and Workspace; `work-items.ts` for the Workspace list                                                                                                     |
| C13 | done   | `home-header.tsx` switch; `home-mode-target.ts` moves the composer target                                                                                                                                 |
| C14 | done   | Tasks and Design entries with `status: "preview"`, `preview-screen.tsx` (Design below Workspace, Owner 2026-10-26)                                                                                        |
| C15 | done   | the scope applies before chips, pin tags, counts and badges (`home-feed.ts`, `homeBadgeCount`)                                                                                                            |
| C16 | done   | `issues.ts`, `issue-store.ts`, `activity.tsx`, `issue-actions.tsx`, `home-feed-view.tsx`                                                                                                                  |

## Old controls → new home (3.1a)

| Before                                   | Desktop                                                                        | Phone                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Sidebar Home row                         | Rail Home                                                                      | Home tab                                           |
| New workspace row, footer `+` New        | Workspace header `+` (the `/new` shortcut stays)                               | Workspace header `+`                               |
| Add project row / footer icon            | Workspace `+` → Add project (shortcut stays)                                   | same                                               |
| Import session (footer, Inbox header)    | Workspace `+` → Import session; Home status line                               | same                                               |
| New bot, New group                       | Chats header ✎                                                                 | Chats header ✎                                     |
| Inbox row and tab                        | Home (feed, 🔍 opens the full history)                                         | Home tab                                           |
| Search row / footer search, ⌘K           | 🔍 in each section header; ⌘K                                                  | 🔍 in each tab header                              |
| Automations row and tab                  | Rail Schedules / Lịch                                                          | Lịch tab                                           |
| Connectors row                           | Rail Connectors                                                                | More → Connectors                                  |
| Plugin header/footer rows                | Rail entries; a plugin's own row opens from it                                 | More rows                                          |
| Pinned section                           | Pinned rows on top of Chats/Workspace; Home pin tags                           | same                                               |
| Bots, Group chats sections               | Chats list                                                                     | Chats tab                                          |
| Projects section, display menu, view bar | Workspace list and its filter rows                                             | Workspace tab                                      |
| Usage (opt-in)                           | Rail bottom while the Usage icon is on; the open session's quota under it      | More → Usage, with the last opened session's quota |
| Hosts + dot (Host picker)                | Rail bottom Hosts, same picker, online count; the filtered Host's tag under it | More → Hosts with online / total; dot on More tab  |
| Help menu                                | Rail bottom Help                                                               | More → Help                                        |
| Settings                                 | Rail bottom, last                                                              | More → Settings / Cài đặt                          |
| Account / Hub top row                    | Settings → Hub                                                                 | Settings                                           |

## Host filter

One Host filter for every list (Owner, 2026-10-26): it is the sidebar's saved `hostFilters`
(`host-filter.ts`), so Home, Chats and Workspace show the same Hosts and a choice made anywhere
applies everywhere. It is set from the rail's Hosts picker, from Home's Host chip (first in Home's
controls: a Host is the widest thing a reader chooses), and from Chats' and Workspace's Display
menus. While it filters, its tag sits on the rail above Hosts (✕ clears it) and Home's chip shows
it with ✕. The rail's Hosts icon shows how many are online in the same small pill as Home's count, green, amber or red as the status dot was (its tooltip and More give online / total). It survives restarts and drops a
Host only once the Host list has settled ([sidebar agent sessions](../sidebar-agent-sessions/README.md)).
Store version 3 drops Chats' former Host filter (`chatsHosts`); Home's was never stored.

## Session quota

While a session is on screen (a workspace's focused session, or a Bot chat's session),
the rail's Usage item shows that session's account quota in two lines: the 5-hour window and the
weekly one, each as a percent (used or remaining, as the Usage preference says) and the time to
its reset in its largest unit (`1d`, `1h`, `30m`: the Usage view's own rule). Scoped limits (one
model's weekly) are left out; a session whose Host cannot report usage shows Usage alone. A phone
shows the most recently opened session's quota in More's Usage row; that session's ids are stored
so it survives a restart (`opened-session.ts`, `session-quota.tsx`).

The quota stays current without hammering the providers (`usage/refresh-policy.ts`,
`usage/live-agent-usage.ts`): it polls every 2 minutes while the app is visible, rereads when the
window comes back and when the session's turn ends, and never forces a provider call (the
daemon's five-minute cache answers; [why][quota-cadence]). When reads fail it keeps the last
numbers and backs off; once they are older than five minutes with the latest read failed, the
lines are dimmed and the percent gets a `~` prefix.

[quota-cadence]: ../../audits/2026-10-27-session-quota-refresh-cadence.md

## For me / Others / All

`resolveOwnership({ createdBy, participationKey, accounts, hostKind, watched })` is the shared
predicate for Home (including its badge), Chats, Workspace, pin tags, search and tab counts.
It returns `mine`, `others` or `unknown`.

A Host is **Hub-bound** when its registered `HostProfile.management` binding exists, including
managed-access mode `off` and a direct TCP transport. A personal Hub follows the same rule as a
company Hub. On these Hosts:

- A verified relationship through the creator **or any participant** makes the item **mine**:
  its `createdBy`, `lastMessageBy` or any `participantActors` entry matches the reader on that Hub
  (`isOwnActor`: member id, else user id). Participation counts even when another person or an
  automation created the session. `lastInteractionBy` is not participation evidence.
- Channel actors need a verified Member link; a provider id alone cannot match a Hub account.
  An unresolved reader or an actor from another Hub does not prove a relationship.
- Without matching creator or participation evidence, a verified other user creator is **others**.
  Missing creators, automation, system and unscoped user creators (including `LOCAL_OWNER`) are
  **unknown** when participation also cannot prove a relationship. Neither titles nor a parent
  workspace/chat author supply that evidence.

A registered Host without a management binding keeps the previous direct-Host behavior for now:
missing creators, automation, system and unscoped users are mine. This is a compatibility exception,
not proof of daemon ownership (pairing can delegate access). `KEEP_DIRECT_LEGACY_OWNERSHIP` is its
single switch, tested both ways. A Host missing from the registry is always **unknown**.
`watched === true` is the explicit Round 2 override on a registered Host; no live caller sets it.

**Unknown** is listed under For me and All, never Others (Owner, 2026-10-31). Its count joins For
me, so For me + Others = All; only a proven other person is Others. `isReaderOwned` in
`ownership.ts` is the single predicate every consumer reads (scopes, counts, Home badge, pin tags,
search ranking). The resolver still returns `unknown`, so the distinction stays available. The
scope tabs' help icon about unknown ownership shows on the tabs that list it (For me and All). It may
persist for legacy sessions without identity evidence; a temporarily missing reader can resolve
later using the remembered account below.

**Why unknown moved to For me.** Sessions the desktop app starts on its own Host carry no creator
and no participant, because the local connection has no Hub account. Under the 2026-10-29 rule
about 700 of the owner's own Mac sessions were listed under Others. Evidence that cannot place an
item no longer moves it away from the reader; a verified other creator still does. Consequences:
on a Host missing from the registry everything is For me until the Host is classified, and a Hub
session whose creator is absent, an automation or the system is For me unless participation or a
creator proves another person.

**Why the provisional rule was removed (2026-10-29, superseded above).** A watchdog-only app probe of 14 real
Hub-bound Hosts found 38 of 3,359 sessions admitted to For me solely because `createdBy` was absent.
All 38 reported authorship `ready`; none matched the reader through last sender or participants.
The initial fix, which accepted participation only for creatorless sessions, changed that snapshot
from 181/3,178/3,359 to 143/3,216/3,359 (mine/others/all). That probe did not collect participation
for authored sessions, so these historical totals do not predict the broader creator-or-participant
rule above.
No direct Host was present in that sample. The probe reads aggregate metadata already in the app;
no timeline fetch or diagnostic probe ships with the ownership fix.

**The reader on a Hub** (`reader.ts`, `reader-accounts.ts`, `hub/reader-memory.ts`) is the live
signed-in account, else the last one this device verified for that Hub (persisted per Hub origin,
`clisbot-hub-readers`). A moment with no live answer (the Hub unreachable, the account loading, a
lapsed sign-in) therefore reclassifies nothing. A different account signing in replaces it; an
explicit sign-out forgets it, and the mark it leaves (`signedOut` in `reader-memory.ts`) wins over
the account query for that account: an answer that still says signed in (a refetch in flight, or
one that failed) is not the reader, in the hook as well as in storage. The mark ends when another
account signs in, when a sign-in or other account action completes with a current answer from the
Hub (`run` in `hub/account-provider.tsx`, a session change elsewhere), or when the Hub answers that
nobody is signed in. An action or read that began before the sign-out and ends after it never ends
the mark: each sign-out bumps a per-Hub generation (`signOutGeneration`) that is compared at both
ends, because its answer predates the sign-out. Storage is read after the app starts: what happened meanwhile wins, and a
reader signed out meanwhile is also removed from storage. It classifies authorship and authorizes
nothing.

**Which Hub an author belongs to.** A session's `createdBy.hubOrigin` is the Hub's public HTTPS
address; a paired Hub's account is scoped as `hub://<hubId>` and reached by an HTTPS route. The
author matches the reader's Hub by `hubIdentity` against that `hubId` when both exist, else by the
canonical origin (scheme, host and port, no trailing slash) against the account's origin or its
connection route. Two Hubs at one address with different identities are two Hubs.

A session never inherits its workspace's or chat's author. Empty workspaces use their own
`createdBy`. A Bot DM uses its Chat's `record.createdBy` and already loaded participant
sessions can supply sender evidence, but not their creators. A Bot without a chat uses its owner
snapshot. The Host's `isOwner` flag alone does not establish ownership on a Hub-bound Host.

`AgentDirectoryEntry` projects a scalar `participationKey` for every session with sender evidence.
It contains deduplicated sender identity fields, not names, avatars or whole actor arrays. The
resolver compares these with current readers, so a reader change does not require reprojection.
A bounded 2,048-entry cache uses the shared `ownershipKey` (creator, participation, immutable reader
accounts identity and Host kind); changing a binding or reader invalidates the result. Projector
caches retain immutable source identities and compute participant identities once per source;
profile-only changes do not alter the key. Workspace count caches compare participation even
when a creator exists.

A chat's participation key is cached on its payload (`clisbot/navigation/chat-ownership.ts`), so
Home's pin tags and the Chats pane derive it once between them. It is recomputed only when the
chat's Host replaces its agents map and a participant session actually changed; the session store
replaces that map on every agent update and never edits it in place. A hidden Chats pane or Home
holds its keys and re-reads them when shown.

The scope applies first everywhere; pins only reorder inside it. A pin (a resource pin, or a
workspace pinned on the Host, which every reader sees) never brings another member's session into
For me.

Global search reads the same rule: For me ranks first, Others rows are labelled, and opening an
item a list hides leaves the list's filter alone and shows a notice above it
([global search wiring](../global-search/README.md#navigation-v2-wiring)).

## Sources removed and cached

A source is a Host. Navigation V2 lists only what a source can say now (`source-liveness.ts`,
`use-source-liveness.ts`; states from [source health](../offline/connection-resilience.md#source-health)).
Home, the Chats unread marks and the Workspace list read the one answer.

| Source                                                                                            | Its sessions                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Not listable**: the Host picker does not list it (`inventoryHosts`), or it was removed          | Not listed anywhere. Nothing stored is cleared.                                                                                                         |
| **Cached**: listable, but offline, sign-in needed, revoked, not answered yet, or not yet measured | Listed with their last facts. Not Running, no approval to give, and not Done either: what they were doing is unknown. Failures and unread replies stay. |
| **Live**                                                                                          | As the Host reports.                                                                                                                                    |

**Listable is the picker's list.** The registry (`useHosts`) holds more than the picker shows: a
Hub-managed Host that no Hub account here lists, or whose Hub answered that this device is signed
out, is registered and still reconnecting, and its replica rows are restored at start. Those rows
used to appear on Home for a Host the picker did not offer. Once the registry, every Hub and the
remembered Hub lists (`hub-daemon-list-cache`) have loaded, Home and Workspace list the picker's
Hosts. Until then nothing is hidden, so a cold start never drops offline work. A Hub that is only
unreachable keeps its Hosts listed through its remembered list; a Host with a verified local
connection is listed regardless.

**Cached sessions are unknown, not finished.** Their running turn and pending approval are
dropped; they sit in Recent on Home (no "Finished" label), and in Workspace they are under no
status chip (not Running, Needs me or Done) and the session line shows no live dot. Active
sessions only does not hide them. A Host with no health entry yet counts as cached. The issue
records keep reading the last report, so an approval a Host asked for before it dropped is still
seen or unseen when it returns.

Not covered, and why: the Workspace row's status badge and the By status grouping read the
daemon's workspace status (`createSidebarWorkspaceEntry`), and the agent tabs' dots read the raw
agent. Those render in upstream components (`project-leading-visual.tsx`, `agent-status-dot.tsx`,
three row call sites) and still show the last reported status. [design.md](../../design.md) §13
has no stale or cached status token, and §13's dots are one family, so a dimmed or hollow dot is a
new visual convention for the Owner to decide, not a local tweak. If it is approved, one
`cached` prop on the dot components read through `useIsSourceCached(serverId)` covers every call
site; until then a cached Host's workspace badge can still look live, and the connection notice
and the Hosts rail dot are what say the Host is out of reach.

## Home

Home, Chats and Workspace all open on For me and keep the last choice the reader made (Owner, 2026-10-28; it replaces Home opening on All from 2026-10-26).

Order: header (mode switch, 🔍) → a connection notice only when something is wrong → composer and
its context row → Status & Setup and Import session → quick starts → the Host chip → scope tabs →
chips → pin tags → feed. On desktop the mode switch sits in the middle of the header, on the centre
line of Home's column. Home has no Hosts block and no
floating updates bar (held updates show as an inline "Show N updates" above the feed). The
composer is at the top on phones too, with its pickers opening downward; a phone's header row is
the mode switch and search (the tab bar already says Home).

- **Connection notice** (`connection-notice.tsx`): `useHomeConnectionNotice()` is the adapter seam
  — today it reads the Hosts strip's issue model; a per-source health summary can replace its body
  without touching `ConnectionNotice` or Home.

- **Mode** (C13). Chat = sessions with a Bot label (`clisbot.bot-id`, `isChatSession`), Workspace =
  every other session, All = both. The same rule decides the Workspace list's Bots chip and global
  search. It filters the feed, issue cards, pin tags and counts on Home only. Switching to Chat points the composer at the last Bot used in Chat mode;
  switching to Workspace returns to the last project or Quick chat. The start switcher offers only the
  mode's starts (Chat: Bot; Workspace: Quick chat and Project; All: all), so the two controls never
  disagree; on phones unselected segments show only their icon, so all three fit 320pt. The
  composer has one draft per screen, so switching never loses it.
- **Chips** (C7). All · Needs me · Running · Updated · Failed. Needs me is Home's existing Needs you
  bucket — approvals and failures — limited to unseen issues; Failed lists failures with seen ones
  below, dimmed. Counts are the reader's scope; Needs me and Failed count unseen only.
- **Feed**. Home's activity layout (`useActivityLayout`) takes the filtered rows and a bucket per
  row, adding a `seen` group. `buildHomeFeed` derives the shown rows, their buckets, Mark all as
  seen and every count in one pass, and its cache keeps whatever did not change, so an update to a
  session the feed does not show re-renders nothing on Home. The layout does not sort: the
  aggregated list is already newest first apart from open turns and ties, so it merges those runs
  (ties by `serverId:id`). Background changes still wait behind Show updates; a change the
  reader makes (a filter, Mark as seen, Dismiss, Archive) applies at once. The feed has no caption:
  loading is the skeleton, and the directory line appears only when a connected Host's list fails —
  a Host that drops is the connection notice's to say. The feed renders one frame after the
  header, composer and filters, so switching to Home paints the top of the page first.
- **States**. Home, Chats and Workspace share `ListState`: the skeleton while a Host connects, one
  offline line once no Host can be reached (`useHostsReachability`; Chats and Workspace add View
  details, which opens the connection sheet), empty, and filtered-empty.
- **Rows never blank.** Once a list has rows it does not go back to a skeleton, an empty state or
  nothing for a refresh, a Bot change or a Host reconnecting. Bot and chat queries key on each
  Host's admission, so a managed Host's reconnect starts a new query; `useAggregatedQuery` holds each
  Host's last rows for display until that Host answers again (`holdAggregateRows`), while
  `acceptedServerIds` still proves only the current admission. Each Host's Bot/chat event feed restarts only on
  that Host's own reconnect (`useHostCatalogFeeds` in `clisbot/bots/data/runtime.ts`): a feed
  restart refetches the Host's open transcripts, and when one Host is revoked and re-added in a
  loop (an expired Hub sign-in) it used to restart every Host's feed, refetching every open chat
  and flashing "Updating messages". Home treats a held layout whose rows
  have all left as empty, so it never keeps arrivals behind Show updates over nothing.
- **Reading position**. Content above the feed that changes height by itself — the connection
  notice, the Show updates / Mark all as seen line — sits in `HoldReadingPosition`: while the reader
  is scrolled, the scroll moves by the same amount, so no row moves under them. At the top the
  change is simply shown.
- **Pins** (C8). Every pin as a tag, the reader's own first (ownership follows the rules above).
  Tags wrap onto at most two lines; the last place on the second line is `+N · Show more`, which
  opens the rest below, and Show less folds them back. How many fit comes from the measured tag
  widths (`fitPinTags`); the two-line height is fixed, so nothing jumps while they are measured.

## Workspace list

The list's unit is the root session (`work-items.ts`); a workspace with no sessions is one item.

- **Scope per session.** For me lists the reader's sessions; a workspace shows under a scope when
  one of its sessions does, with only those sessions under it. Counts, the floating pinned rows and
  the session lines read the same filter (`useWorkListFilter`, the sidebar model's `workList`).
- **One list.** Session and Workspace grouping are one virtualized list ordered by last update
  (`SidebarStatusFlatList`), with no Show more fold. Project grouping keeps project headers.
- **Quick chats** are ordinary sessions: in Project grouping they fold into one Quick chat project
  (`mergeQuickChatProjects`, view key `clisbot:quick-chat`, named in the reader's language on every
  row); elsewhere they sit in the list by time. There is no Quick chats section.
- **Pins.** A pinned row floats to the top inside the scope and carries one `PinMark` at the end of
  its title line; unpinned rows carry none. Pin and Unpin live in the row menu (sessions included),
  not a permanent button.
- **Bots chip** beside the grouping control: on by default, persisted per device
  (`workShowBots`). Off hides Bot-labelled sessions and so Bot home projects, counts included. It is
  label-based, so nothing flashes while Bot data loads. It replaces the Display menu's Bot projects
  switch.
- **No Active filter.** Ordering by last update covers it; V2 ignores the stored `activeOnly`.
- The navigation store's persist version 1 drops `showBotProjectsInWork` and sets `workShowBots`;
  the scope, mode and Chats choices carry over. Version 2 moved a stored Home scope to All once; version 4 returns it to For me once.

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
  Dismiss, Archive, or 7 days after it was seen. The session stays in Chats/Workspace with its status.
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
  history beyond the loaded directory stays reachable. Chats 🔍 filters the list by title. Workspace 🔍
  opens the Command Center, the cross-Host search ⌘K opens everywhere.
- **Bot sessions in Workspace**: shown by default; the Bots chip hides them
  ([Workspace list](#workspace-list)). The Home V2 sidebar's own Bot projects switch is untouched.
- **Chats display**: one `Display ▾` for the mixed list: sort (recent activity or name), an opt-in
  "Separate bot chats and groups" (off by default), and Hosts when there are several. The Home V2
  sidebar's Bots and Group chats display menus are not used in V2.
- **Chip rows** scroll sideways on one line everywhere. The row spans the pane with the inset as
  padding, so a chip that does not fit runs under a fade at the pane's own edge; each edge fades
  while more chips wait that way (`ChipRow`, `EdgeFade`).
- **Chats order**: newest activity first with pins on top; while the pointer, a touch or a scroll
  is on the list the order holds and only new rows enter at the top (`held-order.ts`).
- **Hosts strip** stays above the composer on Home; it carries the connection-issue actions.
- **Schedules**: the destination is Schedules / Lịch. Inside it, the Hub **Automations** tab keeps
  its name: the glossary defines Automation as the Hub Trigger/Workflow, a different thing.
- **Native pins without Bots**: on a Host without the Bots feature, pinned workspaces
  (`pinnedAt`) stay inside their project in Workspace instead of floating. Resource pins float.

## Flag removal

Removal is the first task of Round 2, after Owner acceptance and one stable release with 7 days
without rollback (brief 3.1d). Do not remove it before.

Delete or collapse to the V2 branch:

| File                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/navigation/feature.ts`                                                             | delete; replace imports with nothing (always V2)                                                                                                                                                                                                                                                                                                                                    |
| `app/_layout.tsx`                                                                           | `SidebarChrome` always renders `NavigationChrome`; drop `LeftSidebar`, keep `/work`, `/more`, `/tasks` chrome paths                                                                                                                                                                                                                                                                 |
| `clisbot/navigation/chrome-layout.ts`                                                       | keep only the V2 return                                                                                                                                                                                                                                                                                                                                                             |
| `app/work.tsx`, `app/more.tsx`, `app/tasks.tsx`                                             | drop the `Redirect` fallback                                                                                                                                                                                                                                                                                                                                                        |
| `app/sessions.tsx`                                                                          | becomes a plain redirect to Home                                                                                                                                                                                                                                                                                                                                                    |
| `screens/sessions-screen.tsx`                                                               | keep only `InboxHistory` (embedded); drop the standalone screen and its `MenuHeader`                                                                                                                                                                                                                                                                                                |
| `screens/new-workspace-screen.tsx`                                                          | `StartLayout` always uses `NavigationHomeLayout` for Home                                                                                                                                                                                                                                                                                                                           |
| `clisbot/home/home-header.tsx`                                                              | always `NavigationHomeHeader`; delete `MobileToolbar` (`clisbot/home/mobile-toolbar.tsx`)                                                                                                                                                                                                                                                                                           |
| `clisbot/home/mobile-navigation.tsx`                                                        | drop `HOME_V2_TABS`, the `/sessions` badge/label branch, `MobileChatPanelTabs` and the panel branch of `Tab`; `usesPhoneTabs` = compact                                                                                                                                                                                                                                             |
| `clisbot/home/list-tab-page.tsx`                                                            | drop the non-V2 branches                                                                                                                                                                                                                                                                                                                                                            |
| `clisbot/home/activity-state.tsx`                                                           | Needs link always sets the chip; label "Needs me"                                                                                                                                                                                                                                                                                                                                   |
| `clisbot/home/activity-preview.tsx`                                                         | delete `HomeActivity` (replaced by `home-feed-view.tsx`)                                                                                                                                                                                                                                                                                                                            |
| `clisbot/automations/screen.tsx`                                                            | title always Schedules / Lịch                                                                                                                                                                                                                                                                                                                                                       |
| `clisbot/bot-projects/preferences.ts`                                                       | delete with the legacy store and its key `sidebar-bot-projects`; the Bots chip replaces it                                                                                                                                                                                                                                                                                          |
| `clisbot/navigation/work-filter.ts`, `home-mode-target.ts`, `activity.tsx`                  | drop the flag guard                                                                                                                                                                                                                                                                                                                                                                 |
| `clisbot/workspace-sessions/*`                                                              | delete the Active filter (`activeOnly` setting, `ActiveOnlyTag`, its Display item); `session-list.tsx` keeps `rowTopLevelV2` as `rowTopLevel`                                                                                                                                                                                                                                       |
| `clisbot/home/activity-row.tsx`, `activity-placeholder.tsx`, `clisbot/bots/sidebar/row.tsx` | the V2 row geometry becomes the only one                                                                                                                                                                                                                                                                                                                                            |
| `hooks/use-sidebar-workspaces-list.ts`, `components/sidebar-workspace-list.tsx`             | always merge Quick chat projects and render `SidebarStatusFlatList`                                                                                                                                                                                                                                                                                                                 |
| `components/left-sidebar.tsx`                                                               | delete, with `components/sidebar/sidebar-nav-rows.tsx`, `sidebar-footer.tsx`, `sidebar-new-menu.tsx`, `clisbot/hub/sidebar-nav-group.tsx`, `clisbot/bots/sidebar/sections.tsx` (keep `CreationSheets`, `useSidebarCatalog`, `useDefaultCreationServerId` by moving them), `clisbot/bots/sidebar/bots-section.tsx`/`chats-section.tsx` section components (keep `BotRow`, `ChatRow`) |
| `components/sidebar-workspace-list.tsx`                                                     | drop `pinPresentation="section"` and the Pinned section; `FusionPinnedSection` always `float`                                                                                                                                                                                                                                                                                       |

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
`clisbot/home/use-chat-list-navigation.test.tsx` (Workspace as a list tab),
`clisbot/navigation/work-items.test.ts`, `store.test.ts` (persist migration),
`clisbot/quick-chats/quick-chat-projects.test.ts`, `clisbot/bots/data/aggregate.test.ts` (held
rows), `clisbot/home/use-activity-layout.test.tsx`. Browser:
`e2e/browser/navigation-v2-journeys.spec.ts` (Workspace + creates a workspace, a session opens from
Workspace and sends, a Bot DM opens from Chats and sends, a needs-action card opens from Home and is
approved, Settings from the rail and More, `/sessions` redirect) and
`e2e/browser/navigation-v2.spec.ts` at 1440×900 and 390×844 (rail, Home lifecycle with Seen
issues, Chats, Workspace, Tasks, `/sessions` redirect, phone tabs and More). Set
`E2E_NAV_V2_SCREENSHOTS_DIR` to keep its screenshots. `e2e/browser/navigation-v2-stability.spec.ts`
(acceptance S1, S3, S6 at 1440 and 390: rows hold within 1px while a rename, a new arrival, a new
failure and a Host going offline land; one notice; counts agree across Home, Chats, Workspace and
the badge). `navigation-v2-work-scope.spec.ts` (Round 2 A1–B4 against Hub sessions authored by
another member; `NAV_V2_WORK_SHOTS=<folder>` adds both groupings with pinned rows in light/dark ×
vi/en). `navigation-v2-list-continuity.spec.ts` (D6: 60s of Chats, then Workspace and Home, sampled
every frame through a new chat, a Bot rename, focus refetches and Host restarts, with zero blank
frames, no row lost and no remount; D7: skeleton and loaded rows on one rail, chip rows to the pane
edge; V5: Chats error and Retry; V3: one row height and rail; `NAV_V2_LIST_SHOTS=<folder>` keeps
screenshots). `navigation-v2-continuity.spec.ts` (S2: a Host restart keeps the route and draft; S5:
deep links, `/sessions` and Back; S7: stored preferences migrate and the flag off restores the old
layout).

Opt-in measurement specs:

- `navigation-v2-performance.spec.ts` (`CLISBOT_NAV_V2_PERF_E2E=1`): an isolated daemon with 500
  sessions and 500 group chats (`CLISBOT_NAV_V2_PERF_SESSIONS`, `_WORKSPACES` and `_CHATS` scale
  it; the Workspace-at-scale test measures grouping, scope and Bots chip switches and scroll); rail and tab switch time to the first frame of the new section with
  blank-frame detection, wheel-scroll frame gaps on Chats, Workspace and a 200-item Home feed, and row
  re-renders after one change (render profiler). Set `E2E_STATIC_APP_DIR` to a production
  `expo export --platform web` for switch and scroll numbers; re-render counts need the dev bundle,
  because React reports `Profiler` renders only in development. `CLISBOT_NAV_V2_PERF_CPU=<testID>`
  adds a CPU profile of one switch.
- `navigation-v2-matrix.spec.ts` (`E2E_NAV_V2_MATRIX_DIR=<folder>`): every acceptance screen at
  1440, 1024, 320, 390 and 430 in light/dark × en/vi.
- `navigation-v2-states.spec.ts` (`E2E_NAV_V2_STATES_DIR=<folder>`): loading, offline, empty and
  filtered-empty on Home, Chats and Workspace at 1440 and 390.

Home and the surfaces around it (activity, quick starts, start switcher, connection problems, the
directory line, the Schedules landing, relative times) take their strings from the `home` resource
(`i18n/resources/home.ts`); relative times in `utils/time.ts` follow the reader's language.

Native iOS/Android were not run.

## Native

Everything is shared React Native code with Unistyles tokens and the existing primitives; there is
no DOM path. Phones (native and compact web) use the retained [phone tabs][phone-tabs]: a detail
pushes on the root stack, Android Back pops it to the tab it came from (a tab other than Home goes
Home; Home leaves the app), and iOS swipe-back is the native stack's. Chats is a virtualized
`FlatList`; Work is the existing
workspace list in Project grouping and a virtualized `FlatList` in Session and Workspace grouping;
the Home feed keeps Home's existing scroller. Chips and pin
tags stay visually compact and reach 44pt through `hitSlop`. `HoldReadingPosition` compensates from `onLayout`, which on native can
land a frame after the change, so a native recording should confirm S1; the scope and mode switches use the
44pt segmented size on phones. The issue store persists only when a record changes (a new occurrence or a reader mark), as one small JSON write through AsyncStorage; observing an unchanged directory writes nothing. Native iOS/Android builds were not run for
Round 1.

## Not in Round 1

Watch/Unwatch and Following; cross-device sync of seen/dismissed; offline outbox, tiered cache and
Storage; real Tasks and Design; Notes, Files; calendar inside Lịch; split DM/Group lists in Chats.
