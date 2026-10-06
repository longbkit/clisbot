# Schedules that belong to a conversation (2026-10-06)

Decision record. Status: **proposed**, not built. Covers an agent session in the
app, a Chat with Bots in the app, and a channel conversation (Slack, Telegram,
Zalo).

## Context

Users want two things from wherever they are talking to a bot:

1. See the schedules that report into this conversation, and create, pause or
   stop them here.
2. Ask the bot in plain words ("check CI every 30 minutes and report here") and
   have it set that up.

The Host already has one schedule engine (`packages/server/src/server/schedule/`)
with two target kinds that share the store, the cron engine and the run history:

- `target: { type: "agent" }`, shown as **Heartbeat**: a prompt back into one
  existing agent. Agents get `create_heartbeat` and `delete_heartbeat`, scoped to
  the calling agent.
- `target: { type: "new-agent" }`, shown as **Schedule**: each run starts a fresh
  agent. Agents get `create_schedule`, `list_schedules`, `inspect_schedule`,
  `pause_schedule`, `resume_schedule`, `update_schedule`, `schedule_logs`,
  `run_schedule_once`, `delete_schedule`.

Upstream split the two tools in #1266 because agents picked `new-agent` for
babysitting and the report landed in a session nobody read (commit `0d0012959`).

### What breaks today

| #   | Problem                                                                                                                                                | Where                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | A schedule does not know which conversation it belongs to. Nothing lists "the schedules of this chat".                                                 | `protocol/src/schedule/types.ts:58`                                      |
| 2   | A `new-agent` run reports nowhere a user is looking: `run.output` and a fresh session.                                                                 | `schedule/service.ts`                                                    |
| 3   | A Heartbeat follows an `agentId`. After `/new` in a Chat or channel it fires into the old session; the Chat engine drops the answer.                   | `chats/chat-engine.ts:551`, `hub/channels/execution.ts`                  |
| 4   | A run while the agent is busy fails with "already has an active run".                                                                                  | `schedule/service.ts:855`                                                |
| 5   | No `createdBy`. Runs carry no actor, so a revoked Member's schedule keeps running.                                                                     | `schedule/service.ts:840`                                                |
| 6   | Agent tools check nothing about the requester. Any agent on the Host can list, edit and delete every `new-agent` schedule.                             | `agent/tools/clisbot-tools.ts:816`                                       |
| 7   | `list_schedules` hides Heartbeats, so an agent cannot answer "what is scheduled here?".                                                                | `agent/tools/clisbot-tools.ts:2689`                                      |
| 8   | The app RPCs need `automation.manage`, which only the Owner has. A Hub connection and a Managed Access Member cannot read any schedule.                | `authorization/operation-permissions.ts:184`                             |
| 9   | The app's schedule list does not update on create or delete; it reloads on mount and on reconnect.                                                     | `app/src/runtime/host-runtime.ts:2659`                                   |
| 10  | On a `tool` Route a Heartbeat run posts nothing, and the reply tool reuses the last inbound turn's id (idempotency collisions, shared 50-post budget). | `hub/channels/relay/turn-end.ts:22`, `channel-reply-capabilities.ts:392` |
| 11  | After a Hub restart the reply thread is unknown, so a run can land at the channel root.                                                                | `hub/channels/relay/index.ts:100`                                        |
| 12  | In a group Chat a Heartbeat goes straight into one Bot's session and skips turn rules.                                                                 | `chats/chat-engine.ts`                                                   |
| 13  | Agent tools are off by default (`daemon.mcp.injectIntoAgents` is `false`), so Bot and channel sessions have no schedule tools at all.                  | `server/config.ts:542`                                                   |
| 14  | No limits: minimum interval, schedules per conversation.                                                                                               | —                                                                        |

## Decision

One concept, **Schedule**, on the existing engine. A Schedule gains two optional
facts: the conversation it belongs to and who created it. Everything else, the
store, cron, run history, CLI, and the Automations page, stays shared.

### Model

```ts
// unchanged
target: { type: "agent", agentId } | { type: "new-agent", config }

// new, optional
conversation?:
  | { kind: "agent"; agentId: string }
  | { kind: "chat"; chatId: string; botId: string }
  | { kind: "channel"; routeId: string; bindingKey: string; threadId?: string };
createdBy?: { principalId: string; channelSenderId?: string };
pausedReason?: string;
```

