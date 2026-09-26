# Plan: the daemon-side Bot resource

Date: 2026-09-26. Scope: decisions D1, D2, D3, D4, D10, D11, D12, D13, D14 of
[Bots and Chats](../README.md). Chat (D5–D9), the app, and the Hub are other plans. Every path
below was opened while writing this; line numbers are for the tree at commit `845cc4122`.

Names `Bot`, `bot.*`, `bots` are provisional (README, line 3). Do not rename mid-plan; the naming
pass renames once.

## Ownership and limits

| Class          | Paths                                                                                                                                                                | Rule                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Fusion-owned   | `packages/server/src/server/bots/**` (new), `packages/server/src/server/managed-access/**`, `packages/protocol/src/bot/**` (new), `packages/cli/src/commands/bot/**` | Files under 500 lines, functions under 40, nesting ≤ 3 (CLAUDE.md)      |
| Upstream seams | `session.ts`, `websocket-server.ts`, `bootstrap.ts`, `config.ts`, `persisted-config.ts`, `messages.ts`, `daemon-client.ts`, `operation-permissions.ts`               | Additive hunks only: one `case`, one field, one option. No reformatting |

`operation-permissions.ts` is upstream-shaped but Fusion-maintained (it already lists
`terminal.profile.list.request` at :192). Treat it as a seam.

## 1. Bot record store

### Files

