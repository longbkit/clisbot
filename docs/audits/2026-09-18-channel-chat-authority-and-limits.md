# Channel chat authority, open-Route warnings, and limits (2026-09-18)

Decision record. Supersedes the per-sender execution checks described in
[2026-09-10-channel-vs-app-admission.md](2026-09-10-channel-vs-app-admission.md)
for Route-default sessions, and the open-audience hard rules and fixed limit
ceilings from the channel configuration work of 2026-09.

## Context

A Slack Route with `audience: conversationParticipants` ("Anyone in
conversation") on UAT answered nothing to unlinked senders. The logs showed
`This configuration is outside your AgentConfigurationGrant.` for every
message: the Route admitted the sender, but minting a session checked the
**sender's own** Access grants (`channel.use` → `daemon.connect` →
`project.use` + an AgentConfigurationGrant for the Route's model). The Guest
subject had none, so every first message died silently.

At the same time, a Member with only `channel.use` could talk in a thread
whose session the owner had opened, because a follow-up into a bound session
checks `channel.use` alone. The same person got two different answers
depending on who spoke first.

Separately, Route limits had one set of numbers serving as both the
open-audience default and the hard ceiling (2 concurrent runs, 60
messages/minute), counted per Route across every conversation it matches, and
only open-audience Routes showed them in the UI.

## Problems

1. Talking to a bot required Host/Project access. That is inconvenient
   (every chat user needs Project grants) and riskier (a grant meant for chat
   also opens the Host and Project in the Paseo app).
2. Session creation and follow-up disagreed about who needs what.
3. Open-audience Routes had hard compile errors (no auto-allow approvals,
   relay-only output, no unattended modes, no fast mode, mention required, named
   conversations required). A publisher who is entitled to delegate those
   things could not choose them.
4. Limits could only be lowered, had no off switch, no bot-wide or
   per-conversation scope, and nothing limited what the bot sends out.

## Options considered

- **A. Grant Guest/Members Project access** (status quo). Rejected: it ties
  chat to Host/Project access, the thing we want to keep apart.
- **B. Re-check sender grants on follow-up too.** Consistent, but makes
  problem 1 worse.
- **C. The Route vouches for execution; the sender only needs chat
  authority.** The publisher's authority is already checked at publish time
  (`assertChannelConfigurationDelegation`, `packages/hub/src/access/delegation.ts`):
  they must be able to delegate the Route's daemon, Project, Agent
  configuration and automatic approvals. Senders are checked only when they
  change or reach beyond that configuration.

## Decision

### Chat authority is separate from Host/Project access

Option C.

- **Chat authority** is `channel.use` on the channel account (or the Route's
  audience/`access:` admission). It lets a sender talk to the Route's Agent,
  start a session in the conversation, and use the commands that stay inside
  the Route's configuration: `/status`, `/stop`, `/new`, `/followup`
  (conversation scope), `/steer`, `/queue`, `/skill`, `/command`, `/fork`,
  `/side`, `/quick`, `/routedefault`. On a Workflow Route that includes
  `/stop` and `/status` for the conversation's own runs.
- **Execution authority** for the Route's own configuration comes from its
  publisher (checked at publish). A conversation selection (`/model`,
  `/provider`, `/agent`, `/effort`, `/permission`) is checked against the
  sender who makes it, when they make it; later sessions in that conversation
  use it without re-checking whoever speaks next.
- **Personal Access grants** (`agent.interact`, `agent.create`,
  AgentConfigurationGrant, `approval.*`, `agent.fast.use`) are needed only to
  change the configuration, to answer approval prompts, to `/resume` a session
  from elsewhere, and to `/cowork` into the Paseo app.

Revoking a publisher's or selector's grants later does not retroactively
rewrite what they published; editing or re-publishing the Route does.

### Configurators decide; the Hub warns

Whoever may publish a channel configuration may choose any Route shape their
delegation check allows, including auto-allowed approvals, unattended modes,
fast mode, tool-path output, progress sync, no mention requirement and no
named conversations on an open-audience Route. Each of those produces a
**warning** in the GET, validate and save responses instead of a compile error.
The app shows them in the save confirmation and, collapsed to a count, on the
Route card. A follow-up window (`followUp.mode: auto`) on an open Route warns
too, because anyone there can then talk without a mention. The delegation check
is unchanged: a publisher still cannot delegate what they do not hold.
Replacing a configuration cancels only open-audience runs, as it did before
Member Routes could carry limits.

### Limits

- One limit shape everywhere, with every leaf available at every scope:
  `maxInputCharacters`, `messagesPerMinutePerSender`, `messagesPerMinute`,
  `messagesSentPerMinute`, `maxConcurrentRuns`, `maxRuntimeSeconds`.
- Three scopes, each counted independently; a message must pass all three:
  - **Bot** — account `limits:`; every conversation of the bot together.
  - **Conversation** — account `limits.perConversation`; each channel, group
    or DM on its own. All threads of a channel count toward that channel.
  - **Route** — `routes[].limits`; everything the Route matches together.
- Each leaf is unset (use the default), a positive whole number, or `off`.
- Defaults: open-audience Routes keep the previous conservative numbers
  (8000 characters, 10/60 messages per minute, 2 concurrent runs, 900 s);
  everything else defaults to unlimited. There is no ceiling.
- Inbound over a limit waits in the durable ingress queue and runs when the
  window or a run slot frees, as before. Input over `maxInputCharacters` is
  refused. `/fork`, `/side`, `/quick`, `/steer` and `/queue` are counted like
  messages, since they start or steer a run without passing through the
  message path.
- The sender is told instead of left in silence: once per message that it is
  queued, that a message is too long, and once a day on a Member Route that
  they are not admitted. Permission refusals name what is needed in plain words
  and the privilege in brackets.
- Outbound over `messagesSentPerMinute` is **delayed, never dropped**, and stays
  in order within a conversation. Only new messages count; typing, reactions,
  in-place edits and streaming drafts are not paced. The Route scope applies to
  a conversation once the Route has served an inbound message there, because a
  post carries only the conversation id. Delayed sends live in memory, so an
  account restart (any configuration save that changes the account) or a Hub
  restart loses them; that is accepted rather than adding a durable outbound
  queue.
- The UI shows every leaf on every Route: Default (with its number) / Set / Off
  where a default exists, No limit / Set where it does not. The Bot and
  per-Conversation leaves are under the account's Manage → Limits.

## Rationale

- Chat is a conversation-level permission; Host/Project access is an
  operator-level permission. Mixing them forced operators to over-grant.
- The publish-time delegation check already makes the publisher accountable
  for the Route's execution, so re-checking every sender added friction without
  adding a boundary.
- Warnings keep the information the hard rules carried without overriding a
  decision the configurator is entitled to make.
- Defaults without a ceiling keep an unconfigured open Route safe while the
  operator stays in control.
