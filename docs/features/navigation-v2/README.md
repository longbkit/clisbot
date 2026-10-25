# Navigation V2 — Round 1

PLANNED → IN PROGRESS on `feat/navigation-v2-round1`, 2026-10-25. Contract: the Owner-confirmed
Round 1 brief (C1–C16, D1–D4, 3.1a–3.1c). This doc maps the brief onto the app and records the
decisions the brief leaves to engineering. [Home and Inbox](../home-and-inbox/README.md) still
describes the Home V2 layout this replaces.

## Gate

`NAVIGATION_V2_ENABLED` (`packages/app/src/clisbot/navigation/feature.ts`) is
`HOME_V2_ENABLED && EXPO_PUBLIC_CLISBOT_NAVIGATION_V2 !== "0"`. It nests inside the existing Home V2
gate, so both earlier layouts stay one switch away until acceptance:

| `EXPO_PUBLIC_CLISBOT_HOME_V2` | `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2` | Layout                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------ |
| unset                         | unset                               | Navigation V2 (rail, Chats/Work, More)                 |
| unset                         | `0`                                 | Home V2: one sidebar, Home/Chat/Inbox/Automations tabs |
| `0`                           | any                                 | upstream sidebar                                       |

Every new module lives in `clisbot/navigation/`; upstream files only branch on the flag.

## Structure

The primary navigation says where you are; each section owns its header, filters and list.

- **Section registry** (`clisbot/navigation/sections.ts`). One entry per destination: id, icon,
  label, route, placement (`primary` or `bottom` on the rail; `tab` or `more` on a phone), badge
  and status (`ready` or `preview`). The rail, the phone tabs and More all read it, so a new
  section is one entry. Plugin `header` and `footer` sidebar groups join as entries in the user's
  existing `sidebarNavItems` / `sidebarFooterItems` order and visibility.
- **Desktop**: rail (Home, Chats, Work, Schedules, Tasks, Connectors, plugins; bottom Usage when
  enabled, Hosts with its dot, Help, Settings). Chats and Work open the existing resizable list
  pane beside the detail; Home, Schedules, Tasks, Connectors and More have no list pane. The rail
  owns the window's top-left corner, so the content never draws a sidebar toggle; ⌘B and a second
  click on the active Chats/Work item hide and show the list pane.
- **Phone**: tabs Home · Chats · Work · Lịch · More. Chats and Work are the existing retained list
  panel (`agent-list`) with section content, so the native presentation, pending-detail shell and
  Back return path stay one implementation; `/chat` and `/work` are both list-tab routes. More is a
  page (`/more`). Conversation detail hides the tab bar; Back returns to the tab it came from.

## Change map

| #   | Where                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `navigation/rail.tsx` from the registry                                                                                               |
| C2  | `left-sidebar.tsx` renders `navigation/list-pane.tsx` instead of nav rows, Pinned, Bots, Group chats, Quick chats sections and footer |
| C3  | `navigation/chats-pane.tsx` + `chat-list.ts` (one list: bot DMs and groups)                                                           |
| C4  | `navigation/work-pane.tsx` wraps `SidebarWorkspaceList`; Quick chats lead it as a caption group                                       |
| C5  | `navigation/section-header.tsx`; ⌘K keeps opening the Command Center                                                                  |
| C6  | `/sessions` redirects to Home; Home search opens the Inbox history list in place                                                      |
| C7  | Home quick-filter chips over the existing activity buckets                                                                            |
| C7a | Existing display menu, active-filter chips and Inbox Host/Type/Date filters under the chips                                           |
| C8  | `navigation/pin-tags.tsx`                                                                                                             |
| C9  | `mobile-navigation.tsx` reads phone tabs from the registry; Needs badge on Home                                                       |
| C10 | `navigation/more-screen.tsx`                                                                                                          |
| C11 | Labels only: Schedules / Lịch; routes `/schedules` and `/automations` unchanged                                                       |
| C12 | `navigation/ownership.ts`, scope tabs on Home, Chats and Work                                                                         |
| C13 | Home header mode switch                                                                                                               |
| C14 | Tasks registry entry with `status: "preview"`, placeholder page `/tasks`                                                              |
| C15 | Scope filters run before chips, pin tags, counts and badges                                                                           |
| C16 | `navigation/issues.ts` + `issue-store.ts`, Home feed and Failed chip                                                                  |

## Old controls → new home (3.1a)

