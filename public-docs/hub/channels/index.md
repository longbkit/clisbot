---
title: Hub channels
description: The seven chat platforms a Hub can run an agent in, what each one can do, and which capabilities have live evidence.
nav: Channels
order: 81
category: Hub
---

# Channels

A channel puts an agent in a chat platform. Someone mentions the bot in Slack, DMs it on Telegram, or messages it in a Feishu group; Hub routes that conversation to an agent on one of your daemons and posts the answer back into the same conversation.

```text
Slack / Telegram / Discord / Google Chat / Feishu / Zalo
        │
        ▼
      Hub  ──►  daemon  ──►  agent session
        ▲                        │
        └──────── reply ─────────┘
```

Three resources make that work, and they are separate on purpose:

- A **Connection** owns the credential — one Slack workspace installation, one bot token, one linked Zalo account. Hub encrypts it and never shows it again.
- A **Channel account** is the behaviour attached to that Connection: transport settings, ordered Routes, access, reply synchronization.
- A **Route** picks what a matching conversation runs — a direct agent, or an Automation. The first Route whose audience rules admit the sender wins; a sender no Route admits is refused.

[How Hub works](/docs/hub/concepts) covers the resource model. This section covers the platforms.

## The seven channels

| Channel                                      | Credential                                 | Inbound transport                  | Needs a public HTTPS URL |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------- | ------------------------ |
| [Slack](/docs/hub/channels/slack)            | Bot token + app token                      | Socket Mode, or Events API webhook | Webhook only             |
| [Telegram](/docs/hub/channels/telegram)      | Bot token                                  | Bot API polling, or webhook        | Webhook only             |
| [Discord](/docs/hub/channels/discord)        | Bot token                                  | Gateway                            | No                       |
| [Google Chat](/docs/hub/channels/googlechat) | Service-account JSON                       | HTTP webhook                       | **Yes, always**          |
| [Feishu / Lark](/docs/hub/channels/feishu)   | App ID + app secret (+ webhook secrets)    | Long connection, or webhook        | Webhook only             |
| [Zalo Official Bot](/docs/hub/channels/zalo) | Bot token                                  | Bot API polling, or webhook        | Webhook only             |
| [Zalo Personal](/docs/hub/channels/zalouser) | A QR-linked session for a personal account | Push socket                        | No                       |

Zalo Personal is the odd one: there is no token to paste. You link it by scanning a QR code with a phone, and the session expires and has to be relinked. Everything that account can do, a human on that account can do. Read its page before you use it.

## Capability matrix

What each vertical implements. A blank cell means the platform or the vertical has no such thing; footnoted cells work with a restriction.

| Capability            | Slack | Telegram | Discord | Google Chat | Feishu | Zalo Bot | Zalo Personal |
| --------------------- | ----- | -------- | ------- | ----------- | ------ | -------- | ------------- |
| Text messages         | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Threads               | ✅    | ✅       | ✅      | ✅          | ✅     |          |               |
| Mentions              | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Rich formatting       | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Long-message chunking | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Media                 | ✅    | ✅       | ✅      |             |        | ¹        | ✅            |
| File attachments      | ✅    | ✅       | ✅      |             |        |          | ✅            |
| Reactions             | ✅    | ✅       | ²       |             | ✅     |          | ✅            |
| Edit messages         | ✅    | ✅       | ✅      | ✅          | ✅     |          |               |
| Delete messages       | ✅    | ✅       | ✅      | ✅          |        |          |               |
| Voice messages        | ✅    | ✅       |         |             |        |          | ✅            |
| Video                 | ✅    | ✅       |         |             |        |          |               |
| Video notes           |       | ✅       |         |             |        |          |               |
| Location              |       | ✅       |         |             |        |          |               |
| Polls                 | ✅    | ✅       | ✅      |             |        |          |               |
| Forum topics          |       | ✅       |         |             |        |          |               |
| Tables and charts     | ✅    | ✅       | ✅      |             |        |          |               |
| Buttons               | ✅    | ✅       | ✅      | ³           | ⁴      |          |               |
| Select menus          | ✅    | ✅       | ✅      | ³           | ⁴      |          |               |
| Approval prompts      | ✅    | ✅       |         |             |        |          |               |
| Native commands       | ✅    | ✅       | ⁵       |             |        |          |               |
| Group DMs             | ✅    |          |         |             | ✅     |          |               |
| Emoji discovery       | ✅    | ✅       | ✅      |             |        |          |               |

