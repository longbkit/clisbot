# Global Search — Filter vs Jump Rules

- Date: 2026-10-25 · Status: Atlas recommendation applied to the global-search lane; Owner may override any rule.
- Context: Owner asked whether selecting a Host/Project should filter or jump, and how search interacts with an active Host filter (e.g. filtered to Host A, searching a project on Host B).

## Two separate concepts

|            | Search scope chips                              | View filters                                                     |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Where      | Inside the search box (⌘K / 🔍)                 | Chats / Work display & filter row, Home Host filter              |
| Lifetime   | Only while search is open                       | Persistent user setup                                            |
| Changed by | Selecting a Host/Project result, Tab, Backspace | The filter row, or an explicit "Show in Work" action (with Undo) |

Search never silently changes view filters; view filters never silently hide search results.

## R1. Global search is global

- Search covers everything the user is permitted to see, regardless of the current section, view filter, For me/Others/All scope or Home mode.
- Ranking: matches inside the current view filter and For me rank first; others are labeled, e.g. "Host B · outside current filter", "Others", "Archived", "Offline · cached 10:42".
- So when filtered to Host A, searching a project on Host B **does find it**, labeled.
- When opened from a filtered section, one suggestion chip "Only current filter (Host A)" is offered, **off by default**. One tap turns it into real scope chips.

## R2. Containers filter, items jump

- **Containers** (Host, Hub, Project): primary action (Enter / tap) = **add as a scope chip** and keep searching inside it. Secondary action (→ / long-press / row button) = **"Show in Work"**: navigate to Work and set the view filter to exactly that scope.
- **Items** (session, chat, workspace, file, command): primary action = **jump (open)**.

## R3. Jumping to an item outside the current view filter

- Open the item. **Do not remove Host A and do not auto-apply Host B.**
- The list pane keeps Host A and shows a slim notice: "This session is outside your filter · Show all · Switch to Host B". The user decides with one tap.
- Same rule for For me/Others/All: opening an Others item does not switch scope; notice "Shown from Others".

## R4. "Show in Work" (explicit filter change)

- Replaces the conflicting dimension with exactly the selected scope: Host A → Host B, or Project = X.
- Shows an Undo toast that restores the previous filters.
- Never additive by surprise. If the user wants A + B, they build it in the filter row.

## R5. Chip semantics

- Two dimensions: **Host set** and **Project-name set**. OR within a dimension, AND across dimensions.
- Project with the same name on several Hosts appears once ("clisbot · on 4 hosts"). Selecting it adds a Project chip only, matching all Hosts unless a Host chip exists.
- A Host-specific project entry (secondary row) adds **two chips**, Host + Project. There is no hidden combined chip, so later edits stay understandable.
- Hub chip = Host set expanded to all that Hub's sandboxes, displayed as one chip "Company Hub (92)".
- Typing after chips searches inside the scope. Backspace on an empty input removes the last chip. Clear-all removes every chip.
- Chips reset when search closes. Exception: reopening within a few seconds restores them.

## R6. Results while chips are active

- Host/Project suggestions still appear for the typed text. Out-of-scope ones are labeled; selecting one adds or replaces per R5.
- A Host chip + Project not on that Host gives an empty state: "No 'clisbot' on Host B · Remove Host filter · Search everywhere".
- An empty query with chips shows recent / active / needs-action items in that scope.

## R7. Sources and safety

- Offline/unreachable Hosts are searchable from cache and labeled stale. They never block or delay results from reachable Hosts; results stream in per source without reordering the highlighted row.
- Only Hosts/projects/sessions the user is permitted to see. Revoked sources disappear.
- Duplicate Host display names are disambiguated by Hub, kind or short id.

## Case table

| State before            | Input / action                        | Result                                                                                      |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Work view filter Host A | ⌘K, type "clisbot"                    | Project "clisbot · on 3 hosts" (A first); sessions on A first, B/C labeled "outside filter" |
| same                    | Enter on session from Host B          | Opens it; list keeps Host A + notice "Show all / Switch to Host B"                          |
| same                    | "Show in Work" on project clisbot @ B | Work filter = Host B + Project clisbot; Undo toast restores Host A                          |
| no filters              | type "sandbox-12", Enter on Host      | Chip [sandbox-12]; results narrow; keep typing                                              |
| chip [Host B]           | type "anyapp" (only on A)             | Empty state: remove Host filter / search everywhere                                         |
| chip [Project clisbot]  | type "release"                        | Sessions named release in clisbot on all hosts                                              |
| chip [Company Hub]      | empty input                           | Recent / active / needs-action in all Hub sandboxes                                         |
| Hub offline             | type a project name                   | Cached results labeled "offline · cached HH:MM"; reachable results unaffected               |
| scope For me            | Enter on Others item                  | Opens it; scope unchanged; notice "Shown from Others"                                       |
