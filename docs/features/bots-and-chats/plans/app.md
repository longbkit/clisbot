# Bots and Chats — app plan

Date: 2026-09-26. Area: `packages/app` (web, Electron, iOS, Android from one Expo codebase).
Decision record: [README](../README.md). Names `Bot`/`Chat` are provisional (README, Open).
Every path below is relative to `packages/app/src` unless it starts with `packages/`.

## Ground rules this plan follows

| Rule                                                             | Source                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fusion code lives in one folder, gated once, flag-off = upstream | CLAUDE.md "Upstream compatibility first"; README D10                                                                     |
| Route files are the only thing allowed in `src/app`              | docs/expo-router.md "App Directory"; `app/automations.tsx` is a 3-line re-export of `clisbot/hub/automations-screen.tsx` |
| A layout registers only its direct children                      | docs/expo-router.md "Ownership"; host leaves are listed in `app/h/[serverId]/_layout.tsx:41-50`                          |
| Forms use a plain TS model + one `useSyncExternalStore`          | docs/forms.md; golden example `schedules/schedule-form-model.ts`, `components/schedules/schedule-form-sheet.tsx:266-268` |
| Hover: plain `View` tracks, inner `Pressable` presses            | docs/hover.md; `isHovered \|\| isNative \|\| isCompact` for kebabs (docs/design.md §12)                                  |
| Sidebar insertion mirrors Automations                            | `clisbot/hub/sidebar-nav-group.tsx` rendered at `components/left-sidebar.tsx:597` (mobile) and `:794` (desktop)          |
| Run vitest from `packages/app`                                   | memory `run-vitest-from-package-dir`                                                                                     |

Folder: `clisbot/bots/`. One folder for both resources because a Chat is a conversation with Bots,
the flag is `bots`, and the sidebar sections ship together. Subfolders: `data/` (client calls, query
owners, push subscriptions), `sidebar/`, `create/`, `chat/`, `bot/`, `routes.ts`, `feature.ts`.

## 1. Information architecture and sidebar

### What the user sees

```
┌ nav group ─────────────────┐   unchanged (New, Sessions, Schedules, Automations)
├ Chats ─────────────────────┤   fusion: recent chats, newest first, "show more" after 5
│  ● Research bot · 2m       │
│  ● Ops, Writer · 1h        │   group chat: participant names joined
├ Bots ──────────────────────┤   fusion: one row per bot, avatar + name + status dot
│  ◉ Research bot         ⋮  │
│  + New bot  [ type a name ]│   create-by-name: text row, Enter opens the create sheet
├ Pinned / Workspaces ───────┤   upstream, bot Projects hidden
```

Pressing a bot row opens (or creates) the direct chat with that bot. The bot page (settings,
sessions, sharing) is behind the row's kebab and the chat header, not the row press — the row
press is the Grok gesture.

### How the sidebar composes today

| Piece                                      | File                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Projects/workspaces list model             | `hooks/use-sidebar-workspaces-list.ts:102-208` (`useHostProjects` → `buildSidebarWorkspacePlacementModel`, `:149-157`)   |
| Filters, grouping, projection              | `components/sidebar/sidebar-model.tsx:57+` (provider), `components/sidebar/sidebar-projection.ts:48`                     |
| The scroll list and its sections           | `components/sidebar-workspace-list.tsx:2446-2492` — Pinned, then `listHeaderComponent` (gated at `:2483-2491`), projects |
| Header/footer slots the list already takes | `listFooterComponent`/`listHeaderComponent` props, `components/sidebar-workspace-list.tsx:234-237`                       |
| Left sidebar passes the header             | `components/left-sidebar.tsx:641` (mobile) and `:817` (desktop), stable element at `:869`                                |
| Fusion nav group                           | `clisbot/hub/sidebar-nav-group.tsx` (wrapper owned there because `SidebarNavRows` returns null when all hidden)          |
| Fusion sibling rows under a workspace row  | `clisbot/workspace-sessions/session-list.tsx` — the template for a fusion sidebar row (hover, selected fill, tooltip)    |

`listHeaderComponent` is not usable for the sections: it is hidden when there are no unpinned
projects and no filter (`sidebar-workspace-list.tsx:2483-2491`), which is exactly a fresh install
with only bots (bot Projects are filtered out, §3).

### Upstream insertion points (the whole upstream diff for the sidebar)

| #   | File:line                                   | Change                                                                                                                                                        |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `components/sidebar-workspace-list.tsx:234` | Add `listLeadingComponent?: ReactElement \| null` beside `listFooterComponent`; render it first inside `content` (`:2446`, above the Pinned section)          |
| 2   | `components/left-sidebar.tsx:641`, `:817`   | Pass `listLeadingComponent={<BotsAndChatsSidebarSections onBeforeNavigate={closeSidebar} />}` (mobile) / without the callback (desktop), memoized like `:869` |
| 3   | `hooks/use-sidebar-workspaces-list.ts:152`  | `projects: hideBotProjects(hostProjects, botProjectIds)` — one call into `clisbot/bots/sidebar/hide-bot-projects.ts` (§3)                                     |