¹ Inbound images only; the Zalo Bot API has no upload endpoint.
² Outbound reactions only; inbound reaction events are not wired yet.
³ Card clicks arrive inbound; Hub renders no card of its own.
⁴ Card clicks arrive inbound; Hub renders no Lark card of its own.
⁵ Slash commands and interaction callbacks are not wired yet.

The same matrix appears per account under **Channels → Channel Integrations** in the Paseo app, where a claimed capability shows as **Not verified** until the account has actually exercised it. The catalog is a claim; a green check in the app means evidence.

## Commands in a conversation

The same verbs work on every channel, with or without a leading `/`, and with or without a mention in front. An addressed `@bot /new` and a Telegram-style `/new@yourbot` both normalize to the same command.

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `/new`, `/reset`       | Start a fresh agent session for this conversation.                                   |
| `/stop`, `/cancel`     | Stop what the agent is doing.                                                        |
| `/status`, `/state`    | Report what the conversation is bound to.                                            |
| `/help`                | List the commands.                                                                   |
| `/agent <name>`        | Switch this conversation to another agent.                                           |
| `/model <name>`        | Switch this conversation to another model.                                           |
| `/approve`, `/deny`    | Answer a pending permission request.                                                 |
| `/routedefault`        | Show the route serving this conversation and its default.                            |
| `/promoteroutedefault` | Make this conversation's setup that route's default; `undo` reverts its last change. |

Approve and deny also arrive as button presses where the platform has buttons.

### Permission requests

Each route decides what happens when the agent's provider asks before running a
tool. In the app this is **Permissions** on the route: **Ask authorized
members**, **Deny**, or **Accept automatically**. Accept automatically answers
every request with Allow, for providers whose own modes still stop for approval
(OpenCode's `build` mode, Claude's auto mode review). The Hub saves it with a
warning.

