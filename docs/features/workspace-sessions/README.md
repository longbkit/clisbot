# Workspace sessions in the sidebar

**Shipped 2026-09-15, off by default. Not yet checked in a running app — see [What is not done yet](#what-is-not-done-yet).**

Lists a workspace's sessions under its sidebar row, so opening one takes a single press. Without it, you open the workspace first and then pick a tab, and with many sessions the tab bar truncates their titles.

The terms are in the [glossary](../../glossary.md) under **Workspace sessions**.

## Use cases

| Need                                                    | Outcome                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| Jump straight to a session in another workspace         | Press its line. The workspace and that session's tab open together. |
| A workspace with many sessions whose tab titles are cut | Each session gets a full-width line with its title.                 |
| See which sessions need you across every workspace      | **Always expanded** plus **Active sessions only**.                  |
| Keep the sidebar short                                  | **Auto collapse**: only the selected workspace lists its sessions.  |
| Know who started a session, from which channel, when    | Tick those items in the details group of the same menu.             |

## Settings

Everything lives on one page, **Show → Workspace sessions** in the sidebar's display preferences, in four groups split by separators: the switch, expansion, Active sessions only, and the details a line shows. There is no deeper submenu.

| Item                 | Values                                                                                 | Default       |
| -------------------- | -------------------------------------------------------------------------------------- | ------------- |
| Show sessions        | on / off. Off draws the sidebar exactly as upstream Paseo.                             | off           |
| Expansion            | Auto collapse / Keep as is / Always expanded                                           | Auto collapse |
| Active sessions only | on / off                                                                               | off           |
| Details (last group) | Model, Created user, Updated user, Channels, Created time, Updated time, Last activity | Last activity |

- **Auto collapse** opens the selected workspace and closes it when you select another. Outside a workspace route (Settings, for example) nothing is selected, so every workspace is closed.
- **Keep as is** puts a chevron under the workspace's status mark, in the same column. It is hidden when the workspace has no session. Which workspaces are open is remembered per device (`sidebar-workspace-sessions-expansion`), not synced.
- **Active sessions only** hides sessions in the `done` status bucket — no status mark on their icon. Running, needs-input, failed and unread (`attention`) sessions stay. The chevron ignores the filter, so it does not flicker as sessions go idle and busy.
- Changing expansion, Active sessions only, or details while sessions are hidden is kept for when you turn them back on.

Everything except the per-device open state is stored in `AppSettings.sidebarWorkspaceSessions`.

### Which details a session line offers

Only facts that differ from one session to the next. Anything that comes from the workspace would repeat the row above on every line, so it is not offered:

| Offered for a session                                     | Not offered — the workspace row already shows it                  |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Model                                                     | Branch, Project, Host                                             |
| Created user, Updated user, Channels (session authorship) | Pull request, Checks, Services, Diff stats                        |
| Created time, Updated time (authorship), Last activity    | Labels (a workspace property), title source (a workspace setting) |

User, channel, Updated time and the metadata status only appear on hosts that can read session storage. Model, Created time and Last activity come from the agent record and show on any host. The items are drawn by the same component as the workspace row (`SessionMetadataLine`), so they look and behave the same.

## Behavior

| Topic          | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which sessions | Unarchived root agents of the workspace, the same set its tab bar opens by default. Subagents are not listed. Creation order, so a line does not move while you reach for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Status         | The agent tab's own rule: a message the provider has not acknowledged yet already counts as running. The sidebar and the tab never disagree, and Active sessions only never hides the session you just messaged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Press          | `navigateToAgent`. Opens the workspace and reveals the tab, including one you closed earlier. On a compact screen it also closes the sidebar, like a workspace press does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Selected       | One fill marks where you are. The session in the focused pane gets the selected-row fill and a medium-weight title, and its workspace row gives up its own fill (`useWorkspaceRowSelectionFill`). When the focused tab has no line — a terminal, a file, a session hidden by Active sessions only, or a collapsed workspace — the workspace row keeps the fill as upstream does. Sessions showing in the other panes of a split keep full-strength titles without a fill. The match reads each pane's tab **target**, so a draft tab that became a session still marks its line. Screen readers still hear both the workspace row and its session line as selected; only the fill moves. |
| Grouping       | Project and Status grouping, including Pinned. Session lines are indented to start under the workspace title in every mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Design decisions

- **A session line is the workspace row's sibling, not its child.** Nesting it inside the row's press target would make a session press also select, drag, or open the context menu of the workspace. The one exception is the chevron. It sits inside the row, and its own Pressable takes the tap; a drag needs 6pt of movement first, so a tap cannot start one.
- **The chevron goes under the status mark, not in place of it on hover.** Touch has no hover, and a hover swap would hide the status right when you point at the row.
- **Feature-flagged by the Show sessions switch, and scoped to `packages/app/src/clisbot/workspace-sessions/`.** Upstream files gain a menu entry, a leading-column wrapper, a sibling render in the two list files, one settings field, and the tab-label helper moved into `panels/agent-tab-label.ts` so the tab and the sidebar share it.
- **Subscriptions stay narrow.** With the switch off, a row reads one setting and one expansion key and mounts nothing else. Under Keep as is, the chevron reads only the `agents` map. An open row reads only `agents` and `messageSubmissions`; both are replaced only when an agent or a submission changes, so other session-store updates, such as timeline items, do not re-run the list. The selected row's fill check looks up one agent inside the store selector and returns a boolean, so the upstream row re-renders only when the answer flips.

## What is not done yet

| Gap                                 | Notes                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Checked in a running app            | Unit-tested and typechecked only. The dev daemon requires Hub access, so the web UI was not driven.                   |
| Translations                        | Menu labels are English strings, like the other Clisbot display items. The untitled fallback uses the tab's i18n key. |
| A cap per workspace                 | Every session is listed. Use Active sessions only to keep long lists short.                                           |
| Tab order                           | Lines follow creation order, not a tab order you rearranged by hand.                                                  |
| Keyboard shortcut to open a session | Not added.                                                                                                            |

## Code

| Piece                                  | File                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Setting shape, defaults, schema        | [`preferences.ts`](../../../packages/app/src/clisbot/workspace-sessions/preferences.ts)         |
| Which sessions and their status        | [`select-sessions.ts`](../../../packages/app/src/clisbot/workspace-sessions/select-sessions.ts) |
| Which agents the panes are showing     | [`shown-agents.ts`](../../../packages/app/src/clisbot/workspace-sessions/shown-agents.ts)       |
| Hooks: preference, expansion, row fill | [`model.ts`](../../../packages/app/src/clisbot/workspace-sessions/model.ts)                     |
| Session lines                          | [`session-list.tsx`](../../../packages/app/src/clisbot/workspace-sessions/session-list.tsx)     |
| Chevron                                | [`expand-toggle.tsx`](../../../packages/app/src/clisbot/workspace-sessions/expand-toggle.tsx)   |
| Menu pages                             | [`menu-page.tsx`](../../../packages/app/src/clisbot/workspace-sessions/menu-page.tsx)           |
| Per-device open state                  | [`expansion-store.ts`](../../../packages/app/src/clisbot/workspace-sessions/expansion-store.ts) |

Session authorship — who created a session, its channels — is stored by [Agent session storage](../agent-session-storage/README.md).
