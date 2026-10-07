# Schedules that belong to a conversation (2026-10-06)

Decision record. Status: **proposed**, not built. Covers an agent session in the
app, a Chat with Bots in the app, and a channel conversation (Slack, Telegram,
Zalo). The grant scope it relies on is its own decision:
[Grant scope: own or all](../features/access/grant-scope.md).

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
| 14  | No limits on how often a schedule runs, how many times, or how many schedules a channel holds.                                                         | —                                                                        |

## Decision

One concept, **Schedule**, on the existing engine. A Schedule gains two optional
facts: the conversation it belongs to and who created it. The store, cron, run
history, CLI and the Automations page stay shared.

Authority follows the layer the user is on:

- **App** (agent session, Chat): `automation.manage` on the schedule's Project,
  with the grant's [scope](../features/access/grant-scope.md) deciding whether
  the holder may change only their own schedules or everyone's.
- **Channel**: the Route's Rules, like everything else a sender does there. A
  sender's Host or Project grants are never consulted
  ([2026-09-18 chat authority](2026-09-18-channel-chat-authority-and-limits.md),
  [2026-10-05 Routes and Rules](2026-10-05-routes-and-rules.md)).

### Model

```ts
// unchanged
target: { type: "agent", agentId } | { type: "new-agent", config }

// new, optional
conversation?:
  | { kind: "agent"; agentId: string }
  | { kind: "chat"; chatId: string; botId: string }
  | { kind: "channel"; connectionId: string; routeId: string; bindingKey: string; threadId?: string };
createdBy?: SessionActor & { channelSenderId?: string }; // protocol/src/session-authorship.ts
pausedReason?: string;
```

In the UI a Schedule has two attributes instead of two names:

| Runs in                              | Reports to        | Stored as                            | Use                                    |
| ------------------------------------ | ----------------- | ------------------------------------ | -------------------------------------- |
| This session                         | This conversation | `target: agent` + `conversation`     | "Check CI every 30 min, report here"   |
| A new session each time              | This conversation | `target: new-agent` + `conversation` | "Triage every morning, post a summary" |
| A new session each time              | Nowhere           | `target: new-agent`                  | Today's Schedule                       |
| This session (no conversation field) | The agent         | `target: agent`                      | Today's Heartbeat, unchanged           |

The Fusion app labels both kinds **Schedule**; "Heartbeat" remains the code and
upstream CLI name for "Runs in: this session".