| File                                           | Lines | Content                                                                                                           |
| ---------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/bot/types.ts`           |   ~80 | `BotKindSchema`, `BotLaunchDefaultsSchema`, `StoredBotSchema`, `BotPayloadSchema`; pure zod, no transforms        |
| `packages/server/src/server/bots/bot-store.ts` |  ~220 | `BotStore`: `list/get/getBySlug/getByProjectId/create/update/archive`; per-id mutation queue; invalid-file report |
| `packages/server/src/server/bots/bot-slug.ts`  |   ~60 | `botSlug(name)`, `uniqueBotSlug(name, taken, dirExists)`                                                          |
| `packages/server/src/server/bots/bot-home.ts`  |   ~80 | `resolveBotHome(request, root)`, home-root and nested-Project refusals                                            |
| `packages/server/src/server/bots/index.ts`     |   ~30 | `createBotService(deps)` — the one factory `bootstrap.ts` calls                                                   |

### Schema (`packages/protocol/src/bot/types.ts`)

Precedent: `packages/protocol/src/schedule/types.ts` is imported by
`packages/server/src/server/schedule/store.ts:5` as `@getpaseo/protocol/schedule/types`; the
protocol package exports every file by path (`packages/protocol/package.json:11`). The record
schema lives in protocol so the store, the wire payload, and the app share one type.

```ts
BotKindSchema = z.enum(["personal", "team"]);
BotLaunchDefaultsSchema = AgentProfileSchema.pick({
  provider,
  model,
  modeId,
  thinkingOptionId,
  featureValues,
});
// packages/protocol/src/agent-profile.ts:12 — same field names as AgentSessionConfig, on purpose
StoredBotSchema = z
  .object({
    id: z.string(), // "bot_<16 hex>"
    slug: z.string(), // immutable directory name (D3)
    name: z.string(), // display name
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
    kind: BotKindSchema,
    projectId: z.string(), // prj_…
    workspaceId: z.string(), // wks_…
    cwd: z.string(), // exact directory, never re-derived
    launch: BotLaunchDefaultsSchema,
    template: z.object({ id: z.string(), seededAt: z.string() }).nullable(),
    owner: SessionActorSchema, // packages/protocol/src/session-authorship.ts:5
    scheduleIds: z.array(z.string()).optional(),
    heartbeatIds: z.array(z.string()).optional(),
    skillIds: z.array(z.string()).optional(),
    mcpToolPolicy: z.unknown().optional(), // references by id only (D2); shape decided later
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();
BotPayloadSchema = StoredBotSchema; // wire = record; nothing runtime in it (D2)
```

`owner` reuses `SessionActor` because agents already record `createdBy` that way
(`packages/server/src/server/agent/agent-manager.ts:4077`). A local owner session has no actor
(`OWNER_SESSION_ADMISSION` at `packages/server/src/server/websocket-server.ts:583` carries only
`principalId: "owner"`), so the store writes `{ kind: "user", id: "owner" }` when
`Session.accountActor` (`session.ts:703`) is undefined.

### Store

Copy the shape of `packages/server/src/server/schedule/store.ts`:

- Path `$PASEO_HOME/bots/{botId}.json`; `writeJsonFileAtomic` from
  `packages/server/src/server/atomic-file.ts:23` (temp file in the same directory, rename).
- `list()` reads the directory, `safeParse`s each file, reports an invalid file once
  (`store.ts:117-140`), never throws on one bad record.
- Per-id mutation queue (`store.ts:100`), so `update` is read-merge-write behind the store
  surface (data-model.md "Store Surface Rules").
- `mkdir` of `$PASEO_HOME/bots` happens on the first write, never at construction, so a
  flag-off daemon and a flag-on daemon with no bots leave the home byte-identical.
- Ids: `bot_${randomBytes(8).toString("hex")}`, the `wks_`/`prj_` pattern at
  `packages/server/src/server/workspace-registry-model.ts:13-17`.

### Slug and uniqueness

- `botSlug(name)` = `slugify` from `packages/protocol/src/branch-slug.ts:44` (lowercase,
  non-alphanumerics to `-`, trimmed, max 50). Empty result (name was all symbols) → `bot`.
- Unique per Host: taken = every bot record's `slug` (archived included, the directory still
  exists) ∪ any existing entry under `root`. Collision → `-2`, `-3`, … The check and the
  directory creation run under the store's queue so two `bot.create` calls cannot race.
- The slug never changes; `bot.update` cannot carry it (schema omits it).

### `daemon.bots.root`

- Persisted: `daemon.bots: { enabled?: boolean, root?: string }` added to the `.strict()` daemon
  object in `packages/server/src/server/persisted-config.ts:265-298`, next to `managedAccess`.
- Resolved in `config.ts` like `resolveWorktreesRoot` (`packages/server/src/server/config.ts:499-512`):
  trim, `expandTilde`, absolute → `path.resolve`, relative → under `paseoHome`; absent →
  `path.join(paseoHome, "workspaces")`. The CLI's assistant already lives at
  `workspaces/default` (api-first onboarding audit), so the default keeps it beside the bots.
- Startup-only: it is not in `SupportedMutableConfigPatch`
  (`packages/server/src/server/daemon-config-store.ts:19-35`), so a reload reports it as
  restart-required through the existing startup-snapshot comparison (data-model.md:192-194).
  Verify with `daemon-config-store.test.ts` that an edit to `daemon.bots.root` lands in
  `restartRequiredPaths`.
- Regenerate the public config schema: `packages/server/scripts/generate-config-schema.ts`
  writes `packages/website/public/schemas/paseo.config.v1.json`.

## 2. Feature flag

Template: `agentSessionStorage`, the one existing Fusion flag on the daemon.

| Step        | Where                                                                                                       | What                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| env → value | `packages/server/src/server/config.ts:79` `parseBooleanEnv`; `:686-694` `resolveAgentSessionStorageFeature` | New `resolveBotsConfig(env, persisted, paseoHome)`: `enabled = parseBooleanEnv(env.PASEO_BOTS_ENABLED) ?? persisted.daemon?.bots?.enabled ?? false`; `root` as above                             |
| config type | `packages/server/src/server/bootstrap.ts:431` `agentSessionStorage?: boolean`                               | Add `bots?: { enabled: boolean; root: string }` to `PaseoDaemonConfig`; `loadConfig` (`config.ts:618-660`) fills it                                                                              |
| override    | `config.ts:800-806` `resolveServiceAndWebUiOverridePaths`                                                   | Push `"daemon.bots.enabled"` when `PASEO_BOTS_ENABLED` is set, so a reload names it as override-controlled                                                                                       |
| wiring      | `bootstrap.ts` where `scheduleService` is built (`:1557`)                                                   | `const botService = config.bots?.enabled ? createBotService({...}) : null`; pass to `VoiceAssistantWebSocketServer` as one more trailing optional positional (`websocket-server.ts:752` pattern) |
| server_info | `websocket-server.ts:2050` `...(this.workspaceLabelService ? { workspaceLabels: true } : {})`               | `...(this.botService ? { bots: true } : {})`                                                                                                                                                     |
| protocol    | `packages/protocol/src/messages.ts:3658-3760` features object                                               | `bots: z.boolean().optional()` with the tag below                                                                                                                                                |
| app         | `packages/app/src/runtime/host-features.ts:33` `useHostFeature(serverId, "bots")`                           | `HostFeatureName` is derived from the protocol type; nothing else to declare                                                                                                                     |

COMPAT tag format, copied from the Clisbot one at `messages.ts:3723`:

```ts
// COMPAT(bots): Clisbot Bots, added 2026-09-26; remove the gate after 2027-03-26 once the daemon floor advertises it.
bots: z.boolean().optional(),
```

Flag off, byte-for-byte (D10 and the invariant): `botService === null` → no `bots` in
`server_info`, no `$PASEO_HOME/bots` directory, `Session.botSession === null`, and every
`bot.*` request answers `rpc_error { code: "bots_disabled" }` (loud, per
`docs/lessons/2026-08-26-integration-seams-before-live-e2e.md`). Upstream clients never send
`bot.*`, so nothing they observe changes. `packages/server/src/server/upstream-compatibility.test.ts:36`
`FORK_TERMS` gains `|\bbots?\b`; the default test daemon runs flag-off, so that test now proves
the flag-off contract.

## 3. Creating a bot on the daemon

### How the CLI does it today (through the client)

`provisionAssistant` (`packages/cli/src/commands/bot/assistant-workspace.ts:29-63`):
`ensureWorkspaceDir` (mkdir -p) → `client.createWorkspace({ source: { kind: "directory", path },
title })` (`:106`) → `seedWorkspaceTemplate(directory, botType, overwrite, provider)` on the CLI's
own disk → `client.createAgent({ cwd, workspaceId, labels: { "clisbot.assistant": name } })`
(`:122-158`). Daemon side, `workspace.create.request` with a `directory` source lands in
`handleWorkspaceCreateLocal` (`packages/server/src/server/session.ts:7080-7133`), which calls
`workspaceProvisioning.createWorkspaceForDirectory(cwd, title, projectId)`
(`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:219-243`).
With no `projectId` that falls to `findOrCreateProjectForDirectory` (`:193`), which allocates a
Project **for the exact directory** (`projectRegistry.getOrCreateActiveByRoot`,
`packages/server/src/server/workspace-registry.ts:409`) — so each bot is its own Project (D4) by
construction. A non-git directory yields workspace kind `directory`
(`packages/server/src/server/workspace-registry-model.ts:24-26`).

### The daemon sequence for `bot.create.request`

Lives in `packages/server/src/server/bots/bot-session.ts` (`BotSession`, the sub-handler shape of
`packages/server/src/server/session/schedule/schedule-session.ts:15-24`: `host.emit` plus injected
services). `session.ts` only constructs it and adds one `case` per RPC.

| #   | Step                                                                                                                                                 | Reuses                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Validate: `name` non-empty, `kind`, `launch.provider` present and known to this daemon                                                               | `providerSnapshotManager.getSnapshot().records` as `bootstrap.ts:1420` does; unknown → `errorCode: "provider_unavailable"` (the CLI's own check at `assistant-workspace.ts:35`)                                                                                                                                                                             |
| 2   | Resolve home: `request.path ?? join(root, uniqueBotSlug(name))`; `expandTilde`                                                                       | `bot-home.ts`                                                                                                                                                                                                                                                                                                                                               |
| 3   | Refuse home root and nesting: realpath equals `homedir()` → `home_root`; inside or containing any active Project root → `inside_project`             | home-root rule from `packages/cli/src/commands/bot/workspace-template.ts:58-64`; containment via `isSameOrDescendantPath` (`packages/server/src/server/path-utils.ts`, used at `managed-access/project-folder-policy.ts:49`)                                                                                                                                |
| 4   | Restricted session only: `authorization.allowsDaemonPrivilege("workspace.manage")` and `resourceAuthorizer.mayCreateProjectAt(home)`                 | §5 authorization; the folder policy at `project-folder-policy.ts:41-53`                                                                                                                                                                                                                                                                                     |
| 5   | `mkdir(root, { recursive: true })`, then the bot directory + Project in one call                                                                     | `createProjectDirectory({ parentPath: root, name: slug }, { registerProject: workspaceProvisioning.findOrCreateProjectForDirectory })` (`packages/server/src/server/project-directory-service.ts:47`): validates the name, `mkdir` (non-recursive), registers, `rmdir` on failure. Explicit `path`: `mkdir -p` then `findOrCreateProjectForDirectory(path)` |
| 6   | Workspace: `workspaceProvisioning.createWorkspaceForDirectory(home, name, project.projectId)`                                                        | `workspace-provisioning-service.ts:219`; then the three post-create calls the session makes at `session.ts:7101-7106` (`syncWorkspaceGitObserverForWorkspace`, `describeWorkspaceRecord`, `emitCreatedWorkspaceUpdate`) through a `host.workspaceCreated(workspace)` callback                                                                               |
| 7   | Seed: `seedBotTemplate(home, kind, overwrite, launch.provider)`                                                                                      | §4                                                                                                                                                                                                                                                                                                                                                          |
| 8   | Name the Project for the Access picker: `projectRegistry.update(projectId, customName = name)`                                                       | The Hub receives `customName ?? displayName` (`bootstrap.ts:1431`); without this a shared bot shows as its slug                                                                                                                                                                                                                                             |
| 9   | Write the record (`template.seededAt = now`, `owner` from `accountActor`)                                                                            | `bot-store.ts`                                                                                                                                                                                                                                                                                                                                              |
| 10  | Optional idle agent when `startAgent: true`: `host.createAgent({ config: { ...launch, cwd: home }, workspaceId, labels: { "clisbot.bot-id": id } })` | `createSessionAgent` (`session.ts:4529`) behind a host callback; label mirrors the CLI's `clisbot.assistant` (`assistant-workspace.ts:125`)                                                                                                                                                                                                                 |
| 11  | Emit `bot.create.response`; the store's change event fans out `bot.updated` to every session (§5)                                                    |                                                                                                                                                                                                                                                                                                                                                             |

Failure after step 5: remove what this call made and answer the error — `workspaceRegistry`
archive of the new workspace and `projectRegistry.remove(projectId)`, the two store calls
`handleProjectRemoveRequest` makes (`session.ts:3889-3935`). The directory is left in place only
when it existed before the call. Do not reuse `rollbackFailedImportWorkspace`
(`workspace-provisioning-service.ts:168`); it is import-specific.

Idempotency: a second `bot.create` with the same explicit `path` returns the existing bot and
re-runs seeding (which creates only missing files), the behavior `createAssistantWorkspace`
(`assistant-workspace.ts:94-104`) gives the CLI today. A same `name` without `path` makes a
second bot with a suffixed slug: names are not unique, slugs are.

Project-creation constraints, restated from `docs/features/access/terminal-and-project-creation.md`
§Project creation: only a Host grant with `workspace.manage` creates; the Host folder policy
(`PASEO_PROJECT_FOLDERS_ALLOW/DENY`) plus the grant's `projectFolders` narrow where; never inside
an existing Project. The root itself is never a Project (D3); step 3 enforces that for every
session, not only restricted ones, because a nested bot Project would break D13.

## 4. Template migration (D11)

### Today

- Catalog: `packages/cli/src/commands/bot/templates/{default,customized/default,customized/{personal,team}-assistant}/*.md`
  (15 files, listed 2026-09-26). Read at runtime by `workspaceTemplate()` through
  `new URL("./templates/${layer}/", import.meta.url)` (`workspace-template.ts:39-48`).
- Build: `packages/cli/package.json:19` runs `node scripts/copy-templates.mjs`, which copies
  `src/commands/bot/templates` → `dist/commands/bot/templates`.
- Seeding rules (`workspace-template.ts:53-77`): `mkdir -p`; refuse the OS home root; treat a
  missing `BOOTSTRAP.md` as completed onboarding only when all six context files exist; `open(..., "wx")`
  never overwrites; symlinks are never followed (`lstat`, `:88`, `:103`, `:134`); explicit overwrite backs
  up into a private in-workspace directory and installs atomically (`:159-176`); provider `claude`
  / `gemini` get a `CLAUDE.md` / `GEMINI.md` symlink to `AGENTS.md`.
- Tests: `packages/cli/src/commands/bot/workspace-template.test.ts` (6 cases; sha256 pins of the
  clisbot-main catalog at `:8-31`).

### Move

| From                                                               | To                                                                                                    | Change                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/bot/templates/**`                       | `packages/server/src/server/bots/templates/**`                                                        | `git mv`; content untouched (hash pins stay valid)                                                                                                                                                                                 |
| `packages/cli/src/commands/bot/workspace-template.ts`              | `packages/server/src/server/bots/template-seeding.ts`                                                 | `git mv`; `BotType` import from `./plan.js` → `BotKind` from `@getpaseo/protocol/bot/types`; export `seedBotTemplate`, `botTemplate`; keep the six rules verbatim                                                                  |
| `packages/cli/src/commands/bot/workspace-template.test.ts`         | `packages/server/src/server/bots/template-seeding.test.ts`                                            | `git mv`; imports only; run with `npx vitest run <file> --bail=1` from `packages/server`                                                                                                                                           |
| `packages/cli/scripts/copy-templates.mjs` + `package.json:19` step | deleted                                                                                               | The CLI no longer ships markdown                                                                                                                                                                                                   |
| `packages/server/package.json:76` `build:lib` `node -e` block      | append `fs.cpSync('src/server/bots/templates','dist/server/server/bots/templates',{recursive:true});` | Same mechanism as `src/terminal/shell-integration`; `tsconfig.server.json` `outDir ./dist/server`, `rootDir ./src`, so `import.meta.url` resolves to `dist/server/server/bots/` at runtime; `files` already includes `dist/server` |

`template.id` in the record is `${kind}-assistant` for now (the only catalog). Template overwrite
(`--overwrite-template`) becomes `bot.create.request.template.overwrite`; it is restricted to
sessions that may create (it replaces memory files).

### CLI after the move

- `BotStartDeps` (`packages/cli/src/commands/bot/run.ts:118-150`): drop `seedTemplate`,
  `createWorkspace`, `createIdleAgent`, `ensureWorkspaceDir`; add
  `createBot(client, input): Promise<BotCreateResult>` backed by `client.createBot(...)`.
- `provisionAssistant` (`assistant-workspace.ts:29`): if `client.getLastServerInfoMessage()?.features?.bots`
  is not `true`, throw `"This Host does not support bots; update it."` (feature contract: no
  fallback, `docs/protocol-compatibility.md`). Otherwise one call:
  `createBot({ name, kind: botType, path: plan.workspacePath, launch: { provider, model, modeId }, template: { overwrite }, startAgent: true })`.
  `plan.isolation === "worktree"` is refused for bots (a bot home is a directory, D3/D4).
- Reuse path `resolveAssistantResources` (`run.ts:222-245`): re-seeding on restart becomes
  `bot.create` with the manifest's `path` (idempotent, §3). Remove the `isOnboardingEnabled`
  branch around seeding; `CLISBOT_ONBOARDING_ENABLED=0` keeps its meaning for the Hub steps only.
- Manifest (`packages/cli/src/commands/bot/manifest.ts:12-26`) gains optional `botId`.
- `bot list` (`list.ts`) stays manifest + channel-status based this phase; note in the task that
  it does not read `bot.list` yet.
- `createAssistantAgent` / `findAssistantWorkspace` stay for `hub init` callers until those move.

## 5. RPCs

### Schemas (`packages/protocol/src/messages.ts`)

Dotted names per `docs/rpc-namespacing.md`; params top-level on requests, results under
`payload` with `requestId` on both. Every new field `.optional()`, no transforms, discriminated
unions only (`docs/protocol-validation.md`). Generated validators regenerate through the protocol
package's `pretest`/`prebuild` hooks; nothing to run by hand.

| Message                | Shape                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot.create.request`   | `{ requestId, name, kind?, description?, path?, launch: BotLaunchDefaults, template?: { overwrite?: boolean }, startAgent?: boolean }`                                        |
| `bot.create.response`  | `{ payload: { requestId, bot: BotPayload \| null, agent?: AgentSnapshotPayload, template?: { created, skipped, overwritten? }, error: string \| null, errorCode?: string } }` |
| `bot.list.request`     | `{ requestId, includeArchived?: boolean }`                                                                                                                                    |
| `bot.list.response`    | `{ payload: { requestId, bots: BotPayload[], error: string \| null } }`                                                                                                       |
| `bot.update.request`   | `{ requestId, botId, name?, title?, description?, avatar?, launch?: BotLaunchDefaults }` — no `slug`, `cwd`, `projectId`, `workspaceId`                                       |
| `bot.update.response`  | `{ payload: { requestId, bot: BotPayload \| null, error: string \| null } }`                                                                                                  |
| `bot.archive.request`  | `{ requestId, botId }`                                                                                                                                                        |
| `bot.archive.response` | `{ payload: { requestId, botId, archivedAt: string \| null, error: string \| null } }`                                                                                        |
| `bot.updated` (push)   | `{ payload: z.discriminatedUnion("kind", [{ kind: "upsert", bot }, { kind: "remove", botId }]) }`                                                                             |

Error codes: `bots_disabled`, `provider_unavailable`, `home_root`, `inside_project`,
`access_denied`, `bot_not_found`, `directory_exists` (explicit `path` already holds a different
bot's home).

Insert the request schemas into `SessionInboundMessageSchema` (`messages.ts:3279`) and the
responses plus push into `SessionOutboundMessageSchema` (`:6954`). Both are `satisfies`-checked
against the permission maps, so the build fails until §5 classification lands.

Test: `packages/protocol/src/messages.bots.test.ts`, the shape of
`messages.workspace-labels.test.ts:1-45` (feature optional for old daemons; each request/response
parses; the push union rejects an unknown `kind`).

### Client (`packages/client/src/daemon-client.ts`)

`createBot`, `listBots`, `updateBot`, `archiveBot` via `sendCorrelatedSessionRequest`
(`:1960`), copying `setWorkspaceTitle` (`:3049-3066`). Subscribe to `bot.updated` with the same
raw-observer path the SDK uses for `workspace_update`. Tests in `packages/client/src/index.test.ts`
(pattern at `:591-608`).

### Session dispatch (`packages/server/src/server/session.ts`)

- Field `private readonly botSession: BotSession | null`, built in the constructor beside
  `terminalProfileSession` (`:1166-1170`) when `options.botService` is set;
  `SessionOptions.botService?: BotService` (`:427-530`).
- New `dispatchBotMessage(msg)` next to `dispatchScheduleMessage` (`:3310`): four `case`s call
  `this.botSession?.handle*(msg)`; when `botSession` is null they emit
  `rpc_error { code: "bots_disabled" }` via the `emitScheduleRpcError` shape
  (`schedule-session.ts:36-61`).
- `createSocketSession` (`websocket-server.ts:1575-1640`): `botService: this.botService ?? undefined`.

### Authorization classification

`packages/server/src/server/authorization/operation-permissions.ts` — both maps are
`satisfies Record<…>`, so the compiler enforces completeness:

| Operation             | Permission                            | Why                                                                                                     |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `bot.create.request`  | `["workspace.manage", "hub.execute"]` | Creates a Project; same class as `project.add.request` (`:163`) and `workspace.create.request` (`:228`) |
| `bot.list.request`    | `["workspace.read", "hub.execute"]`   | Like `fetch_workspaces_request` (`:96`)                                                                 |
| `bot.update.request`  | `["workspace.manage", "hub.execute"]` | Edits the bot's Project-level defaults; same as `workspace.title.set.request` (`:216`)                  |
| `bot.archive.request` | `["workspace.manage", "hub.execute"]` | Archives a workspace; same as `archive_workspace_request` (`:39`)                                       |
| responses             | mirror the request                    |                                                                                                         |
| `bot.updated`         | `["workspace.read", "hub.execute"]`   | Like `workspace_update` (`:471`)                                                                        |

`hub.execute` is included so a Route targeting a Bot (phase 2) can list and create without a new
permission; `authorization/index.test.ts:40` "owner authority covers every session operation"
picks the new types up automatically.

Restricted (Managed Access) sessions — `ManagedResourceAuthorizer.allowsInbound`
(`packages/server/src/server/managed-access/resource-authorizer.ts:701`) ends with a generic tail
that passes any message without `agentId`/`workspaceId`/`projectId`/`cwd` (`:753-758`). A
`bot.update`/`bot.archive` request carries only `botId`, so without an explicit rule every Member
could edit every bot. Add `packages/server/src/server/managed-access/bot-access.ts` and call it
from three places:

| Seam                                                                     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowsInbound` before the generic tail (`:735`)                         | `bot.create.request` → `authorization.allowsDaemonPrivilege("workspace.manage")` (Host grants create; the path check runs in step 4 of §3 through a new public `mayCreateProjectAt(path)` that wraps `:307-316`), and record `admittedProjectCreations.add(requestId)`. `bot.update`/`bot.archive` → `allowsProject(bot.projectId, "workspace.manage")` via an injected `resolveBotProjectId(botId)`; unknown bot → false. `bot.list` → true (the response is filtered) |
| `allowsOutboundListProjection` (`:403`)                                  | `bot.list.response`: every `bot.projectId` allowed with `project.use`; otherwise filter is not enough — the handler must filter before emit, so `BotSession.handleList` filters with `authorizer.allowsProject` and the authorizer only asserts                                                                                                                                                                                                                         |
| `allowsOutboundResourceUpdate` (`:447`)                                  | `bot.updated` upsert → `allowsProject(bot.projectId)`; remove → previously visible bot id, the `visibleWorkspaceIds` idiom                                                                                                                                                                                                                                                                                                                                              |
| `PROJECT_CREATION_REPLIES` (`managed-access/workspace-management.ts:15`) | add `bot.create.response`, so the creator receives the reply for a Project not yet in its ticket (`resource-authorizer.ts:381-386`)                                                                                                                                                                                                                                                                                                                                     |

`resource-authorizer.ts` is 1544 lines; keep the additions to one-line calls into `bot-access.ts`.

### How the principal reaches the handler

The ticket's `SessionActor` arrives as `admission.actor` (`packages/server/src/server/hub/relationship-remote.ts:347`)
→ `createSocketSession({ accountActor: admission.actor })` (`websocket-server.ts:1481`) →
`Session.accountActor` (`session.ts:703`), replaced on lease refresh (`:2424-2430`). `BotSession`
takes `actor: () => this.accountActor` the way `createTerminalProfileSession` takes
`actorId: () => this.accountActor?.id` (`:1169`), and writes `owner = actor() ?? { kind: "user", id: "owner" }`.
`principalId` itself never reaches `Session` (it stays on `SessionConnectionBase`,
`websocket-server.ts:1549`); do not thread it, the actor is the durable identity every other record
uses.

## 6. Sharing via Project grants (D13): what the code already gives

| Need                                                   | Present                                                                                                                                                                                                                                                  | Missing                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bot's Project reaches the Hub Access picker        | `projectRegistry.subscribeToMutations` → `publishProjects` (`bootstrap.ts:1458-1463`); snapshot is `{ projectId, name, agentConfigurationCatalog, terminalProfileCatalog }` (`:1419-1433`, Hub schema `packages/hub/src/access/daemon-projects.ts:9-18`) | The snapshot has no "this is a bot" marker; the picker lists it as a Project named after the slug unless step 8 of §3 sets `customName`. A marker is a Hub/app change, later                                                                          |
| A Member with a Project grant sees the bot's workspace | `fetch_workspaces_response` filtered by `allowsProject(workspace.projectId)` (`resource-authorizer.ts:428`); `workspace_update` likewise (`:459`)                                                                                                        | `bot.list` filtering (§5) so the bot row itself appears                                                                                                                                                                                               |
| The Member creates a session in the bot's workspace    | `create_agent_request` with `workspaceId` → `allowsAgentConfiguration(workspaceId, config)` (`:791`); a Developer grant carries `agent.create`                                                                                                           | The Member's Agent configuration grant must cover the bot's `launch.provider/model`; a bot whose defaults the grant excludes is visible but not startable. The app must show the reason; the daemon returns the existing `access_denied`              |
| The Member's session runs under their own ticket       | `createdBy` on the agent = the Member's actor (`agent-manager.ts:4077`); sessions on one cwd are independent (data-model.md:89)                                                                                                                          | Nothing                                                                                                                                                                                                                                               |
| Only a Host grant may create a bot                     | §5 (`allowsDaemonPrivilege("workspace.manage")`), the same rule as Add project                                                                                                                                                                           | The creator's ticket does not cover the new Project until the lease refresh (access README "A new Project is not in the creator's current ticket"); `bot.update` right after `bot.create` fails for a restricted creator until then. Accept; document |
| Can share                                              | Hub-side, unchanged (`packages/hub/src/access/grantor.ts`)                                                                                                                                                                                               | Nothing                                                                                                                                                                                                                                               |

Conclusion: a grant on the bot's Project is enough for a Member to open the workspace and create
sessions. The daemon gap is the `bot.list` projection and the `customName`; the rest is app copy.

## 7. Archive and delete (D14)

- `bot.archive.request` → `host.archiveWorkspace(workspaceId, requestId)` running exactly
  `handleArchiveWorkspaceRequest`'s `archiveByScope` call (`session.ts:7780-7818`,
  `packages/server/src/server/workspace-archive-service.ts`). For a `directory` workspace the
  service archives agents, kills terminals and the record, and removes no directory (`:121`
  comment: only a Paseo-owned worktree root is deleted). Then `botStore.archive(botId)` sets
  `archivedAt`. The Project stays registered so `workspace.recovery.restore.request` can bring the
  workspace back.
- `bot.list` omits archived bots unless `includeArchived`.
- Restore: not in the README RPC list. Recommend `bot.update.request { archivedAt: null }` is
  **not** the way (the field is omitted from update); add `bot.restore` in phase 2 alongside the
  workspace restore it must call. Phase 1 ships archive only.
- Delete directory: "a separate confirmed action" (D14). No daemon RPC deletes a Project root
  today (`project.remove.request` removes the registry entry and archives workspaces,
  `session.ts:3889-3935`; `fs.entry.delete.request` works under a cwd). Phase 1: the app offers
  **Remove from Paseo** = `bot.archive` then `project.remove.request`, and tells the user the
  folder stays. A `bot.delete { deleteDirectory: true }` RPC is phase 2 and needs its own
  `workspace.manage` + folder-policy check.

## 8. Test plan

Rules: one file at a time, `npx vitest run <file> --bail=1` from the package directory
(`docs/testing.md`, memory note). Real registries and a real temp home over mocks.

| Layer         | File                                                                                                                                                                  | Proves                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol      | `packages/protocol/src/messages.bots.test.ts` (new)                                                                                                                   | Optional feature parses on old `server_info`; each RPC parses; push union rejects unknown `kind`                                                                                                                                                                                                   |
| Protocol      | `packages/protocol/src/bot/types.test.ts` (new)                                                                                                                       | `StoredBotSchema` round-trip; `launch` accepts an `AgentProfile` minus id/name                                                                                                                                                                                                                     |
| Config        | `packages/server/src/server/config-clisbot-defaults.test.ts` (extend)                                                                                                 | Off by default; `PASEO_BOTS_ENABLED=1` and `daemon.bots.enabled` turn it on; env beats config; `root` default `workspaces`, relative resolves under home, `~` expands                                                                                                                              |
| Config        | `packages/server/src/server/persisted-config.test.ts` (extend)                                                                                                        | Strict daemon object accepts `bots`; unknown key inside `bots` is rejected                                                                                                                                                                                                                         |
| Config        | `packages/server/src/server/daemon-config-store.test.ts` (extend)                                                                                                     | Editing `daemon.bots.root` reports restart-required                                                                                                                                                                                                                                                |
| Store         | `packages/server/src/server/bots/bot-store.test.ts` (new)                                                                                                             | Atomic write (no `.tmp` left), list skips and reports one invalid file, per-id updates serialize, directory created on first write only                                                                                                                                                            |
| Slug          | `packages/server/src/server/bots/bot-slug.test.ts` (new)                                                                                                              | `"Ops Bot!"` → `ops-bot`; collision → `ops-bot-2`; symbol-only name → `bot`; existing directory counts as taken                                                                                                                                                                                    |
| Seeding       | `packages/server/src/server/bots/template-seeding.test.ts` (moved, 6 cases unchanged)                                                                                 | The pinned catalog and the six seeding rules                                                                                                                                                                                                                                                       |
| Session unit  | `packages/server/src/server/bots/bot-session.test.ts` (new, `schedule-session.test.ts:9-16` shape)                                                                    | Each handler's success and error reply; flag-off `rpc_error`; owner from actor or local; list filtered for a restricted authorizer stub                                                                                                                                                            |
| Authorization | `packages/server/src/server/managed-access/bot-access.test.ts` (new) + `workspace-management.test.ts` (extend)                                                        | `bot.update` on an ungranted Project refused; `bot.create` needs the Host privilege; `bot.create.response` passes for the admitted `requestId` only                                                                                                                                                |
| Authorization | `packages/server/src/server/authorization/index.test.ts` (no change, re-run)                                                                                          | Owner covers the new operations; the compile-time `satisfies` covers the maps                                                                                                                                                                                                                      |
| Daemon e2e    | `packages/server/src/server/bots/bots.e2e.test.ts` (new; `createTestPaseoDaemon({ bots: { enabled: true } })`, add that option to `test-utils/paseo-daemon.ts:17-56`) | create → `bots/{id}.json`, Project root = dir, one `directory` workspace, 9 files seeded, `CLAUDE.md` symlink for `claude`; list; update name keeps slug; archive keeps the directory; second create at the same `path` is idempotent; `startAgent` yields an idle agent labelled `clisbot.bot-id` |
| Managed e2e   | `packages/server/src/server/managed-access/bot-management.e2e.test.ts` (new; fixture from `project-management.e2e.test.ts:30-90`)                                     | Full access on the Host creates under the root; denied folder refuses; a bot inside an existing Project refuses; Developer on the bot's Project lists it and creates an agent in its workspace; Developer on another Project sees nothing                                                          |
| Flag-off      | `packages/server/src/server/upstream-compatibility.test.ts` (extend)                                                                                                  | `FORK_TERMS` catches `bots`; `bot.list.request` → `rpc_error bots_disabled`; `$PASEO_HOME/bots` absent after start                                                                                                                                                                                 |
| Client        | `packages/client/src/index.test.ts` (extend)                                                                                                                          | Each method sends the request and resolves on the correlated response; rejects on `error`                                                                                                                                                                                                          |
| CLI           | `packages/cli/src/commands/bot/run.test.ts` (extend), `assistant-workspace.test.ts` (extend)                                                                          | `provisionAssistant` calls `createBot` once with the plan; throws on a Host without `features.bots`; manifest records `botId`                                                                                                                                                                      |

Byte-equivalence check for the flag-off state, run by hand once and asserted in the e2e above:
start two test daemons from empty homes, one from this branch and one from `upstream/main` (the
`versioned-daemon.ts` helper in `test-utils` starts a packaged daemon), diff `server_info` and the
home directory listing.

## 9. Risks and open questions

| #   | Risk / question                                                                                                                                                              | Recommendation                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `session.ts` (9431 lines) and `websocket-server.ts` grow by a positional constructor parameter and a dispatch block; upstream merge conflicts on those seams                 | Keep each seam to one hunk; put every line of logic in `bots/`. Record the diff in a `upstream-blast-radius.md` for this feature after task 12                                                                        |
| 2   | `mayCreateProjectAt` needs a canonical path for a directory that does not exist yet                                                                                          | `project.create_directory` already checks `parent + name` before `mkdir` (`workspace-management.ts:60-63`), so `canonicalPathForAuthorization` handles a missing leaf; add a unit case to be sure                     |
| 3   | The default root `$PASEO_HOME/workspaces` may fall under a deny pattern or lie outside `PASEO_PROJECT_FOLDERS_ALLOW` on a locked-down Host                                   | The e2e proves the default policy allows it (`DEFAULT_PROJECT_FOLDER_POLICY` denies `/`, `~`, `~/.ssh/**`, `/etc/**`); the error `access_denied` names the rule in the message; the operations doc lists the env vars |
| 4   | A user or another tool opens the root as a Project, blocking every later bot for restricted sessions (D3)                                                                    | Step 3 of §3 refuses `inside_project` with a message naming the Project; the app plan should hide the root from Add project                                                                                           |
| 5   | `workspaceProvisioning.createWorkspaceForDirectory` runs git discovery; a bot directory that later gains `.git` reclassifies to `local_checkout`                             | Acceptable; nothing keys on `kind === "directory"` in this plan. Open question in the README (`git init` in bot directories) stays open                                                                               |
| 6   | Restricted creator cannot `bot.update` its new bot until the lease refresh admits the new Project                                                                            | Documented in access README; the app disables edit until `project.update` arrives for that Project                                                                                                                    |
| 7   | Provider validity at create: the daemon checks the provider exists, not that the creator's grant allows it; a restricted creator could persist launch defaults it cannot use | Acceptable: sessions are checked at `create_agent_request`; no privilege escalation. Note in the error copy                                                                                                           |
| 8   | Two `bot.create` calls racing on the same slug                                                                                                                               | Slug allocation and `createProjectDirectory` run under the store's queue; `mkdir` without `recursive` fails on an existing directory, so the second caller gets `-2`                                                  |
| 9   | Hub Access picker shows bot Projects among code Projects                                                                                                                     | `customName = bot name` now; a `kind` marker on the Project snapshot is a Hub change for the sharing plan                                                                                                             |
| 10  | `bot.updated` fan-out across sessions                                                                                                                                        | `BotStore` emits change events; each `BotSession` subscribes in its constructor and unsubscribes in `Session.dispose` (the `pluginRuntime.subscribe` idiom); the authorizer filters per session                       |
| 11  | `rpc_error` for flag-off changes nothing an upstream client observes, but a new app against an old Fusion daemon (no `bots` feature) must not call at all                    | The app gates on `useHostFeature(serverId, "bots")`; the CLI on `features.bots`; never fall back                                                                                                                      |
| 12  | Seeding writes files as mode `0600` (`workspace-template.ts:131`); Members' sessions run as the daemon user, so no change, but a future per-user OS isolation would break    | Out of scope; noted for the isolation phase                                                                                                                                                                           |
| 13  | `template.id` and `seededAt` are recorded, but there is no upgrade path when the catalog changes                                                                             | Keep the API-first onboarding rule: no implicit template upgrade; `template.overwrite` is the explicit path                                                                                                           |

## Ordered tasks

Each under about two hours. Run `npm run typecheck`, `npm run lint`, and the one test file you
touched after every task; `npm run build:client` / `build:server` when cross-package declarations
go stale.

1. **Protocol record schema.** Add `packages/protocol/src/bot/types.ts` (`BotKindSchema`,
   `BotLaunchDefaultsSchema` from `AgentProfileSchema.pick`, `StoredBotSchema`, `BotPayloadSchema`)
   and `types.test.ts`.
2. **Protocol messages.** Add the eight `bot.*` schemas and `bot.updated` to `messages.ts`, insert
   into the inbound (`:3279`) and outbound (`:6954`) unions, add `features.bots` with the COMPAT
   tag (`:3658`), write `messages.bots.test.ts`. The server build now fails on the permission maps
   until task 3.
3. **Authorization maps.** Classify the new operations in `operation-permissions.ts`; re-run
   `authorization/index.test.ts`.
4. **Config leaf and flag.** `persisted-config.ts` `daemon.bots`; `config.ts` `resolveBotsConfig`
   - override path; `bootstrap.ts` `PaseoDaemonConfig.bots`; extend `config-clisbot-defaults.test.ts`,
     `persisted-config.test.ts`, `daemon-config-store.test.ts`; regenerate the config JSON schema.
5. **Store and slug.** `bots/bot-store.ts`, `bots/bot-slug.ts`, `bots/index.ts`
   (`createBotService`), with `bot-store.test.ts` and `bot-slug.test.ts`.
6. **Template move.** `git mv` templates, seeding module and test into `bots/`; fix imports
   (`BotKind`); add the `cpSync` to `packages/server/package.json` `build:lib`; delete
   `packages/cli/scripts/copy-templates.mjs` and its build step; run the moved test from
   `packages/server`; run `npm run build:server` and confirm `dist/server/server/bots/templates`
   exists.
7. **Bot home rules.** `bots/bot-home.ts`: explicit path vs root+slug, home-root and
   inside-Project refusals; unit test with a temp home and a real `FileBackedProjectRegistry`.
8. **BotSession: list, update, archive.** `bots/bot-session.ts` with the `host` interface
   (`emit`, `archiveWorkspace`, `actor`); wire `SessionOptions.botService`, the constructor field,
   `dispatchBotMessage`, `createSocketSession`, the ws-server constructor parameter, and the
   `server_info` line. Flag-off path emits `rpc_error bots_disabled`. `bot-session.test.ts` for
   these three plus the flag-off reply.
9. **BotSession: create.** Steps 1–9 and 11 of §3 through host callbacks `workspaceCreated`,
   `removeProject`; the `customName` write; rollback on failure. Extend `bot-session.test.ts`.
10. **Optional idle agent.** `startAgent` through `host.createAgent` → `createSessionAgent`
    (`session.ts:4529`); label `clisbot.bot-id`. Test the label and `workspaceId` on the created
    agent.
11. **Managed Access.** `managed-access/bot-access.ts`; the three call sites in
    `resource-authorizer.ts`; public `mayCreateProjectAt`; `PROJECT_CREATION_REPLIES` +
    `bot.create.response`; `bot-access.test.ts`; extend `workspace-management.test.ts`.
12. **Daemon e2e.** `test-utils/paseo-daemon.ts` gains `bots`; `bots/bots.e2e.test.ts` (create,
    list, update, archive, idempotent path, seeded files, idle agent).
13. **Managed e2e and flag-off.** `managed-access/bot-management.e2e.test.ts`; extend
    `upstream-compatibility.test.ts` (`FORK_TERMS`, `bots_disabled`, no `bots/` directory).
14. **Client methods.** `daemon-client.ts` `createBot/listBots/updateBot/archiveBot` and the
    `bot.updated` observer; `index.test.ts` cases; `npm run build:client`.
15. **CLI on the RPC.** `BotStartDeps.createBot`; `provisionAssistant` and
    `resolveAssistantResources` call it; feature gate error; manifest `botId`; remove the dead
    deps; extend `run.test.ts` and `assistant-workspace.test.ts`; `hub init` path compiles.
16. **Docs.** `docs/data-model.md`: `bots/` in the directory layout and a "Bot" section
    (record table, atomic write, `daemon.bots` in the config block); the channel operations
    runbook gains the two env vars' effect on bot creation; `docs/features/bots-and-chats/README.md`
    status line to "phase 1 daemon built"; a `upstream-blast-radius.md` for this feature listing
    the seam hunks from tasks 2, 4, 8, 14.
