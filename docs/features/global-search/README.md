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
  "Show in Work" (the row's arrow button, ⌘/Ctrl+Enter, or long-press) sets the view filter to
  that scope and offers Undo (R2, R4).
- **Item** (workspace, session, file, command) — Enter or tap opens it. Opening an item outside the
  view filter publishes a reveal signal; the list shows the notice, the filter stays (R3).

## Matching

| Result            | Matched on                                                       | Notes                                                                                                                    |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Host              | label, Hub name, connection hostname / SSH host, Hub daemon slug | Case- and diacritics-insensitive (`đ`→`d`). Duplicate labels show the Hub (or "Direct"), then a short id if still equal. |
| Hub               | organization name / profile label                                | Only Hubs with at least one Host you can see. Chip shows the Host count: "Company (92)".                                 |
| Project (merged)  | project name, custom name, repo folder name                      | One row per name across Hosts: "on 4 Hosts · 12 sessions".                                                               |
| Project on a Host | project name **and** Host label                                  | Shown under the merged row when a query word matched a Host label, or when the project is on 2–3 Hosts. Adds two chips.  |

Projects show before Hosts, both above Workspaces and Sessions, at most 6 rows each. Matching is
the shared `scoreTextFields` ranker on folded text, so token order does not matter.

Permissions: candidates come from `useAvailableHosts()` — the same inventory the Home strip and
Settings use — so a Host a Hub stopped listing, or one whose access was revoked, disappears from
search with it.

## Case table

Each row is a test in `packages/app/src/clisbot/search-scope/cases.test.ts`.

| #   | State before                          | Input / action                          | Results                                                                                                                                         | Selection → resulting scope                                                     |
| --- | ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | No chips                              | type `sandbox-12`                       | Hosts: sandbox-12 (status, Hub, sessions)                                                                                                       | Enter → chip [sandbox-12]; query clears; items narrow to that Host              |
| 2   | No chips                              | type `clisbot` (on local + 3 sandboxes) | Projects: "clisbot · on 4 Hosts"                                                                                                                | Enter → chip [clisbot]; sessions of clisbot on all 4 Hosts                      |
| 3   | No chips                              | type `clisbot sandbox-12`               | "clisbot · on 4 Hosts", then "clisbot on sandbox-12"                                                                                            | Enter on the second → chips [sandbox-12] [clisbot]                              |
| 4   | Two Hosts both labelled `build`       | type `build`                            | Two rows, subtitles "Company · …" and "Direct · …" (short id if the Hub also matches)                                                           | Each adds its own serverId                                                      |
| 5   | Chip [Host B]                         | type `anyapp` (only on Host A)          | Suggestions first, then "No 'anyapp' in Host B" · Remove Host filter (+ Remove Project filter · Search everywhere when both dimensions are set) | Remove → chip dropped, query kept; Search everywhere → all chips dropped        |
| 6   | Chip [clisbot]                        | type `release`                          | Sessions/workspaces named release inside clisbot on every Host                                                                                  | —                                                                               |
| 7   | Chip [Company] (Hub)                  | empty input                             | Recent / active / needs-action items on the Hub's Hosts, plus up to 5 project suggestions                                                       | —                                                                               |
| 8   | Chip [sandbox-12]                     | empty input                             | Projects on sandbox-12 as suggestions, recent items on it                                                                                       | Enter on a project → adds chip                                                  |
| 9   | Chip [clisbot]                        | type `sand`                             | Hosts; those without clisbot are labelled "No clisbot"                                                                                          | Enter → adds Host chip (AND)                                                    |
| 10  | Chip [Host A]                         | Enter on Host B                         | Both chips (OR within the Host set)                                                                                                             | —                                                                               |
| 11  | Host offline                          | type its project                        | Rows from cache labelled "Offline · cached 10:42"; online rows unaffected                                                                       | Host chip on an offline Host shows the same label in its subtitle               |
| 12  | View filter Host A, no chips          | type `clisbot`                          | Items on A first; others labelled "Outside filter"; suggestion chip "Only current filter (Host A)"                                              | Tap suggestion → chips [Host A]                                                 |
| 13  | View filter Host A                    | Enter on a session on Host B            | Opens it; filter kept; reveal signal `{ serverId: B, reason: "host" }`                                                                          | List pane shows "Outside your filter · Show all · Switch to Host B"             |
| 14  | Any                                   | "Show in Work" on "clisbot on Host B"   | —                                                                                                                                               | View filter = Host B + Project clisbot; Undo toast restores the previous filter |
| 15  | Chips                                 | Backspace on empty input                | —                                                                                                                                               | Last chip removed                                                               |
| 16  | Chips                                 | Clear (×)                               | —                                                                                                                                               | All chips removed                                                               |
| 17  | Chips                                 | Esc / close, reopen after 3 s           | Chips restored                                                                                                                                  | Reopen after 10 s: no chips                                                     |
| 18  | `files` scope (workspace file search) | type                                    | Scope rows hidden; file search unchanged                                                                                                        | —                                                                               |

## Contract case table → tests

| Rules row (rules.md)                    | Unit (`cases.test.ts`) | Real app (`e2e/browser/global-search-scope.spec.ts`)       |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| View filter Host A, type "clisbot"      | 2, 12                  | "a view filter ranks and labels…"                          |
| Enter on a session from Host B          | 13                     | — (notice rendering belongs to the V2 Work pane)           |
| "Show in Work" on clisbot @ B           | 14                     | "Show in Work replaces the sidebar Host filter…"           |
| No filters, "sandbox-12", Enter on Host | 1                      | "a Host chip with a project it lacks…"                     |
| Chip [Host B], "anyapp"                 | 5                      | "a Host chip with a project it lacks…"                     |
| Chip [Project clisbot], "release"       | 6                      | "a project on two Hosts is one row…"                       |
| Chip [Company Hub], empty input         | 7                      | browser harness (`search-scope.browser.test.tsx`, Hub row) |
| Hub offline, type a project name        | 11                     | "the offline Host stays searchable…"                       |
| Scope For me, Enter on Others item      | not on `main`          | — API only: `OutsideFilterReveal.reason = "others"`        |

## Deviations from rules.md

- **Empty state with one dimension** offers only "Remove Host filter" (or "Remove Project
  filter"). With one dimension it does exactly what "Search everywhere" would, and the acceptance
  standard (V8) forbids two controls for one job. With both dimensions all three rows show.
- **Empty state placement.** Below the Host / Project suggestions, so Enter takes the suggestion
  the user just typed rather than "Remove filter" (R6: suggestions still appear for typed text).

## Choices the rules left open

- **Commands and files while chips are active.** Hidden. They do not live on a Host or Project,
  so showing them inside a scope would contradict the chip.
- **For me / Others.** Not on `main`. The ranking input (`SearchViewContext`) has no mine/others
  field yet; Navigation V2 adds it next to `hosts` and `projects` and the same partition applies.
- **Secondary action key.** ⌘/Ctrl+Enter, matching "open in background" conventions; → stays
  caret movement. Phones use the row's arrow button (always visible on touch) or long-press.
- **When a Host counts as offline.** As the Home strip judges it: online, or connecting until the
  first attempt stalls (15 s) or reports an error, then offline. A slow tick re-judges waiting
  Hosts while search is open, so a dead Host turns Offline without a keystroke.
- **Agents' project.** From the agent's workspace, else its project placement, else the Host
  project whose repo root contains its `cwd`.

## Integration API for the Work list (Navigation V2)

`packages/app/src/clisbot/search-scope/work-navigation.ts`:

- `setSearchViewContext(context | null)` — the section that opens search publishes its current
  view filter (`{ label, hosts, projectNames }`). When nothing is published, search reads the
  sidebar filters on `main`.
- `setOpenInWorkHandler(handler)` — replaces the default "Show in Work" (on `main`: replace the
  sidebar Host and/or Project filter, open the sidebar). The handler receives
  `{ serverIds, projectNames, projectViewKeys }` and must return an undo function; search shows
  the Undo toast. Replace only the dimensions the target names (R4).
- `useOutsideFilterReveal()` / `dismissOutsideFilterReveal()` — the reveal signal. The Work list
  renders, while it is set: one slim notice row above the list, "This session is outside your
  filter" (or "Shown from Others"), with **Show all** (clear the conflicting dimension) and
  **Switch to {Host}** (replace it). Nothing on `main` renders it yet.

## Performance

Catalog (Hosts, Hubs, Projects, agent→project index) is built once per open and per directory
change, never per keystroke. Per keystroke: Hosts + Hubs + merged projects are scored, item rows
are filtered by two `Set` lookups. Numbers and method: [verification.md](verification.md).
