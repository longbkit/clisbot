# Routes and Rules: where a message goes, and how it gets in (2026-10-05)

Decision record. Status: decided 2026-10-05, built the same day (hub:
`channels/rule-trigger.ts`, `channels/config/rule-conditions.ts`, the rule
leaves in `channels/config/schema.ts`; app: the Route form's Rules section).
Amends [2026-09-19 Route audience rules](2026-09-19-route-audience-rules.md)
(the rule's shape and its editor) and
[2026-09-19 Connection naming](2026-09-19-connection-naming-and-route-flow.md)
(the Route form's sections).

## Context

A Route held two different things:

- **Where a message goes and what happens to it:** the Agent or Automation,
  the Host, permissions, the Reply method, limits.
- **When a message gets in:** its audience rules (who, where), plus a mention
  requirement, a follow-up window and a text filter (`contains`) that sat on
  the Route and applied to every rule.

So one Route could not say "DMs without a mention, #support with one". An
operator who wanted that needed two Routes with the same Agent, Reply method and
limits, kept in step by hand. The onboarding flow did exactly that: one Route
for DMs and a copy for group chats, only to vary `requireMention`.

The Route form showed the same confusion: a "Who can talk, and where" section
with Who above Where, then a separate "When it answers" section whose mention
switches applied to all of them.

A second problem: the docs and the app said a DM is answered without a mention,
but the gate applied the Route's `requireMention` (or the organization's
`true`) to DMs too. Slack and Telegram report a plain DM as not mentioned, so a
DM-only Route the app saved, with the mention switch hidden and `true` written,
ignored plain DMs.

## Decision: a Route is a destination, a Rule is a way in

- **Route**: where messages go. Its target (Agent or Automation), what runs
  (Host, Project, provider, permissions), how it replies, its limits and what
  happens to a message once it is in (`interaction.whenBusy`, context,
  batching). One Route per destination; several Routes only for different
  destinations.
- **Rule**: one way in. Where (direct messages, or which group chats), Who,
  and the trigger conditions: **Require a mention**, **Continue without a
  mention** (the follow-up window) and the message text filter. A message gets
  in when any Rule matches it. UI name: **Rules**, with the line "A message
  reaches this Route when it matches any rule."

Stored shape (the Hub schema, `channels/config/schema.ts`):

```yaml
routes:
  - agent: support-agent
    environment: support
    interaction: { whenBusy: queue } # what happens once in: stays on the Route
    audience: # the Rules
      - who: { roles: [owner] }
        where: { dm: true }
        interaction: { requireMention: false }
      - who: { roles: [member] }
        where: { conversations: [C_SUPPORT] }
        interaction:
          requireMention: true
          followUp: { mode: auto, ttlMinutes: 5 }
        contains: "#help"
```

- `contains`, `interaction.requireMention` and `interaction.followUp` are
  **refused on a Route**. They are each Rule's. A leaf a Rule does not set
  inherits the Connection's and then the organization's `defaults:`, as every
  other leaf does. (`contains` has no default.)
- `contains` still applies only while a conversation is being routed. A
  conversation already bound to a session is past it, as before.
- The code keeps the name `audience` and `AudienceRule`; the UI says Rules.

### How the Hub decides (`rule-trigger.ts`)

1. **Selecting a Route for a new conversation:** the first Route whose Where
   covers the conversation, one of whose covering Rules lets the text in
   (`contains`), and that admits the sender.
2. **The conversation's conditions:** the loosest of the Rules that cover the
   conversation. If one Rule needs no mention, none is needed yet. This check
   needs no sender facts, so a message that is not for the bot costs nothing.
3. **The sender:** the Route's audience, then role assignments and the legacy
   `access:` block, as before.
4. **The sender's conditions:** the loosest of the covering Rules that
   admitted the sender. They differ from step 2 only where the Rules covering a
   conversation disagree. A sender admitted outside the Rules (a role
   assignment) meets the conversation's conditions.
5. **A refused sender:** told why only when the message was for the bot under
   the Rules that need a mention. Where the covering Rules disagree, step 2 can
   let an unmentioned message from a stranger reach step 3; it is then kept as
   unaddressed context, not answered with a refusal.

A follow-up pause, its end, and `/followup` act on the Rules that need a
mention (`mentionTrigger`), not on the loosest: where the owners need no
mention but Members do, `/followup pause` still pauses the Members.
`contains` applies only while no binding owns the conversation; a pending
binding (the first turn still being set up) is past it too.

`/followup route …` writes the change into every Rule of the Route: it is
documented as "every conversation on this Route". Approvals, questions and
commands ask "may this person use the Route" and ignore the trigger
conditions, as before.

### Options considered

| Option                                                                             | Why not                                                                                                                                            |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Conditions on each Rule, inherited from the Route                               | Chosen at first. Dropped for the clean cut below: the Hub is in early development, and a Route-level layer would leave two places to set one thing |
| A′. Conditions on each Rule, **removed from the Route**, data migrated on upgrade  | **Chosen**                                                                                                                                         |
| B. Each UI Rule saved as its own Route with a shared Agent                         | No Hub change, but the UI and the stored shape disagree, limits and order multiply, YAML gets hard to read                                         |
| C. Mention per kind of place on the Route (`interaction.dm`, `interaction.groups`) | Smaller, but cannot give two group Rules different mentions or text filters                                                                        |

## Limits

Decided 2026-10-05, after the Rules: a Route held one set of limits for every
Rule, and one Anyone Rule made the open-Route defaults (8000 characters, 10 per
person and 60 per minute, 8 runs, 15 minutes) apply to everyone on it. An owner
DMing a Route that also answered a public room was held to the strangers'
limits and shared their minute and their run slots.

Each limit now lives at the scope that owns what it protects:

| Limit (UI label)                                                       | Protects                       | Rule | Route | Connection, and each conversation |
| ---------------------------------------------------------------------- | ------------------------------ | ---- | ----- | --------------------------------- |
| `maxInputCharacters` (Message length)                                  | cost of one message            | ✓    |       | ✓                                 |
| `messagesPerMinutePerSender` (Messages handled per minute, per person) | one person's spam              | ✓    |       | ✓                                 |
| `messagesPerMinute` (Messages handled per minute)                      | one way in, or the whole Route | ✓    | ✓     | ✓                                 |
| `maxConcurrentRuns` (Concurrent runs)                                  | the Agent and its Host         | ✓    | ✓     | ✓                                 |
| `maxRuntimeSeconds` (Run time)                                         | cost of one run                | ✓    |       | ✓                                 |
| `messagesSentPerMinute` (Bot messages per minute)                      | the platform's rate limits     |      |       | ✓                                 |

- **A Rule's limit** (`audience[].limits`) is its own leaf, else the Route's
  authored leaf, else, for a Rule that lets anyone in, the open-Route default
  (`config/limits.ts` `ruleLimits`). A Rule naming people meets no default.
  `messagesSentPerMinute` is refused on a Rule: a post belongs to no sender.
- **The Route's limits** are totals for every Rule together, with no default.
  The form shows Messages handled per minute and Concurrent runs, plus any
  other leaf an earlier version set there (with a note); the schema still takes
  all six, and the Hub still applies them to everyone on the Route.
- **A message counts in one Rule:** among the covering Rules that let its sender
  in, one that names them before one that lets anyone in, so an owner never
  shares the strangers' bucket (`plane/limit-scopes.ts` `limitRule`). A sender let
  in outside the Rules (a role assignment, the `access:` block) counts in an
  Anyone Rule if one covers the conversation.
- The labels say what is counted: "handled" is a message that starts or
  continues work (chatter and status commands don't count, extra ones wait);
  "Bot messages" are new posts by the bot (delayed, never dropped).
- The bot's own and each conversation's limits are back in the app, under the
  Connection's … menu, Limits.

Compatibility needs no data migration. A Route's authored leaf already replaced
the open-Route default for strangers, and it still does, now as the Anyone
Rule's fallback; so every stored Route limits strangers exactly as before, and
nothing is rewritten at boot. One intended change: on a Route with both an
Anyone Rule and a Rule naming people, the people named are no longer held to the
open-Route defaults. A Rule that sets no limits compiles as before, so its
`routeFingerprint` does not move.

## Migration (on upgrade, automatic)

`channels/config/rule-conditions.ts` runs at Hub boot, before anything reads a
revision, and rewrites every stored revision in place (the history stays
readable, the active revision keeps its id):

- A Route's `contains`, `interaction.requireMention` and `interaction.followUp`
  are copied onto each of its Rules, then removed from the Route. A leaf a Rule
  already set keeps it. `interaction.whenBusy` stays on the Route.
- **One intended change:** on a Route that set `requireMention`, a Rule that
  covers only DMs and does not set its own gets `false`, not the Route's value.
  That is the documented DM behavior: the old app hid the switch on DM-only
  Routes and still wrote `true`. A Rule over DMs **and** group chats keeps the
  Route's value for both. A Route that set no `requireMention` is left alone:
  its Rules keep inheriting the defaults, exactly as a Rule saved after the
  upgrade does, so a later revision never changes on the next boot.
- A Route still in the shape before Rules (`audience` not a list) is skipped;
  `one-time/route-shape.ts` converts it and runs the same move on its output.
- A file with nothing to move is left byte for byte. A second run finds nothing.
- A revision that does not parse is left as it is and named in a warning; it
  never stops the Hub from starting. Only revisions whose text names a moved
  key are read.
  Side effects, checked:

- `routeFingerprint` hashes the compiled Route, so a Route whose conditions
  moved gets a new fingerprint once. Every reader already falls back to the
  Route's position: bound conversations keep their Route, a running Workflow
  keeps its Route, the Route-scope rate window starts over.
- A Rule that sets no condition compiles exactly as before (no `trigger` key),
  so a Route that never had conditions keeps its fingerprint.
- An app or YAML that still writes Route-level conditions gets a validation
  error naming the key. Nothing is silently dropped.
- Rolling deploys: the move runs once per boot. A Hub of the previous release
  still serving during a rollout can save a Route-level condition after the new
  Hub moved them; the new Hub then refuses that revision until it starts again.
  When a rollout overlaps two Hubs, restart the new one once the old one stops.
- A new app against a Hub of the previous release: a Route that still carries a
  condition opens with "Update this Hub to edit this Route" and cannot be
  saved, instead of saving it without the condition (`routeCarriesRuleConditions`,
  `COMPAT(route-rule-conditions)` in the app).

## The Route form (wireframe)

Sections, top to bottom: the way back and the title, Connection, **Rules**,
What runs, Replies, Limits (folded), Incoming messages (folded). "When it
answers" is gone: its switches and the text filter are each Rule's.

```
← Connections
Add Route

Connection
Slack · support            (named when the Connection card's Add Route opened it;
                            a picker when Add Connection did)

Rules ⓘ   A message reaches this Route when it matches any rule.
┌──────────────────────────────────────────────────────────────┐
│ Where                                                        │
│ ( Direct messages ● | Group chats )                          │
│                                                              │
│ Who can message the bot privately?                           │
│ ◉ Only owners             Long Luong                         │
│ ○ Owners and admins       Long Luong, An Nguyễn (not linked  │
│                           on Slack)                          │
│ ○ Everyone on the Hub     6 people · 4 linked on Slack       │
│ ○ Only people I pick                                         │
│ ○ Anyone on Slack                                            │
│                                                              │
│ Require a mention                                     [ off ]│
│ Messages ( Every message ● | Only messages containing… )     │
│                                                              │
│ + Add another rule                                           │
└──────────────────────────────────────────────────────────────┘
```

A Group chats Rule:

```
│ Where                                                        │
│ ( Direct messages | Group chats ● )                          │
│ Which chats?                                                 │
│ ◉ Chats I pick   [#support ×] [#ops ×]  [Choose chats ▾]     │
│ ○ Every chat the bot is in                                   │
│ ○ Every public chat   ○ Every private chat   (where reported)│
│ Who can talk to the bot there?                               │
│ ◉ Only owners  ○ Owners and admins  ○ Everyone on the Hub    │
│ ○ Only people I pick  ○ Anyone in the chat                   │
│ Require a mention                                      [ on ]│
│ Continue without a mention                             [ on ]│
│   for [ 5 ] minutes after the bot's last reply               │
│ Messages ( Every message | Only messages containing… ● )     │
│   [ #help ]                                                  │
```

- A lone Rule has no frame or title. From two Rules on, each is framed and
  titled, the one being edited is open, and the others fold to one line
  ("#support · Everyone on the Hub · when mentioned"), with Edit and a … menu
  (Remove).
- **Who is one choice, narrow to wide.** Roles nest on the Hub (`admin`
  includes Owners, `member` is every Member), so they are a ladder, not
  independent chips: Only owners (`roles: [owner]`), Owners and admins
  (`[admin]`), Everyone on the Hub (`[member]`), Only people I pick (Roles,
  Teams, Hub people and senders from the channel in one picker), Anyone
  (`anyone: true`, with the open-Route warning). Each choice names the people
  it lets in.
- **Defaults.** A new Rule is Direct messages, Only owners, no mention.
  Switched to Group chats it needs a mention. Continue without a mention is off.
- **Linked identities.** A Hub with no sign-in still needs the owner's channel
  account linked, or "Only owners" lets nobody in. When the person editing has
  not linked theirs on this Connection's channel, the Rule shows "The bot can't
  recognize you on Slack yet" with **Link my Slack account**, which issues the
  `/link` code in place; the prompt goes away once the link lands (the form
  polls while a code is out). Others who have not
  linked are named "(not linked on Slack)": only they can link themselves.
  The Hub reads a `/link` before choosing a Route, but only on a Connection
  whose account is saved and enabled, since only then does its bot run. So a
  Route on a Connection being added (or one kept after its Routes were
  removed) says "The bot starts on Slack when you save this Route" instead of
  issuing a code nothing would answer. Once saved, the Connection's card on
  the Connections page shows the same prompt and **Link my Slack account** for
  as long as a Rule names the viewer and they are not linked. A Rule that names
  them only through a Team does not raise it: the app does not read Team
  membership there.
- **Older Rules.** A stored Rule over DMs and group chats opens as two Rules
  (the same people, the same conditions): the meaning is unchanged, since a
  sender gets in through any Rule. A Rule that narrows DMs to named people
  (`dmMembers`, `dmTeams`, `dmIdentities`) opens on Only people I pick with a
  note, and is written back exactly as stored unless it is edited.
- The Connections list names a Route by its destination and lists its Rules
  one per line.

## Compatibility and edge cases

| Case                                                               | Behavior                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Route saved before the upgrade                                     | Migrated at boot; the same messages get in, except DM-only Rules on a Route that set `requireMention`, which now answer without a mention |
| Rule that sets nothing                                             | Inherits the Connection's, then the organization's `defaults:`                                                                            |
| Two Rules covering one conversation with different conditions      | Before the sender is known, the loosest; after, the loosest of the Rules that admitted them                                               |
| A conversation no Rule covers any more (bound before a Where edit) | Its recorded Route keeps it; the inherited conditions apply                                                                               |
| `contains` on a bound conversation                                 | Not applied, as before                                                                                                                    |
| Sender admitted by a role assignment, not a Rule                   | The conversation's conditions                                                                                                             |
| `/followup route auto 10`                                          | Written into every Rule of the Route                                                                                                      |
| `/followup` in a DM                                                | Applies when the DM's Rule requires a mention (it never applied in DMs before)                                                            |
| Old app (or old YAML) saving Route-level conditions                | Refused, naming the key and that it moved onto each rule; nothing is saved, so nothing is lost                                            |
| Downgrading the Hub after the upgrade                              | Not supported: the older Hub refuses rule-level conditions in the migrated revisions. Restore a database backup taken before the upgrade  |
| New app editing a Route on an older Hub                            | Shown with "Update this Hub to edit this Route"; Save is off                                                                              |
| Stranger's unmentioned message where Rules disagree                | Kept as context; no refusal notice                                                                                                        |
| Owner not linked on the channel                                    | "Only owners" admits nobody until they link; the form says so and offers the link in place                                                |