With the flag off `BotsAndChatsSidebarSections` returns `null` before subscribing to anything
(same shape as `AutomationSidebarItem` returning null on `!hub.enabled`), and `hideBotProjects`
returns its input identity when the bot set is empty, so the list re-renders nothing new.

Why a new prop rather than the nav group: the nav group (`sidebar-nav-group.tsx`) is a fixed row
set above the scroll; bot and chat rows grow without bound and must scroll with the list. Why
above Pinned: Grok's sidebar leads with chats; pinned workspaces are the developer's mode.

### Fusion files

| File                                        | Responsibility                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/bots/sidebar/sections.tsx`         | `BotsAndChatsSidebarSections`: reads `useBotsFeatureHosts()` (§3); renders `ChatsSection` then `BotsSection`; null when no host has the feature                           |
| `clisbot/bots/sidebar/chats-section.tsx`    | Recent chats from `useAggregatedChats()`; cap with `useLimitedSidebarGroup` + `SidebarGroupToggleRow` (`components/sidebar/use-limited-sidebar-group.ts`)                 |
| `clisbot/bots/sidebar/bots-section.tsx`     | Bot rows from `useAggregatedBots()` + the `NewBotRow`                                                                                                                     |
| `clisbot/bots/sidebar/row.tsx`              | One row component for both sections: leading visual, title, trailing time/status, kebab. Copy the hover/selected shape from `clisbot/workspace-sessions/session-list.tsx` |
| `clisbot/bots/sidebar/new-bot-row.tsx`      | "+ New bot" row; on press becomes an `EditingTextInput`-backed `FormTextInput`; Enter/blur-with-text opens the create sheet (§5) with the name                            |
| `clisbot/bots/sidebar/section-header.tsx`   | Section label; same geometry as `components/sidebar/pinned-section-header.tsx` (reuse it if its props allow a label, else copy)                                           |
| `clisbot/bots/sidebar/hide-bot-projects.ts` | Pure: `hideBotProjects(projects, botProjectIds: ReadonlySet<`${serverId}:${projectId}`>)`                                                                                 |
| `clisbot/bots/sidebar/bot-status.ts`        | Pure: status bucket for a bot = worst of its unarchived agents in the bot workspace (reuse `utils/sidebar-agent-state` buckets)                                           |

Selected fill: the chat row whose route is current (`usePathname()` matched by `routes.ts`) gets
`surface2` (docs/design.md §12), the same rule the workspace row uses; no fill moves elsewhere.

Host labels: when more than one host has bots, rows show the host name as the workspace rows do
(`shouldShowSidebarHostLabels`, `hooks/use-sidebar-workspaces-list.ts`).

## 2. Routes

### Where routes live

`app/` (Expo Router directory). Host leaves are owned by `app/h/[serverId]/_layout.tsx:41-50`.
The chrome predicate `app/_layout.tsx:875-881` already enables app chrome for any
`/h/<knownHost>/…` path (`routeHasKnownHost`), so unlike `/automations` (`:879`) no predicate
change is needed. The root stack (`:905-926`) is untouched.

### New routes

| Route                         | File                                 | Screen                              |
| ----------------------------- | ------------------------------------ | ----------------------------------- |
| `/h/[serverId]/chat/[chatId]` | `app/h/[serverId]/chat/[chatId].tsx` | `clisbot/bots/chat/chat-screen.tsx` |
| `/h/[serverId]/bot/[botId]`   | `app/h/[serverId]/bot/[botId].tsx`   | `clisbot/bots/bot/bot-screen.tsx`   |

Each route file is the `app/automations.tsx` shape: import, `export default`. Register both in
the host layout with `<Stack.Screen name="chat/[chatId]" />` and `<Stack.Screen name="bot/[botId]" />`
(two lines at `app/h/[serverId]/_layout.tsx:41-50`). Wrap the screen content in
`HostRouteBootstrapBoundary` like `app/h/[serverId]/agent/[agentId].tsx:14-18`, and read the host
id with `useHostRouteServerId()` (`navigation/host-route-context.tsx:19`), never a global param.

Route builders live in `clisbot/bots/routes.ts` (`buildHostChatRoute`, `buildHostBotRoute`,
`parseChatRouteFromPathname`), built on `buildHostRootRoute` from `utils/host-routes.ts:399`.
`utils/host-routes.ts` is upstream and stays untouched.

### Startup and remembered workspace

- Root `/` still lands on `/h/[serverId]` and the host index (`app/h/[serverId]/index.tsx`)
  still restores the last workspace via `resolveHostIndexRoute`. Chats are not restored at
  startup in phase 1; a reload on `/h/x/chat/y` is a deep link and works as one.
- A chat route must not overwrite the remembered workspace. It cannot:
  `parseActiveWorkspaceSelection` only recognises `/h/:id/workspace/:id` paths
  (`stores/navigation-active-workspace-store/navigation.ts:74-86`) and returns null for anything
  else outside cold mount.
- "Open in cowork" calls `navigateToAgent({ serverId, agentId, workspaceId })`
  (`utils/navigate-to-agent/index.ts:8`), which remembers the workspace and reveals the tab;
  a bot with no session yet uses `navigateToWorkspace({ serverId, workspaceId })`
  (`stores/navigation-active-workspace-store/index.ts:62`). Back returns to the chat via
  `router.back()`; do not add a chat-aware branch to either helper.
- Nothing is added to `nestedNavigatorScreens`, `getId`, or `dangerouslySingular`
  (docs/expo-router.md "Native Stack").

Flag-off state of a route: the screen renders `HostFeatureUnavailable` ("This Host does not
offer bots") with Back — the same posture as `/automations` when Hub is disabled
(`clisbot/hub/automations-screen.tsx:19`). The two route files and two `Stack.Screen` lines exist
regardless of the flag; see Risks R1.

## 3. Feature gating

| Layer       | Code                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire        | `bots: z.boolean().optional()` in the `server_info` features object, `packages/protocol/src/messages.ts` next to `terminalProfileGrants` (`:3722-3727`), with `// COMPAT(clisbotBots): …` |
| Type        | `HostFeatureName` is derived from `DaemonServerInfo["features"]` (`runtime/host-features.ts:7`, `stores/session-store.ts:287`) — no app type change                                       |
| Per host    | `useHostFeature(serverId, "bots")` (`runtime/host-features.ts:33`); per host set `useHostFeatureMap(serverIds, "bots")` (`:41`)                                                           |
| Fusion gate | `clisbot/bots/feature.ts`: `useBotsFeatureHosts(): string[]` = hosts from `useAvailableHosts()` (`clisbot/hub/host-inventory.ts`) whose feature map is true                               |

