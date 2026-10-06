# Bots and Chats

App interaction contract: [2026-09-27 navigation, creation and shared panes](app-experience.md).

Date: 2026-09-26. Status: implementation in progress; see [verification and remaining work](implementation.md). Names decided 2026-09-26: **Bot** and
**Chat**, with **Bot kind** and **Transcript**, in [the glossary](../../glossary.md).

Grok-style teammates inside the Clisbot app: create a bot by name, chat with it, put several bots in
one chat, inspect files beside the chat, and explicitly open a bot session in the cowork view. The bot layer lives on the daemon and the app;
the Hub adds external channels, cross-Host chats, and chats with several humans later.

Context that led here: [the product vision](../../overview/product-vision.md) directions 2, 11, 12;
the assistant onboarding the CLI already ships ([API-first onboarding](../../audits/2026-09-06-api-first-onboarding.md));
the channel plane the Hub already runs ([channel platform](../channels/README.md)).

## What a Bot is

A Bot is a daemon resource: a named, durable agent persona with a home directory. It bundles four
things the daemon already has and adds nothing else at runtime:

| Part               | Existing thing                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Persona and memory | Instruction files in a directory (`AGENTS.md`, `SOUL.md`, `MEMORY.md`, …), the same set the CLI seeds today |
| Home               | One Project whose root is the bot directory, with one `directory` Workspace                                 |
| Launch defaults    | Agent controls with the shape of an Agent profile                                                           |
| Sessions           | Ordinary agent sessions created in the bot's Workspace                                                      |

The Hub's Channel account is not a Bot and keeps its glossary entry. A Route can start a Bot
(D15); the account stays the credential and audience owner.

## What a Chat is

A Chat is a daemon resource: one conversation between the user and one or more Bots on the same
daemon, with its own transcript. A direct chat is a Chat with one Bot. A group chat is a Chat with
several. Each Bot in a Chat talks through its own agent session in its own home directory, so its
memory stays its own.

Chat with humans, chats spanning Hosts, and chats exposed on Slack, Telegram or Zalo are Hub
conversations, not daemon Chats. When the Hub joins, it treats a daemon Chat as one more
Conversation kind; there is no second model.

## Decisions

Each decision names what it revises. History stays in the audits it points at.

### D1. Bot is a daemon resource, not a Hub resource

The app talks to the Host directly and a one-person setup runs without a Hub. Team sharing reuses
the Project grants Managed Access already has (D13), so the Hub needs no Bot table.

Revises the glossary line on Channel account that forbids "Bot" as a separate product resource:
that line still holds for the Channel account; the Bot is a Host resource beside it.

### D2. The bot record

One JSON file per bot at `$CLISBOT_HOME/bots/{botId}.json`, written atomically, following
[data-model](../../data-model.md). Durable facts only:

- identity: `id` (opaque), `slug` (immutable directory name), display name, title, description, avatar;
- home: `projectId`, `workspaceId`, `cwd`;
- launch defaults: provider, model, mode, thinking option, feature values;
- `kind`: `personal` or `team`, which selects the template and the session policy on channels later;
- template: template id and seeded-at time;
- owner: the principal that created it (a Managed Access Member or the local owner);
- references by id only: Schedules, Heartbeats, skills, MCP tool policy;
- created and updated times.

Not in the record: running sessions, the main conversation's agent id, transport state. A session
finds its bot and chat through labels on the agent, the way open tabs are marked today.

### D3. Where the directory goes

`<root>/<slug>`. `root` is a daemon config leaf, default `$CLISBOT_HOME/workspaces`. An explicit path
at creation wins. The slug is derived from the name at creation, unique per Host (a numeric suffix
on collision), and never changes; the display name changes freely. No folder name is derived from
the bot kind. `workspaces/default` stays as the already-shipped assistant.

Why immutable: session storage lives under `agents/{sanitized-cwd}/` and provider resume is keyed by
cwd. Moving the directory loses both.