A question from the agent (Claude's AskUserQuestion) is not a permission: the
permission choice never decides it, and anyone the route lets talk in the
conversation may answer it. The route's `questions:` setting, under
**Permissions** in the app, decides how it is answered:

| `questions:`    | In the app                  | What happens                                                               |
| --------------- | --------------------------- | -------------------------------------------------------------------------- |
| `ask` (default) | Ask in the conversation     | The question is posted; anyone the route admits answers it.                |
| `recommended`   | Pick the recommended answer | Each question gets the option labelled recommended, else the first option. |
| `agent-decides` | Let the Agent decide        | The agent is told nobody can answer and picks the option it recommends.    |

```yaml
routes:
  - audience: [...]
    agent: worker
    approval: [{ match: "*", mode: auto-allow }]
    questions: recommended
```

`questions:` is also a `defaults:` leaf, inherited organization → account →
route.

`/agent` and `/model` only offer what the route lists:

```yaml
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker
    environment: repo
    agents: [reviewer] # plus `worker`, the route's own — always offered
    models: [gpt-5.6-luna, claude-sonnet-4.6]
```

A route that lists neither refuses both commands. A bare `/model` prints the
menu. Switching ends the running session, because an agent's model is fixed when
it starts; the next message opens a session on the new choice, and the choice
outlives `/new`.

## Route defaults

A route starts new sessions with its `agent:` from `hub.yml`. `agentControls:`
overrides that for one route without editing an agent other routes or
automations share:

```yaml
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    contains: deploy
    agent: worker
    environment: repo
    agentControls: { provider: claude, model: claude-opus-5, thinkingOptionId: high }
```

Naming a `provider` makes the block the whole setup: the agent's model, mode,
thinking option and feature values are replaced, anything you leave out is
unset, and the agent's `options` stay only when the provider is the same.
Without a `provider`, the block overrides only the fields you set.

`/promoteroutedefault` writes this leaf from a conversation: it publishes a new
Channel revision that makes the conversation's current setup the default of the
route that served it. It needs `channel.manage` — an organization owner or admin,
or **Manage** on that Connection in Access — and the new default must be
something the sender could start themselves. Only the route being changed is
checked against the sender's access; the organization's other routes are not. Running sessions keep their setup; the next
session on the route uses the new default, and no account restarts.

## What the agent receives

Every message reaches the agent with its sender, on every route:

```
Minh Dương (slack:U018WR2K090, @minh.duong): Create a CS card for QR tickets
```

Messages in the same conversation that did not wake the agent (no mention, or
the follow-up window had closed) are kept and sent before the next message that
does, marked as quoted context rather than instructions. Each is sent once. A
message the Hub could not deliver (its session failed to start) is kept the same
way, and the sender is asked to write again. `/new` and `/fork` start without
the earlier context.

```yaml
defaults:
  interaction:
    whenBusy: steer # steer | queue: add to the running turn, or wait for it to end
  context:
    unmentioned: everyone # everyone | allowed-senders | none
    maxMessages: 20 # 0–200
  batching: off # or { pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 20 }
```

`batching` holds a message until no new one has arrived for `pauseSeconds`, the
first has waited `maxWaitSeconds`, or `maxMessages` are waiting, then sends them
as one prompt. `maxWaitSeconds` must be greater than `pauseSeconds`. Write
`batching: off` on a route to turn off what its account turned on. Every leaf is
inherited organization → account → route.

## Where a conversation's work lands

Each conversation gets its own workspace on the daemon, named from the first
message it sends — `Fix the flaky login test`, not `repo`, `repo`, `repo`.
Commands that continue that work (`/fork`, `/side`) open their session in the
same workspace; commands that start something else (`/new`, `/quick`) open a new
one. Renaming a workspace yourself is safe: automatic naming never overwrites a
name you set.

Turn it off per organization, account, or route and the daemon places and names
sessions as it did before:

```yaml
defaults:
  workspace: { organize: false }
```

## Editing a route while conversations are running

A deployed change applies to live conversations, it does not strand them.
Changing how a route talks — synchronization, templates, mention rules, approval
rules, who may talk to it — keeps every bound conversation on its session, and
the new rules apply from the next message. Two edits do end a session, because
they change where the conversation goes:

- pointing the route at another `agent:` or at a workflow retires the session
  and starts one at the new target;
- narrowing or removing the route so it no longer matches the conversation
  leaves it unserved, and the bot stops answering there.

## Who may talk, where

Each route carries **audience rules**. A rule is one sentence, "[who] may talk
in [where]", and a sender is admitted when any rule of the route matches.
Rules are the only place that decides who may chat; the People & access › Access tab grants
only **Connection Admin**.

- **Who**: Owner, Admins, Members (every linked Member), Teams, named Members,
  Anyone (unlinked senders included), or senders outside the Hub, picked from
  the people who already messaged the bot (or typed as channel user ids).
- **Where**: two switches, both off on a new route. **Direct messages** is
  either all of them or only named senders (`dmTeams`, `dmMembers`, and
  `dmIdentities` for Guests: of the Who, only these may DM). **Group chats** is exactly one of all group chats, public only,
  private only (Slack and Telegram), or specific conversations picked from one
  search box that lists every conversation the bot has seen. A rule that covers
  group chats does not cover DMs unless its Direct messages switch is on.

Public or private is what the platform says on the message: a Slack channel's
type, and on Telegram a group with a public @username is public, any other
group private. Other channels do not say, so a public-only or private-only rule
matches no group chat there; the editor warns when a rule asks for it.

```yaml
routes:
  - audience:
      - who: { roles: [owner, admin] }
        where: { dm: true, groups: all }
      - who: { teams: [team-qc] }
        where: { groups: public }
      - who: { teams: [team-qc] }
        where: { dmMembers: [membership-id-of-the-lead], conversations: [C0QCPRIVATE] }
      - who: { anyone: true }
        where: { conversations: [C0HELP] }
    contains: deploy # optional text filter, route-level
    agent: worker
    environment: repo
```

Routes stay ordered. A route applies when a rule's Where covers the
conversation (and `contains`, if set, matches); if the sender matches none of
that route's rules, the next route is tried. A bound conversation does not fall
through: the route that started the session owns it, and a sender that route
refuses is told in the thread to start their own conversation with a new
message outside it. There is no catch-all: a
sender no route admits is refused. To answer everyone else, add a last route
whose rule covers them.

Talking to a bot and reaching a Host or Project stay separate. A chatting
sender can start sessions with the route's configuration and use `/status`,
`/stop`, `/new`, `/fork`, `/side`, `/quick`, `/steer`, `/queue`, `/skill` and
`/command`; chat gives no access to the Host, the Project, or the Paseo app.
`/agent`, `/model`, `/provider`, `/effort`, `/permission`, `/cowork` and
`/resume` need the sender's own Access grants on the route's Project, and
answering an approval needs an `approval.*` privilege.

The person who publishes a route vouches for what it runs: saving checks that
they may hand out its Host, Project, Agent configuration and automatic
approvals. A Connection Admin edits the routes of one account through the
app and keeps its Connection as it is. Only a route whose target, approvals,
reply path or Agent controls changed is checked against their access, so a
Connection Admin can change who may talk to a route they could not publish.
The bot token and every credential in the account's settings are never shown
to a Connection Admin and survive their saves unchanged.

Commands never need a mention. `requireMention` decides when a plain message
wakes the agent.

### Routes open to Anyone

A rule with `anyone: true` works like any other. The Hub saves it and lists a
warning on the route for each wide choice: no named conversations, no mention
needed, a follow-up window that lets anyone talk without a mention, output
beyond the final answer, permission requests accepted automatically, Fast mode, or a
mode that runs tools without asking. The app lists them before you confirm a
save. New routes start from the safe side: a mention in groups, final answers
only, tool requests denied.

A route takes its audience only as a list of rules. A file that still carries a
route `match:`, a one-value `audience: { kind: … }` or an account `fallback:`
fails validation.

## Limits

Limits are available on every route and on the account, with the same fields
everywhere:

| Field                        | Counts                                    |
| ---------------------------- | ----------------------------------------- |
| `maxInputCharacters`         | characters in one incoming message        |
| `messagesPerMinutePerSender` | messages received from one sender         |
| `messagesPerMinute`          | messages received                         |
| `messagesSentPerMinute`      | new messages the bot posts                |
| `maxConcurrentRuns`          | agent turns running at the same time      |
| `maxRuntimeSeconds`          | how long one turn may run before it stops |

```yaml
limits: # the whole bot
  maxConcurrentRuns: 20
  messagesSentPerMinute: 120
  perConversation: # each channel, group or DM; threads count toward their channel
    messagesPerMinute: 30
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0SUPPORT] } }]
    limits: { maxConcurrentRuns: 5, maxRuntimeSeconds: off }
```

A message must fit the bot, its conversation and its route. Each field is a
positive number, `off`, or left out. Left out means no limit, except on an
open-audience route, which defaults to 8000 characters, 10 messages per sender
and 60 per minute, 8 concurrent runs and 900 seconds. There is no ceiling: set
any number or turn a default off.

Over a limit, an incoming message waits in the ingress queue and runs when there
is room, and the bot says once that it is queued. A message longer than
`maxInputCharacters` is refused with a short reply. `/fork`, `/side`, `/quick`,
`/steer` and `/queue` count like messages. Outgoing messages over
`messagesSentPerMinute` are delayed and keep their order within a conversation.
Typing, reactions, edits and streaming drafts are not counted. Delayed outgoing
messages are held in memory: saving a change to the account, or restarting the
Hub, drops the ones still waiting.

## Allowlists, pairing, and who may talk to the bot

`access:` is the sender gate. It uses OpenClaw's names and semantics, so an
account file written for OpenClaw works unchanged, and it is authorable at any
layer — organization policy, account, or a single route:

```yaml
defaults:
  access:
    dmPolicy: pairing # open | pairing | allowlist | disabled
    groupPolicy: allowlist # open | allowlist | disabled
    allowFrom: ["U0ALICE"] # `*` admits anyone
    groupAllowFrom: ["U0ALICE", "U0BOB"] # falls back to allowFrom when absent
    deniedReply: "Ask an operator for access." # omit to refuse silently
```

Omit the whole `access:` block and nothing is gated by it — the Hub's own roles
decide, exactly as they did before the block existed. Add one leaf and the gate
runs in front of them: both have to allow.

A refused sender never reaches an agent. The refusal is recorded in channel
activity with its reason (`dm_policy_not_allowlisted`, `group_policy_disabled`,
…) and answered only if you set `deniedReply`.

### Pairing

With `dmPolicy: pairing`, an unknown sender's first DM gets a six-character code
instead of an agent, and you decide:

```sh
curl -H "authorization: Bearer $KEY" \
  "$HUB/api/management/organizations/$ORG/channel-accounts/telegram/support/pairing"

curl -X POST -H "authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"senderIdentity":"telegram:77001"}' \
  "$HUB/api/management/organizations/$ORG/channel-accounts/telegram/support/pairing/approve"
```

`.../pairing/deny` is the other half. Approving adds the sender to that
account's allowlist; denying is final — a denied sender is never handed a new
code. The code is a handle so you can tell two strangers apart, not a secret:
knowing it grants nothing.

The requests belong to one organization and one account. Approving someone on
one account does not admit them on another, and never on another organization's.

## How the agent replies

A Route's **Reply method** decides what reaches the conversation:

| Reply method      | What the user sees                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hybrid            | The agent's answer as text, plus the files, reactions and edits it sends with its `message` tool. The default for a new Route open to members. |
| Text forward      | The agent's answer as text. The agent cannot send files or act on messages.                                                                    |
| Channel tool only | Only what the agent sends with its `message` tool, including short progress updates on long work.                                              |

The Paseo app shows the same answer the conversation got on the first two. On
**Channel tool only**, the agent's own messages stay in the app and the
conversation sees the tool's posts; if the agent finishes without sending a
reply, its last message is sent instead. A turn started in the Paseo app is not
sent to the conversation on this method. Progress updates are limited to one
every 30 seconds.

If a turn fails, the conversation gets one notice with the error. A turn you
stop on purpose (`/stop`, or a message that interrupts it) posts nothing.

## Files the agent sends

One tool sends both. The agent's `message` tool takes attachments alongside the
text — one file or many, any type, in the order it names them. Each file becomes
its own post in the same conversation, so a reply that says "here is the report"
and attaches it arrives as two messages, not one.

A file has to live under the Project the session is bound to. A path outside it
is refused and the agent is told why; the same goes for a file over the
channel's upload cap (Telegram 50 MB, Slack 250 MB, Discord 10 MB), which posts
a visible notice in place of the file rather than dropping it silently.

Channels with no upload endpoint — Google Chat, Feishu, Zalo Bot — refuse the
attachment by name. See each channel's page.

## Manage accounts from the CLI

Four verbs, all against a running Hub:

```sh
paseo channels add <channel> --account <id> [--connection-id <uuid> | --secret-file <path>]
paseo channels ls
paseo channels status
paseo channels rm <channel> --account <id> --yes
```

`add` never takes a credential on the command line — a secret in argv lands in `ps` output and shell history. Pass a file and delete it afterwards. Each channel's page shows the file shape it expects.

`status` adds the pin, integrity, and load-trace columns to what `ls` shows, and is the first thing to run when an account is not behaving.

`rm` drops the account from the channel configuration and stops its transport. It refuses without `--yes`. The Connection holding the credential stays — another account can be using it — and `rm` prints its id so you can retire it from the app.

`ls` also answers to `list`, the name it shipped under.

All four accept `--hub <origin>` to target a Hub other than the local one (with `--api-key`), `--home <path>` to pick a different Clisbot home, and `--json`.

## Verified live

A capability is only "verified live" when a message from a real account on the real platform reached an agent and the agent's answer came back to the same conversation, read back through the platform's own API.

| Channel           | Live evidence                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Slack             | Yes — mention → reply in thread, long chunked replies, outbound files (2026-09-07).                            |
| Telegram          | Yes — mention → reply, forum topics, files in and out, edit and poll actions, `/new` and `/stop` (2026-09-07). |
| Discord           | No. Tested against a simulated platform only; needs a bot token and a test guild.                              |
| Google Chat       | No. Blocked on a public HTTPS endpoint and Workspace admin approval.                                           |
| Feishu / Lark     | No. Tested against a faked Lark SDK client only; needs Lark app credentials.                                   |
| Zalo Official Bot | No. Polling E2E is runnable with a bot token and a human sender; not yet run.                                  |
| Zalo Personal     | No. Needs a human to scan a QR code.                                                                           |

Each channel page carries its own per-capability line. The running record of what passed and what failed, with message ids, is `docs/tests/channels/p0-live-scenarios.md` in the repository.

## Before you connect one

A channel is an untrusted input. Anyone who can post in a conversation your Route matches can send text to an agent that has a working directory, a shell, and network access. Read [Hub security](/docs/hub/security) and set the account's access rules before you point a Route at a real project.