| Before                                   | Desktop                                            | Phone                         |
| ---------------------------------------- | -------------------------------------------------- | ----------------------------- |
| Sidebar Home row                         | Rail Home                                          | Home tab                      |
| New workspace row, footer `+` New        | Work header `+` (also `/new` shortcut)             | Work header `+`               |
| Add project row / footer icon            | Work header `+` → Add project                      | same                          |
| Import session (footer, Inbox header)    | Work header `+` → Import session; Home status line | same                          |
| New bot, New group                       | Chats header ✎                                     | Chats header ✎                |
| Inbox row                                | Home (feed + search)                               | Home tab                      |
| Search row / footer search, ⌘K           | 🔍 in each section header; ⌘K                      | 🔍 in each tab header         |
| Automations row                          | Rail Schedules / Lịch                              | Lịch tab                      |
| Connectors row                           | Rail Connectors                                    | More → Connectors             |
| Plugin header/footer rows                | Rail entries (user order)                          | More entries                  |
| Pinned section                           | Pinned rows float in Chats/Work; Home pin tags     | same                          |
| Bots, Group chats sections               | Chats list                                         | Chats tab                     |
| Projects section, display menu, view bar | Work list and its filter row                       | Work tab                      |
| Usage (opt-in)                           | Rail bottom when enabled                           | More → Usage                  |
| Hosts + dot (host picker)                | Rail bottom Hosts, same picker                     | More → Hosts, dot on More tab |
| Help menu                                | Rail bottom Help                                   | More → Help                   |
| Settings                                 | Rail bottom, last                                  | More → Settings / Cài đặt     |
| Account / Hub top row                    | Settings → Hub (unchanged)                         | Settings                      |

## For me / Others / All

`resolveOwnership({ createdBy, accounts, watched })` returns `mine` or `others`:

- No author, or a non-user author (automation, system): **mine** (provisional, brief 1.3).
- A user author whose Hub has no signed-in account on this device: **mine** — the app cannot tell.
- A user author matching the signed-in account of that Hub (`isOwnActor`): **mine**.
- Any other user author: **others**.
- `watched === true` (Round 2) makes anything **mine**; the predicate already takes the input.

Authors come from data available today: a workspace's `createdBy` for work sessions and agents in
them, a Chat's `createdBy` for bot DMs and groups (falling back to the agent's workspace), a Bot's
`owner` for a Bot row without a chat. Every list, chip, pin tag, count and badge applies the
scope before anything else, so another member's failure never reaches For me (C15). Gaps: Hosts
older than the authorship feature send no `createdBy`, so everything on them is For me; a
session started from a channel records the channel identity, which matches the reader only when
its verified `memberId` is present.

## Home mode

Chat = agents with a bot label (`clisbot.bot-id`) and Chats rows; Work = everything else (projects
and Quick chats), the same split as the daemon's Inbox Type filter. The mode applies to the feed,
issue cards, pin tags and counts on Home only. The composer keeps one draft per start target, so
switching mode never touches a draft.

## Failure and needs-action lifecycle (3.1c)

The daemon already records unread attention per agent (`requiresAttention`, `attentionReason`,
`attentionTimestamp`); opening a session clears it. That is the existing seen signal and stays the
source. The device adds one persisted store per principal (`navigation/issue-store.ts`, the same
scope key as resource pins) for what the daemon cannot hold per user: Dismiss, Mark as seen
without opening, Mark unread, and when an item was seen.

- **Occurrence id**: `attentionTimestamp` of the failure or permission request, captured the first
  time the device sees it. The daemon clears that timestamp when the session is opened, so the
  store keeps the last occurrence per session. A new failure or request sets a new timestamp, so a
  dismissed session resurfaces as Unseen. Limits: a failure the device never observed before it was
  opened elsewhere has no captured occurrence; it is keyed `seen@<lastActivityAt>` and treated as
  seen. Attention is per agent on the Host, so opening the session on any device or by another
  member also counts as seen.
- **States**: Unseen (counted in the Home badge, Needs/Failed chips, shown in the feed) → Seen
  (opened, or Mark as seen; collapses into "Seen issues (n)" at the bottom of the feed; dimmed below
  unseen ones in the Failed chip) → gone from Failed when the session recovers or runs again,
  Dismiss, Archive, or 7 days after it was seen. Mark unread returns Seen to Unseen.
- **Needs action** (pending permission): stays in Needs me while the daemon still reports a pending
  request; seen ones stop counting in the badge; Dismiss hides a stale one until a new request.
- **Actions** on a failed row: Open · Reload · Dismiss · Archive. There is no "re-run the failed
  turn" RPC. Reload is the existing `refresh_agent_request` (the workspace tab menu's Reload agent):
  it reattaches a persisted provider session so the user can continue. It is offered only when the
  agent has a persistence handle; otherwise the row offers Open only.

## Not in Round 1

Watch/Unwatch and Following; cross-device sync of seen/dismissed; offline outbox, tiered cache and
Storage; real Tasks; Notes, Design, Files; calendar inside Lịch; split DM/Group lists in Chats.