In the UI a Schedule has two attributes instead of two names:

| Runs in                              | Reports to        | Stored as                            | Use                                    |
| ------------------------------------ | ----------------- | ------------------------------------ | -------------------------------------- |
| This session                         | This conversation | `target: agent` + `conversation`     | "Check CI every 30 min, report here"   |
| A new session each time              | This conversation | `target: new-agent` + `conversation` | "Triage every morning, post a summary" |
| A new session each time              | Nowhere           | `target: new-agent`                  | Today's Schedule                       |
| This session (no conversation field) | The agent         | `target: agent`                      | Today's Heartbeat, unchanged           |

With `conversation` set, `target.agentId` is the session the last run used. The
next run resolves the conversation's current session again, so `/new` keeps the
schedule (#3).

Every schedule created from a conversation reports back to it, whichever
"Runs in" the agent picks. Picking the wrong tool now costs context continuity,
not a lost report (#2), which removes the reason the split was dangerous.

### Wire compatibility

All new fields are optional object fields, so an old client parses a new
daemon's `schedule/list` and ignores them. No new variant is added to the
`target` union or to `ScheduleStatusSchema`; either would make an old client
reject the whole response. A paused schedule with `pausedReason` is still
`status: "paused"`.

There is no flag of its own. The feature rides the Clisbot fusion gate and is
advertised once as `server_info.features.conversationSchedules`. With the fusion
gate off, no new fields are written and agent tools and RPCs behave as upstream.
Today the fusion has no single master switch: each area has its own
(`daemon.bots`, `daemon.managedAccess.mode`, `features.agentSessionStorage`), so
which switch this rides is Q7.

### Authority: `automation.manage`, scoped by creator

`automation.manage` stays the one permission for schedules. What changes is its
reach: it is narrowed to Projects, and changing someone else's schedule needs a
second privilege.

| Privilege (Hub, on a Host or Project) | Unlocks on that Project's schedules                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `automation.manage`                   | See all of them; create; update, pause, resume, run once, delete **own**        |
| `automation.manage.others`            | Update, pause, resume, run once, delete **anyone's**; needs `automation.manage` |

- **Which Project a schedule belongs to**: the Project of the agent it runs in
  (`target: agent`), of its `cwd` (`target: new-agent`), or of the Bot (a Chat).
  A Host grant reaches every Project on the Host, as for every other privilege.
- **Own** means `createdBy` is the caller's principal. A schedule written before
  `createdBy` existed has no creator and needs `automation.manage.others`.
- **Owner and daemon admins** (`daemon.manage`) hold both on everything; the
  Automations page keeps working for them unchanged.
- **Without Managed Access** (a local or paired client), the daemon permission
  `automation.manage` keeps today's meaning: every schedule, own and others'.

This follows the existing `workspace.manage` shape (`hub/src/access/store.ts:1377`):
the Hub hands the daemon the session-wide `automation.manage` permission
whenever any Project grants it, and the daemon narrows each request back to the
Projects that hold it. The daemon permission names stay upstream's; only Hub
privileges are added. `automation.manage.others` follows the
`approval.command` / `approval.command.destructive` naming pair.

Grants work the same on every surface. A Member, a Team, or the Guest group
gets `automation.manage` on a Project like any other privilege, so a channel
needs no privilege of its own: the sender's Hub authority on the bound
session's Project decides.

An agent tool acts for the **requester of the turn** (the Chat message's sender,
the channel sender, the session's actor), never for the agent (#6). A Hub
connection never needs the daemon permission: it calls the scoped RPCs under
`hub.execute` and passes the sender (#8).

| Where                    | See                                                   | Create              | Change own          | Change others'                          |
| ------------------------ | ----------------------------------------------------- | ------------------- | ------------------- | --------------------------------------- |
| Agent session in the app | `automation.manage` on the agent's Project            | `automation.manage` | `automation.manage` | `automation.manage.others`              |
| Chat in the app          | `automation.manage` on the Bot's Project              | `automation.manage` | `automation.manage` | `automation.manage.others`              |
| Channel conversation     | the sender's `automation.manage` on the bound Project | the same            | the same            | the sender's `automation.manage.others` |
| Automations page         | `automation.manage`, Projects it reaches              | `automation.manage` | `automation.manage` | `automation.manage.others`              |

Inside a conversation, lists show that conversation's schedules; the
Automations page shows every schedule the caller may see.

### Running

Before each run the daemon checks that the creator still holds
`automation.manage` on the schedule's Project and that the conversation still
exists. If not, the schedule
pauses with a `pausedReason` (creator lost access, Chat archived, Bot removed,
Route deleted) and the conversation gets one line saying so. The run executes
under the creator's identity (`withSessionOperationIdentity`) (#5).

Delivery by conversation kind:

- **None or `agent`**: start a run in the agent. A busy agent queues the run
  until its turn ends instead of failing (#4).
- **`chat`**: `ChatService` appends a system line ("Scheduled: <name>") and
  dispatches it to the Bot like a message. It gets an expectation, turn rules
  and hops apply, the per-Bot delivery queue absorbs a busy Bot (#12).
- **`channel`**: the daemon sends `channel.schedule.fire` to the Hub over the
  socket the Host already holds. The Hub turns it into an inbound event with
  source `schedule` and idempotency key `runId`, admits it to the binding's
  lane, and the Route's Reply method answers into `threadId` (#10, #11). With
  no Hub connected the run fails with `hub_not_connected` and is not replayed,
  matching the channel plane's no-auto-replay rule.
- **`new-agent` with a conversation**: the run starts a fresh agent as today.
  Its final answer is delivered to the conversation by the same adapter
  (system line in a Chat, post in the channel, notification prompt into the
  agent) (#2).

Each run counts against the conversation's limits. New limits: minimum interval
and active schedules per conversation, on the Bot/Conversation/Route Limits for
channels and a daemon default elsewhere (#14).

## Surfaces

### Agent tools: same names, scoped

Tool names and parameters stay upstream's, so prompts and skills keep working.

- `create_heartbeat`: Runs in this session. When the caller has a
  conversation, it is attached automatically.
- `create_schedule`: Runs in a new session. When the caller has a
  conversation, it is attached automatically, so the result reports back here.
- `list_schedules`, `inspect_schedule`, `pause_schedule`, `resume_schedule`,
  `update_schedule`, `schedule_logs`, `run_schedule_once`, `delete_schedule`:
  return and act on both kinds, checked against the requester's
  `automation.manage` and `automation.manage.others` (#7). Inside a
  conversation they list that conversation's schedules.
- `delete_heartbeat` stays as an alias of `delete_schedule` for a Heartbeat.
- Descriptions say where the result lands: "Reports back to this conversation."

The caller's conversation is derived on the daemon: the `chatId`/`botId` labels
on a Bot session (`chats/bot-sessions.ts:133`), the channel binding label the
Hub sets when it binds an agent (to add), or the agent itself.

Bot and channel sessions receive these tools whenever the fusion gate is on,
even with `injectIntoAgents` off, through a per-session tool policy that exposes
only the schedule tools (#13, Q4).

### App

- **Agent session**: agent menu → Schedules. Lists the agent's schedules with
  Runs in, cadence, next and last run, creator. New opens the existing schedule
  form with Reports to = this agent.
- **Chat**: chat options → Schedules (`chat-options-pages.tsx`), same list and
  form, Reports to = this Chat, Bot picker in a group.
- **Automations page**: unchanged for `automation.manage`; gains a Reports to
  column. Under the fusion gate the "Heartbeat" label becomes "Schedule · runs in this
  session" (Q1).
- Lists update live from a `schedule.changed` push, filtered by scope (#9).

### Channel

| Command                                    | Does                                    | Requires                                                             |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| `/schedule`                                | List this conversation's schedules      | `automation.manage`                                                  |
| `/schedule every <cadence> <prompt>`       | Create, runs in this session            | `automation.manage`                                                  |
| `/schedule every <cadence> --new <prompt>` | Create, runs in a new session each time | `automation.manage`                                                  |
| `/schedule pause\|resume\|stop <id>`       | Change one                              | `automation.manage` for own, `automation.manage.others` for anyone's |

`/status` shows how many schedules the conversation has. The channel reply tool
needs no schedule tools of its own: the agent uses the scoped tools above.

### RPCs

New dotted RPCs, one family for all three conversation kinds:
`schedule.conversation.list.request`, `…create…`, `…update…`, `…pause…`,
`…resume…`, `…delete…`, `…run_once…`, each with a `conversation` scope, plus
the `schedule.changed` push. They require `automation.manage`, narrowed to the
schedule's Project, and `automation.manage.others` to change another creator's
schedule. The existing flat `schedule/*` RPCs keep serving the Automations page
with the same narrowing.

For a channel the Hub resolves the sender's privileges on the bound Project
itself, then calls the family under `hub.execute` with `createdBy` set to the
sender, limited to `conversation.kind: "channel"` for bindings it owns. A Hub
connection never needs the daemon permission.

### Hub fix that ships regardless

The reply tool restamps its turn on `turn_started`, not only on an inbound
message, so any turn the channel did not start gets its own idempotency
namespace and output budget (#10).

## Options considered

| Option                                                        | Why not                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Keep Heartbeat as-is and patch around it                      | Leaves #2, #3, #5, #6, #10–#12.                                                              |
| One tool with a `runIn` parameter                             | Upstream removed exactly this in #1266 because agents picked wrong.                          |
| A scheduler inside each conversation owner (ChatService, Hub) | Three cron engines, three pause/log/UI paths.                                                |
| Hub Automations with a time trigger                           | In-app Chats must work without a Hub; a workflow is too heavy for "report every 30 minutes". |
| New tool names (`schedule_create`, …) for conversations       | A second vocabulary for the same tools; scoping the existing tools does the job.             |

## Phases

1. **Core and agent sessions** (daemon + app, no Hub): fields, Project-narrowed
   `automation.manage` with `automation.manage.others`, creator identity and
   pre-run checks, busy queue, scoped agent tools, scoped
   RPCs and push, the agent menu's Schedules.
2. **Chat**: `chat` delivery through `ChatService`, chat options → Schedules,
   Bot-session tool policy.
3. **Channel**: `channel.schedule.fire`, inbound source `schedule`, `/schedule`,
   limits, binding label, `threadId`. The reply-tool turn fix can
   land earlier on its own.
4. **Follow-ups**: confirmation card when the requester lacks create authority
   (Q6), CLI `clisbot schedule ls --conversation`.

Docs to update when built: `docs/glossary.md` (Schedule, Heartbeat),
`docs/permissions.md` (the `automation.manage` row still says "loops"),
`docs/features/access/terminal-and-project-creation.md` (says
`injectIntoAgents` defaults to true), `docs/features/slash-commands/README.md`,
`public-docs/schedules*.md`.

## Open questions

- **Q1. Label.** Rename "Heartbeat" in the app to "Schedule · runs in this
  session" under the fusion gate (proposed), or keep both words and record the split
  in the glossary.
- **Q2. Privilege names.** `automation.manage` on a Hub Project means schedules,
  while the Hub's Automation resource (`automation.run`, Automation Admin) means
  workflows. Keep the daemon's name for both levels (proposed:
  `automation.manage`, `automation.manage.others`), or name the Hub privileges
  after schedules (`schedule.manage`, `schedule.manage.others`) and map them to
  the daemon permission.
- **Q3. Hub offline at run time.** Fail the run without replay (proposed), or
  run it once the Hub reconnects.
- **Q4. Tools without `injectIntoAgents`.** Give Bot and channel sessions the
  scoped schedule tools whenever the fusion gate is on (proposed), or require the
  global switch.
- **Q5. Group Chat target.** Require a Bot per schedule (proposed for v1), or
  allow "the room" and let turn rules pick.
- **Q6. Requester without create authority.** Refuse and say who can create it
  (proposed for v1), or post a confirmation card an authorized person accepts.
- **Q7. Which switch.** No single fusion master switch exists. Ride Managed
  Access (`daemon.managedAccess.mode` not `off`, proposed: the scoped privileges
  only mean something there), ride `daemon.bots`, or introduce one master switch
  and move the existing ones under it.
