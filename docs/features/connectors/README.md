# Connectors

Date: 2026-10-06. Status: built on the daemon and the app; the Hub broker is not built. Proposal,
research and the first wireframes: [2026-10-06 Connectors audit](../../audits/2026-10-06-apps-composio/README.md).

A **Connector** is an outside app or an MCP server agents may use: Gmail, GitHub, Notion through
[Composio](https://composio.dev), or a server the person runs. You connect it once on a Host, then
choose per Project which Connectors its agent sessions may use, what they may do with each, and
whether they ask before sending. A Bot is a Project, so Bot settings edits the same grant. One
session can turn some off for itself. Modeled on OpenMausBot's Apps screen. The same grant also
holds the Project's choice of the daemon's own tools ([Agent tools](#agent-tools)).

## Where things live

| Piece                              | Where                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Composio key, MCP servers, secrets | Daemon, `$CLISBOT_HOME/connectors/` (`secrets.json` is mode 0600)                                                               |
| Connected accounts                 | Composio; the daemon asks each time and never stores them                                                                       |
| What a Project may use             | `connectors.json` `projectGrants`, by Project id (`ConnectorGrantSchema`)                                                       |
| Clisbot and browser tools          | The same grant, `agentTools` and `browserTools`; the groups in `packages/protocol/src/connectors/agent-tools.ts`                |
| What one session turned off        | The agent label `clisbot.connectors-off` (`CONNECTORS_OFF_LABEL`)                                                               |
| Tool calls                         | Daemon relay `/mcp/connectors/*`, per-agent bearer token                                                                        |
| Screens                            | Sidebar **Connectors**; the **Tools** tab of Project settings and Bot settings; the composer **Tools** chip; the timeline cards |

Code: `packages/protocol/src/connectors/`, `packages/server/src/server/connectors/`,
`packages/server/src/server/session/connectors/`, `packages/app/src/clisbot/connectors/`.

## How an agent reaches a Connector

1. `AgentManager.prepareSessionConfig` asks the runtime for extra MCP servers. The session belongs
   to the active Project one of whose Workspaces runs in its `cwd`, worktrees included
   (`connector-projects.ts`); an archived Project, or an archived Bot's, gets nothing. That
   Project's grant becomes `connectors_composio` (all granted apps) and one `connectors_<name>`
   per granted MCP server. The session's off list does not change what is mounted, so a switch
   can turn a Connector back on mid-session; the relay applies the list to every call instead. Chats, Schedules and channel Routes of a Bot
   run in its Project like any session started by hand, so one rule covers all of them. The
   Workspace decides, not a label: any client that may update an agent can write labels, so the
   only label read is the off list, which can only take away. Entries are never persisted
   (`stripRuntimeMcpServers` drops them). A provider with native Clisbot tools (OpenCode with the
   bridge, OMP) loses only the `clisbot` entry at launch (`stripInternalClisbotMcpServer`), never
   its Connectors.
2. Every Connector, local-command servers included, goes through the daemon relay. The agent
   holds only a token naming itself; the relay adds the Composio key or the stored headers. A
   token is refused while its agent is closed and dropped once the daemon no longer knows the
   agent, so a background process an agent left behind cannot keep calling. The relay serves only
   `initialize`, `ping`, `tools/list` and `tools/call`, and reaches an upstream only for a target
   the session has on; anything else gets method-not-found (`connector-relay.ts`). A frame
   without an id is passed on only when it is a `notifications/*`: a `tools/call` sent without
   one would otherwise reach the upstream unjudged. Composio answers such a frame with 202 and
   runs nothing (checked on 2026-10-06), but a person's own MCP server may run it. The relay parses bodies up to 16 MB before the
   daemon's 100 KB default, so a long email or document is not refused as HTTP 413.
   Local-command servers run in the daemon, one process per server and Project, in its root, with
   a minimal environment (PATH, HOME, USER, SHELL, locale, temp dir, proxy) plus the server's own
   variables (`connector-env.ts`): no provider keys, no tokens, and nothing in the agent's config.
   Variables named `CLISBOT_*` are refused when a server is saved. A line on stdout that is not
   JSON-RPC (a banner, a log) is ignored instead of failing the server, and a request the server
   sends (`ping`) is answered by the relay, never taken for the answer to a call with the same id.
   Saving or removing a server stops its processes. The daemon waits for them to exit when it
   stops and kills any that do not.
3. Every `tools/call` is judged against the session's grant as it is now, so an edit applies to the
   next call: app or server not granted or paused → refused; tool not picked → refused; a tool
   that changes data on a read-only app → refused (`connector-verdict.ts`). A tool's own hint
   decides whether it reads: Composio tags tools `readOnlyHint` (read per app from `/tools`, kept
   ten minutes) and MCP servers annotate it. The name alone misreads apps that put the verb last:
   Google Calendar's `EVENTS_LIST` looked like a change, so a read-only grant could not list
   events (found against real Composio on 2026-10-07). Without a hint the name decides: a read
   verb first and no free-form text is a read; a bare `QUERY` (`GOOGLEBIGQUERY_QUERY`) or a name
   with `SQL`, `GRAPHQL` or `COMMAND` is a write. `tools/list` is
   filtered the same way. Composio meta-tools are an allowlist (search, schemas, multi-execute,
   connections, wait); workbench, bash, proxy and any meta-tool Composio adds later are hidden and
   refused. A multi-execute entry may name its tool as `tool_slug`, `slug`, `tool` or `name`;
   the grant reads all four and refuses an entry naming two different tools. A multi-execute
   without the `tools` list is refused: Composio refuses it too ("Required at tools").
4. A tool that sends something asks first (`connector-tool-kind.ts`): its name says so (send,
   post, reply, invite, pay, share, a change to an access list), or the call names people to
   notify (`attendees`, `to`, `cc`, `recipients`…; a draft excepted). A calendar event with
   attendees emails them an invitation, though `CREATE_EVENT` alone reads as a plain change. It
   asks first: the daemon raises its own permission request on the agent's timeline
   (`AgentManager.requestDaemonPermission`), shown like any other approval in the app and on
   channels. One Allow sends once: the same send again asks again, and of two identical calls made
   while the person decides, only one is sent (`connector-approvals.ts`). An Allow whose agent hung
   up before the send is kept ten minutes for its retry. Every send in a call shows on the card,
   two through the same tool included, and each counts against the daily limit. Only a person
   answers these cards: the Clisbot agent tool `respond_to_permission` refuses them, so an agent
   cannot approve its own send (checked live with a second Claude agent; agents get that tool
   only with `daemon.mcp.injectIntoAgents` on). Answering any other request leaves them open, and
   closing or archiving the agent ends them at once. With **Ask before sending** off, sends run
   up to the daily limit (default 25), counted before they run and kept in `send-counts.json`
   across restarts. An approval or a connect card can take minutes, so the grant and the upstream
   are read again after it; an app paused or a server turned off meanwhile stops the call.
5. Composio's meta-tools (search, schemas, multi-execute, listing connections) are preapproved
   in the launch config, so the agent's own prompt does not fire for every read; the relay is the
   gate. Codex turns preapprovals into the server's only enabled tools, which also hides the
   workbench. Tools of the person's own MCP servers keep the agent's normal prompts.
6. A Project limited to some accounts of an app may only name those in `tools[].account` of a
   multi-execute call; with exactly one allowed, the relay names it (`connector-accounts.ts`).
   A tool belongs to the longest app slug in Composio's catalog that prefixes it, so granting
   `zoho` does not grant `ZOHO_MAIL_*` when `zoho_mail` is its own app; while the catalog cannot
   be read, app tools are refused rather than matched on the grant's slugs alone. Listing connections
   (`COMPOSIO_MANAGE_CONNECTIONS` with a read action) is answered by the relay with the accounts
   this session may use, never the Host's whole list.
7. The relay answers `initialize` and `ping` itself and holds its own MCP session with each
   upstream (`connector-upstream.ts`): it waits at most 1.5 s for the upstream on `initialize`,
   reopens a session the upstream forgot (404), and returns every failure as HTTP 200 (a tool
   error for `tools/call`, a JSON-RPC error otherwise). An MCP client marks a server failed for
   the whole session when its handshake times out, and an upstream 401 passed through makes it
   start an OAuth sign-in against the daemon; both happened to OpenMausBot.
8. The `initialize` answer tells the agent these are its Connectors and to prefer them. Without it
   Codex reached for its own `codex_apps` Gmail first (found in the 2026-10-06 live run).

9. A call to a granted app with no active account, or to an app the Project lacks, raises the
   connect card instead of failing; see below. An app that needs no sign-in (`noAuth` in the
   catalog, such as Hacker News) has no account at Composio and runs without one.

A session whose grant changes keeps the MCP servers it started with; a newly granted app or server
appears in its next session. Paused, removed or turned-off ones are refused at once.

## Connect card

When an agent calls an app with no working account on the Host, the relay holds the call and raises
a daemon permission request whose metadata carries `clisbotConnector` (`ConnectorCardSchema`):

```
┌──────────────────────────────────────────────────────────┐
│ [G]  Gmail isn't connected yet                            │
│      This agent needs it to continue.                     │
│                              [Not now]   [Connect Gmail]  │
└──────────────────────────────────────────────────────────┘
```

Connect starts the sign-in from the app; the card turns into "Finish signing in in your browser"
with **Open sign-in again**. The daemon polls the accounts and, once one is active, closes the card
itself and runs the held call, so the turn goes on without a new message (OpenMausBot ends the turn
and resumes it after sign-in). Not now, or ten minutes, fails the call with a message the agent
can read. An agent asking `COMPOSIO_MANAGE_CONNECTIONS` to connect an app gets the same card.
An agent's MCP client may give up on a held call (Codex after about a minute) and call again; the
retry waits on the card already open for that agent and app instead of raising a second one. A
failed read of the accounts while waiting counts as not connected yet, and the card always closes
when the wait ends.

An app the Project lacks raises **Use GitHub in this Project?** with Read only / Read and write.
Allow writes the Project's grant through `connectors.project_grant.set` before answering, and the
relay reads the grant again: answering a card never grants anything by itself, so an Allow from
someone who may not change Connectors, or from a channel, changes nothing. Clients that do not know
the card show its title, description and two plain actions (`connector-connect.ts`).

## Per session

The composer shows a **Tools** chip when the session's Project gives it any tools. Its sheet lists
the Clisbot tool groups, then the apps and servers on, then the session's skills. Each group and
Connector has a switch for this session and opens a page with every one of its tools and a switch
per tool, as Project settings lists them. A tool the Project leaves off says why ("Off in this
Project", "Project only reads this app") with a **Change** link to the Project's Tools tab, and its
switch still turns it on, **for this session only**: the daemon keeps a list per agent of what a
session may use beyond its Project (`sessionAllows` in `connectors.json`, set with
`connectors.session_allows.set`, same rights as changing the Project). It is not in the label
because the agent can write its own labels (`update_agent`) and would grant itself; the label only
ever takes away, and its off keys still win over an allow. The relay and the Clisbot tool list
read both on every call. A draft has no agent yet, so there the switch asks and adds the tool to
the Project instead (`project-allow-tool.ts`; on a read-only app only that tool, the app's other
changing tools stay off). An allowed MCP server tool joins `tools/list`, which the agent reads at
start, so a new session sees it; the allow list of an archived agent is not cleaned up yet. **All connectors** opens the Host's
Connectors page, **Manage tools** the Project's Tools tab.

A draft keeps the list until the agent is created with the label; a running session writes the
label, and the daemon reads it on every call. The keys, all in `clisbot.connectors-off`
(`CONNECTORS_OFF_LABEL`):

| Key                                        | Turns off                       |
| ------------------------------------------ | ------------------------------- |
| `gmail`, `mcp:notes`                       | An app, an MCP server           |
| `gmail/GMAIL_SEND_EMAIL`, `mcp:notes/send` | One of their tools              |
| `tools:<group>`, `tool:<name>`             | A Clisbot tool group, one tool  |
| `skill:<name>`                             | A skill, where the provider can |

`tools/list` still shows everything the Project grants, because an MCP client reads the list once
and a tool hidden at launch could not be used after the switch goes back on. Calls to an entry that
is off are refused with "turned off for this session", and turning it back on takes effect on the
next call. Renaming an MCP server renames its keys (`mcp:<name>` and `mcp:<name>/<tool>`) in the
agents' labels, the Chats' lists and the session allows, and removing one drops them; an archived
agent's stored label keeps the old name. A tool off by name is off however the call spells it:
the check also tries the Composio slug in upper case.

**In a Chat** the switches belong to the Chat, not to an agent: the list is the Chat's
`rules.tools.off` (`chat.update` with `toolsOff`, a direct chat included; gated by the
`chatTools` feature). It survives `/new`, reaches a Bot added later, and only takes away: what a
Bot has is its Bot settings minus the Chat's list, so a change in Bot settings reaches every Chat
unless that Chat turned the thing off itself. The daemon adds the Chat's list to each Bot
session's own (`ConnectorProjectDirectory.offList`, by the agent's `clisbot.chat-id` label) for
the relay, the Clisbot tool list and skills. An agent may not set `clisbot.connectors-off`,
`clisbot.chat-id` or `clisbot.bot-id` (`update_agent` and `create_agent` refuse them), and a child
it creates starts with its whole off list, the Chat's included, so a limit cannot be escaped
through a child. In a Chat, "On for this chat only" is kept under `chat:<chatId>` in
`sessionAllows` and applies to every session of that Chat, after `/new` too.

- **Direct chat:** the sheet is the session sheet, "Tools for <Bot> · In this chat", shown before
  the first message too; **Manage tools** opens the Bot's settings.
- **Group chat:** **Tools in this room** lists what any Bot in the room has, with who has it ("Only
  writer"), and its switches turn a tool off for every Bot here. Bots can ask each other for help,
  so what a room can do is what its Bots can do together: a limit that matters for safety has to
  be the room's, and a per-Bot switch in a room would only divide roles. The room never gives a
  Bot what its settings do not (no switch for a tool no Bot here has); a Bot gets more in Bot
  settings. Skills stay per Bot. Per-Bot switches inside a room, from the member list, are not
  built.

**Skills** come from the provider's command list (`kind: "skill"`). Claude says which of its
commands are skills (the init message's `skills`, else `reloadSkills()`), so its built-in commands
stay out. Only Claude can switch one off per session: the daemon hands the label's skills to
`AgentSession.setSkillsOff` at start and on every change, and Claude applies them as
`skillOverrides: { name: "off" }` through `applyFlagSettings`. From the next step the Skill tool
refuses it ("disabled … in skillOverrides settings"); the skill list already in the model's context
updates only at its next system reminder. A skill that is off drops out of Claude's list, so the
sheet keeps showing it from the label. Codex enables skills for the whole Host in `config.toml`,
so for Codex and OpenCode the list only shows. Providers advertise the switch with the
`supportsSkillToggles` capability.

## Agent tools

The **Tools** tab also chooses what a Project's sessions get of the daemon's own tools, the
**Clisbot tools**: Host, On or Off for the whole set, then one row per group (Browser first, then
agents, permissions, workspaces, terminals, schedules, providers) with a switch and a list of every
tool, named by what it does. Host follows the Host's **Inject Clisbot tools**
(`daemon.mcp.injectIntoAgents`); On and Off win over the Host, so one Project can have them while
the Host's default is off. The Browser group also has the Host's **Browser tools** default
(`daemon.browserTools.enabled`): its switch stores `browserTools` only while it differs from the
Host, and switching it back to the Host's value follows the Host again.

- **One table.** `AGENT_TOOL_GROUPS` names every tool for the app and for the session switches.
  `mcp-server.test.ts` fails when the daemon registers a tool the table does not list, or the
  reverse. `speak` (voice chats) is always on and not listed.
- **When it applies.** On or Off for the whole set is decided at launch
  (`AgentManager.launchClisbotToolPolicy`): turning the tools on mid-session needs a new session.
  The Project's tool list, its Browser choice and the session's switches are read on every request
  to `/mcp/agents` (`connector-agent-tools.ts`), so a tool turned off is gone from the next call.
  An agent that read the list earlier gets "Tool X disabled", not "not found", so it can say the
  tool was switched off.
- **Native-tool providers** (OpenCode's bridge, `supportsNativeClisbotTools`) build their catalog
  at launch from the provider policy and the Project's On or Off only: the Project's tool list,
  its Browser choice and the session switches do not reach them.
- The provider policy (`agents.providers.<id>.clisbotTools`, [data model](../../data-model.md))
  still applies: its disabled tools stay off whatever the Project chooses.
- Like the provider policy, this shapes what the agent is offered. An agent with a shell can still
  run the `clisbot` CLI.

## Who can do what

Connectors belong to the Host: one Composio key, one Composio user, so every connected account is
the Host owner's. Reads need `daemon.read`, changes need `daemon.manage`
(`authorization/operation-permissions.ts`). Granting Connectors to a Project or Bot also needs an
unrestricted session (daemon resource mode), because its agents then act with the owner's accounts
(`session/connectors/connector-session.ts`). Listing an MCP server's tools needs `daemon.manage`
too, because it starts the server's command or calls it with its stored headers; a session
without it sees a server's address without path or query and no arguments. Turning a Connector
off for one session needs only the right to update that agent.

| Who                                                        | See Connectors | Connect, key, MCP servers | Grant to a Project |
| ---------------------------------------------------------- | -------------- | ------------------------- | ------------------ |
| Managed Access `off`: local app, paired device with manage | yes            | yes                       | yes                |
| Paired device without `daemon.manage`                      | yes            | no                        | no                 |
| Hub Organization Owner                                     | yes            | yes                       | yes                |
| Hub Member with **Administrator** on the Host              | yes            | yes                       | yes                |
| Hub Member with any other Host or Project level            | no             | no                        | no                 |
| Sender on a channel Route                                  | no             | no                        | no                 |

A personal Hub has one person, its Owner. A Member without Administrator holds `daemon.read` on
the ticket, but a session limited to some Projects may use only the daemon reads Managed Access
lists (`allowsRestrictedDaemonReadInbound` in `managed-access/resource-authorizer.ts`), and no
`connectors.*` read is among them: such a Member sees no Connectors, and the app hides the
Connectors parts of Bot settings, Project settings and the composer for them. Their sessions
still use what the Project was granted. The consequence below was reviewed on 2026-10-06 and
accepted for now; see Open.

## Decisions

- **Name: Connectors.** "Apps" collides with the Clisbot app and with Hub Integrations ("Apps
  your organization is connected to"); Connectors is free in the glossary.
- **On by default.** Nothing leaves the Host until someone saves a Composio key or adds a server.
  `daemon.connectors.enabled: false` or `CLISBOT_CONNECTORS_ENABLED=0` turns it off; the daemon
  then registers no RPC or route and reports no `connectors` feature.
- **Composio introduces itself wherever its key is.** The Composio section always starts with two
  lines on what Composio does and what leaves the Host, and links to its site, quickstart, security
  and privacy pages (`ComposioIntro`). **Get a key** opens `dashboard.composio.dev`, which lands in
  the person's own project: its API keys page sits under that project's path
  (`/<workspace>/<project>/api-keys`), and `/api-keys` is a 404, so no link reaches it for
  everyone. Replacing a saved key can be cancelled.
- **Grants belong to Projects, not Bots.** A Bot is a Project, so storing the grant per Project
  serves both with one record and one editor (Bot settings shows it for quick setup), and an
  ordinary session in a Project gets the same Connectors as the Bot's Chats. The first build kept
  the grant on the Bot record; it was never released, so nothing migrates it.
- **The UI is rows and sheets** ([mockup](ui-mockup.html), 2026-10-07). Every Connector is one
  row (logo, name, a summary after a dot, the switch, a chevron) that opens a sheet with access,
  accounts, tools and Remove, as the Providers page does; the first build put every control on
  the row. Project settings and Bot settings get a **Tools** tab (`ViewTabs`, as Channels and
  Automations), because the section sat below every other setting; `?view=tools` opens it, and
  the older `?view=connectors` still does. The tab holds the Clisbot tools, the browser tools and
  the Connectors, each a section of rows: one place for everything an agent may call.
  Send cards show the arguments as labelled lines the daemon builds (`connector-send-card.ts`)
  under `clisbotConnector` with `action: "send"`; a client that does not know it shows the plain
  request.
- **The connect card holds the call.** The person connects without leaving the chat, and the
  agent's turn continues. The card's answer is never authority; the grant and the account are.
- **Pause, not only remove.** Each granted app or server has a switch on the Project
  (`enabled: false` keeps access and tools), and each MCP server has **On everywhere** on the
  Host. Remove forgets the settings.
- **New grants start read-only with every tool.** Writes and picked tool lists are widened on
  purpose.
- **Sessions name the project's own auth configs.** A Composio session signs in with a project's
  own OAuth app or API-key config only when created with its id, and cannot change later
  (OpenMausBot #509). The daemon lists them when it makes a session and again on every Connect,
  and makes a new session for the same Composio user when one is missing. An app with no
  ready-made sign-in tells the person to create an auth config. A key that may not list accounts
  or auth configs still connects. A key that may not read the app list (a scoped key without
  **Toolkits: Read**) is refused when saved: browsing apps and telling which app a tool belongs
  to both need it, and with it missing every app tool would be refused.
- **Sign-in links are trusted only on `*.composio.dev`**, and stay offered after Connect as
  **Open sign-in** for ten minutes: a browser blocks a tab opened after a network call.
- **Unknown is not none.** When the Host's accounts cannot be read, the app says so instead of
  "No account connected", and keeps the accounts read last.
- **Wire values a later daemon may add are plain strings.** Access levels, send policies, tool
  kinds and transports travel as strings, so an older client still parses a newer daemon's
  messages; the daemon accepts only the values it knows (`connector-grant-rules.ts`), and readers
  treat an unknown one as the narrowest (`connectorAccessOf`, `connectorSendPolicyOf`,
  `connectorToolKindOf`).
- **Grants follow a server's name.** Renaming an MCP server moves it in every Project's grant;
  removing it drops it, so a later server with the same name starts with no grants. Editing a
  paused server keeps it paused.
- **No Composio SDK.** `@composio/core` is 0.x; the daemon calls REST v3.1 with `fetch`
  (`composio-client.ts`). `CLISBOT_COMPOSIO_API_URL` points it elsewhere for tests.

## Testing

- Unit and HTTP tests: `packages/server/src/server/connectors/*.test.ts`. The relay and cards tests
  run a real MCP client against the relay and a local Composio stand-in
  (`test-utils/connectors-relay-harness.ts`): the target gate, tokens of closed agents, the
  minimal environment, the connect and grant cards, one-shot approvals, the session off list and
  `COMPOSIO_MANAGE_CONNECTIONS`; `connector-projects.test.ts`
  (Workspace → Project, worktrees, archived), `session/connectors/connector-session.test.ts`
  (restricted sessions may not grant),
  `agent-manager.test.ts` (runtime servers, daemon permission), `config-clisbot-defaults.test.ts`,
  `packages/app/src/clisbot/connectors/model.test.ts`.
- 2026-10-06 OpenMausBot review: their fixes became tests in `connector-relay.test.ts` (handshake
  while Composio hangs or refuses, forgotten session, grant read after approval, unknown
  meta-tools, local server run by the daemon without `CLISBOT_*`, auth configs, scoped key,
  untrusted link, `_1password`) and `connector-store.test.ts` (reserved variables, limits).
- 2026-10-06 code review: `connector-relay-refusals.test.ts` (a `tools/call` without an id,
  repeated sends on the card, the account of a top-level multi-execute, large bodies, app tools
  while the catalog is down, a local server's stray stdout line and its own `ping`), the shared
  connect card in `connector-cards.test.ts`, `connector-off-lists.test.ts`, orphan and renamed
  secrets in `connector-store.test.ts`, daemon cards across answers and closing in
  `agent-manager.test.ts`, the agent tool refusing cards in `mcp-server.test.ts`,
  `runtime-mcp-config.test.ts`, and on the app side `use-grant-editor.test.ts` (an app added
  elsewhere survives a save), `session-connectors.test.ts` and the command round trip in
  `model.test.ts`.
- Against real Composio on 2026-10-06, on an isolated daemon (own home and port) with a real
  Claude agent: a Hacker News read with no card, a send to a local server raising the card, a
  second agent refused when it tried to approve that card, the person's Deny not sending, and
  archiving the agent ending its card at once. With the flag off the relay route was 404, the
  RPCs refused, and a new agent had no `connectors_` server. A scoped key without Toolkits: Read
  is refused at save.
- Google Calendar against real Composio on 2026-10-07: a read-only grant lists events (a real
  Claude agent counted them), and an event with attendees on a write grant raises **Google
  Calendar: Create event**; denied, nothing reached Google. An account connected in the
  Composio dashboard's Playground belongs to its own Composio user, not to the Host's, so
  Clisbot does not see it; connect apps from Clisbot.
- Live loop without a Composio account: run a local stand-in for Composio's REST and MCP
  endpoints, start a daemon with `CLISBOT_COMPOSIO_API_URL` pointing at it, and drive the app.
  The 2026-10-06 run used Codex `gpt-5.6-luna`: read through `GMAIL_FETCH_EMAILS`, then a send
  that raised the approval card and ran after Accept.

Connect card, live on 2026-10-06: a Claude Bot granted Trello with no Trello account asked to
list boards; the card showed in the web timeline, Connect opened the stand-in's sign-in, and the
daemon closed the card and ran the call. Project settings, Bot settings and the composer chip
were checked on the web the same day.

Providers covered on 2026-10-06, each with a fresh Bot, a plain request ("check my latest
email") and a send answered through the approval card: Claude ✅, OpenCode ✅ (free OpenRouter
model), Codex reads through Connectors when asked by name, but with a plain request it used its
own `codex_apps` Gmail (see Open).

Platforms covered on 2026-10-06 (against the local Composio stand-in):

| Platform           | Covered                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Web, desktop width | Key save and refusal, browse, connect two accounts, MCP server, Bot grants, Codex chat with approval |
| Web, phone width   | List and app detail                                                                                  |
| Electron (macOS)   | Connectors screen through the real window, Host-wide MCP server switch                               |
| iOS simulator      | List, SVG logos, app detail, second-account sheet and browser sign-in, Bot switches                  |
| Android emulator   | List, app detail, Bot settings, pause and resume from the switch                                     |
| Windows, Linux     | Not run                                                                                              |

Composio serves SVG logos; React Native's `Image` does not draw SVG on iOS or Android, so
`ConnectorLogo` uses `expo-image`.

## Open

- **Connectors only govern their own path.** A Bot can still reach the owner's accounts through
  anything else its agent can run: Codex's built-in ChatGPT apps (`codex_apps`), and any CLI
  already signed in on the Host. In the 2026-10-06 live run a Codex Bot read Gmail through
  `codex_apps`, and with that switched off it read and **sent a real email** with the `gog` CLI
  from a shell. The **Codex's own apps** switch on the Project (`builtInApps: false`, Codex
  `features.apps = false`, on by default as decided) closes the first path; the second needs a
  Bot permission mode without shell access, which Connectors do not set.
- **Granted tools of the person's own MCP servers still prompt** in the agent (a Claude Bot asked
  before `read_note` in the 2026-10-06 run). Composio reads do not. Preapproving read tools of
  a picked tool list would match; not decided.
- **Accepted for now, review pending (2026-10-06): channel senders use the owner's accounts.**
  Whoever a Route admits can ask a Bot with Gmail granted to read the owner's mail; reads run
  without asking, sends wait for approval. The Hub broker (per-Member Composio users) is the real
  fix. Until then the options are: keep Bots with Connectors off Routes open to others, or make
  reads ask too when the turn came from a channel.
- **OpenCode Bots with a provider-prefixed model** (`anthropic/claude-sonnet-4-5`) fail with
  "Model not found"; a Bots model-plumbing bug, not a Connectors one.

## Not built yet

- Hub broker: the Organization's Composio key on the Hub, per-Member Composio users, Access
  grants for shared accounts, Composio triggers as an Automation input.
- The connect card on native and Electron, and the composer chip on phone width, were not run.
- Sign-in (OAuth) for remote MCP servers; today they take a header only.
- Importing MCP servers from Claude Code, Cursor or Codex config.
