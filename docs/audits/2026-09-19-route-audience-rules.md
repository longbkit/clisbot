# Route audience rules: one place decides who talks to the bot (2026-09-19)

Decision record. Status: decided and built 2026-09-19 (hub: `channels/config/audience.ts`, `policy/gate.ts`, `bindings/stored-route.ts`, `management-api/channel-admin.ts`, the one-time `channels/one-time/`; app: `settings/channel-route-audience*.ts(x)`). Supersedes the chat-authority
sources in [2026-09-18](2026-09-18-channel-chat-authority-and-limits.md#chat-authority-is-separate-from-hostproject-access)
(`channel.use` **or** the Route's audience/`access:` admission). The rest of
that record (execution vouched by the publisher, warnings, limits) stands.
The UI name **Channel Route** used below is now **Connection**
([2026-09-19 naming decision](2026-09-19-connection-naming-and-route-flow.md)).

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

| Kind     | Values                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role     | Owner, Admins, Members (every linked Member). Resolved per message, so later role changes apply                                                                                |
| Team     | One or more Teams                                                                                                                                                              |
| Person   | One or more Members                                                                                                                                                            |
| Anyone   | Every sender, unlinked ones included (the Guest subject). Keeps the open-Route warning and default limits                                                                      |
| Advanced | Senders outside the Hub, picked from people who already messaged the bot. Does the job of `allowFrom` for new rules; existing `access:` blocks stay as they are (not migrated) |

Advanced is built as a picker over `channel-accounts/<channel>/<account>/senders`
(`channels/observed-senders.ts`): distinct senders in the account's ingress
queue, newest first, minus those linked to a Member in the bot's identity realm.
The queue keeps every inbound message, admitted or refused, until retention
(30 days); someone who has not messaged the bot yet is typed as an id. The
Specific search reads the same queue beside bindings and Workflow receipts, so
it lists every conversation a bot has seen on every channel.

**Where** — the parts add up:

| Part       | Meaning                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DM         | Every 1:1 conversation with the bot                                                                                                                                      |
| Group chat | Every conversation with two or more people: channel, group, space, group DM. Optional filter: all / public only / private only, shown only where the platform reports it |
| Specific   | Named conversations from one search box. The configurator does not need to know whether a room is public, private, a group, or a topic                                   |

DM is a Where like any other: a rule that covers channels does not cover DMs unless its Where includes DM, so talking in a channel never implies DM access. "Only these people may DM the bot" is its own rule: Who = those people, Where = DM. Threads and topics belong
to their room; pick one under Specific only to narrow to it.

Who uses Hub Members and Teams, and each person links their Slack, Telegram, Zalo, and other accounts through Channel identities, so one Who works on every channel. Where uses the generic names below; a channel that lacks a kind hides it, and the layout reads the same everywhere.

| Generic        | Slack                       | Telegram                                 | Zalo (personal) | Zalo OA                   | Discord                      | Google Chat       | Feishu        |
| -------------- | --------------------------- | ---------------------------------------- | --------------- | ------------------------- | ---------------------------- | ----------------- | ------------- |
| DM             | DM                          | Private chat                             | 1:1 chat        | 1:1 chat                  | DM                           | DM                | P2P chat      |
| Group chat     | Channel, group DM           | Group, supergroup                        | Group           | Group (`chat_type GROUP`) | Server channel, group DM     | Space, group chat | Group         |
| Public/private | Yes                         | Yes (a group with @username is public)   | No              | No                        | No (roles decide)            | No                | No            |
| Specific shows | `#qc-bugs`, `🔒#qc-private` | `QC Group`, `QC Group › Release` (topic) | Group name      | Group name                | `Server › #channel`          | Space name        | Group name    |
| Thread/topic   | Thread → channel            | Forum topic → group                      | —               | —                         | Thread, forum post → channel | Thread → space    | Topic → group |

Public/private was verified per vertical on 2026-09-19 against what the inbound
event carries; nothing is fetched to learn it. Slack states it in
`channel_type`; Telegram's chat object carries `username` only for a public
group. Zalo personal and Zalo OA events say only group or not. Discord guild
channel events carry no visibility (roles and overwrites decide who sees a
channel). A Google Chat event's space carries `spaceType`, not its access
setting. A Feishu message event's `chat_type` is `p2p` or `group`; visibility
is only in `im.chat.get`. A channel that reports it claims the `visibility`
capability in the Hub catalog (`channels/catalog.ts`); the editor offers the
filter there and warns on a rule that uses it anywhere else, because such a
rule matches no group chat. Where a kind is absent the control is hidden.

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
  one thread would reach different Routes and sessions. When that Route's Who
  refuses the sender, the bot replies in the thread instead of staying silent:
  the conversation belongs to Route <name>, and a new message outside the
  thread starts the sender's own conversation. That new message goes through
  ordinary selection, so it may land on a later Route with its own session.
  Keying sessions by (thread, Route) was rejected as too invasive.
- **No catch-all.** A sender no Route admits is refused. To answer "everyone
  else", add a last Route whose rule covers them. The account `fallback`
  (the "Everyone else (catch-all)" screen) is removed: once Where lives in the
  rules and senders fall through, a catch-all is a Route with no Where of its
  own appended last, so it added a second concept and a second binding state
  (`"fallback"`) without adding behavior.

### Access page

The Channel Route's Access tab keeps only **Channel Route Admin** (see
[Delegated access](../features/access/scoped-admins.md)). `channel.use` with a
conversation scope is no longer created from the UI.

### Migration (one-time, then deleted)

| Old                                  | Becomes a rule on every Route of that account      |
| ------------------------------------ | -------------------------------------------------- |
| `channel.use`, conversation `all`    | Who = the grant's subject, Where = DM + Group chat |
| … `direct_messages`                  | Where = DM                                         |
| … `public_channels`                  | Where = Group chat, public only                    |
| … `specific`                         | Where = Specific, same ids                         |
| `audience: conversationParticipants` | Who = Anyone, Where = the Route's old `match`      |
| `audience: members`                  | Who = Members, Where = the Route's old `match`     |
| `match.kind` + `ids`                 | The Where of the Route's rules                     |
| `fallback` without `deny`            | A last Route with the same rules, target, behavior |
| `fallback: { deny: true }`           | Removed (refusing is the default)                  |
| A binding that recorded `"fallback"` | Points at that last Route                          |

A folded grant only widens Who. Its rule's Where is the **intersection** of the
grant's scope and that Route's old `match`, and a Route where the intersection
is empty gets no rule. A Route's Where is the union of its rules' Where, so
adding the grant's own scope would let an "all conversations" grant make Route 1
cover everywhere and take conversations that belong to later Routes. Example:
Routes `#eng` and `#support` plus one "all" grant give Route 1 {grantee, `#eng`}
and Route 2 {grantee, `#support`}.

Channel-policy roles (`bot.interact`) and `access:`/pairing stay under an
**Advanced** section and are not migrated yet.

The old shapes leave the stored data entirely, history included, so nobody
reading the database later meets a format the code no longer knows. A one-time
script, per Hub and in one transaction after dumping both tables:

- rewrites the **active** `channel_configuration_revisions` row of each
  organization in place into the new shape (`content_hash` recomputed);
- **deletes every other revision** of that organization. The only foreign key
  into the table is `organization_channel_configurations.active_revision_id`,
  so nothing else points at them;
- rewrites every thread binding's stored route selection to the active
  revision id and the new Route position.

Dropping history is a decision for this migration only. Revisions stay
append-only everywhere else. The Hub and app code then know
only the new shape: no `fallback`, no `match`/one-value `audience` reader, no
`COMPAT(route-audience-rules)` tag. This is acceptable because both Hubs that
hold data (dev and ai-cowork) are ours; an old app still sending `fallback`
gets a validation error and a reload fixes it. The script is deleted once it
has run on both.

## Options considered

| Option                                                                  | Outcome                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Keep grants, make the grant form smarter (defaults, bulk, named scopes) | Rejected: treats the symptom; two places still decide the same thing |
| Route audience with one Who for the whole Route                         | Rejected: cannot say "Owner anywhere, Anyone only in public rooms"   |
| Where as exclusive choice (types **or** specific)                       | Rejected: cannot say "all public rooms plus #qc-private"             |
| Where split by public/private for specific rooms                        | Rejected: the configurator would have to know each room's visibility |
| "DM with" as a Where part                                               | Rejected: in a DM the sender is the other person, so it is a Who     |
| Route chosen by conversation only; rules only refuse                    | Rejected: no tiers by audience                                       |
| Keep the catch-all, relabel it "Last Route"                             | Rejected: still a second concept with no behavior of its own         |
| Read old shapes at compile time behind a COMPAT tag                     | Rejected: old revisions keep the old shape forever                   |
| Rewrite every revision in place, keep history                           | Rejected: old revisions would claim content nobody saved             |

## Storage sketch

```
audience:
  - who:   { roles: [owner, admin, member], teams: [], members: [], anyone: false, identities: [] }
    where: { dm: true, groups: off | all | public | private, conversations: [] }
```

This extends `RouteAudienceSchema` (`packages/hub/src/channels/config/schema.ts`)
and replaces `match.kind`/`ids` as the conversation selector.
