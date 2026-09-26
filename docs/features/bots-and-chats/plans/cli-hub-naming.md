# Plan: names, CLI, and Hub touchpoints

Date: 2026-09-26. Mode: plan (naming-expert). Scope: the final names for the daemon's Bot and Chat
resources, how the CLI `bot` verbs change once the daemon owns the record and seeding (D2, D11),
and what the Hub already gives phase-1 sharing (D13). Decisions D1–D15 in [the README](../README.md)
are fixed; this plan grounds them in code and orders the work. Labels: CURRENT = in the tree today,
TARGET = what the README decided, GAP = what has to be built or written.

## A. Naming pass

### Concept cards

- **Bot** is a durable resource owned by the daemon that keeps a persona (instruction files), a
  home (one Project, one `directory` Workspace) and launch defaults across sessions; it is not an
  Agent session (one running instance, `docs/glossary.md:30`), not an Agent profile (a launch
  bundle with no home or identity, `docs/glossary.md:33`), and not a Channel account (the Hub's
  behaviour on one Connection, `docs/glossary.md:40`).
- **Chat** is a durable resource owned by the daemon that holds one transcript between the user and
  one or more Bots on that daemon; it is not a Conversation (a provider-native DM/channel/thread the
  Hub's Channel account handles, `docs/glossary.md:48`) and not a Session in either sense
  (`docs/glossary.md:31`).

### CURRENT uses of "bot" and "chat" the names must not collide with

| Where                                                                                    | Meaning today                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Glossary **Channel account** (`docs/glossary.md:40`)                                     | "Forbidden: 'Bot' as a separate product resource"                                    |
| Glossary **Automation** (`docs/glossary.md:56`)                                          | "Forbidden: 'Job' or 'Bot'"                                                          |
| Glossary **Connection** (`docs/glossary.md:37`)                                          | "Channel bot Connection": a Connection made by `paseo channels add`                  |
| Glossary **Identity realm** (`docs/glossary.md:116-124`)                                 | "the bots across which one sender id names one person": platform bot users           |
| 2026-09-19 decision (`docs/audits/2026-09-19-connection-naming-and-route-flow.md:42-43`) | "Bot" rejected as the name of what holds Routes                                      |
| CLI `bot` group (`packages/cli/src/commands/bot/index.ts:1-4`)                           | A composite: workspace + idle agent + channel account + route, tied by a manifest    |
| Glossary **Channel identity** (`docs/glossary.md:114`)                                   | UI **Chat accounts** = a Member's linked chat-platform accounts                      |
| Glossary **Audience rule** (`docs/glossary.md:49`)                                       | **Group chats** = a Where choice on a Route (platform group conversations)           |
| Glossary **Fork** (`docs/glossary.md:82`)                                                | `chat_history` composer attachment                                                   |
| Product vision direction 2 (`docs/overview/product-vision.md:108-118`)                   | "AI agents and bots should be native participants"; "group chat" for humans + agents |

### Decision: keep **Bot** and **Chat**

Both are the user's words, both are what the CLI group and the product vision already say, and the
collisions are with informal uses (platform bot users, chat platforms), not with another product
resource. The fix is to make those informal uses precise, not to add a fourth term.

Rejected alternatives:

| Candidate                      | Why not                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent / Agent session          | Canonical Paseo term for one running instance (`docs/glossary.md:10,30`); a Bot outlives every session                                                                                                                                                                                                  |
| Agent profile                  | Exists: a launch bundle applied and forgotten, no home, no identity (`docs/glossary.md:33`); a Bot _has_ one                                                                                                                                                                                            |
| Assistant                      | The CLI's word for the one shipped bot (`clisbot.assistant` label, `packages/cli/src/commands/bot/assistant-workspace.ts:125`; `personal-assistant` / `team-assistant` templates). Direction 11 makes "the assistant" one Bot with a lead role (phase 2); naming every Bot "Assistant" erases that role |
| Persona                        | Names only the instruction files, not the home, Project, or launch defaults                                                                                                                                                                                                                             |
| Teammate                       | Grok's metaphor; reads as a human Team member (`docs/glossary.md:60`); not searchable                                                                                                                                                                                                                   |
| Conversation (for Chat)        | Owned by the Hub for provider-native conversations (`docs/glossary.md:48`); using it on the daemon puts two owners behind one name. The README already says the Hub will treat a Chat as one more Conversation _kind_: Conversation stays the Hub's superclass                                          |
| Thread (for Chat)              | Provider-native sub-conversation inside a Conversation; Slack threads are what Routes reply into                                                                                                                                                                                                        |
| Room / Channel (for Chat)      | Channel = one chat platform (`docs/glossary.md:38`)                                                                                                                                                                                                                                                     |
| Direct chat / Group chat kinds | D6 has one model; "Group chats" is already a Route Where choice. Neither becomes a UI label for a Chat kind; a Chat with several Bots is a Chat                                                                                                                                                         |

### Names to use

| Surface            | Name                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI labels          | **Bot**, **Bots** (sidebar section), **New bot**; **Chat**, **Chats** (sidebar section), **New chat**, **Add bot** (participant), **Open in cowork** (the session view)                                                                                                 |
| Bot kind values    | `personal` \| `team` (kept from the CLI's `botType`, `packages/cli/src/commands/bot/plan.ts:14-15`); UI **Personal** / **Team** under one field **Kind**                                                                                                                |
| Ids                | `bot_<16 hex>`, `cht_<16 hex>`: the `prj_` / `wks_` / `srv_` family (`docs/data-model.md`, `docs/glossary.md:5`)                                                                                                                                                        |
| Persisted records  | `BotRecord` (`$PASEO_HOME/bots/{botId}.json`), `ChatRecord` (`chats/{chatId}/chat.json`), `ChatTranscriptLine` (`transcript.jsonl`)                                                                                                                                     |
| Stores             | `BotStore`, `ChatStore` (owns `chat.json` and the transcript: one store per data-model "store surface rule")                                                                                                                                                            |
| Server module      | `packages/server/src/server/bots/` (Fusion-owned, beside `managed-access/`): `bot-store.ts`, `bot-templates/` (the moved catalog), `bot-template-seeding.ts`, `chat-store.ts`, `chat-fanout.ts`                                                                         |
| Wire payloads      | `BotPayload`, `ChatPayload`, `ChatMessagePayload`: the `AgentSnapshotPayload` / `WorkspaceDescriptorPayload` family (`packages/protocol/src/messages.ts:608,2178`)                                                                                                      |
| RPC namespaces     | `bot.*`, `chat.*` as the README lists; pushes `bot.updated`, `chat.updated`, `chat.transcript.appended` sit beside `agent.provider_subagents.update` in the subscription list (`packages/protocol/src/messages.ts:3212`)                                                |
| Daemon permissions | `bot.list` / `chat.list` / `chat.transcript.fetch` → `workspace.read`; `bot.create` / `bot.update` / `bot.archive` / `chat.*` writes → `workspace.write`, entries in `packages/server/src/server/authorization/operation-permissions.ts:10-27`                          |
| Config leaves      | `daemon.bots.enabled`, `daemon.bots.root` in `RELOADABLE_PATHS` and `PERSISTED_TO_MUTABLE_PATH` (`packages/server/src/server/daemon-config-store.ts:170-215`); env `PASEO_BOTS_ENABLED`; feature `server_info.features.bots` (`packages/protocol/src/messages.ts:3658`) |
| Agent labels       | `clisbot.bot` = botId, `clisbot.chat` = chatId. `clisbot.assistant` (`assistant-workspace.ts:125`) stays only as a read alias, tagged `COMPAT(clisbot-assistant-label)`                                                                                                 |
| Route segments     | `h/[serverId]/bot/[botId].tsx`, `h/[serverId]/chat/[chatId].tsx`: singular, like `packages/app/src/app/h/[serverId]/agent/[agentId].tsx` and `workspace/[workspaceId]`                                                                                                  |
| Sidebar keys       | `bots`, `chats` (the `history` / `schedules` family in `packages/app/src/sidebar-nav/model.ts`) if they are head rows; section titles **Bots**, **Chats** otherwise                                                                                                     |
| CLI                | `paseo bot start\|stop\|status\|list`; flag `--kind personal\|team` with `--bot-type` kept as a hidden alias (`COMPAT(clisbot-bot-type-flag)`); public flags stay kebab-case                                                                                            |

Why `daemon.bots.*` and not `features.*`: the other Fusion flag, `features.agentSessionStorage`
(`packages/server/src/server/config.ts:640,685-694`), is read once at boot. Bots must switch on and
off through `set_daemon_config` like `daemon.agentProfiles` and `daemon.managedAccess.mode`
(`daemon-config-store.ts:177,187`), so the leaf belongs in the reloadable `daemon.*` block.

### Glossary entries (paste into `docs/glossary.md` after **Agent profile**)

```md
- **Bot** — A named, durable agent persona with a home directory on one daemon: instruction files (`AGENTS.md`, `SOUL.md`, `MEMORY.md`, …), one Project whose root is that directory with one `directory` Workspace, and launch defaults in the shape of an Agent profile. Its `id` is an opaque `bot_<16 hex>`; its `slug` is the immutable directory name under `daemon.bots.root`; the display name changes freely. UI: **Bot** / **Bots** / **New bot**. Code: `BotRecord` (`packages/server/src/server/bots/bot-store.ts`), `BotPayload` (`packages/protocol/src/messages.ts`), RPCs `bot.*`, gated on `server_info.features.bots`. See [Bots and Chats](features/bots-and-chats/README.md). Don't confuse with: **Agent session** (one running instance; a Bot runs many), **Agent profile** (a launch bundle with no home), the bot user a chat platform shows for a **Connection** (say "the Connection"), or the CLI's earlier `bot` composite (now this resource, created through `bot.create`). Forbidden: "Assistant" as the resource name (that is one Bot's role), "Teammate", "Persona".
- **Bot kind** — `personal | team`, chosen at creation. Selects the seeded template today and the session policy on channels later. UI: **Kind** on the create form. Code: `kind` on `BotRecord`; the CLI flag is `--kind`. Not a folder name: the directory is `<root>/<slug>` for both.
- **Chat** — One conversation between the user and one or more Bots on the same daemon, with its own transcript apart from any timeline. A Chat with several Bots is still a Chat; there is no separate group kind. Each Bot in it answers through its own Agent session in its own home. UI: **Chat** / **Chats** / **New chat**; **Add bot** adds a participant. Code: `ChatRecord`, `ChatTranscriptLine` (`packages/server/src/server/bots/chat-store.ts`), `ChatPayload`, `ChatMessagePayload`, RPCs `chat.*`. Don't confuse with: **Conversation** (a provider-native DM, channel or thread the Hub's Channel account handles; the Hub will treat a Chat as one more Conversation kind), **Chat accounts** (a Member's linked chat-platform accounts), or the **Group chats** choice on a Route (platform group conversations). Forbidden: "Thread", "Room", "Direct chat" / "Group chat" as UI labels for a Chat.
- **Transcript** — A Chat's append-only record of final messages: sender (`user` or a `botId`), text, and for a Bot reply the `agentId` and timeline item it came from. Never carries tool calls or progress; those stay in the session timeline. Code: `transcript.jsonl` under `$PASEO_HOME/chats/{chatId}/`. Don't confuse with the composer's `chat_history` attachment, which is a curated copy of one session's timeline used by **Fork**.
```

### Glossary lines D1 revises (exact rewrites)

`docs/glossary.md:40` (**Channel account**), replace the last sentence

> Forbidden: "Bot" as a separate product resource.

with

> Forbidden: "Bot" for this or for its Connection. A **Bot** is the daemon resource; the bot user a
> platform shows for a Connection is named by the Connection ("the Connection", "the Slack
> Connection"), never "the bot".

`docs/glossary.md:56` (**Automation**), replace

> Forbidden: "Job" or "Bot".

with

> Forbidden: "Job". Not a **Bot**: an Automation runs on a trigger and has no home or persona; a
> Route may target a Bot in a later phase.

Same-family cleanups in the same edit (one concept, one name):

- `docs/glossary.md:116-118` (**Identity realm**): "The bots across which…" → "The Connections
  across which…"; "every bot" → "every Connection"; "one bot each" → "one Connection each".
- `docs/glossary.md:37` (**Connection**): keep "Channel bot Connection" (a kind label users see);
  add "Don't confuse with: a **Bot**, the daemon resource a Route may target later."
- `docs/features/access/scoped-admins.md:62` "A Channel input is a Route on a bot" → "on a
  Connection".
- `docs/audits/2026-09-19-connection-naming-and-route-flow.md:42` stays as history; add one line
  under Options: "Bot became the daemon resource on 2026-09-26 ([Bots and Chats](../features/bots-and-chats/README.md))."

## B. CLI

### CURRENT: what each verb does

| Verb / file                                                  | Today                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot start` (`packages/cli/src/commands/bot/run.ts:165-219`) | Ensures daemon + embedded Hub (`ensureInfrastructure`, 377-399), opens the daemon, `provisionAssistant` (`assistant-workspace.ts:29-67`: provider check, `mkdir`, `createWorkspace`, **local** `seedWorkspaceTemplate`, `createAgent` labelled `clisbot.assistant`), writes the manifest, then Hub onboarding, `addChannel`, status |
| `hub init` / `bot init` (`init.ts:13-46,70-95`)              | With channel flags or a saved manifest → `bot start`; bare → `initializeAssistantWorkspace`: daemon up, `provisionAssistant`, Hub up. Both paths assume `provider: "codex"` (`init.ts:35,77`)                                                                                                                                       |
| `bot status` (`status.ts:52-77`)                             | Manifest by name + `channelStatus` from the Hub; `BOT_NOT_FOUND` without a manifest                                                                                                                                                                                                                                                 |
| `bot list` (`list.ts:35-48`)                                 | Every manifest joined with Hub channel status                                                                                                                                                                                                                                                                                       |
| `bot stop` (`stop.ts:49-65`)                                 | Stops the embedded Hub; lists the credentials the manifests name as preserved                                                                                                                                                                                                                                                       |
| Manifest (`manifest.ts:12-38`)                               | `version:1, name, botType, provider, model, mode, workspacePath, workspaceId, projectId, isolation, sourcePath, agentId, agentTitle, channel, account, connectionId, routeNote, credentials`; mode 0600, atomic (`manifest.ts:115-129`)                                                                                             |
| `plan.ts`                                                    | `buildAssistantPlan` (88-106): name default `<kind>-assistant`, provider/model, `workspacePath` default `<home>/workspaces/{default\|team}` (139-143), isolation, `agentTitle`; `planUnchanged` (215-227) decides reuse; `buildBotManifest` (230-255)                                                                               |
| `workspace-template.ts`                                      | Catalog (`workspaceTemplate`, 37-49, three layers under `templates/`) and `seedWorkspaceTemplate` (52-84: never the OS home root, `wx` create, symlinks skipped, backup on explicit overwrite, `CLAUDE.md`/`GEMINI.md` symlinks for claude/gemini)                                                                                  |
| Home (`home.ts:9-13`, `../hub/local-hub.ts:157-169`)         | `--home` > `CLISBOT_HOME` > `PASEO_HOME` > `~/.clisbot`; the daemon is spawned with `PASEO_HOME` = that home (`packages/server/src/server/paseo-home.ts:14-15` reads `PASEO_HOME`)                                                                                                                                                  |

### TARGET: one RPC replaces the local composite

`bot start` and bare `hub init` become: ensure daemon → open daemon → require
`server_info.features.bots` → `bot.create.request` → (channel flags only) Hub onboarding on the
returned `projectId` + `cwd` as today (`channelSetup`, `run.ts:319-338`) → manifest.

`bot.create.request` carries what `buildAssistantPlan` resolves today minus the defaults the daemon
now owns: `name`, `kind`, optional `cwd` (explicit path wins, D3), launch defaults (`provider`,
`model`, `modeId`, …; bare `hub init` must ask or fail instead of assuming `codex`, D11),
`template: { overwrite?: boolean }`. The response returns the `BotPayload` plus `reused: boolean`
and the template result (`created`, `skipped`, `overwritten`, `backupDirectory`) the CLI prints
(`start-output.ts:95-99`).

Idempotency moves to the daemon: a `bot.create` naming an existing slug returns that Bot with
`reused: true`, the way `createAssistantWorkspace` finds an existing Workspace by path today
(`assistant-workspace.ts:94-105`). `planUnchanged` and `resumeBotOptions` (`run.ts:271-303`) go;
runtime flag changes on restart (`shouldUpdateRuntime`, `run.ts:305-317`) become `bot.update`.

Re-seeding on restart (`resolveAssistantResources`, `run.ts:235-242`) and `--overwrite-template`
need a verb the README's RPC list lacks. GAP: add `bot.template.seed.request` / `.response`
(`{ botId, overwrite? }`) rather than overloading `bot.update`; it is the one operation that touches
files.

The initial idle agent (`createAssistantAgent`, `assistant-workspace.ts:123-156`) is not created any
more: D2 keeps no main-conversation agent id and D7 creates the session per (Bot, Chat) on the first
message. Hub-side Routes need only `projectId` and `cwd` (`channelSetup`), which the record has.

### What moves where

| Today (CLI)                                                                                                                                               | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-template.ts` + `templates/**` (copied into `dist` by the CLI package)                                                                          | `packages/server/src/server/bots/bot-templates/` + `bot-template-seeding.ts`; the three-layer merge and every seeding rule unchanged; the `main` sync note (`workspace-template.ts:1-3`) moves with it                                                                                                                                                                                                                                                                                                                                         |
| `assistant-workspace.ts` (`provisionAssistant`, `createAssistantWorkspace`, `createAssistantAgent`, `findAssistantWorkspace`, `waitForAssistantProvider`) | Deleted. Provider readiness (`waitForAssistantProvider`, 70-87) is the daemon's own `providerSnapshotManager` check inside `bot.create`; Project and Workspace creation is the daemon's `WorkspaceProvisioningService` (`docs/data-model.md`)                                                                                                                                                                                                                                                                                                  |
| `plan.ts`                                                                                                                                                 | Shrinks to flag parsing + `resolveCredential` (146-177) + `buildRouteNote`; `resolveWorkspacePath`, `resolveIsolation`, `agentTitle`, `planUnchanged`, `buildBotManifest` go                                                                                                                                                                                                                                                                                                                                                                   |
| `--new-workspace local\|worktree`                                                                                                                         | Rejected with `INVALID_WORKSPACE`: a Bot's Workspace is `directory` (D4). `COMPAT(clisbot-bot-new-workspace)`, remove after 2027-03-31                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--workspace` / `--cwd`                                                                                                                                   | Kept: becomes `cwd` on `bot.create` (explicit path wins)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--bot-name`                                                                                                                                              | Kept as the display name; the daemon derives the slug. Default `personal-assistant` / `team-assistant` kept for `hub init` so `workspaces/default` stays the shipped assistant (D3): bare `hub init` sends `cwd: <home>/workspaces/default` explicitly                                                                                                                                                                                                                                                                                         |
| Manifest v1                                                                                                                                               | Manifest v2: `{ version: 2, name, botId, channel, account, connectionId?, credentials, createdAt, updatedAt }`, the restart reference the API-first audit describes (`docs/audits/2026-09-06-api-first-onboarding.md:52-53`), nothing the daemon already stores. v1 is still parsed (`COMPAT(clisbot-bot-manifest-v1)`); `bot start` on a v1 manifest adopts: `bot.create` with `cwd: workspacePath` finds the existing Project by exact root (`docs/data-model.md`, Project identity), writes the record, and the manifest is rewritten as v2 |
| `bot status` / `bot list`                                                                                                                                 | Read the Bot from the daemon (`bot.list`), join channel status from the Hub, and read the manifest only for `channel` / `account` / `connectionId`. Bots created in the app appear with channel `-`. `BOT_NOT_FOUND` now means "no Bot on this daemon"                                                                                                                                                                                                                                                                                         |
| `bot stop`                                                                                                                                                | Unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `botRestartCommand` (`start-output.ts:7-15`)                                                                                                              | Unchanged shape; `--home` still selects the daemon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### `--home` versus `daemon.bots.root`

`--home` picks the Clisbot home the CLI spawns and talks to (`resolveBotHome`, `home.ts:9-13`); the
daemon's `PASEO_HOME` is that home. `daemon.bots.root` is a daemon config leaf read on the daemon's
side, default `$PASEO_HOME/workspaces` (D3). Precedence for a new Bot's directory:

1. `cwd` on the request (`--workspace` / `--cwd`, or bare `hub init`'s explicit default path);
2. `daemon.bots.root` + `/` + slug.

`--home` never names a Bot directory directly. The root must sit inside the Host folder policy's
allow set and is never itself a Project (D3, `packages/server/src/server/managed-access/project-folder-policy.ts`);
`bot.create` refuses a root that is a Project instead of creating a Project inside a Project.

### Compatibility (per `docs/protocol-compatibility.md`)

| Pair                                     | Result                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New CLI, old daemon (no `features.bots`) | `bot start` / `hub init` fail with one actionable error ("update the Host"). No local-seeding fallback: `workspace-template.ts` leaves the CLI. The check is one place, tagged `COMPAT(clisbot-bots-feature-gate)`                                                                         |
| Old CLI, new daemon                      | Keeps working: it uses only upstream RPCs (`createWorkspace`, `createAgent`, `fetchWorkspaces`) and seeds locally. The result is a Workspace the daemon does not list as a Bot; the new CLI adopts it on its next `bot start` (manifest v1 path above). The daemon never adopts on its own |
| New app, old daemon                      | `useHostFeature(serverId, "bots")` (`packages/app/src/runtime/host-features.ts:33-39`) false → no Bots / Chats sections (D10)                                                                                                                                                              |
| Old app, new daemon                      | Ignores `features.bots`; bot Projects show as ordinary Projects in the sidebar (the D4 hiding is app-side and gated)                                                                                                                                                                       |
| Flag off on the new daemon               | No `bot.*` / `chat.*` handlers registered, `features.bots` absent; the new CLI gets the same "update the Host" error, which should add "or enable `daemon.bots.enabled`" when the daemon version already carries the leaf                                                                  |

Schema rules: every new field optional; `bot.create.request` keeps parameters at the top level and
the response under `payload` with `requestId` (`docs/rpc-namespacing.md`); no `.transform()`.

## C. Hub touchpoints for phase-1 sharing (D13)

### CURRENT: what a Project grant already is

- The daemon publishes every unarchived Project to the Hub as `{ projectId, name, agentConfigurationCatalog, terminalProfileCatalog }` (`packages/server/src/server/bootstrap.ts:1419-1435`, `name = customName ?? displayName`) on every project-registry mutation and on provider or terminal-profile changes (`bootstrap.ts:1458-1483`), through `PUT /api/daemons/:id/projects` (`packages/server/src/server/hub/relationship-remote.ts:370-384`).
- The Hub replaces its snapshot atomically (`packages/hub/src/access/daemon-projects.ts:24-77`, strict body schema at 8-21; `packages/hub/src/access/store.ts:1195-1240`) into `daemon_projects` with a `metadata` jsonb (`packages/hub/src/db/schema.ts:621-641`).
- The access catalog lists each as `{ kind: "project", id, name, parent: daemon, available }` plus the parsed catalogs (`store.ts:596-608`).
- The app groups them under "Projects" with the Host name as description (`packages/app/src/clisbot/hub/settings/access-catalog.ts:28-57`), labels the kind "Project" (117-126), offers **Also apply to** siblings on the same Host (`access-assignment-form.tsx:405-427`), and words levels for `project` resources (`access-level-summary.ts:55,277`). `HubAccessResourceSchema` is a plain `z.object` (`packages/app/src/clisbot/hub/contracts.ts:650`), so an unknown field is stripped, not rejected.
- Levels, Can share, Team grants, the Administrator warning: [Access](../../access/README.md), [Delegated access](../../access/scoped-admins.md). Nothing in them depends on the Project's shape.

### Does a bot Project appear automatically?

Yes. `bot.create` creates a Project through the registry, the registry mutation publishes the
catalog, and the Access picker lists it under Projects on its Host with no Hub change. GAP: the
Project's name is the folder basename (`displayName`) unless `bot.create` sets `customName` to the
Bot's display name; it must, and `bot.update` (rename) must keep it in step, or Access shows slugs.

### Marker so the Hub shows it as a Bot, not a repo

Add one optional field to the daemon's publish body and carry it through, without a new resource
kind:

- Daemon `listProjects` (`bootstrap.ts:1429-1434`): `bot?: { id: string; kind: "personal" | "team" }` for Projects a `BotRecord` names by `projectId`.
- Hub `replaceProjectsBodySchema` (`daemon-projects.ts:8-21`): the same optional object (the schema is `.strict()`, so it must be declared); stored in `metadata` beside the catalogs (`daemon-projects.ts:57-63`).
- Hub catalog (`store.ts:596-608`): `parseBotMarker(project.metadata)` → optional `bot` on the `project` resource.
- App contract (`contracts.ts:650`): optional `bot`; `assignmentResourceOptions` groups such rows under **Bots** and describes them "Bot · <Host>" (`access-catalog.ts:33-55`); `resourceKindLabel` stays "Project" (the grant _is_ a Project grant, and the level wording in `access-level-summary.ts` must not fork).
- Old Hub or old app: the field is absent or stripped and the row reads as a Project. No shim beyond the optional field; tag the daemon-side emitter `COMPAT(clisbot-bot-project-marker)` so the field's origin is findable.

### What must NOT change in the Hub

- No `bot` in `ACCESS_RESOURCE_KINDS` (`packages/hub/src/access/contract.ts:57-64`): the app parses the kind with a closed enum and an older app would reject the whole catalog (`docs/features/access/scoped-admins.md:68`). No Bot table, no Bot privilege, no Bot level.
- No change to levels, Can share, delegation (`packages/hub/src/access/grantor.ts`, `delegation.ts`), tickets, or the daemon authorizer: a Member with a Project grant on the bot's Project already gets sessions in its Workspace under their own ticket (`packages/server/src/server/managed-access/resource-authorizer.ts`, [Access implementation notes](../../access/README.md#implementation-notes)).
- The creator's ticket does not carry a Project created after admission until the lease refresh; the authorizer admits the creation reply by remembered `requestId` (`docs/features/access/README.md:33`). GAP: `bot.create.response` must join that admitted-reply set, or a restricted creator never sees their own Bot until refresh.
- Creating a Bot on a shared Host is Project creation: it needs `workspace.manage` from a Host grant and a root inside the Host folder policy (`docs/features/access/README.md:16-19`; `mayCreateProjectAt`). The app's create form surfaces that refusal; it does not hide the button.
- `paseo hub projects` (`packages/cli/src/commands/hub/projects.ts`, `GET /api/v1/projects` in `hub-client/index.ts:85-95`) lists the legacy Hub Project resource, not daemon Projects; it is not a touchpoint and must not be extended.

## Tasks (ordered, each under ~2 hours)

1. Glossary: add the four entries above; rewrite the Channel account, Automation, Connection and Identity realm lines; fix `scoped-admins.md:62`; add the one-line note to the 2026-09-19 audit.
2. Config: `daemon.bots.enabled` and `daemon.bots.root` in `persisted-config.ts` and `daemon-config-store.ts` (`RELOADABLE_PATHS`, `PERSISTED_TO_MUTABLE_PATH`, patch merge), `PASEO_BOTS_ENABLED` in `config.ts`; test beside `config-clisbot-defaults.test.ts`.
3. Protocol: `features.bots` with its `COMPAT` tag; `BotPayload`; `bot.create|list|update|archive|template.seed` request/response schemas, all fields optional; entries in `operation-permissions.ts`; regenerate the inbound validators (`docs/protocol-validation.md`).
4. Server: `bots/bot-store.ts` (`BotRecord`, `bot_` ids, slug derivation with numeric suffix, atomic writes through `atomic-file.ts`); unit tests for slug collision and record round-trip.
5. Server: move `templates/**` and `seedWorkspaceTemplate` into `bots/bot-templates/` + `bot-template-seeding.ts`; port `workspace-template.test.ts` unchanged; stop the CLI `package.json` copy step.
6. Server: `bot.create` handler: root and folder-policy check, Project + Workspace through `WorkspaceProvisioningService` with `customName` = display name, seeding, record write, `reused` on an existing slug; `bot.list|update|archive|template.seed`; handlers registered only when `daemon.bots.enabled`.
7. Server + Hub: the Project marker: `bot` field in `listProjects`, `replaceProjectsBodySchema`, catalog parse; contract tests in the `packages/hub/src/access` host-scope / parity suites and a publish-body case in the `daemon-executions` tests.
8. Server: `bot.create.response` in the managed-access admitted-reply set; e2e beside `project-management.e2e.test.ts`.
9. CLI: manifest v2 with v1 parse + adopt path; `plan.ts` shrink; `--kind` with the `--bot-type` alias; reject `--new-workspace`; port `manifest` / `plan` tests.
10. CLI: `run.ts` and `init.ts` call `bot.create` (feature gate, one error), keep channel onboarding on the returned `projectId` / `cwd`, delete the idle-agent step and `assistant-workspace.ts`; update `run.test.ts`, `start-output.test.ts`, `plan.test.ts`.
11. CLI: `status.ts` / `list.ts` read from `bot.list`; tests.
12. App (Hub settings): optional `bot` on `HubAccessResourceSchema`; **Bots** group and "Bot · Host" description in the Access picker; tests in the `access-catalog` / `access-assignment-selection` suites.
13. Docs: the list below; `npm run format:files` on every touched doc.

## Docs to update

- `docs/glossary.md`: entries and rewrites in §A.
- `CLAUDE.md`: the Bots and Chats table row (line 36) exists; extend it with "names decided 2026-09-26: Bot, Chat" and the `plans/` link.
- `docs/audits/2026-09-06-api-first-onboarding.md`: a supersession note under "Decision": the seed catalog and seeding step moved from the CLI to the daemon (`bot.create`, D11); the manifest is a restart reference holding `botId` and the Connection id only; the initial idle agent is no longer created; `workspaces/default` stays the shipped assistant's path. Point at the README.
- `docs/features/bots-and-chats/README.md`: close the "Final names" open item; add `bot.template.seed` to the RPC list; note `customName` = display name.
- `docs/features/access/README.md`: one Implementation-notes row for the admitted `bot.create` reply and one line in the Hub-catalog bullet for the `bot` marker; `scoped-admins.md:62` wording.
- `docs/data-model.md`: `bots/` and `chats/` in the directory layout.
- `docs/audits/2026-09-19-connection-naming-and-route-flow.md`: the one-line pointer under Options.
- CLI help text: the `bot` group description (`index.ts:13-15`), `start` / `init` descriptions, flag help for `--kind` and `--workspace`.

## Unresolved

- Whether `bot.template.seed` is accepted as the fifth `bot.*` RPC or `--overwrite-template` waits for phase 2.
- Whether the sidebar shows Bots and Chats as head rows (nav items keyed `bots` / `chats`) or as sections like Projects; the names hold either way.
- Whether the 2026-09-18 "Bot limits" wording on Connections (`docs/audits/2026-09-18-channel-chat-authority-and-limits.md`) becomes "Connection limits" if that row returns; the app has no such label today.