With `conversation` set, `target.agentId` is the session the last run used. The
next run resolves the conversation's current session again, so `/new` keeps the
schedule (#3).

Every schedule created from a conversation reports back to it, whichever
"Runs in" the agent picks. Picking the wrong tool now costs context continuity,
not a lost report (#2), which removes the reason the split was dangerous.

### Wire compatibility and gating

All new fields are optional object fields, so an old client parses a new
daemon's `schedule/list` and ignores them. No new variant is added to the
`target` union or to `ScheduleStatusSchema`; either would make an old client
reject the whole response. A paused schedule with `pausedReason` is still
`status: "paused"`.

No flag of its own: the feature rides the Clisbot fusion gate and is advertised
once as `server_info.features.conversationSchedules`. With the gate off, no new
fields are written and agent tools and RPCs behave as upstream. Which existing
switch is "the fusion gate" is Q1.

### Authority in the app

| Action on a Project's schedules                      | Needs                                     |
| ---------------------------------------------------- | ----------------------------------------- |
| See all of them                                      | `automation.manage`                       |
| Create                                               | `automation.manage`                       |
| Update, pause, resume, run once, delete **own**      | `automation.manage`, scope `own` or `all` |
| Update, pause, resume, run once, delete **anyone's** | `automation.manage`, scope `all`          |

- **The schedule's Project**: the Project of the agent it runs in (`target:
agent`), of its `cwd` (`target: new-agent`), or of the Bot (a Chat). A Host
  grant reaches every Project on the Host.
- **Own**: `createdBy` is the caller's principal. A schedule without
  `createdBy` (written before this change, or from a local client) counts as
  someone else's.
- **Owner, daemon admins and clients without Managed Access** keep today's
  meaning: every schedule, scope `all`.
- The daemon permission stays upstream's `automation.manage`. As with
  `workspace.manage` (`hub/src/access/store.ts:1377`), the Hub hands the
  session the permission whenever any Project grants it, and the daemon narrows
  each request to the Projects and scope that hold it.
- An agent tool in an app session acts for the **requester of the turn** (the
  Chat message's sender, the session's actor), never for the agent (#6).
- Inside a conversation, lists show that conversation's schedules; the
  Automations page shows every schedule the caller may see.

### Authority on a channel

A schedule on a channel is a message the sender asks to be sent later, run by
the Route's configuration. So the same parties decide as for a message.

**A Rule decides who may schedule, and where.** A Rule gains one leaf, off by
default (name provisional, Q6):

```yaml
audience:
  - who: { teams: [ops] }
    where: { conversations: [C0OPS] }
    interaction: { requireMention: true, allowSchedules: true }
```

| Action                                           | Who                                                          |
| ------------------------------------------------ | ------------------------------------------------------------ |
| See this conversation's schedules                | a sender any Rule admits here                                |
| Create                                           | a sender admitted here by a Rule with `allowSchedules: true` |
| Update, pause, resume, run once, delete own      | the creator, while still admitted by such a Rule             |
| Update, pause, resume, run once, delete anyone's | Connection Admin (`channel.manage`)                          |

- **Asking the bot and typing `/schedule` are the same act.** The table applies
  to both doors. When a sender asks the agent in words, the agent's schedule
  tool is served by the Hub and checked against the turn's requester, the
  sender. It is not checked against the agent's own authority: on a channel the
  agent runs under the Route's configuration, so judging the agent would let
  anyone the Route admits schedule through a sentence what `/schedule` refuses
  them.
- **Who the requester is.** The sender of the message the turn answers; in a
  batched turn, the sender of the newest message. In a turn a schedule started,
  the schedule's creator, so a run cannot schedule more than its creator may.
  This needs new Hub state: today the capability's `requesterSenderId` is the
  sender who **opened the thread** and is never restamped
  (`channel-reply-capabilities.ts:35`, `noteTurn` at `:392`). `noteTurn` must
  restamp the sender with the turn. A message steered into a running turn
  (`/steer`, `whenBusy: steer`) makes the turn answer two senders; the tool
  then requires both to be allowed.
- **Project authority is checked once, at publish.** Turning `allowSchedules`
  on means other people may start unattended, repeated runs on the Route's
  Project, as auto-approved actions do. The publisher must be able to delegate
  `automation.manage` on that Project, through the same delegation check that
  covers the Route's Agent configuration and approvals
  (`assertChannelConfigurationDelegation`, `hub/src/access/delegation.ts`).
  Senders are never checked against Project grants.
- **An Anyone Rule warns, it does not refuse**, like every other open-Route
  choice.
- **Re-publishing decides, revoking does not.** Revoking the publisher's grant
  later does not rewrite the Route; re-publishing it with `allowSchedules` off
  pauses the schedules that Rule admitted.
- **Operators on the app**: a holder of `automation.manage` scope `all` on the
  Project can also stop a channel schedule from the Automations page. That is
  Host authority over the Host's own resources, not channel authority.

### Limits on a channel

Two kinds, configured on the Connection (`limits`) and on the Route
(`limits`). Rules and conversations carry none.

| Limit                         | Default | Range                      | Scope                                |
| ----------------------------- | ------- | -------------------------- | ------------------------------------ |
| Active schedules              | 20      | any whole number, or `off` | Connection and Route, each counted   |
| Minimum interval between runs | 5 min   | 2 min or more              | per schedule; Route, else Connection |
| Runs per schedule             | 20      | any whole number, or `off` | per schedule; Route, else Connection |

```yaml
limits:
  schedules:
    max: 20 # "off" = unlimited
    minIntervalSeconds: 300 # refused below 120
    maxRuns: 20 # "off" = unlimited
```

- **Active schedules** are counted at both scopes; a create fails when either
  is full. Paused schedules count; completed and deleted ones do not.
- **Interval and runs** resolve Route, then Connection, then the default. They
  bound the schedule a sender may create: a cadence whose consecutive fire
  times come closer than the minimum is refused (checked over the cron's next
  occurrences, `schedule/cron.ts`), and a schedule created without `maxRuns`
  gets the limit as its `maxRuns`. A larger `maxRuns` than the limit is
  refused, naming the limit.
- **2 minutes is a floor**, not a default: the schema refuses a lower value.
- Each run is also a message, so it counts against the existing
  Bot/Conversation/Route message and concurrency limits.
- The key names follow `CHANNEL_LIMIT_NAMES`; final names are Q6.

App surfaces keep upstream behavior: no new limits (Q5).

### Running

Before each run:

- **App kinds**: the daemon checks that the creator still holds
  `automation.manage` on the schedule's Project.
- **Channel**: the Hub checks that a Rule with `allowSchedules` still admits
  the creator in that conversation and that the Route still serves it.
- **Both**: the conversation still exists.

On a failed check the schedule pauses with a `pausedReason` (creator lost
access, Chat archived, Bot removed, Rule changed, Route deleted) and the
conversation gets one line saying so. The run executes under the creator's
identity (`withSessionOperationIdentity`) (#5).

Delivery by conversation kind:

- **None or `agent`**: start a run in the agent. A busy agent queues the run
  until its turn ends instead of failing (#4).
- **`chat`**: `ChatService` appends a system line ("Scheduled: <name>") and
  dispatches it to the Bot like a message. It gets an expectation, turn rules
  and hops apply, and the per-Bot delivery queue absorbs a busy Bot (#12).
- **`channel`**: the daemon sends `channel.schedule.fire` to the Hub over the
  socket the Host already holds. The Hub turns it into an inbound event with
  source `schedule` and idempotency key `runId`, admits it to the binding's
  lane, and the Route's Reply method answers into `threadId` (#10, #11). With
  no Hub connected the run fails with `hub_not_connected` and is not replayed
  (Q2).
- **`new-agent` with a conversation**: the run starts a fresh agent as today.
  Its final answer is delivered to the conversation by the same adapter (#2).

## Surfaces

### Agent tools

Tool names and parameters stay upstream's, so prompts and skills keep working.

- `create_heartbeat`: Runs in this session. The caller's conversation is
  attached automatically.
- `create_schedule`: Runs in a new session. The caller's conversation is
  attached automatically, so the result reports back here.
- `list_schedules`, `inspect_schedule`, `pause_schedule`, `resume_schedule`,
  `update_schedule`, `schedule_logs`, `run_schedule_once`, `delete_schedule`:
  return and act on both kinds (#7). Inside a conversation they list that
  conversation's schedules.
- `delete_heartbeat` stays as an alias of `delete_schedule` for a Heartbeat.
- Descriptions say where the result lands: "Reports back to this conversation."

Where they come from:

- **App sessions** (an agent session, a Bot in a Chat): the daemon's `clisbot`
  MCP server, checked by the app rules above. The caller's conversation is the
  agent itself or the Bot session's `chatId`/`botId` labels
  (`chats/bot-sessions.ts:133`).
- **Channel-bound sessions**: the Hub's `channel_reply` MCP server serves the
  same tool names and checks the turn's requester (above) against the Route's
  Rules.
  - The agent calls the Hub over HTTP at `publicBaseUrl/mcp/channel/<token>`
    (`channels/control-plane.ts:321`); the Hub then creates the schedule on the
    daemon through the Host socket (`schedule.conversation.create.request`
    under `hub.execute`).
  - Today the server is attached only on `tool` and `hybrid` Routes
    (`outboundAttachesTool`, `control-plane.ts:317`). Schedules need it on
    every Route, so a `relay` Route gets the server carrying the schedule tools
    only, without the `message` tool.
  - Preapproval depends on the provider. A `toolPolicy` on a provider without
    `applyToolPolicy` fails the session create
    (`agent/agent-manager.ts:6394`); that is why such providers fall back to
    `relay` today ([2026-09-16 ACP preapproval](2026-09-16-acp-mcp-tool-preapproval.md)).
    Where the provider supports exact preapproval, the schedule tools are
    preapproved like `message`, since the Hub has authorized the call. Elsewhere
    they are attached without preapproval, and the provider's permission prompt
    goes through the Route's approval rules.
  - Hiding the daemon's schedule tools in these sessions is new work: the
    current tool policy is per provider (`clisbotTools.disabledTools`,
    `clisbot-tool-policy.ts:14`), not per session.
  - MCP servers are stored on the agent record and reused when a closed agent
    reloads (`agent-manager.ts:256`). A session bound before the feature
    shipped gets the tools on its next `/new`.

Bot and channel sessions get their schedule tools whenever the fusion gate is
on, even with `injectIntoAgents` off (#13, Q3).

### App

- **Agent session**: agent menu → Schedules. Lists the agent's schedules with
  Runs in, cadence, next and last run, creator. New opens the existing schedule
  form with Reports to = this agent.
- **Chat**: chat options → Schedules (`chat-options-pages.tsx`), same list and
  form, Reports to = this Chat, Bot picker in a group (Q4).
- **Automations page**: gains a Reports to column and the Schedule label.
- **Route form**: each Rule gets an "Allow schedules" switch; the Route and
  Connection limits sections get the three schedule limits.
- Lists update live from a `schedule.changed` push, filtered by authority (#9).

### Channel commands

| Command                                    | Does                                    | Who                                             |
| ------------------------------------------ | --------------------------------------- | ----------------------------------------------- |
| `/schedule`                                | List this conversation's schedules      | any admitted sender                             |
| `/schedule every <cadence> <prompt>`       | Create, runs in this session            | sender admitted by a Rule with `allowSchedules` |
| `/schedule every <cadence> --new <prompt>` | Create, runs in a new session each time | the same                                        |
| `/schedule pause\|resume\|stop <id>`       | Change one                              | the creator, or Connection Admin                |

`/status` shows how many schedules the conversation has.

### RPCs

New dotted RPCs, one family for all three conversation kinds:
`schedule.conversation.list.request`, `…create…`, `…update…`, `…pause…`,
`…resume…`, `…delete…`, `…run_once…`, each with a `conversation` scope, plus
the `schedule.changed` push.

- From the app they require `automation.manage`, narrowed to the schedule's
  Project and the grant's scope. The existing flat `schedule/*` RPCs keep
  serving the Automations page with the same narrowing.
- From the Hub they run under `hub.execute`, limited to `conversation.kind:
"channel"` for bindings the Hub owns. The Hub has already applied the Rules,
  so the daemon checks no sender grant, as for every channel session.

### Hub fix that ships regardless

The reply tool restamps its turn on `turn_started`, not only on an inbound
message, so any turn the channel did not start gets its own idempotency
namespace and output budget (#10).

## Options considered

### Overall shape

| Option                                                        | Why not                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Keep Heartbeat as-is and patch around it                      | Leaves #2, #3, #5, #6, #10–#12.                                                              |
| One tool with a `runIn` parameter                             | Upstream removed exactly this in #1266 because agents picked wrong.                          |
| A scheduler inside each conversation owner (ChatService, Hub) | Three cron engines, three pause/log/UI paths.                                                |
| Hub Automations with a time trigger                           | In-app Chats must work without a Hub; a workflow is too heavy for "report every 30 minutes". |
| New tool names (`schedule_create`, …) for conversations       | A second vocabulary for the same tools; scoping the existing tools does the job.             |

### Who may schedule on a channel

| Option                                                   | Why not                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **A. A Rule leaf plus Connection/Route limits (chosen)** | —                                                                                                               |
| B. One switch on the Route                               | "Who may" belongs to Rules; a Route cannot say "DMs yes, #general no", the problem 2026-10-05 fixed.            |
| C. A personal grant, like `/command add`                 | `approval.config` is a Project privilege, the coupling chat authority removed. A schedule is not configuration. |
| D. A new privilege granted on the Connection             | Brings grants back for chat senders, which 2026-09-19 removed; cannot vary by conversation.                     |
| E. Connection Admins only                                | Too narrow: a team cannot set its own reminders. Kept as the "anyone's" authority.                              |
| F. Any admitted sender, limits as the only gate          | Authority hidden in a number: "why can't I?" answered by "the limit is 0". Limits stay as the second gate.      |
| G. Anyone proposes, a Connection Admin confirms          | Needs buttons on every channel and stalls without an admin; kept for later.                                     |

### Which MCP server serves a channel session's schedule tools

| Option                                                         | Why not                                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Hub's `channel_reply` server (chosen)**                  | —                                                                                                                                                                                                        |
| The daemon's `clisbot` server, unchanged                       | Checks nothing about the sender; anyone the Route admits schedules by asking (#6).                                                                                                                       |
| The daemon's `clisbot` server, asking the Hub before each call | A new daemon-to-Hub authorization call, and the daemon must know which channel turn and sender it is serving. The Hub already holds the binding and, once `noteTurn` restamps the sender, the requester. |

## Phases

1. **Core and agent sessions** (daemon + app, no Hub): fields, grant scope,
   Project-narrowed `automation.manage`, creator identity and pre-run checks,
   busy queue, scoped agent tools, scoped RPCs and push, the agent menu's
   Schedules.
2. **Chat**: `chat` delivery through `ChatService`, chat options → Schedules,
   Bot-session tool policy.
3. **Channel**: Rule leaf and publish check, schedule limits,
   `channel.schedule.fire`, inbound source `schedule`, Hub-served tools,
   `/schedule`, `threadId`. The reply-tool turn fix can land earlier on its own.
4. **Follow-ups**: confirmation card (option G), CLI
   `clisbot schedule ls --conversation`.

Docs to update when built: `docs/glossary.md` (Schedule, Heartbeat, grant
scope), `docs/permissions.md` (the `automation.manage` row still says "loops"),
`docs/features/access/terminal-and-project-creation.md` (says
`injectIntoAgents` defaults to true), `docs/features/slash-commands/README.md`,
`docs/features/channels/conversation-flow.md` (inbound source `schedule`),
`public-docs/schedules*.md`.

## Open questions

- **Q1. Which switch is the fusion gate.** No single fusion master switch
  exists; each area has its own (`daemon.bots`, `daemon.managedAccess.mode`,
  `features.agentSessionStorage`). Ride Managed Access (not `off`), or
  introduce one master switch and move the others under it.
- **Q2. Hub offline at run time.** Fail the run without replay (proposed,
  matching the channel plane's no-auto-replay rule), or run it once the Hub
  reconnects.
- **Q3. Tools without `injectIntoAgents`.** Give Bot and channel sessions their
  schedule tools whenever the fusion gate is on (proposed), or require the
  global switch.
- **Q4. Group Chat target.** Require a Bot per schedule (proposed for v1), or
  allow "the room" and let turn rules pick.
- **Q5. Limits in the app.** Keep upstream behavior (proposed), or apply the
  channel defaults to Chats too.
- **Q6. Names.** The Rule leaf (`allowSchedules`) and the limit keys
  (`limits.schedules.max`, `minIntervalSeconds`, `maxRuns`) are provisional
  until a naming review.
