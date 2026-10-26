# Global search: Host, Hub and Project scope

CURRENT — `feat/global-search-host-project-filters`, 2026-10-25. Contract: [Filter vs Jump Rules](rules.md) (Atlas, R1–R7, copied
from the CTO workspace on 2026-10-25). This page records how the app implements those rules and the choices the rules
left open.

Global search is the Command Center (`packages/app/src/command-center/`, upstream code). The
Clisbot scope layer lives in `packages/app/src/clisbot/search-scope/` and is switched off with
`EXPO_PUBLIC_CLISBOT_SEARCH_SCOPE=0`, which restores upstream search exactly.

## Concepts

- **Scope chip** — a filter inside the search box. Two dimensions: the **Host set** (Host chips
  and Hub chips) and the **Project set** (Project chips, keyed by project name). OR within a
  dimension, AND across. Chips live while search is open; reopening within 10 s restores them.
- **View filter** — the persistent list filter (on `main`: the sidebar's Host and Project filters;
  in Navigation V2: the Work/Chats filter row). Search never changes it silently and it never hides
  search results (R1). It only ranks: rows inside it come first, the rest carry "Outside filter".
- **Container** (Host, Hub, Project) — Enter, Tab or tap adds a chip and clears the typed text.
  "Show in Workspace" (the row's arrow button, ⌘/Ctrl+Enter, or long-press) sets the view filter to
  that scope and offers Undo (R2, R4).
- **Item** (workspace, session, file, command) — Enter or tap opens it. Opening an item outside the
  view filter publishes a reveal signal; the list shows the notice, the filter stays (R3).

## Matching

| Result            | Matched on                                                       | Notes                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host              | label, Hub name, connection hostname / SSH host, Hub daemon slug | Case- and diacritics-insensitive (`đ`→`d`). Duplicate labels show the Hub (or "Direct"), then a short id if still equal.                                                             |
| Hub               | organization name / profile label                                | Every Hub you are signed in to. Chip shows the Host count: "Company (92)". A Hub with no Host you can see is listed with "Signed in · no Host shared with you yet" and adds no chip. |
| Project (merged)  | project name, custom name, repo folder name                      | One row per name across Hosts: "on 4 Hosts · 12 sessions".                                                                                                                           |
| Project on a Host | project name **and** Host label                                  | Shown under the merged row when a query word matched a Host label, or when the project is on 2–3 Hosts. Adds two chips.                                                              |

Projects show before Hosts, both above Workspaces and Sessions, at most 6 rows each. Matching is
the shared `scoreTextFields` ranker on folded text, so token order does not matter.

Permissions: candidates come from `useAvailableHosts()` — the same inventory the Home strip and
Settings use — so a Host a Hub stopped listing, or one whose access was revoked, disappears from
search with it.

## Case table

Each row is a test in `packages/app/src/clisbot/search-scope/cases.test.ts`.

| #   | State before                          | Input / action                             | Results                                                                                                                                         | Selection → resulting scope                                                     |
| --- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | No chips                              | type `sandbox-12`                          | Hosts: sandbox-12 (status, Hub, sessions)                                                                                                       | Enter → chip [sandbox-12]; query clears; items narrow to that Host              |
| 2   | No chips                              | type `clisbot` (on local + 3 sandboxes)    | Projects: "clisbot · on 4 Hosts"                                                                                                                | Enter → chip [clisbot]; sessions of clisbot on all 4 Hosts                      |
| 3   | No chips                              | type `clisbot sandbox-12`                  | "clisbot · on 4 Hosts", then "clisbot on sandbox-12"                                                                                            | Enter on the second → chips [sandbox-12] [clisbot]                              |
| 4   | Two Hosts both labelled `build`       | type `build`                               | Two rows, subtitles "Company · …" and "Direct · …" (short id if the Hub also matches)                                                           | Each adds its own serverId                                                      |
| 5   | Chip [Host B]                         | type `anyapp` (only on Host A)             | Suggestions first, then "No 'anyapp' in Host B" · Remove Host filter (+ Remove Project filter · Search everywhere when both dimensions are set) | Remove → chip dropped, query kept; Search everywhere → all chips dropped        |
| 6   | Chip [clisbot]                        | type `release`                             | Sessions/workspaces named release inside clisbot on every Host                                                                                  | —                                                                               |
| 7   | Chip [Company] (Hub)                  | empty input                                | Recent / active / needs-action items on the Hub's Hosts, plus up to 5 project suggestions                                                       | —                                                                               |
| 8   | Chip [sandbox-12]                     | empty input                                | Projects on sandbox-12 as suggestions, recent items on it                                                                                       | Enter on a project → adds chip                                                  |
| 9   | Chip [clisbot]                        | type `sand`                                | Hosts; those without clisbot are labelled "No clisbot"                                                                                          | Enter → adds Host chip (AND)                                                    |
| 10  | Chip [Host A]                         | Enter on Host B                            | Both chips (OR within the Host set)                                                                                                             | —                                                                               |
| 11  | Host offline                          | type its project                           | Rows from cache labelled "Offline · cached 10:42"; online rows unaffected                                                                       | Host chip on an offline Host shows the same label in its subtitle               |
| 12  | View filter Host A, no chips          | type `clisbot`                             | Items on A first; others labelled "Outside filter"; suggestion chip "Only current filter (Host A)"                                              | Tap suggestion → chips [Host A]                                                 |
| 13  | View filter Host A                    | Enter on a session on Host B               | Opens it; filter kept; reveal signal `{ serverId: B, reason: "host" }`                                                                          | List pane shows "Outside your filter · Show all · Switch to Host B"             |
| 14  | Any                                   | "Show in Workspace" on "clisbot on Host B" | —                                                                                                                                               | View filter = Host B + Project clisbot; Undo toast restores the previous filter |
| 15  | Chips                                 | Backspace on empty input                   | —                                                                                                                                               | Last chip removed                                                               |
| 16  | Chips                                 | Clear (×)                                  | —                                                                                                                                               | All chips removed                                                               |
| 17  | Chips                                 | Esc / close, reopen after 3 s              | Chips restored                                                                                                                                  | Reopen after 10 s: no chips                                                     |
| 18  | `files` scope (workspace file search) | type                                       | Scope rows hidden; file search unchanged                                                                                                        | —                                                                               |

## Contract case table → tests

Unit: `cases.test.ts`, plus `navigation-v2.test.ts` and `navigation/outside-filter.test.ts` for
Navigation V2. Real app: `global-search-scope.spec.ts` (sidebar layout) and
`global-search-navigation-v2.spec.ts` (V2).

| Rules row (rules.md)                    | Unit                           | Real app                                                      |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| View filter Host A, type "clisbot"      | cases 2, 12; V2 For me ranking | "a view filter ranks and labels…"                             |
| Enter on a session from Host B          | case 13; outside-filter        | V2 "opening a session outside Workspace's Host filter…"       |
| "Show in Workspace" on clisbot @ B      | case 14                        | sidebar and V2 "Show in Workspace … Undo"                     |
| No filters, "sandbox-12", Enter on Host | case 1                         | "a Host chip with a project it lacks…"                        |
| Chip [Host B], "anyapp"                 | case 5                         | "a Host chip with a project it lacks…"                        |
| Chip [Project clisbot], "release"       | case 6                         | "a project on two Hosts is one row…"                          |
| Chip [Company Hub], empty input         | case 7                         | browser harness (`search-scope.browser.test.tsx`, Hub row)    |
| Hub offline, type a project name        | case 11                        | "the offline Host stays searchable…"                          |
| Scope For me, Enter on Others item      | V2 "publishes reason others"   | V2 "an Others item opens without changing For me…" (mock Hub) |

## Deviations from rules.md

- **Empty state with one dimension** offers only "Remove Host filter" (or "Remove Project
  filter"). With one dimension it does exactly what "Search everywhere" would, and the acceptance
  standard (V8) forbids two controls for one job. With both dimensions all three rows show.
- **Empty state placement.** Below the Host / Project suggestions, so Enter takes the suggestion
  the user just typed rather than "Remove filter" (R6: suggestions still appear for typed text).

## Choices the rules left open

- **Commands and files while chips are active.** Hidden. They do not live on a Host or Project,
  so showing them inside a scope would contradict the chip.
- **For me / Others.** Results rank in four bands: in the view and For me, in the view and Others,
  then the same two outside it. Others rows say "Others". A session's ownership is its own author
  (`createdBy`, else its workspace's), as in the Workspace list; a workspace's is its author's.
  Chats use Chats' rule, so a Bot's direct chat is its author's, else the Bot owner's.
- **A Hub with no visible Host.** Signed in, but none of its Hosts is listed for you (none yet, or
  none shared). Searching its name still finds it, with "Signed in · no Host shared with you yet" instead of a Host count,
  so the reader learns why its work is missing; it has nothing to scope, so it adds no chip.
- **Secondary action key.** ⌘/Ctrl+Enter, matching "open in background" conventions; → stays
  caret movement. Phones use the row's arrow button (always visible on touch) or long-press.
- **When a Host counts as offline.** As the Home strip judges it: online, or connecting until the
  first attempt stalls (15 s) or reports an error, then offline. A slow tick re-judges waiting
  Hosts while search is open, so a dead Host turns Offline without a keystroke.
- **Agents' project.** From the agent's workspace, else its project placement, else the Host
  project whose repo root contains its `cwd`.

## Navigation V2 wiring

The seam is `packages/app/src/clisbot/search-scope/work-navigation.ts`; Navigation V2 plugs into
it from `clisbot/navigation/search-integration.ts`, mounted with the V2 chrome.

- **Workspace's filter** is published with `setSearchViewContext({ serverIds, projectViewKeys,
ownership, suggest })`: Workspace's Host and Project filters (the sidebar's, which Workspace reads) and
  its For me / Others / All scope. "Only current filter" is offered only when search was opened
  from Workspace. Without Navigation V2 nothing is published and search reads the sidebar filters.
- **Show in Workspace** (`setOpenInWorkHandler`) replaces only the dimensions the target names, opens
  the V2 Workspace section and returns the Undo that restores both filters (R4).
- **The notice** (`navigation/outside-filter-notice.tsx`) sits above Workspace's and Chats' lists while
  `useOutsideFilterReveal()` names an item that list's filter still hides: "This workspace /
  session / chat is outside your filter" with **Show all** (clear only the hiding dimension) and
  **Switch to {Host or project}** (replace it), or "Shown from Others" with **Show all** (scope →
  All). Neither changes until the reader taps. It ends when the reader widens the filter some
  other way, dismisses it, or opens another item; list and Home pages keep it, because on a
  phone the list is the page the reader goes Back to.
- **Chats.** Bot and group-chat results publish their reveal just before opening
  (`willOpenBot` / `willOpenChat` in `bots/search/command-center-contributions.ts`), judged
  against Chats' own Host filter and scope at that moment.

## Performance

Catalog (Hosts, Hubs, Projects, agent→project index) is built once per open and per directory
change, never per keystroke. Per keystroke: Hosts + Hubs + merged projects are scored, item rows
are filtered by two `Set` lookups. Numbers and method: [verification.md](verification.md).