Rules:

- Every fusion component starts with the gate and returns `null` (sidebar) or the unavailable
  state (screens) before any query or store subscription, so a flag-off host costs one selector.
- Queries (§6) are `enabled` only for feature hosts; a host that predates the flag is never asked.
- Hiding bot Projects: `hideBotProjects` (§1, insertion #3) removes a project when any of its
  `hosts[].projectId` (`projects/workspace-structure.ts:4-7`) matches a bot record's
  `projectId` on that `serverId`. Only the sidebar list is filtered. The New workspace picker and
  Settings › Projects keep showing bot Projects: Settings › Projects is where the Project grant
  for sharing lives (README D13), and the picker is how a developer opens the bot directory as a
  workspace. Revisit if the picker gets noisy (Open question O3).

## 4. Chat screen

### What exists to reuse

| Need                            | Reuse                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live items of a session         | `state.sessions[serverId].agentStreamTail.get(agentId)` (`panels/agent-panel.tsx:1391`; store `stores/session-store.ts:396`)                                                                                                                                                                    |
| Turn state                      | `selectAgentTurnPresentation(session, agentId)` (`panels/agent-panel.tsx:1400`)                                                                                                                                                                                                                 |
| Pending approvals per agent     | filter of `session.pendingPermissions` by `agentId` (`panels/agent-panel.tsx:1409-1433`); rendered by `renderPendingPermissionsNode` (`agent-stream/view.tsx:157`) and `QuestionFormCard` (`components/question-form-card.tsx:324`)                                                             |
| Keep a timeline live            | `viewedTimelineSync.replaceVisibleAgentIds(sourceId, agentIds)` (`timeline/viewed-timeline-sync.ts:364`) + `getHostRuntimeStore().prepareAgentTimeline(serverId, agentId)` (`runtime/host-runtime.ts:2624`), as the workspace screen does at `screens/workspace/workspace-screen.tsx:1946-1964` |
| Timeline status/retry           | `viewedTimelineSync.getAgentTimelineStatus/retryVisibleAgentTimeline` (`viewed-timeline-sync.ts:366-369`), `TimelineSyncStatus` (`timeline/sync-status.tsx`)                                                                                                                                    |
| Text rows                       | `UserMessage` (`components/message.tsx:604`, takes `sender`), `AssistantMessage` (`:1640`, takes `phase` for the paced reveal and `underSenderName`)                                                                                                                                            |
| Sender line and avatar          | `ActorResponseRow` (`clisbot/session-storage/actor-row.tsx`: `face`, `name`, `opensGroup`), used by `message.tsx:698`; `useMessageSender` (`:646`) for the user's own face                                                                                                                      |
| Tool calls                      | `ToolCall` (`components/message.tsx:3194`), `buildToolCallPresentation` (`tool-calls/presentation.ts`), `buildToolCallDisplayModel` (`utils/tool-call-display.ts`), sheet `components/tool-call-sheet.tsx`                                                                                      |
| Markdown block split, reveal    | `agent-stream/presentation.ts` (`getStreamItemMessageId`), `hooks/use-revealed-text.ts` (already inside `AssistantMessage`, `message.tsx:1663`)                                                                                                                                                 |
| Composer                        | `Composer` (`composer/index.tsx:940-1005`): `onSubmitMessage` replaces the agent send (`:1540`), `agentControls`, `inputMode`, `placeholder`; dictation is built in (`:84`, `:144`)                                                                                                             |
| Composer draft                  | `useAgentInputDraft({ draftKey })` (`composer/draft/input-draft.ts:42-45,69`): `draftKey` is any string (`composer/draft/input-draft-core.ts:9`), so `chat:${serverId}:${chatId}` works as-is                                                                                                   |
| Cowork view of the same session | `navigateToAgent` (§2)                                                                                                                                                                                                                                                                          |

`AgentStreamView` (`agent-stream/view.tsx:327-352`) is not reused as the list: it is one agent,
one history window, one bottom anchor, and its history paging reads that agent's own timeline.
A chat renders one transcript plus N live heads. The row components above are what it is made
of, and those are reused.

### Render model (pure, tested)

`clisbot/bots/chat/render-model.ts` — `buildChatRenderModel(input)`:

```
input:  transcript lines (oldest→newest, from the transcript store)
        participants: { botId, name, avatar, agentId | null }[]
        per agent: streamTail items, turn presentation, pending permissions
output: rows[] =
        | { kind: "user";   line }                                  ← UserMessage
        | { kind: "bot";    line, bot }                             ← ActorResponseRow + AssistantMessage(phase "complete")
        | { kind: "system"; line }                                  ← Notification
        | { kind: "live";   bot, items: StreamItem[], permissions } ← the bot's in-progress turn
```

Rules:

- A live head for a bot = its `agentStreamTail` items newer than the last transcript line that
  references that agent (`agentId` + timeline item id, README D5), while its turn is active or
  the tail still has unreferenced items. Assistant text in a live head renders with `phase:
"streaming"`; thoughts and tool calls render with `ToolCall` at the compact detail level;
  permissions render the same card the cowork view shows.
- When `chat.transcript.appended` delivers the bot's final line, the referenced items leave the
  live head. Dedupe is by referenced timeline item id, never by text.
- Group chat: consecutive rows from the same bot share one sender row (`opensGroup` on the
  first). The user's rows are right-aligned (`ActorResponseRow alignRight`), as in the cowork view.
- Nothing in the model reads React or the store; the screen feeds it from selectors.

### Screen composition

| File                                        | Responsibility                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/bots/chat/chat-screen.tsx`         | Gate → `HostRouteBootstrapBoundary` → header + list + composer. Under 100 lines; hooks below own the data                                                                                                                                                                                                                                                                              |
| `clisbot/bots/chat/use-chat.ts`             | Chat record (participants, rules) from `useChats(serverId)` (§6) + `chat.updated`                                                                                                                                                                                                                                                                                                      |
| `clisbot/bots/chat/use-chat-transcript.ts`  | Pages from `chat.transcript.fetch` (newest page first, older on reaching the top), appends from `chat.transcript.appended`; state in `transcript-store.ts` (zustand, keyed `${serverId}:${chatId}`)                                                                                                                                                                                    |
| `clisbot/bots/chat/select-chat-sessions.ts` | Pure: the agent per participating bot = unarchived agent in `session.agents` whose labels carry this chat and bot (label keys are the daemon plan's contract; README D2 "labels on the agent")                                                                                                                                                                                         |
| `clisbot/bots/chat/use-chat-sessions.ts`    | `acquireDirectoryDemand(serverId)` (as `hooks/use-sidebar-workspaces-list.ts:130`), then `prepareAgentTimeline` + `replaceVisibleAgentIds("chat:" + chatId, agentIds)` with release on unmount                                                                                                                                                                                         |
| `clisbot/bots/chat/chat-list.tsx`           | Inverted `FlatList` over `rows`, `maintainVisibleContentPosition`, scroll-to-bottom control; rows are the reused components. Uses `MessageOuterSpacingProvider` (`components/message.tsx:149`)                                                                                                                                                                                         |
| `clisbot/bots/chat/chat-header.tsx`         | `MenuHeader` (`components/headers/menu-header.tsx:15`) with title + participant faces; kebab (`DropdownMenu`): Add bot, Rename, Open in cowork (one item per bot), Delete chat (`confirmDialog`)                                                                                                                                                                                       |
| `clisbot/bots/chat/chat-composer.tsx`       | `Composer` with `onSubmitMessage` → `chatMessageSend`. Direct chat: `agentId`/`serverId` of the bot's session so the live `AgentControls` show that session's model and mode. Group chat: `agentId={draftKey}` with no live agent — the draft launcher already runs `Composer` that way (`screens/new-workspace-screen.tsx:2390-2399` passes `agentId={draftKey}` + `onSubmitMessage`) |
| `clisbot/bots/chat/bot-face.tsx`            | Avatar for a bot: `AgentProfileGlyph` (`agent-profiles/index.ts:28`) when the bot's defaults name a profile, else initial letter on an identity colour                                                                                                                                                                                                                                 |

Behavior notes:

- The composer submits through the daemon (`chat.message.send`); the user line appears when the
  daemon echoes it via `chat.transcript.appended`, with an optimistic pending row keyed by the
  request id until then (same posture as `pendingMessageSubmissions` in the cowork view).
- `/new` in the composer maps to the chat's "start a fresh session for that pair" (README D7):
  handle it as a client slash command (`onClientSlashCommand`, `composer/index.tsx:946`) that
  calls `chat.message.send` with the reset flag the daemon plan defines; do not invent a second RPC.
- Approval and question cards respond through the existing permission path (they are the same
  pending permissions the cowork view answers), so answering in either view settles both.
- One session, two views (README Invariants): the chat never writes to the timeline, and the
  cowork tab never writes to the transcript.

### Bot screen (`/h/[serverId]/bot/[botId]`)

`clisbot/bots/bot/bot-screen.tsx`: `BackHeader`, a settings card (name, description, avatar,
launch defaults — the same form model as create, `mode: "edit"`), a Sessions card listing the
bot's unarchived agents (`clisbot/workspace-sessions/select-sessions.ts` shapes) each opening in
cowork, a Sharing row that navigates to `buildProjectSettingsRoute(serverId, bot.projectId)`
(`utils/host-routes.ts:597`; README D13), and Archive (`confirmDialog`, README D14).

## 5. Create-by-name flow

Entry: the `NewBotRow` in the sidebar (§1) and a "New bot" item in the chat header's Add bot
picker. Typing a name and pressing Enter opens `BotFormSheet` with the name filled. There is no
silent create: the form starts filled, every default shown in the AI configuration card, and
Enter in Name creates (README D11, D12 as revised 2026-09-29).

### Model — `clisbot/bots/create/bot-form-model.ts` (zero React imports)

Copy the shape of `schedules/schedule-form-model.ts`:

- `openBotForm(snapshot)` with `snapshot = { mode: "create" | "edit", bot?, hosts, defaults:
{ serverId?, name?, preferences? } }`. Edit mode seeds every value and display from the record.
- Commands: `setName`, `setHost(serverId, display)`, `setProvider`, `setModel`, `setMode`,
  `setThinkingOption`, `setFeature`, `applyProfile(profile)`, `applyHosts`, `applyPreferences`,
  `applyProviderSnapshot(serverId, { entries })` (late data as model input, not reconstruction).
- Provider/model/mode/thinking resolution reuses `provider-selection/resolve-agent-form`
  (`resolveFormStateFromProviderModels`, `resolveThinkingOptionId`, …) exactly as the schedule
  model imports them (`schedule-form-model.ts:15-25`).
- Derived on every publish: `showHostField = hosts.length > 1`, `resolution: idle|pending|complete`
  per host, `canSubmit = name.trim() && serverId && provider`, displays owned by the model.
- `toCreateRequest(state)` → `bot.create` payload; `toUpdateRequest(state)` → `bot.update`.

### Adapters and sheet

| File                                                    | Copy of                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/bots/create/use-bot-form-model.ts`             | `schedules/use-schedule-form-model.ts` (construct once, `close()` on unmount, mechanical `apply*` effects)                                                                                                                          |
| `clisbot/bots/create/use-bot-form-provider-snapshot.ts` | `schedules/use-schedule-form-provider-snapshot.ts` (`useProvidersSnapshot(serverId, { cwd })` → `applyProviderSnapshot`)                                                                                                            |
| `clisbot/bots/create/bot-form-sheet.tsx`                | `components/schedules/schedule-form-sheet.tsx:250-300`: returns null when closed, `key` from mode + bot id, `AdaptiveModalSheet`, `Field`/`FormTextInput` (`components/ui/form-field.tsx:36,161`), size `sm` desktop / `md` compact |
| `clisbot/bots/create/host-field.tsx`                    | `HostPicker` (`components/hosts/host-picker.tsx:227-248`) behind a `SelectFieldTrigger`; rendered only when `showHostField`                                                                                                         |
| `clisbot/bots/create/defaults-field.tsx`                | `DraftAgentControls` (`composer/agent-controls/index.tsx:1808`) fed by `toDraftAgentControlsProps(model, state)`; `onApplyAgentProfile` from `useAgentProfiles` (`agent-profiles/index.ts:20`)                                      |

`DraftAgentControls` is what the composer shows for a draft (`screens/new-workspace-screen.tsx:2307,2444`),
so the bot's defaults look like the controls the user already knows. It reads
`useComposerKeyboardScope` and layout context; the spike task (T7) confirms it mounts inside a
sheet without the composer dock. Fallback: the `SelectField` rows the schedule sheet uses for
provider/model/thinking (`schedule-form-sheet.tsx:480+`).

A ready-made source of `DraftAgentControlsProps` already exists: `useAgentInputDraft({ draftKey,
composer: { initialServerId, initialValues, isVisible } }).composerState.agentControls`
(`composer/draft/input-draft.ts:34-40,47-55`), built on `useAgentFormState`. It is React-owned
provider state, so it does not replace the form model (docs/forms.md rule 3: late data is a model
input). Use it only if T7 shows that mapping the model to `DraftAgentControlsProps` by hand costs
more than the 26 props are worth; then the model keeps name + host + resolution and reads the
chosen provider values back through `composerState` at submit.

Provider snapshot `cwd`: a bot has no directory before creation. Use the host's bots root when
the daemon plan exposes it in `bot.list`'s response, else `""` — `useProvidersSnapshot` takes a
cwd for per-project provider overrides; verify the daemon accepts an empty cwd for the snapshot
(R6).

After create: close the sheet, invalidate the bots query, create the direct chat (`chat.create`
with one participant) and navigate to it. Persist the chosen controls into form preferences
(`useFormPreferences`, `hooks/use-form-preferences.ts:30`) the way the schedule sheet does
(`schedule-form-sheet.tsx:292+`), so the next bot starts from them.

## 6. Client and runtime

### How the app calls the daemon

The app does not use the `ClisbotApi` facade (`packages/client/src/index.ts:488`; that is the
CLI/SDK surface). It holds a `DaemonClient` per host: `useHostRuntimeClient(serverId)`
(`runtime/host-runtime.ts:2713`) or `getHostRuntimeStore().getClient(serverId)` (`:2510`).
Fusion RPCs are methods on `DaemonClient` calling the private
`sendCorrelatedSessionRequest` (`packages/client/src/daemon-client.ts:1960`); precedent
`listTerminalProfiles` (`:5895`) and `fetchPermissionResponses` (`:5395`). Pushed messages are
observed with `client.on("<type>", handler)` (precedent
`clisbot/session-storage/use-permission-history.ts:146`).

Add to `daemon-client.ts`, in one contiguous block marked `// Clisbot bots (README D10)`:
`botList`, `botCreate`, `botUpdate`, `botArchive`, `chatList`, `chatCreate`,
`chatParticipantAdd`, `chatParticipantRemove`, `chatMessageSend`, `chatTranscriptFetch`. Types
come from the protocol module the daemon plan adds (assumed `@clisbot/protocol/bots`); the app
imports types only from there and never re-declares them (CLAUDE.md "Build workspace packages
before diagnosing cross-package type errors" — `npm run build:client` after the protocol lands).

### Query owners — plain fetch queries, not the replica cache

The replica cache stores a closed set of row kinds (`agent | workspace | project`,
`runtime/replica-cache/index.ts:37-43`) with a versioned schema
(`row-store-schema.ts:1`) and is fed by `DirectorySync` (`runtime/directory-sync/index.ts`).
Joining it means touching upstream schema, migrations, and the directory transaction owner for
two lists that are small and cheap to refetch. Use the schedules pattern instead:

| File                                   | Shape                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/bots/data/aggregated-bots.ts` | `fetchAggregatedBots({ hosts, runtime })` → `{ status: "connecting" } \| { status: "loaded", data, hostErrors }` (copy `schedules/aggregated-schedules.ts:1-60`)                                                                                        |
| `clisbot/bots/data/use-bots.ts`        | `useAggregatedBots()` via `useFetchQuery` (`data/query.ts:48`), key `["bots", serverIds, connectionStatusKey]`, `AggregateLoadState` (docs/forms.md "Data gating"); only feature hosts                                                                  |
| `clisbot/bots/data/use-chats.ts`       | Same for chats; sorted by `updatedAt` desc                                                                                                                                                                                                              |
| `clisbot/bots/data/push.ts`            | One subscriber per connected feature host: `bot.updated` / `chat.updated` → `queryClient.invalidateQueries`; `chat.transcript.appended` → `transcript-store.append`. Mounted once by `BotsAndChatsSidebarSections` (the one always-mounted fusion node) |
| `clisbot/bots/data/mutations.ts`       | `useBotMutations(serverId)`, `useChatMutations(serverId)` — thin wrappers that invalidate on success                                                                                                                                                    |

`staleTimeMs: 5_000` like schedules; the push subscriptions keep lists current between refetches.

### Offline

- Lists: react-query keeps the last answer per key; a host that drops to `connecting` changes the
  key (`connectionStatusKey`), so the load state reads `connecting` and rows from the previous key
  are shown dimmed with the host's status until the next answer (same as the schedules screen).
- Chat: the transcript store keeps loaded pages in memory for the app's lifetime; reload refetches.
  Sending is disabled while the host is not `online` (`useHostRuntimeConnectionStatus`,
  `runtime/host-runtime.ts:2751`); the screen shows the same unavailable state the cowork pane
  shows (`AgentSessionUnavailableState`, `panels/agent-panel.tsx:1640` — local there; copy its 30
  lines into `clisbot/bots/chat/host-offline-state.tsx`).
- Persisting transcripts into the replica cache is deferred (Open question O4).

## 7. Compact form factor, native, hover

| Concern                  | Rule                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar press on compact | Rows call `onBeforeNavigate` before navigating, exactly `AutomationSidebarItem` (`clisbot/hub/automation-sidebar-item.tsx:11-14`); the mobile sidebar passes `closeSidebar` (`left-sidebar.tsx:597`)              |
| Chat screen on compact   | A host leaf under app chrome; `MenuHeader` carries the sidebar toggle. It is not a mobile panel (`docs/mobile-panels.md`: the three panels belong to the workspace screen) — nothing registers with `panel-store` |
| Sheet                    | `AdaptiveModalSheet` owns compact vs popover; fields size `md` on compact (`useIsCompactFormFactor` from `@/constants/layout`)                                                                                    |
| Kebab visibility         | `isHovered \|\| isNative \|\| isCompact`; hover on a plain `View` with `onPointerEnter/Leave`, press on an inner `Pressable` (docs/hover.md); fixed `minHeight` on rows                                           |
| Tooltips                 | Web only, and only for cut titles (`clisbot/workspace-sessions/session-title-tooltip.tsx` shows the measurement gate)                                                                                             |
| Platform files           | None expected. If the chat list needs a web-only virtualizer later, split `chat-list.web.tsx` / `chat-list.tsx` rather than `if (isWeb)` blocks                                                                   |
| Keyboard on native       | `Composer blurOnSubmit={isNative}` as the cowork pane does (`panels/agent-panel.tsx:1612`)                                                                                                                        |
| Draggable rows           | Bot and chat rows are not draggable (no `DraggableList`); long press opens the `ContextMenu` with the kebab's items (docs/menus.md: `ContextMenu` defaults to a sheet on compact)                                 |

## 8. Test plan

Run from the package: `cd packages/app && npx vitest run <file> --bail=1` (memory note; from the
repo root app tests fail to load). Browser tests: `npm run test:browser` picks `*.browser.test.tsx`.
Playwright: `packages/app/e2e/browser/*.spec.ts`.

| Test                                                       | Kind       | Asserts                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clisbot/bots/sidebar/sections.test.tsx`                   | jsdom      | Mirror `clisbot/hub/automation-sidebar-item.test.tsx`: no host with the feature → renders nothing; a row press calls `onBeforeNavigate` then pushes the chat route; new-bot row opens the sheet with the typed name |
| `clisbot/bots/sidebar/hide-bot-projects.test.ts`           | unit       | Identity returned for an empty bot set; a project is removed only when one of its host placements matches on `serverId` + `projectId`                                                                               |
| `clisbot/bots/create/bot-form-model.test.ts`               | unit       | Copy the cases of `schedules/schedule-form-model.test.ts`: fresh per open, edit seeds displays, host field only with >1 host, provider snapshot applies per host, `canSubmit`, `toCreateRequest`                    |
| `clisbot/bots/chat/render-model.test.ts`                   | unit       | Transcript + live heads merge; live items referenced by a transcript line drop out; grouping of consecutive bot rows; permissions attach to the right bot                                                           |
| `clisbot/bots/chat/select-chat-sessions.test.ts`           | unit       | Labels pick one unarchived agent per bot; archived and foreign-chat agents are ignored                                                                                                                              |
| `clisbot/bots/chat/transcript-store.test.ts`               | unit       | Page prepend, append dedupe by message id, per-chat isolation                                                                                                                                                       |
| `clisbot/bots/routes.test.ts`                              | unit       | Builders encode ids like `utils/host-routes.ts`; parser round-trips                                                                                                                                                 |
| `clisbot/bots/chat/chat-list.browser.test.tsx`             | browser    | A direct and a group transcript render sender rows and a streaming live head (pattern: `clisbot/session-storage/user-message-avatar.browser.test.tsx`)                                                              |
| `packages/app/e2e/browser/bots-and-chats.spec.ts`          | Playwright | Harness daemon with `CLISBOT_BOTS_ENABLED=1` and the mock provider: create by name → chat opens → send → reply row → Open in cowork lands on `/h/:id/workspace/:id` with the tab revealed                           |
| `packages/app/e2e/browser/bots-and-chats-flag-off.spec.ts` | Playwright | Flag off: no Chats/Bots sections, `/h/:id/chat/x` shows the unavailable state, Projects list unchanged — the "flag-off navigation" proof Automations ships as `Hub-enabled/disabled navigation`                     |

Add a native regression only if a route-tree change is suspected (docs/expo-router.md
"Regression Shape"); the two new leaves are direct children of the host layout, so the pure
policy tests there stay green untouched.

## 9. Risks and open questions

| #   | Risk / question                                                                                                                                                 | Recommendation                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | README D10 says flag-off is "byte-for-byte as upstream". Expo Router needs the two route files in `src/app` and two `Stack.Screen` lines regardless of the flag | Accept: behavior is identical (no entry points, screens show unavailable). Record the exception in the README's D10 line ("route registration excepted") when implementing                                                                                   |
| R2  | `Composer` is built around one `agentId` (controls, slash commands, attention). A group chat has no single agent                                                | Resolved: `Composer` runs without a live agent when given a draft key and `onSubmitMessage` (`screens/new-workspace-screen.tsx:2390-2399`). Direct chat passes the bot session's agent; group chat passes the chat draft key and `agentControls={undefined}` |
| R3  | Own chat list means own scroll anchoring; the cowork view's bottom-anchor controller is a large piece of `agent-stream/`                                        | Phase 1: `FlatList inverted` + `maintainVisibleContentPosition` + a scroll-to-bottom button. Measure with the stream-smoothness spec pattern only if jank is reported                                                                                        |
| R4  | The (bot, chat) → agent join relies on agent labels whose keys the daemon plan defines                                                                          | Put the two label keys in one exported constant in the protocol bots module; the app imports them. No string literals in the app                                                                                                                             |
| R5  | Composer draft persistence for a chat                                                                                                                           | Resolved: `useAgentInputDraft` takes any string `draftKey` (`composer/draft/input-draft-core.ts:9`); key it `chat:${serverId}:${chatId}`. No copy needed                                                                                                     |
| R6  | Provider snapshot before a bot exists needs a `cwd`                                                                                                             | Ask the daemon plan to return the bots root in `bot.list`; until then send `""` and confirm the snapshot RPC accepts it                                                                                                                                      |
| R7  | Transcript pages + N live subscriptions in a group chat                                                                                                         | Participants are few (a hop limit and defaults in README D9); `replaceVisibleAgentIds` releases on unmount. No extra retention logic                                                                                                                         |
| O1  | Should the host index restore the last chat like it restores the last workspace?                                                                                | Not in phase 1. Restoring a workspace is a developer habit; a chat deep link already works. Decide after use                                                                                                                                                 |
| O2  | Naming pass (README Open) may rename Bot/Chat and their routes                                                                                                  | Every path stays in `routes.ts`. User-visible strings moved from `clisbot/bots/copy.ts` (removed 2026-10-07) to i18n: `i18n/resources/bots/{chat,workspace}.ts` (`bots.*` keys, all app locales), so a rename edits the English values there                 |
| O3  | Bot Projects stay visible in the New workspace picker and Settings › Projects                                                                                   | Keep for phase 1 (sharing lives there). Revisit if users open bot directories by accident                                                                                                                                                                    |
| O4  | Transcript persistence in the replica cache for instant cold-start reads                                                                                        | Defer; measure first fetch on a long transcript                                                                                                                                                                                                              |
| O5  | i18n: Clisbot sidebar labels were English literals (`AutomationSidebarItem`)                                                                                    | Resolved 2026-10-07: Bots & Chats, Hub and Connectors screens use `t()`; copy lives in `i18n/resources/{bots,hub,connectors}/`                                                                                                                               |

## 10. Ordered tasks (each under ~2 hours)

1. **Protocol/client handshake.** With the daemon plan: confirm the RPC schemas, the `bots`
   feature flag line in `server_info`, the label-key constants, and the transcript line shape.
   Add the `DaemonClient` method block. `npm run build:client`, typecheck.
2. **Feature gate and routes.** `clisbot/bots/feature.ts`, `routes.ts` (+ test), the two route
   files, two `Stack.Screen` lines, `HostFeatureUnavailable` state. Typecheck, lint.
3. **Query owners.** `data/aggregated-bots.ts`, `use-bots.ts`, `use-chats.ts`, `mutations.ts`
   with `AggregateLoadState`; unit tests for the aggregate fetchers (copy the schedules tests).
4. **Push subscriptions.** `data/push.ts` + `chat/transcript-store.ts` (+ test).
5. **Sidebar sections, part 1.** Insertion #1 (`listLeadingComponent`) and #2; `sections.tsx`,
   `section-header.tsx`, `row.tsx` after the session-line template; Chats section with the cap.
6. **Sidebar sections, part 2.** Bots section, status dots, kebab/context menu, `hide-bot-projects.ts`
   - insertion #3; `sections.test.tsx`, `hide-bot-projects.test.ts`.
7. **Spike (timeboxed 1h).** Mount `DraftAgentControls` inside an `AdaptiveModalSheet` fed from
   a hand-written `DraftAgentControlsProps`; decide model-mapped props vs `composerState` (§5).
8. **Bot form model.** `create/bot-form-model.ts` + test; provider resolution reuse.
9. **Bot form sheet.** Adapters, sheet, host field, defaults field; create → chat → navigate;
   preferences persist.
10. **New-bot row.** `new-bot-row.tsx` in the Bots section; Enter opens the sheet with the name.
11. **Chat render model.** `chat/render-model.ts` + test; `select-chat-sessions.ts` + test.
12. **Chat data hooks.** `use-chat.ts`, `use-chat-transcript.ts` (paging), `use-chat-sessions.ts`
    (directory demand, `prepareAgentTimeline`, `replaceVisibleAgentIds`, release).
13. **Chat list.** `chat-list.tsx` with the reused rows, live head rendering, permissions and
    question cards, sync status; `chat-list.browser.test.tsx`.
14. **Chat header and composer.** `chat-header.tsx` (kebab items, Add bot picker, delete with
    `confirmDialog`), `chat-composer.tsx` (`chat.message.send`, `/new` as a client slash command,
    offline disable), `host-offline-state.tsx`.
15. **Open in cowork.** Header and row actions → `navigateToAgent` / `navigateToWorkspace`;
    verify Back returns to the chat on web and native.
16. **Bot screen.** `bot/bot-screen.tsx`: settings card in edit mode, sessions card, sharing row,
    archive.
17. **Playwright.** `bots-and-chats.spec.ts` and `bots-and-chats-flag-off.spec.ts` against the
    harness daemon with the mock provider.
18. **Docs.** README: add the D10 route-registration exception (R1), link this plan from a
    `plans/` line; glossary rows once the naming pass lands; `npm run format`, typecheck, lint.