The root itself is never opened as a Project. Managed Access refuses a Project inside a Project
(`mayCreateProjectAt` in `packages/server/src/server/managed-access/project-folder-policy.ts`), so
a root that became a Project would block every later bot for restricted sessions. The root must sit
inside the Host folder policy's allow set.

### D4. Each bot is its own Project

Project root = bot directory, one Workspace of kind `directory`. This is what gives per-bot sharing
through Project grants and per-bot session storage. One shared "Bots" Project would lose both.

Bot Projects have an always-present **Bot projects** subgroup inside **Projects**, initially collapsed.
Its lighter caption and one 8px inset distinguish the group without adding a full tree level to
every row. Collapsing Projects hides the whole subgroup while preserving its own expansion
preference. When there are no ordinary projects, the existing Add project / Import session empty
state remains available above it. Its expansion state is a device view preference. The 2026-09-27 [app experience decision](app-experience.md) supersedes
the earlier separate visibility toggle beside Workspaces and under Display → Show. It retains the
existing Project/workspace/session rows, filters, pins and grants. Mixed multi-Host project entries
must be split by Host/Project identity before grouping so an ordinary project on another Host is
not misclassified. Settings › Projects remains unchanged.

### D5. Transcript is separate from timelines

`$CLISBOT_HOME/chats/{chatId}/chat.json` (participants, rules, times; atomic writes) and
`transcript.jsonl` (append-only, one line per message), mirroring the
`session.json` + `events.jsonl` layout of [agent session storage](../agent-session-storage/design.md).

A transcript line: message id, time, sender (`user`, `bot`, or `system`), final text, and for a bot reply
the `agentId` and timeline item id it came from. Tool calls and progress stay in the bot's
`events.jsonl`; the chat screen streams them from the session timeline while the turn runs.

User identity fields live directly on `sender`, like an agent timeline user message:
`{ kind: "user", id, displayName, hubOrigin, organizationId, memberId, ... }`.
Bot senders use `{ kind: "bot", botId }`; system notices use `{ kind: "system" }`.
The existing local `owner` fallback is unchanged. Old nested `sender.actor` records are
normalized on read (including client reads from older Hosts), while new transcript writes
use only the flat shape. Existing JSONL history is not rewritten.

Accepted duplication: a final answer exists in the transcript and in the timeline, joined by the
reference. The alternative, merging N timelines at read time, was rejected.

Only the daemon writes. A user message and its chosen bot recipients are written before fan-out.
A completed turn records a durable completion receipt (source-message and timeline references)
before its final answer is appended. After restart, a matching receipt permits backfill from the
timeline. A message accepted before dispatch, an interrupted turn, or provider-only history without
completion evidence gets a scoped system notice instead of a guessed final answer or blind resend.
The user can inspect the session in cowork and send a new message to continue.

### D6. One Chat model

Direct and group chats share the model, storage, RPCs and screen. Sidebar navigation distinguishes
their intent: **Bots** owns the user's DM entry and **Group chats** owns group entries. A group must
stay a group when its participants shrink to one; the Bot row must never adopt that group as its DM.

Each Bot appears once in the communication sidebar: clicking its row resumes the user's DM, while
a separate options action exposes Bot settings only with configuration authority. Activity shown
there belongs to that user's DM, not to other people's sessions of a shared Bot. Group chats does
not repeat DMs. The selected fill follows the open DM's Bot row or the active group row.

