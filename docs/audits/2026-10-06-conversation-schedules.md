# Schedules and heartbeats in the app (2026-10-06)

Decision record. Status: **decided** 2026-10-07, **built** 2026-10-08 except
channel bindings (D). Scope: Managed
Access Members on the Automations page, where a schedule runs, and heartbeats
inside an agent session and a Chat with Bots. Channel conversations are out of
scope; see [Superseded](#superseded).

## Context

The Host has one schedule engine (`packages/server/src/server/schedule/`). Its
two target kinds share the store, the cron engine and the run history:

- `target: { type: "agent" }`, shown as **Heartbeat**: a prompt back into one
  existing session. Agents get `create_heartbeat` and `delete_heartbeat`,
  scoped to the calling agent.
- `target: { type: "new-agent" }`, shown as **Schedule**: each run starts a
  fresh session. Agents get `create_schedule`, `list_schedules`, and the rest.

Upstream split the two agent tools in #1266 because agents picked `new-agent`
for babysitting and the report landed in a session nobody read (commit
`0d0012959`).

What stops users today:

- `schedule/*` needs the daemon permission `automation.manage`
  (`authorization/operation-permissions.ts`), which a Managed Access Member
  session never holds. Members cannot open Schedules at all.
- The form creates only `new-agent` schedules, and Isolation `local` creates a
  new workspace on every run (`schedule/service.ts:977`). Nothing reuses an
  existing session or workspace.
- A heartbeat can be edited from the Automations page but not created, and
  nothing shows it inside the session it runs in.

## Decisions

### Agent tools follow configuration

An agent uses the schedule and heartbeat tools when the daemon gives them to it
(`daemon.mcp.injectIntoAgents`, `clisbotTools` per provider), and not
otherwise. No check on who sent the prompt. This holds in an agent session, a
Bot session and a channel-bound session alike.

### Managed Access: `schedule.manage`

- A new Project privilege `schedule.manage` in `PROJECT_PRIVILEGES`, beside
  `terminal.use`. It covers seeing, creating, changing and deleting the
  schedules and heartbeats of that Project.
- **Office worker, Developer and Full access** all carry it as a preset the
  grant can switch off, the way Full access carries Terminal and Can share.
  Administrator and Organization Owners hold schedules through the daemon admin
  permissions.
- **A schedule's Project** is the Project of the session it runs in (heartbeat)
  or of its working directory (schedule). A Host grant reaches every Project on
  the Host.
- **First gate**: `schedule/*` keeps upstream's `automation.manage`. The lease
  adds that permission once any Project holds `schedule.manage`, and the daemon
  narrows each request to those Projects, as it does for `workspace.manage`
  (`hub/src/access/store.ts:1377`). The daemon also refuses the `loop/*` stubs,
  which need the same permission, to such a session. The two-gate model is in
  [permissions](../permissions.md#daemon-permissions-and-project-privileges).
- **Seeing is not running.** Seeing, pausing and deleting a schedule needs
  `schedule.manage` where it runs. Making it run (create, update, resume, run
  now) also needs what the run does, because runs are unattended: a `new-agent`
  schedule must be a launch the caller could start with `create_agent`
  (`configurationMatchesProject`, no `mcpServers`, `systemPrompt` or
  `providerOptions`; no mode needs every approval), and a heartbeat needs
  `agent.interact` on the session and, through a Chat, the right to post there
  (`managed-access/schedule-access.ts`).
- **Lists** show only schedules of granted Projects. The Schedules tab lists
  only Hosts where the Member holds it; Create appears only then.
- **Stored grants do not gain it.** Re-selecting the level adds it
  ([permissions](../permissions.md#managed-access-resources)).
- **Older daemons never receive it.** A daemon names the Project privileges it
  enforces in the `x-clisbot-project-privileges` header when it consumes a
  ticket or refreshes a lease; the Hub leaves out the rest, with the session
  permission they bring (`hub/src/managed-access/daemon-privileges.ts`). A
  daemon without the header gets no `schedule.manage` and no
  `automation.manage` from it, so it cannot honor the wide permission without
  narrowing it. A daemon also drops a Project privilege it does not know instead
  of rejecting the ticket.
- **No own/all split.** Anyone holding `schedule.manage` on a Project manages
  every schedule of it. A schedule created by an agent tool has no human
  creator to compare against, so [grant scope](../features/access/grant-scope.md)
  is deferred.

### Where a schedule runs

The form gains one field at the top, **Run in**:

```text
Run in       [ New session each run ▾ ]       [ Existing session ▾ ]
             Host, Project, Model, Mode,      Session  [ fix-login · Claude ▾ ]
             Isolation:                       (model, mode, isolation hidden)
               New folder workspace
               New worktree
               Existing workspace → [ pick ]
```

| Option                                 | Backend                                                                                  | Cost       | UX                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| **A. Existing session** (heartbeat)    | Exists: `schedule/create` takes `target: agent`                                          | Low        | Keeps the session's context; runs appear in it. A busy session fails the run, as today                            |
| **B. New session, existing workspace** | Optional `workspaceId` on the `new-agent` config; the run creates its agent there        | Low–medium | A third Isolation choice. Each run adds a session to the workspace, so Archive on finish defaults on              |
| **C. A Bot DM or group Chat**          | Optional `chatId` on the `agent` target; the run goes through `ChatService` as a message | Medium     | No choice of its own: a heartbeat on a Bot's session in a Chat runs through that Chat. See below                  |
| D. A channel binding                   | The daemon does not know bindings; the Hub owns them                                     | High       | Deferred. A channel-bound session can still be picked under A; the Hub relays its runs until the binding moves on |

The session picker in A lists Bot sessions and channel-bound sessions too, each
labeled with where it lives.

**C, a heartbeat through its Chat.** When the session picked in A is a Bot's
session in a Chat (it carries `clisbot.chat-id`), and the Host reports
`server_info.features.scheduleChatDelivery`, the app sends the Chat's id as
`target.chatId`. The Chat ⏱ creates the same. Each run is then posted in the
Chat as a line whose sender name is the run notice, **Heartbeat · name · run N
of M** (`schedule/chat-delivery.ts`, `ChatEngine.postScheduled`), instead of a
prompt into the session. The app draws that line as the run marker, not as a
user bubble (`bots/chat/render-model.ts`); the Bot reads the prompt under it:

- **Who answers.** In a group Chat the form's **Mention** field picks the Bots
  each run tags (`target.mentionBotIds`), the session's own Bot by default. The
  line starts with their tags and only they answer, one at a time as for an
  addressed user line; tags written in the prompt reach no one else. A direct
  Chat has one Bot.
- **The Chat's rules apply.** The input limit refuses an over-long run like a
  user line; the group turn rules decide the order.
- **The marker is structural.** The daemon sets `scheduleRun` on the line
  (`chats/types.ts`), which a client cannot send; the app draws the marker from
  that, not from the sender name any user could choose.
- **Creating one needs the Chat.** The daemon refuses a `chatId` whose session
  is not that Bot's session in that Chat, or a host without Chats; a
  Project-scoped caller must also be allowed to post in the Chat. From a Chat
  that is given; from Schedules the session picker offers only sessions the
  caller can see.
- **It follows the Bot.** The Chat delivers to the Bot's current session, so a
  run survives `/new` and an archived session; archiving does not end it. An
  archived Chat, or its own Bot leaving, ends it. A run due before Chats start
  waits for them.
- The run counts as succeeded once the line is posted; it records no output.

C reuses the `agent` target instead of adding a `chat` target kind: an old app
parses the schedule list unchanged and shows the heartbeat on the Bot's session,
and Managed Access checks the same Project. A Bot session in a Chat that calls
`create_heartbeat` gets a heartbeat through that Chat, since the Chat would drop
a reply in the session; re-registering it by name keeps the Chat.

### Heartbeats where the session is

A ⏱ button sits right after the header's ⋯, in the workspace header
(`clisbot/heartbeats/workspace-heartbeats-button.tsx`) and the Chat header
(`chat-heartbeats-button.tsx`). The Chat's ⋯ moved from the right-hand actions to
the heading for the same reason: ⋯ keeps one place whether or not ⏱ is there.
The composer was the first idea and was dropped: its control row is full.

- **Always shown**, with the selected session's count when it has heartbeats, so
  creating the first one is one press away. It is hidden only for a session that
  cannot manage schedules (no `automation.manage` on the host).
- **The quick menu** (`heartbeats-menu.tsx`) leads with the selected session:
  its heartbeats, or an empty state, then New heartbeat. **Other sessions in this
  workspace** follow, each a **Session name ›** row that navigates to that session
  (the chevron means navigate, not expand), with its heartbeats under it. In a
  group Chat every Bot is a group of its own, with New heartbeat for that Bot.
- **A row opens the detail sheet**; its trailing button pauses or resumes without
  leaving the menu. All schedules… opens the Automations page.
- **The detail sheet** (`clisbot/schedules/schedule-detail-sheet.tsx`) edits name,
  prompt, cadence and max runs in place, lists the latest runs with a way to the
  session each ran in, and holds Run now, Pause or Resume, Save and Delete in its
  footer. The Automations page opens the same sheet from a row; More settings…
  opens the full form for a `new-agent` schedule.
- **When an agent creates a heartbeat**, its `create_heartbeat` call renders as a
  card in the timeline (`heartbeat-created-card.tsx`): name, status, cadence and
  next run, the prompt, and Run now, Pause and Edit.
- **Each run is marked** in the session's timeline. The daemon drops the
  `<clisbot-system>` prompt it sends (`agent-manager.ts`), so before the prompt
  it appends a `notification` item, **Heartbeat · name · run N of M**
  (`protocol/src/schedule/heartbeat-notice.ts`), which the app draws as a marker
  (`heartbeat-run-marker.tsx`). A heartbeat through its Chat gets the same
  marker from its transcript line.
- **The Chat ⏱ follows a Bot across `/new`**: its group lists the heartbeats of
  every session that Bot has had in the Chat (`clisbot.chat-id` and
  `clisbot.bot-id` labels), so a heartbeat still on the earlier session stays
  listed until its next run moves it.

```text
Asana 8340  ⋯  ⏱ 1                                   Commit ▾   ▣
            ┌───────────────────────────────────────┐
            │ This session · Check CI watcher       │
            │ Check CI                         ⏸    │
            │ every 30 min · next in 25m            │
            │ + New heartbeat…                      │
            │───────────────────────────────────────│
            │ Other sessions in this workspace      │
            │ › Release review                      │
            │     Review CI                    ⏸    │
            │───────────────────────────────────────│
            │ 🗓 All schedules…                      │
            └───────────────────────────────────────┘
```

The menu rows follow the entity-row pattern in [menus](../menus.md#entity-rows).

**Repeat.** The form and the detail sheet pick a cadence as Every N minutes or
hours, Daily at a time, Weekly on chosen days at a time, or Custom cron, with
quick picks (`clisbot/schedules/cadence-picker.tsx`). It still writes cron, in
the device timezone for a new schedule. "Every N" offers only steps that divide
the hour or the day, because cron restarts the count at each hour or midnight:
a 7-minute step would also run at :56 and :00.

**Max runs is required when a schedule repeats within the day** (decided
2026-10-08). A forgotten every-5-minutes heartbeat would otherwise run
without end. The rule is "more than one run per calendar day": an `every`
cadence under 24 hours, or a cron whose minute and hour fields match more than
one time of day. Once a day, weekly, and a daily cron limited to some days
stay optional. `runsMoreThanDaily` in `protocol/schedule/run-limit.ts` decides
this for both sides. The daemon refuses the request at `schedule/create` and
`schedule/update` and in the agent tools (`create_schedule`,
`create_heartbeat`, `update_schedule`). The check is at the request, not in
`ScheduleService`, so schedules stored before the rule keep running. An update
is checked only when it changes the cadence or Max runs, so a rename never
needs a limit. `runLimitErrorForUpdate` holds that rule for the daemon, the
detail sheet and the Edit settings form, which sends the cadence and Max runs
only when they changed. The app marks Max runs as Required under the cadence
and keeps Create or Save off until it is set. Max runs counts every run since
the schedule was created, so a limit at or below the runs done ends it on the
next tick.

The rule has no feature flag, an exception to the upstream-compatibility rule
in `CLAUDE.md`. It only refuses requests, and an app or agent that predates it
gets the refusal message from the daemon. The agent skill and
`public-docs/schedules-cli.md` give `maxRuns` in every sub-daily example.

**`/new` in a Chat.** When a Bot's fresh session starts in a Chat, the daemon
moves the heartbeats of that Bot's earlier sessions in the Chat to it
(`chats/bot-sessions.ts`, `ScheduleService.retargetAgent`), keeping `chatId`.
A heartbeat through its Chat starts that session itself. A plain one runs into
the old session until the fresh one starts, and the Chat drops the reply.

**In the Chat's transcript.** A Chat keeps a turn's text, not its tool calls, so
a heartbeat a Bot made in a turn shows as its card above that turn's reply
(`clisbot/heartbeats/chat-turn-heartbeats.ts`): the Bot's first line after the
heartbeat's `createdAt` for that session, when the line before it is older. This
covers the `create_heartbeat` tool and `clisbot heartbeat create` from the
Bot's shell alike. The daemon pushes no schedule changes, so each new bot line
refreshes the list. Two lines from one Bot share a group only within one turn
(`reply.turnId`), so a run with no prompt before it, such as a heartbeat made
from the shell that runs in the session without a marker, keeps the face.

Seeing and changing heartbeats here needs `schedule.manage` on the session's or
the Bot's Project, because these use the same RPCs.

## Build order

1. `schedule.manage` for Managed Access. Built.
2. Heartbeats in an agent session, and Run in **Existing session** (A); both
   need the session picker. Built.
3. **Existing workspace** (B), gated on `server_info.features.scheduleExistingWorkspace`.
   Built.
4. Heartbeats in a Bot DM and group, with the `/new` move. Built.
5. Heartbeats through their **Chat** (C), gated on
   `server_info.features.scheduleChatDelivery`. Built.

Channel bindings (D) are deferred.

## Known limits

- The daemon pushes no event when a schedule changes; lists reload when opened
  or on reconnect (`runtime/host-runtime.ts:2659`), so a heartbeat an agent
  just created appears on the next open.
- A run into a busy session fails with "already has an active run"
  (`schedule/service.ts`). A heartbeat through its Chat follows the Chat's When
  busy instead.
- `list_schedules` omits heartbeats by design: an agent only manages its own
  (`clisbot-tools.ts:2689`).
- A run that hits a permission prompt waits for whoever can answer it. Office
  worker holds only `approval.file`.
- A heartbeat through its Chat records no output in its runs: the reply is in
  the transcript, and the run ends when the line is posted.
- A Chat shows no created card: its transcript carries the Bot's lines, not tool
  calls. The ⏱ count and menu are the signal there.

## Superseded

Earlier revisions of this record (2026-10-06, in Git history) proposed a
`conversation` field on every schedule, delivery into Chats and channel lanes,
a Rule leaf `allowSchedules` with Connection and Route limits, Hub-served agent
tools, per-prompt allowance claims in the session-operation ticket, and an
own/all grant scope. They were dropped on 2026-10-07 for a smaller first step:
tools follow configuration, Members get one Project privilege, and the app
gains the Run in choice and heartbeat lists.
