# Route audience rules: one place decides who talks to the bot (2026-09-19)

Decision record. Status: decided and built 2026-09-19 (hub: `channels/config/audience.ts`, `policy/gate.ts`, `access-migration.ts`, `management-api/channel-admin.ts`; app: `settings/channel-route-audience*.ts(x)`). Supersedes the chat-authority
sources in [2026-09-18](2026-09-18-channel-chat-authority-and-limits.md#chat-authority-is-separate-from-hostproject-access)
(`channel.use` **or** the Route's audience/`access:` admission). The rest of
that record (execution vouched by the publisher, warnings, limits) stands.

## Context

"May this sender talk to this Route" is answered in four places today, and any
one admits (`mayUseChannelRoute`, `packages/hub/src/channels/policy/gate.ts`):

1. The Route's `audience` (`members` | `conversationParticipants`).
2. Channel-policy roles granting `bot.interact` (`policy.defaultRoles`, `assignments`).
3. The Route's `access:` block (`dmPolicy`, `groupPolicy`, `allowFrom`, pairing).
4. A Hub Access grant `channel.use` on the Channel Route, with its own conversation scope.

The Route already chooses conversations through `match`. Granting access then
asks again for people and again for conversations, on another page. A
configurator thinks "this Route answers Team QC in #qc-bugs" and cannot tell
which of the two places is real.

## Decision

A Route has two parts:

1. **Audience rules** — who may talk, where. A list; add rows the way Agent
   configuration rows are added today.
2. **What the bot does** — Agent, Model, behaviour. Unchanged.

Each audience rule is **Who + Where** and reads as one sentence: "[who] may talk
in [where]". A sender is admitted when any rule matches (union).

**Who** — multi-select, mixed:

| Kind     | Values                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Role     | Owner, Admins, Members (every linked Member). Resolved per message, so later role changes apply           |
| Team     | One or more Teams                                                                                         |
| Person   | One or more Members                                                                                       |
| Anyone   | Every sender, unlinked ones included (the Guest subject). Keeps the open-Route warning and default limits |
| Advanced | Senders outside the Hub, picked from people who already messaged the bot. Replaces `allowFrom`            |

**Where** — the parts add up:

| Part       | Meaning                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DM         | Every 1:1 conversation with the bot                                                                                                                                      |
| Group chat | Every conversation with two or more people: channel, group, space, group DM. Optional filter: all / public only / private only, shown only where the platform reports it |
| Specific   | Named conversations from one search box. The configurator does not need to know whether a room is public, private, a group, or a topic                                   |

DM is a Where like any other: a rule that covers channels does not cover DMs unless its Where includes DM, so talking in a channel never implies DM access. "Only these people may DM the bot" is its own rule: Who = those people, Where = DM. Threads and topics belong
to their room; pick one under Specific only to narrow to it.

Who uses Hub Members and Teams, and each person links their Slack, Telegram, Zalo, and other accounts through Channel identities, so one Who works on every channel. Where uses the generic names below; a channel that lacks a kind hides it, and the layout reads the same everywhere.

| Generic        | Slack                       | Telegram                                    | Zalo (personal) | Zalo OA   | Discord                      | Google Chat       | Feishu        |
| -------------- | --------------------------- | ------------------------------------------- | --------------- | --------- | ---------------------------- | ----------------- | ------------- |
| DM             | DM                          | Private chat                                | 1:1 chat        | 1:1 chat  | DM                           | DM                | P2P chat      |
| Group chat     | Channel, group DM           | Group, supergroup                           | Group           | To verify | Server channel, group DM     | Space, group chat | Group         |
| Public/private | Yes                         | Probably (a group with @username is public) | No              | —         | No (roles decide)            | To verify         | Probably      |
| Specific shows | `#qc-bugs`, `🔒#qc-private` | `QC Group`, `QC Group › Release` (topic)    | Group name      | —         | `Server › #channel`          | Space name        | Group name    |
| Thread/topic   | Thread → channel            | Forum topic → group                         | —               | —         | Thread, forum post → channel | Thread → space    | Topic → group |

Cells marked "to verify" or "probably" are checked per vertical when built. Where a kind is absent the control is hidden.

One configuration, several channels:

```
Rule 1  Who: Owner, Admins     Where: DM + Group chat (all)
Rule 2  Who: Team QC           Where: Group chat (public only) + Specific [qc-private]
Rule 3  Who: aitran, nam       Where: DM
Rule 4  Who: Anyone (warned)   Where: Specific [qc-public-help]
```

|        | Slack                                    | Telegram                               | Zalo (personal)                                      |
| ------ | ---------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Rule 1 | DMs and every channel and group DM       | Private chats and every group          | 1:1 chats and every group                            |
| Rule 2 | Every public channel and `🔒#qc-private` | Groups with @username and `qc-private` | Only `qc-private`; Zalo cannot filter public/private |
| Rule 3 | aitran and nam may DM the bot            | aitran and nam may chat privately      | aitran and nam may chat 1:1                          |
| Rule 4 | Anyone in `#qc-public-help`              | Anyone in that group                   | Anyone in that group                                 |

### Routing

- Routes stay ordered. A Route applies when its Where covers the conversation
  (plus `contains`, which stays a Route-level text filter). If the sender matches
  no rule of that Route, **the next Route is tried**. This allows tiers: Owner and
  Admins on a strong Agent, Anyone in public rooms on a limited one.
- **A bound conversation does not fall through.** The Route the binding recorded
  owns it, and a sender must match that Route's rules. Otherwise two people in
  one thread would reach different Routes and sessions.

### Access page

The Channel Route's Access tab keeps only **Channel Route Admin** (see
[Delegated access](../features/access/scoped-admins.md)). `channel.use` with a
conversation scope is no longer created from the UI.

### Migration (automatic)

| Old                                  | Becomes a rule on every Route of that account      |
| ------------------------------------ | -------------------------------------------------- |
| `channel.use`, conversation `all`    | Who = the grant's subject, Where = DM + Group chat |
| … `direct_messages`                  | Where = DM                                         |
| … `public_channels`                  | Where = Group chat, public only                    |
| … `specific`                         | Where = Specific, same ids                         |
| `audience: conversationParticipants` | Who = Anyone, Where = the Route's old `match`      |
| `audience: members`                  | Who = Members, Where = the Route's old `match`     |
| `match.kind` + `ids`                 | The Where of the Route's rules                     |

Channel-policy roles (`bot.interact`) and `access:`/pairing stay under an
**Advanced** section and are not migrated yet. The read path for old grants
carries a `COMPAT(route-audience-rules)` tag until the migration has run
everywhere.

## Options considered

| Option                                                                  | Outcome                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Keep grants, make the grant form smarter (defaults, bulk, named scopes) | Rejected: treats the symptom; two places still decide the same thing |
| Route audience with one Who for the whole Route                         | Rejected: cannot say "Owner anywhere, Anyone only in public rooms"   |
| Where as exclusive choice (types **or** specific)                       | Rejected: cannot say "all public rooms plus #qc-private"             |
| Where split by public/private for specific rooms                        | Rejected: the configurator would have to know each room's visibility |
| "DM with" as a Where part                                               | Rejected: in a DM the sender is the other person, so it is a Who     |
| Route chosen by conversation only; rules only refuse                    | Rejected: no tiers by audience                                       |

## Storage sketch

```
audience:
  - who:   { roles: [owner, admin, member], teams: [], members: [], anyone: false, identities: [] }
    where: { dm: true, groups: off | all | public | private, conversations: [] }
```

This extends `RouteAudienceSchema` (`packages/hub/src/channels/config/schema.ts`)
and replaces `match.kind`/`ids` as the conversation selector. The account file
format changes, so the compiler reads the old shape through the migration.