A sidebar row's menu and the open chat's options menu list the same resource actions, in the same
order and words, from `chatResourceActions` (`packages/app/src/clisbot/bots/chat/chat-resource-actions.ts`):
**Pin to sidebar**/**Unpin**, then **Bot settings** (a Bot row or DM, with configuration authority)
or **Group settings** (a group), then **Connect to a channel…** (a Bot row or DM, see D15), then
**Archive chat…** (a chat, never a Bot row). Group settings from
the sidebar opens the chat with `?panel=group-settings`, which opens the chat's own settings sheet.
Page actions (Switch tab, Project actions, Start a fresh session) stay in the chat options menu.

Pinning a DM or its Bot represents the same sidebar item. Existing duplicate pins are resolved
when the chat catalog loads; unpinning either surface removes the known aliases. Unknown/offline
pins stay intact, and Host/account scopes remain separate. A one-bot group retains its own pin.

New bot reuses the saved agent-creation provider, model, permission and thinking defaults. Late
preference hydration must preserve fields the user already changed; editing a Bot uses its saved
launch configuration instead of creation defaults.

**Create bot** and **Create group chat** are always-visible plus buttons on their respective section
headings, replacing separate create rows. They have explicit accessible names, hover/focus tooltips,
and touch targets (32 px desktop, at least 44 px touch). Creation and configuration remain subject
to the existing daemon authority. This supersedes the initial separate Chats-and-Bots sidebar.

### D7. Sessions in a Chat

One long-lived session per (bot, chat) pair, resumed across restarts. `/new` starts a fresh session
for that pair. Context compaction belongs to the provider. A session that cannot resume is replaced
by a new one and the transcript gets a system line saying so.

### D8. No turn serialization per bot

A bot in several chats runs several sessions on the same cwd, concurrently. Overlapping writes to
memory files are the agent's problem, as they already are for any workspace with several sessions.
A per-bot queue was rejected: it breaks the native feel and Clisbot runs sessions freely everywhere else.

### D9. Group turn rules follow the channel Route model

Who answers is configuration on the Chat, with the same vocabulary and guard rails as a Route:
mention required or anyone-may-answer, a cap on discussion rounds, and limits with defaults
but no ceiling ([2026-09-18 decision](../../audits/2026-09-18-channel-chat-authority-and-limits.md)).
How a group discusses is decided in [group discussion](plans/group-discussion.md) (2026-09-28):
a room contract in each bot's system prompt, silence as a valid turn, and one bot speaking at a time
in rounds capped by `rounds.max` (default 5). It replaces the first defaults, where an unaddressed
message reached every bot in parallel and bot mentions were forwarded up to 3 hops. The context
handed to a bot is the transcript since its last turn, one line per message with a sender line, the
same shape channels use ([conversation flow](../channels/conversation-flow.md)).

The chat owner can change a group's name and everyday reply policy in **Chat options → Group
settings**. The `chat.update` RPC is gated by `server_info.features.bots` (D10) and checks current
Project access. Changes affect subsequent messages without resetting sessions or altering internal
limits. Participant changes apply immediately; name/reply edits use Save. Older Hosts expose the
current values with an update hint. Direct and archived chats cannot use this operation.

### D10. Feature flag

`daemon.bots.enabled` in persisted config, `CLISBOT_BOTS_ENABLED` override, `server_info.features.bots`
with a `COMPAT` tag; the app gates on `useHostFeature`. **On by default** since 2026-09-29
(`COMPAT(clisbot-bots-default)` in `packages/server/src/server/bots/bots-config.ts`): a fusion daemon
runs Bots & Chats unless `daemon.bots.enabled: false` or `CLISBOT_BOTS_ENABLED=0`; the environment
wins, then the file, then the default. Off: no RPC registered, no storage touched,
no sidebar entry; the daemon behaves byte-for-byte as upstream. The app is behavior-equivalent: its
two route files and three sidebar insertion points exist in the bundle and return nothing while the
Host reports no `bots` feature. That is the one recorded exception to byte-equivalence.

`bots` is the only capability flag for the whole feature: bots, chats, attachments, voice routing,
group settings and whatever ships on this branch later. Do not add per-capability flags
(`chatAttachments` and `chatSettings` were folded into it on 2026-09-28, before any release carried
them). A Host either runs Bots & Chats at the version the app expects or reports no `bots`.

Three changes on this branch apply whether or not `bots` is on; each is deliberate:

- **Web notifications never throw.** `packages/app/src/utils/os-notifications.ts` returns `false`
  when a browser exposes `Notification` but rejects it (mobile browsers without a service worker).
  A plain bug fix; a candidate to send upstream.
- **Managed agent lists judge the record in hand.** `ManagedResourceAuthorizer.allowsAgentRecordSync`
  checks the listed agent's own workspace and labels. With `bots` off the label check always
  passes, so the result equals upstream's workspace check.
- **One persisted layout blob.** Conversation layouts add the `conversation` tab kind and
  `workspaceContext`/`layoutScope` to `workspace-layout-state`. Ordinary workspace tabs are stored
  unchanged, but a build older than this branch discards the whole blob once a Chat layout is in
  it, so a user who opened Chats and then downgrades loses remembered tab layouts. Accepted: tab
  layouts are recoverable UI state; moving Chat layouts to their own key is the fix if it matters.

### D11. Templates move into the daemon

Today the catalog lives in the CLI package (`packages/cli/src/commands/bot/templates`) and
`seedWorkspaceTemplate` writes to the CLI process's own filesystem, so creating a bot only works when
CLI and daemon share a machine. The catalog and the seeding step become a Fusion-owned server
module; `bot.create` seeds on the Host; `bot start` in the CLI calls the RPC. The seeding rules stay:
existing files are kept, symlinks are never followed, never seed into the OS home root.

A new bot's launch defaults come from the Agent profile or controls chosen at creation. There is no
hidden default provider.

Revised 2026-09-29: the New bot form now starts filled so Name and Enter create a bot. Provider,
model, mode and thinking come from the choices this device last saved, the same preferences New
agent reads and writes. When nothing is saved, or the saved provider is not ready or loading on the
Host, the first provider the Host's snapshot reports ready stands in, with its default model.
Creating a bot saves its choices only when the provider was chosen (by the user, or the saved
one); a stand-in is never saved, so it cannot become New agent's default. Changing the Host drops
choices made for the old one. The default is not hidden: the AI configuration card always shows
Host, Model, Permissions and Thinking as labeled rows. The earlier rule left Model empty and Create
disabled on a fresh device, one extra pick per bot. The CLI (`hub init`) still asks or fails
instead of assuming a provider.

### D12. Host choice is explicit

A bot is created on the Host selected in the sidebar. With several Hosts the create form shows a
Host picker; nothing guesses.

Revised 2026-09-29: when no Host is selected in the sidebar, the form starts on the Host of the
most recent chat, else the only Host. The Host row is always shown, and with several Hosts it can
be changed before creating, so the guess is visible, not silent.

### D13. Sharing is a Project grant

Sharing a bot with a Team or Member is a Managed Access grant on the bot's Project, with the levels
and **Can share** rules that exist ([Access](../access/README.md)). A shared bot runs on its owner's
Host; a Member with a grant gets sessions in the bot's Workspace under their own ticket. This is in
scope for the first phase. Sharing a Chat is not.

### D14. Archive and delete

Archiving a bot archives its Workspace and keeps the directory. Deleting the directory is a separate
confirmed action. Deleting a Chat deletes its transcript and detaches, never deletes, the bots'
sessions.

### D15. Hub boundary

The Hub owns: chats with several humans, chats whose bots sit on different Hosts, chats exposed on
external channels, and Routes that start a Bot. None changes the daemon Chat model.

**Routes that start a Bot (2026-10-06).** A user who has a Bot wants it on Telegram or Slack; they
think from the Bot, not from the Hub's Connections. **Connect to a channel…** in the Bot row's menu
and in a DM's Chat options opens Channels on Add Route with **What should happen** set to **Start or
continue a Bot** and that Bot picked; the user configures the Connection, Rules and Replies in the
ordinary Route form. Add Route opened from Channels offers the same choice first whenever a Bot is
on offer, and still starts on an Agent. The action shows only for an Organization Admin (a
Connection Admin cannot pick what a Route runs) and only for a Bot on a Host the Hub has enrolled.

Options considered:

1. A Bot target on the Hub (`bot: <botId>` on the Route), resolved on the Host at each turn. Editing
   the Bot's model would reach its channels at once, but it changes the Route schema, the
   compiler and the turn path, and a Hub without it refuses the Route.
2. An app-side target over the schema the Hub has. The form writes the direct Agent target it
   already writes: the environment is the Bot's Host, Project and folder, the agent is the Bot's
   launch defaults, and the Route carries `workspace.organize: false`
   (`packages/app/src/clisbot/hub/channel-route-bot.ts`).

Decision: option 2. It needs no Hub, protocol or daemon change, and every Hub in service runs it.
The form recognizes a Bot's Route when it reopens by those three facts: `organize: false`, no
worktree, and an environment on a Bot's Host, Project and folder; an Agent Route on a Bot's folder
that organizes workspaces stays an Agent. Saving a Bot's Route as an Agent's removes the Route's
own `workspace` setting, so it stays an Agent when it reopens. The launch settings are copied at
save, so changing the Bot does not change its Routes. The form says so when the Route's named
agent differs from the Bot (provider, model, mode, thinking, feature values), and saving takes the
Bot's current settings. A model someone chose for the Route from a conversation (`agentControls`)
is replaced on save, and the form says that too. Option 1 stays open if copied settings turn out
to drift in practice.

## Invariants

- One session, two views: the chat screen and the cowork view render the same agent session.
- The transcript never carries tool calls or progress.
- The bot directory path never changes after creation.
- Routes that start a Bot run sessions in the bot's Workspace and never mint workspaces per
  conversation (`workspace.organize` off).
- With the flag off, nothing about bots or chats is registered, stored, or shown.

## RPC surface

Dotted namespaces per [rpc-namespacing](../../rpc-namespacing.md), gated once on
`server_info.features.bots`. Additions to existing messages remain optional; new RPCs declare
the inputs they require.

- `bot.create.request` / `.response`, `bot.list`, `bot.update`, `bot.archive`, `bot.template.seed`
  (re-seeding and explicit overwrite; the one verb that touches files, kept apart from `bot.update`)
- `chat.create.request` / `.response`, `chat.list`, `chat.participant.add`, `chat.participant.remove`,
  `chat.message.send`, `chat.transcript.fetch`
- pushed: `chat.transcript.appended`, `chat.updated`, `bot.updated`

`bot.create` names an existing slug idempotently and returns that bot with `reused: true` only
when the caller may manage its Project. Reuse can seed files, so permission to create a new
Project alone is insufficient. It sets
the Project's `customName` to the display name, so Access pickers show the bot's name, not its slug.
The initial idle agent the CLI created is gone: sessions start per (bot, chat) on the first message.

Per-area plans: [server-bot](plans/server-bot.md), [server-chat](plans/server-chat.md),
[group-discussion](plans/group-discussion.md),
[app](plans/app.md), [cli-hub-naming](plans/cli-hub-naming.md).

## Phases

1. Bot record, storage, seeding, RPCs, flag; Chat record, transcript, fan-out rules, RPCs; app: Bots
   and Group chats sidebar sections, create-by-name, chat screen as a timeline rendering, switch to cowork;
   sharing through Project grants. Web, desktop and mobile from the one Expo app.
2. Lead bot role, Schedules and Heartbeats attached to a Bot, share links. Routes that start a Bot
   shipped app-side on 2026-10-06 (D15); a Hub-side Bot target is still open.
3. Hosted Hosts from the Hub, a high-density in-process provider, Hub conversation plane for chats
   with several humans.

Sidebar uses Group chats and Bots sections ahead of the existing cowork list. D4 and D6
supersede the original sidebar layout in [plans/cli-hub-naming.md](plans/cli-hub-naming.md) §A.

## Open

- Whether `USER.md` is shared across a user's bots once the second brain exists.
- `git init` in bot directories for memory history and diff viewing.
