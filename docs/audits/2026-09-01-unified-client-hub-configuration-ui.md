# Unified client Hub configuration UI

Date: 2026-09-01. Status: final product and interaction proposal. Scope: make the existing Paseo
app the only end-user UI for Hub account, Channel, Automation, Team, access, and configuration
management, without introducing a second app shell or a separate product-level Bot entity.

This document is the UI companion to
[Unified Paseo client and Managed Access Lite](2026-08-31-unified-client-managed-access-lite.md).
That document owns connection admission, access tickets, daemon leases, revocation, and enforcement.
This document owns what users see, how they configure access, and how the Hub turns those choices
into the managed-access policy. Where the earlier audit describes a separate Bot resource or its
Phase-C UI, this document supersedes that part of the proposal.

## 1. Product shape

Paseo remains one app for web, iOS, Android, and Electron. Hub management appears inside the
existing Settings screen, beside the existing App and Host settings.

```text
App
  General
  Appearance
  Editor
  Diagnostics
  About

Hub
  Channels
  Automations
  Team
  Access
  Configuration

Host
  ● sandbox ⌄
  Overview
  Projects
  Connections
  Pair device
  Agents
  Metadata
  Workspaces
  Providers
  Usage
  Terminals
  Plugins
  Managed access
```

The App and Host groups keep their current order and behavior. `Hub` is the only new top-level
group. The standalone Hub dashboard navigation is not copied into Paseo.

All configuration UI in this document lives in the shared Paseo app on web, native, and Electron.
The Hub remains the authentication, API, compiler, revision, policy, and runtime service. It does
not remain a second end-user configuration website, and no Paseo screen may redirect a user to the
old Hub dashboard to complete setup. A system browser may still visit a Hub callback during OAuth
or native sign-in, then immediately return to Paseo; that is authentication, not configuration.

When Hub support is not included in the Clisbot app build, the Hub group, account provider, Hub
requests, Hub storage, and managed-Host reconciliation do not exist at runtime. This build
capability is not a user-facing Settings toggle.

When Hub support is included but the user is signed out, the group contains one row:

```text
Hub
  Sign in to Hub
```

After sign-in, the app shows only the Hub destinations the member may view. The main app sidebar
adds the signed-in member's avatar without replacing the existing Settings button. The avatar opens
Account and Sign out. There is no organization switcher in the first version.

### Baseline product tests

Every Hub UI or policy change must continue to pass two primary use cases:

1. **One owner:** without Hub, ordinary Paseo continues to work in managed access `off`. After the
   first Hub account is created, its owner has full access, can connect a Channel account and start
   working without creating Teams or assignments, and never encounters a permission editor merely
   to grant themselves access.
2. **Public or customer Channel:** an owner or organization administrator can expose one fixed Route
   to people in selected public, shared, customer, or direct-message Conversations without creating
   a Hub Member for each participant. This convenience must not grant those participants access to
   Paseo, the target Project, Agent profiles, Terminals, Files, approvals, or Hub management.

The default Add channel result is owner-only. Open audience is always an explicit Route choice.

## 2. Vocabulary

Use these terms consistently in UI, API contracts, and implementation:

- **Member** is one BetterAuth membership in the active organization.
- **Team** is a named group of Members. A Member may belong to several Teams.
- **Channel account** is one external messaging installation, such as a Slack app in one workspace
  or one Telegram bot account.
- **Channel identity** is a verified external-user identity mapped to a Member within one Channel
  account.
- **Conversation** is a DM, channel, group, thread, or topic handled by a Channel account.
- **Audience** says who may invoke a Route. Conversation visibility says where the Conversation
  exists; it does not decide the Audience.
- **External participant** is a provider sender invoking an explicitly exposed Route without acting
  as a Hub Member. It is not a guest account and receives no general Hub or Paseo access.
- **Route** selects which fixed Agent configuration or Automation handles a matching Conversation.
- **Agent configuration** is the resolved Agent controls used to start work: Provider, Model, Mode,
  Thinking, feature values such as Fast mode, and provider options.
- **Agent profile**, **Agent session**, **Project**, **Workspace**, **Host**, and **Daemon** keep
  their existing Paseo meanings.

There is no separate product entity named `Bot`.

A Telegram bot token or Slack app is represented by its Channel account. What it does is represented
by Routes. Who may use it is represented by Channel access. The target behavior is an Agent
configuration in a Project, or an Automation. Another product object between those concepts would
duplicate their ownership without adding a user-visible capability.

The requested “access by bot” maps to Channel-account access. Two Telegram bots are two Channel
accounts. Two Slack apps in the same workspace are two Channel accounts. When one Channel account
has several behaviors, Route access determines which Agent configurations or Automations a Member
may invoke.

An Agent profile is optional. It is the existing Paseo launch preset, not a durable identity and not
an ACL resource. Choosing `Apply Agent profile` copies its values into Agent controls and is then
forgotten, exactly like the current Paseo flow. A Route, Automation step, or direct Agent launch may
configure Provider, Model, Thinking, and other controls without creating or selecting a profile.

The current technical privilege `bot.interact` should normalize to the canonical cross-surface
privilege `agent.interact`. Existing channel configuration may accept `bot.interact` as a bounded
compatibility alias during migration, but new UI and stored managed-access assignments use
`agent.interact`.

## 3. Existing foundation

The Paseo implementation reuses two separate layers.

From the Paseo client:

- The shared Settings list-and-detail shell in `packages/app/src/screens/settings-screen.tsx`.
- The App and Host navigation groups, Host picker, compact detail push, and desktop split pane.

From the Hub backend and domain model:

- BetterAuth organization membership, including the `owner`, `admin`, and `member` roles and the
  backend operations and rules for members, invitations, role changes, and removal.
- The channel control plane's Channel accounts, Routes, inheritance, transport state, and
  provider adapters.
- Its dotted privilege matching and provider-neutral approval classification.
- Its ability to evaluate an unmapped channel sender as a raw principal and apply Route default
  roles. This is the narrow implementation seam for public participation; it is not yet a safe
  public-access product flow.
- Stable Paseo Project IDs and the Daemon's existing Provider, Model, Thinking, feature, and Agent
  profile catalogs.
- The daemon's `SessionAdmission`, `SessionAuthorization`, semantic permissions, live permission
  replacement, and Hub service-principal relationship.
- Organization-owned Triggers, one self-contained `.paseo/triggers/<name>.yml` document per Trigger,
  immutable revisions, atomic per-Trigger activation, durable execution, and Activity.
- A new Trigger has one `run` with an explicit Daemon, absolute `cwd`, Provider, Mode, optional
  Model, Thinking and provider options. The Hub-to-Daemon execution protocol already carries those
  Agent controls and optional feature values.
- Startup migration converts simple legacy Project workflows to `single_run` Triggers and preserves
  workflows that cannot be flattened as runnable, read-only `legacy_multistep` revisions. The hidden
  runtime Project created for each Trigger is an execution adapter, not a product resource.

No Hub frontend is inherited. The Hub website's React pages, routes, dashboard shell, components,
and client state are behavior references only. Every end-user Hub management screen is implemented
as new Paseo client code under `packages/app/src/clisbot/hub/**`, using Paseo navigation and design
patterns while calling the retained Hub backend.

The following are not implemented yet:

- BetterAuth Teams are currently disabled.
- BetterAuth Members are not connected to channel-control-plane users.
- Channel identity, Team membership, and managed resource access have no unified data model.
- The Paseo app has no structured Channel, Team, or Access management screens.
- Channel configuration activation does not yet provide all required validation and runtime
  reconciliation guarantees.
- Current Channel Routes still target a named legacy Hub `agent + environment`, not a stable Paseo
  Project plus resolved Agent configuration. Their unreleased `.paseo/channels/**` storage depends
  on a legacy Project that current startup migration archives; replace that storage rather than
  retaining or migrating the Project.
- The current Trigger authoring schema does not carry every Paseo Agent control; notably Fast mode
  is available on the execution wire but not in `TriggerAgentSchema` or the generated launch intent.
- The current Hub website owns configuration presentation. The Paseo app does not yet have the
  session-authenticated read/write APIs and structured screens needed to replace it.

## 4. Organization roles and resource access

Organization roles control Hub administration. They do not automatically grant access to Channels,
Daemons, Projects, or Automations.

The canonical CURRENT/MODIFY/NEW permission inventory is in section 4 of
[Unified Paseo client and Managed Access Lite](2026-08-31-unified-client-managed-access-lite.md).
This document uses those actions through UI access levels; it does not define a second catalog.

| Organization role | Hub authority                                                                                         | Resource access                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `owner`           | Full organization management                                                                          | Implicit access to every current and future organization resource |
| `admin`           | Manage Members, Teams, access, Channels, Automations, and configuration, except owner-only operations | Explicit Team or direct assignments only                          |
| `member`          | View the Hub account and assigned resources                                                           | Explicit Team or direct assignments only                          |

Owner access is evaluated from the current organization membership. It is not stored as one row per
resource, so an owner can immediately use a newly enrolled Daemon or newly added Channel account.

Inviting a Member creates only organization membership. It does not grant a Team, Channel, Project,
Automation, or Daemon. An invitation may explicitly include Teams, but the default is no Team.

The owner never needs a stored assignment for personal use. The Access page shows
`Full organization access · No setup required`, while still allowing the owner to configure access
for other people.

## 5. Teams and assignments

Enable BetterAuth Teams as the organization-scoped directory for Team names and Team membership.
Do not use BetterAuth Teams as the resource policy engine. A small Clisbot-owned access service
stores assignments that reference a BetterAuth Team or organization membership.

```ts
type AccessSubject = { kind: "team"; teamId: string } | { kind: "member"; membershipId: string };

type ResourceScope =
  | {
      kind: "channel";
      channelAccountId: string;
      conversation: ConversationAccess;
    }
  | { kind: "daemon"; daemonId: string }
  | { kind: "project"; daemonId: string; projectId: string }
  | { kind: "automation"; automationId: string };

interface AgentConfigurationGrant {
  providerId: string;
  modelIds: "*" | string[];
  thinkingOptionIds: "*" | string[];
  allowFastMode: boolean;
}

interface AccessAssignment {
  organizationId: string;
  subject: AccessSubject;
  resource: ResourceScope;
  accessLevel: string;
  agentConfigurations?: AgentConfigurationGrant[];
}
```

`agentConfigurations` is used only on a Project assignment. A launch passes when one complete grant
matches Provider, Model, and Thinking; fields from different grants are never combined into a new
configuration. This prevents two narrow Team grants from accidentally producing a broader
Provider/Model combination.

The first version uses built-in access levels. It has no custom-role editor, assignment-level deny,
or policy expression builder. The existing role evaluator may continue to implement the built-ins,
including the narrower deny required by the Developer Project level.

For a non-owner Member, effective access is the union of:

```text
all assignments from the Member's Teams
+ direct assignments for that Member
```

Direct assignments are for exceptions. The main setup flow assigns Teams.

Every effective-access row states where it came from: `Via Engineering`, `Via Operations`,
`Direct`, or `Owner`. If one Team grants a narrower level and another grants a broader level, the
broader effective privilege wins and both sources remain visible.

## 6. Account and Channel identities

Account opens from the member avatar rather than taking another Settings navigation row.

```text
Account

Account details
  Name
  Email
  Organization
  Organization role

Channel identities
  Slack · Acme · @long                 Verified
  Slack · Customer workspace · @long  Verified
  Telegram · Internal · 123456        Verified

  Link identity
```

A Member may have several identities for the same provider and several providers. Identity is
scoped by Channel account so the same Slack user ID in two workspaces is not treated as one
identity.

```ts
interface ChannelIdentity {
  id: string;
  organizationId: string;
  membershipId: string;
  channelAccountId: string;
  externalSubjectId: string;
  displayName?: string;
  verifiedAt: string;
}
```

The unique identity key is:

```text
organizationId + channelAccountId + externalSubjectId
```

Only verified identities are stored as Channel identities. A short-lived verification challenge
owns the pending state. An attempt to claim an identity already linked to another Member returns a
clear conflict error; it does not create a persistent `conflict` identity state. Channel account
connection health is displayed on the Channel account, not copied onto each identity.

### Link identity

1. Choose a Channel account.
2. Start the provider-supported verification.
3. Confirm the identity returned by the provider.
4. Save the verified mapping.

Slack can use OAuth self-linking or a verified workspace directory. Telegram can use a one-time DM
or `/start` code. A provider adapter declares which verification method it supports.

An organization administrator may link an identity for another Member only through verified
provider data or an audited instance-operator override. Typing an unverified external ID is not a
normal management flow.

Unlinking takes effect for new messages immediately. Any pending approval response rechecks the
identity and current access before it is accepted.

Owner wildcard applies only after an external identity maps to the owner membership. An unknown
Slack or Telegram sender never becomes an owner merely because the organization has an owner.

## 7. Team UI

`Hub → Team` implements member, invitation, role, and removal flows as new Paseo screens over the
Hub membership backend. The existing Hub Team page is a behavior reference only; none of its React
components, routes, layout, or client state is reused. The Paseo screen has three sections rather
than introducing another navigation hierarchy:

```text
Team
  Members
  Teams
  Invitations
```

### Members

A Member row shows name, organization role, Team count, and Channel identity count. It opens:

```text
Member

Overview
  Name
  Email
  Organization role
  Status

Teams
  Engineering
  Internal operations
  Add to team

Channel identities
  Slack · Acme · @long
  Telegram · Internal · 123456
  Link identity

Effective access
  Slack · Acme · Public conversations     Via Engineering
  Project · sandbox / paseo · Developer   Via Engineering
    Agent configuration · Codex · GPT-5.6 · High

Direct access
  Project · sandbox / support · Office worker
```

An owner shows one immutable row: `Full organization access`.

### Teams

A Team row shows Member count and assignment count. It opens:

```text
Engineering

Members
  Long
  Alice
  Bob

Access
  Slack · Acme · Public conversations
  Telegram · Internal · Direct messages
  Project · sandbox / paseo · Developer
    Agent configuration · Codex · GPT-5.6 · Medium, High
    Fast mode · Not allowed

  Add access
```

### Invitations

The existing invitation flow adds an optional Team selection after organization role. Nothing is
selected by default. The review step lists the Teams and resulting access before the invitation is
sent.

## 8. Access UI

`Hub → Access` is the central review and assignment surface. It starts with access subjects because
the common administrative question is “what can this Team use?”

```text
Access

Teams
  Engineering              4 assignments
  Internal operations      3 assignments

Direct access
  Alice                    1 assignment
  Bob                      2 assignments

Open routes
  Slack · #customer-acme   Anyone in this conversation
  Telegram · Direct messages   Anyone who messages this account
```

Selecting a Team or Member opens the same access editor used from the Team and Member pages.

`Add access` is a focused sheet:

1. Choose Channel, Daemon, Project, or Automation.
2. Choose the specific resource.
3. Choose its built-in access level.
4. For a Channel, choose the Conversation access. For a Project, choose the allowed Agent
   configurations and whether Fast mode is allowed.
5. Review the resulting privileges.
6. Save.

A Project assignment requires the Member to connect to its Daemon. The form shows the associated
Daemon access and saves it explicitly in the same confirmation; it must not create a hidden grant.

Resource detail pages provide the reverse answer without adding a second editor:

```text
Project · sandbox / paseo

Who has access
  Engineering · Developer
  QA · Office worker
  Alice · Full access · Direct
```

Unknown or removed resources remain visible to access administrators as `Unavailable resource` so
they can remove stale assignments. Ordinary Members never receive their identifiers or names.

## 9. Channels

`Hub → Channels` is the structured management surface for external work channels. This screen and
its Advanced configuration view are both in Paseo. The old Hub configuration workbench is not a
fallback product flow.

Reuse the Hub provider-application backend, but keep two levels distinct. An Application stores the
credentials and callback/runtime configuration for a provider app; a Channel account or Automation
connection is one organization-scoped installation of it. Current Hub already supports multiple
Slack workspaces, Discord guilds, GitHub installations, and Linear organizations beneath one
provider Application. GitHub keeps its existing App installation and repository-selection flow.
Token-native accounts such as Telegram remain ordinary Channel-account rows with their own secret.

The current `runtime_provider_configuration.provider` primary key permits one Application
registration per provider. Keep that simple shape while one registration can serve many accounts.
If a real deployment needs two independent Slack or GitHub app registrations, migrate the
Application table to a stable ID plus unique provider/slug and let each connection reference that
ID. Do not duplicate OAuth, callback, secret, or runtime-owner logic in the Channel backend merely
to obtain multi-account support that the connection/account layer already provides.

```text
Channels

Slack · Acme
  Connected · Socket mode
  4 routes · 3 Teams

Telegram · Internal
  Connected · Long polling
  2 routes · Direct messages

Add channel
```

The Channel account detail uses Settings sections:

```text
Slack · Acme

Connection
  Status
  Provider identity
  Transport
  Effective enabled state

Routes
  #engineering → paseo · Codex / GPT-5.6 · Members with access
  #customer-acme → Support triage automation · Anyone in this conversation
  Direct messages → Denied

Access
  Engineering · Public conversations
  Support · #support
  Alice · Direct messages · Direct

Audience
  #customer-acme · Anyone in this conversation

Diagnostics
  Configuration revision
  Effective route configuration
  Integrity and load errors
  Last event
```

Provider secrets are never shown after save. Replace and revoke are explicit actions. Revoke uses a
destructive confirmation.

### Add channel

Adding a Channel account is one full-page flow because it combines external verification and route
configuration:

1. Choose Slack, Telegram, or another installed Channel provider.
2. Connect credentials and verify the provider account.
3. Choose the first Conversation scope.
4. Review `Who can use it`. A one-owner organization is prefilled as `Only you`; otherwise the
   default is `Members with access`. Open the picker only to add Teams or choose
   `Anyone in selected conversations`.
5. Choose an Automation, or choose a Project and configure Agent controls. `Apply Agent profile` is
   an optional shortcut that fills those controls.
6. For Members with access, optionally choose Teams. No Team is selected by default. A Team must
   receive explicit Channel access, but it does not need direct Project or Automation access merely
   to invoke this fixed Route.
7. Review the account, Route, target, Audience, safeguards, and Team access.
8. Save, validate, activate, and start the transport.

For `Members with access`, no Team assignment means only organization owners can use the Route. For
`Anyone in selected conversations`, the explicit Route Audience admits participants under the
open-audience safeguards below. The Channel account may be saved as disabled before a Route is
complete.

When the provider proves the installing user's identity, setup offers to link it to the signed-in
owner automatically. Telegram setup presents the one-time link command before the final test. A
one-owner organization therefore needs no separate Team or Access setup before testing the Route.

### Routes

A Route combines three facts:

```text
where a message arrived
+ which Project and Agent configuration, or Automation, handles it
+ synchronization and approval behavior
```

For an Agent target, the Route identifies the Daemon, Project, and complete Agent configuration.
For an Automation target, it identifies the Automation. There is no intermediate Bot object.

The Agent editor reuses Paseo Agent controls:

```text
Project             paseo
Provider            Codex
Model               GPT-5.6
Thinking            High
Mode                Default
Fast mode           Off
More settings       …

Apply Agent profile
```

Applying a profile copies values into this form. The Route revision stores the resolved values, not
the profile ID, so deleting or editing a profile cannot silently change a live Route.

This replaces the managed form of the current named `agent + environment` target. During migration,
the compiler continues reading existing named targets and normalizes them into the same resolved
Daemon, Project, and Agent configuration. New structured UI writes the stable target and inline
configuration; it does not create another named-agent catalog.

The Route editor reuses the current interaction, binding, reply, outbound, synchronization, and
approval settings. It shows the effective compiled value beside any inherited value so the user
does not need to read several YAML files to understand the result.

The outbound section also owns a small Route-bound Channel action ceiling. It does not expose
`tool.*`, `channel.tool.*`, arbitrary MCP tool names, or OpenClaw's complete message-action catalog:

```text
Channel replies
  Send text replies                    On
  Send files and artifacts             On
  Allowed file roots                   Project outputs
```

An owner-only Route preserves the current easy default: text and Project-output files are enabled.
An open-audience Route starts with text only; enabling files requires an explicit Project-output
root and a safeguard review. Provider-native actions such as reactions, polls, edits, or pins appear
only after the Hub action broker and that in-repo vertical implement them. They are Route behavior,
not Agent-profile fields and not automatically granted to a Member.

Changing a Route target shows the old and new Project, Agent controls, tool ceiling, and cost impact
before activation. It does not silently create direct Project or Automation access for any Team. An
open-audience Route requires a fresh safeguard review, and any target change invalidates the
Route's active Conversation bindings.

Saving performs full channel semantic compilation before activating the revision. A successful
activation reconciles the Channel supervisor immediately: added accounts start, changed accounts
restart when required, disabled or removed accounts stop, and failed accounts report the error in
the account detail. “Saved” must mean the selected revision is both valid and applied.

## 10. Conversation access

Conversation access is provider-neutral but deliberately small:

```ts
type ConversationAccess =
  | { kind: "all" }
  | { kind: "directMessages" }
  | { kind: "publicConversations" }
  | { kind: "specific"; conversationIds: string[] };

type RouteAudience = { kind: "members" } | { kind: "conversationParticipants" };
```

The UI labels are:

- `All conversations`
- `Direct messages`
- `Public conversations`
- `Specific conversations`

There is no `Custom` policy builder in the first version. Multiple assignments can express a union,
for example Direct messages plus two specific private channels.

Provider adapters normalize their native conversation facts:

- Slack DMs map to Direct messages. Public Slack channels map to Public conversations. Private
  channels require a Specific conversation assignment unless All conversations is granted.
- Telegram private chats map to Direct messages. A group or channel maps to Public conversations
  only when the adapter can prove it is public; otherwise it requires a Specific conversation
  assignment.
- Future providers supply the same normalized conversation ID, kind, and visibility facts.

Unknown visibility fails closed for `Public conversations`. Threads inherit the root Conversation's
access. A provider topic may be selected specifically when it has a stable provider ID.

Conversation access does not authorize an unknown sender. Every sender must still map through a
verified Channel identity to an active organization Member unless the matching Route explicitly
uses `Anyone in selected conversations`.

`Members with access` is the default Audience. It uses the owner, Team, and direct assignments
described above.

`Anyone in selected conversations` may be combined only with:

- `Specific conversations`; or
- `Direct messages`, when the Channel account is deliberately operated as a public DM endpoint.

It cannot be combined with `All conversations` or the open-ended `Public conversations` selector.
The picker may offer `Select all current public conversations`, but it saves the current stable IDs
as Specific conversations. A newly created public channel is not exposed automatically.

Channel accounts have one built-in user access level:

- `Use` grants `channel.use` and `agent.interact` for the fixed Route in the assigned Conversations.
  It does not grant direct access to the target Project or Automation.

## 11. Channel authorization

When a message arrives from Slack, Telegram, or another provider, Hub evaluates:

```text
1. Which Channel account received it?
2. Which exact Route matches this Conversation?
3. Is the sender a verified Hub Member?
4a. Member Route: does owner, Team, or direct Channel access cover this Conversation?
4b. Open-audience Route: does its Audience explicitly cover participants in this exact Conversation?
5. Does the Route allow this interaction and message type?
6. Does the request fit the Route's execution and abuse limits?
```

The applicable branch and all shared checks must pass. The Hub then executes the configured Route
through its existing enrolled-daemon service principal. The Route is the execution ceiling: a
channel sender cannot replace its target Daemon, Project, Provider, Model, Thinking, Mode, feature
values, provider options, or Automation through message content.

A channel user does not need direct Project or Automation access merely to use a fixed Route. Hub
already validated the Route's fixed target and runs it under the compiled service-principal ceiling.
This keeps Channel use separate from opening source code, Files, Terminals, arbitrary Agent
sessions, or direct Automation runs in Paseo.

Approval responses are narrower. A Member responding to an approval must also hold the matching
`approval.*` privilege on the target Project. A Member who may use a Route but lacks Project approval
authority may continue the conversation but cannot approve the blocked operation.

### Open-audience safeguards

Selecting `Anyone in selected conversations` automatically applies these non-optional safeguards:

- Enabling or changing open Audience requires both Hub configuration and access-management
  authority, unless the current Member is the organization owner.
- The Route has one fixed target and exact Conversation IDs, or is an explicitly enabled public DM
  Route.
- A group, shared, or public Conversation requires an explicit mention or command to start work.
  Follow-ups must remain in the bound thread or topic.
- Context and bindings are keyed by Channel account, Conversation, and thread or topic. A customer
  Conversation cannot reuse another Conversation's Agent session or history.
- External participants receive final answers only. Hub does not attach or synchronize Project
  metadata, paths, tool streams, progress, diagnostics, or internal approval details to the
  Conversation.
- External participants cannot approve any tool request. The Route may auto-run only actions in
  its server-side, Conversation-bound capability. Text replies are the default; file sending must
  be limited to declared Project outputs. Every other tool request is denied.
- Fast mode defaults to off. Enabling it requires `agent.fast.use`, an explicit cost warning, and a
  Route budget. An External participant never receives `agent.fast.use`; the fixed Route either has
  that authority at activation or cannot enable Fast mode.
- A public Automation must compile every step under the same explicit target, tool, output, and
  runtime ceiling. One unconstrained step makes the Route invalid. Any preapproved tool must enforce
  its own resource and argument scope; prompts are not authorization.
- Hub enforces bounded per-sender and per-Route rate, concurrency, input-size, attachment, runtime,
  and idle limits before starting or continuing work.
- Provider self-messages and redeliveries retain the existing loop and deduplication protection.
- Denials use a generic response and do not reveal whether a Project, Agent configuration,
  Automation, or Member exists.
- Activity records the Channel account, Route, Conversation, provider sender ID, outcome, and limit
  decision for audit and abuse investigation. It does not create a Hub Member or Channel identity.

These controls are the public automation boundary. Prompt intent, classifier output, and model
instructions never broaden the fixed target or tool policy.

## 12. Automations and Configuration

`Hub → Automations` is the Paseo UI for the Hub's existing workflow architecture. It does not move
workflow state into the client and it does not create a second workflow engine.

### Existing Trigger architecture

The current Hub already owns the server-side model Paseo should reuse:

- One organization-owned Trigger is authored as one self-contained
  `.paseo/triggers/<name>.yml` document and stored as immutable revisions.
- A `single_run` Trigger may listen to one or more GitHub, Slack, Discord, Linear, or manual events,
  then starts one Agent run with an explicit Daemon, absolute `cwd`, Agent controls, prompt, limits,
  environment values, and bounded outputs.
- Saving validates and activates one Trigger atomically. Accepted runs retain the exact compiled
  revision through the durable execution engine.
- Provider-native `hub.reply` is added automatically for conversational sources;
  `hub.finish_execution` is available to every execution.
- At startup, active legacy Project bundles migrate before provider events are accepted. Simple
  workflows become `single_run`; multi-step, conditional, or dynamic workflows remain runnable as
  read-only `legacy_multistep` revisions.
- A hidden Project per Trigger temporarily adapts the new authoring model to the existing workflow
  engine. It must never appear beside a Paseo Daemon Project in the UI.

The relevant seams are `packages/hub/src/triggers/configuration/**`,
`packages/hub/src/triggers/store.ts`, `packages/hub/src/triggers/dashboard.ts`,
`packages/hub/src/triggers/migration.ts`, `packages/hub/src/workflows/engine.ts`, and the Trigger
operations in `packages/hub/src/public-api/operation-manifest.ts`. The Hub React Trigger pages are
presentation references only; Paseo calls these backend services through new session-authenticated
operations.

In the Paseo product language, one organization Trigger is shown as one Automation. The old Project
bundle API remains only for older CLI compatibility; it is not the target Automation or Channel
authoring architecture.

### Automation list and detail

The list is optimized for operation rather than source-file browsing:

```text
Automations

Support triage                 Active
  Slack mention · Single run · Last run 8m ago

Issue review                  Active
  GitHub issue · Single run · Last run succeeded

Release assistant             Disabled

Add automation
```

An Automation detail has these sections in the existing Settings detail column:

```text
Support triage

Overview
  Status
  Trigger
  Last activation
  Last run

Run
  Inputs
  Target and Agent
  Prompt and limits
  Outputs

Routes and triggers
  Slack · #customer-acme
  Manual run

Access
  Support · Run

Activity
  Recent runs and step outcomes

Advanced
  Authored YAML
  Active revision
  Revision history
```

`Advanced` is still a Paseo screen. It exposes the exact authored files for users who need YAML,
but it never links to the standalone Hub website.

### Add or edit Automation

The structured flow is:

1. Enter a name and optional description.
2. Choose one or more events from Manual or an installed GitHub, Slack, Discord, or Linear
   connection. A Channel Route may invoke the same fixed Automation through the Channel control
   plane. Schedule appears only after Hub has a schedule trigger provider.
3. Define only the inputs that callers may supply. A caller cannot override an undeclared target or
   Agent control through input data.
4. Configure the single run: choose the target Daemon and Project, then Provider, Model, Thinking,
   Mode, Fast mode, other supported Agent controls, prompt, outputs, and timeouts.
5. Optionally choose `Apply Agent profile` to fill the Agent controls. The Automation stores the
   copied values, not a live profile reference.
6. Configure the step's tool ceiling. A Route or caller may narrow it but cannot broaden it.
7. Review target access, automatic tool authority, Fast-mode cost, runtime limits, and exposed
   outputs.
8. Validate. Validation is read-only and does not create or activate a revision.
9. Activate. Activation submits one self-contained Trigger document, records a new revision, and
   atomically replaces that Trigger's active revision.

The MVP does not add a separate server-side draft model. Edits remain an explicitly labelled local
draft until activation. Activation includes the base revision ID; if another administrator has
activated a newer revision, Paseo returns a stale-revision conflict and asks the editor to review
the new source rather than silently overwriting it.

New multi-step authoring is not part of this MVP. A migrated `legacy_multistep` Automation remains
runnable and visible, but read-only until a deliberate multi-step editor and contract are added.

An Automation has one Member access level:

- `Run` grants `automation.run` for a direct Paseo invocation. Invoking one fixed Automation through
  an authorized Channel Route is governed by that Route's `channel.use` assignment instead.

Managing and activating Automation definitions remains an organization owner or administrator
capability in the first version. The author must also be allowed to delegate every target Project,
Agent configuration, Fast-mode cost capability, and automatic tool action contained by the
Automation. A workflow executes with a fixed service-principal ceiling compiled into its revision;
the invoking Member or External participant supplies declared inputs only.

For an open-audience Route, every step must have a fixed target, fixed Agent configuration, bounded
runtime and outputs, and an exact automatic tool policy. One unconstrained step makes activation
fail. Fast mode is off by default and additionally requires an explicit Route budget.

### Minimum integration migration

The migration extends the current Trigger backend instead of reviving the old bundle UI:

1. Add session-authenticated operations for Paseo to list, validate, activate with optimistic
   concurrency, inspect revisions and Activity, and invoke organization Triggers. The app does not
   use an administrator API key.
2. Extend `TriggerTargetSchema` with an optional stable Paseo Project ID. Resolve it to the current
   Workspace/cwd at activation, while continuing to accept the current daemon-plus-absolute-cwd
   source form.
3. Add optional `featureValues` to `TriggerAgentSchema`, compiled Agent configuration, and launch
   intent so Fast mode can use the existing optional execution-wire field. Keep `mode` and `options`
   as authored compatibility names and normalize at the execution boundary.
4. Carry stable Project identity on Hub-created Agent work so the Daemon enforces the Project
   boundary instead of trusting only a supplied path.
5. Move `.paseo/channels/**` into a revisioned, organization-owned Channel configuration store and
   point Channel operations plus supervisor snapshots at it. The existing path is unreleased, so
   start with the new store and delete the legacy Project dependency without a compatibility
   migration.
6. After Paseo reaches feature parity, remove the old Hub configuration pages from the end-user
   build. Keep authentication/OAuth callbacks, APIs, compiler, revisions, and runtime.

There is no bulk rewrite in the client. Upstream startup migration already normalizes old named
agents, environments, prompt partials, and workflows into self-contained Trigger revisions. Agent
profile values are copied at edit time, so a later profile change cannot mutate an active or
historical run.

### Configuration screen

`Hub → Configuration` is also entirely inside Paseo and contains lower-frequency administration:

- General organization configuration.
- Automation connections for GitHub, Slack, Discord, or other event sources used by workflow
  triggers. These are distinct from Channel accounts used for two-way work conversations.
- API keys.
- Active configuration and revision history.
- Instance Apps and Operator settings, visible only to the instance operator.

Usage and Billing remain outside the first unified-client MVP. Host Usage remains unchanged. Hub
Usage can return only when the product has an organization-level metric or billing workflow that
cannot be represented by Host Usage.

## 13. Project, Agent configuration, and Daemon access

An enrolled Daemon publishes the minimum catalog required by the Hub access editor, Route resolver,
and Automation editor: stable Project IDs and names, plus the Provider, Model, Thinking, Mode,
feature, and optional Agent-profile choices available on that Daemon. It updates the snapshot when
the catalog changes. Filesystem paths and inaccessible resource details are not part of the
member-facing catalog.

A Route or assignment whose Project was removed becomes unavailable and cannot start new work. The
Channel account remains connected, and its detail page names the missing target to an access
administrator so it can be repaired or removed.

Project access uses three built-in levels:

| Access level  | Effective product privileges                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Office worker | `project.use`, `agent.interact`, `agent.create`, `approval.file`                                                           |
| Developer     | Office worker plus `terminal.use`, `approval.config`, and `approval.command`, while denying `approval.command.destructive` |
| Full access   | Developer plus `approval.command.destructive` and `approval.channel`                                                       |

`project.use` is the first-version access to Agents, Workspaces, Files, and Project projections.
Creating, renaming, or removing Projects stays with the Daemon administrator rather than adding a
new `project.manage` privilege before a narrower lifecycle use case exists.

Every non-owner Project assignment also states which Agent configurations may be launched:

```text
Agent configurations
  Codex · GPT-5.6 · Medium, High
  Claude Code · Opus 4.1 · High

Use Fast mode                       Off
```

The Project-access form is one short flow:

1. Choose Office worker, Developer, or Full access.
2. Add one or more Provider rows.
3. For each row, select the allowed Models and Thinking options from the Daemon catalog.
4. Optionally grant `Use Fast mode`; it is off by default and shows a cost warning.
5. Review the tool approvals implied by the access level and save.

The form requires at least one Agent-configuration row while `agent.create` is present. It does not
ask the administrator to create an Agent profile first.

Provider, Model, and Thinking are checked as one grant. An empty list grants no Agent creation;
`All available` is an explicit choice, not an empty-state interpretation. Agent profiles shown in
Paseo are filtered by the same rule: a profile appears usable only when its copied Provider, Model,
and Thinking values fit one grant. There is no Agent-profile assignment and no
`agent.profile.use` action.

Mode is not a second authorization system and has no `mode.use` action. Mode controls provider
approval behavior, so the Daemon maps its effective file, command, configuration, channel, and
other tool effects to the existing `approval.*` actions. A requested mode cannot bypass the
session's semantic permission ceiling; a mode whose effect cannot be represented safely is rejected
for a managed Member. Open-audience Routes still require exact preapproval and never inherit a
Member's ability to answer approvals.

Fast mode is cost-bearing rather than a tool authority. Enabling `featureValues.fast_mode` requires
the separate `agent.fast.use` action. It is off by default for non-owners, is granted explicitly on
a Project assignment, and is checked again when an Agent is created. Owner and Daemon
Administrator access include it implicitly.

Other Agent settings may be stored directly on a Route or Automation and are validated by the
Daemon's existing provider-configuration validator. For a managed Member, an unclassified
provider-specific setting cannot silently broaden tool authority or cost: it stays at the Daemon
default unless it is fixed by an administrator-authored Route/Automation or explicitly classified
by the provider contract. The first version adds only the special Fast-mode action; it does not add
a generic feature-policy language.

Daemon access has two levels:

- `Connect` grants managed admission to the Daemon but no Project by itself.
- `Administrator` grants Daemon configuration, updates, plugins, pairing, connection management,
  sensitive diagnostics, all Daemon Projects, every Agent configuration, and Fast mode. It does not
  grant Hub Team or access management.

Organization owners implicitly hold every level.

### Agent creation enforcement

For direct Paseo work, the Daemon checks `daemon.connect`, `project.use`, `agent.create`, one complete
Agent-configuration grant, Mode-derived `approval.*` requirements, and `agent.fast.use` when Fast
mode is on. It validates the resolved configuration immediately before creation.

Applying an Agent profile changes none of those checks. Paseo sends the copied Agent controls just
as it does for a manually configured launch. No profile ID is required in the create request, and an
Agent session does not pretend to retain a profile association after launch.

For a Channel Route or Automation, Hub validates the fixed configuration during activation and the
Daemon validates it again when work starts. The Channel sender or Automation caller cannot override
the compiled Project or Agent controls.

## 14. Paseo client authorization

After Hub sign-in, the app receives only the managed Hosts and resources the Member may use.

Opening a managed Host follows the Managed Access Lite flow:

```text
Hub account
  → choose an accessible Host
  → request one access ticket for the real connection attempt
  → connect directly or through the existing relay transport
  → include the ticket in hello
  → Daemon binds the Hub principal and current lease
  → Session lists and events are filtered by resource access
```

Opening a Project requires:

```text
daemon.connect
+ project.use for that Project
```

Interacting with an Agent session requires `agent.interact`. Creating one additionally requires
`agent.create`, a matching Agent-configuration grant, Mode-compatible `approval.*` authority, and
`agent.fast.use` when Fast mode is enabled. Terminal use and approval responses require their
narrower privileges.

The app hides unavailable Host and Project navigation for clarity. The Daemon independently checks
every direct request, guessed resource ID, subscription, pushed event, File transfer, Terminal text
message, and Terminal binary frame. Client filtering is not the security boundary.

## 15. Revocation

These changes invalidate affected managed sessions and Channel authorization caches:

- Removing a Member from the organization.
- Removing a Member from a Team.
- Removing or changing an access assignment.
- Unlinking a Channel identity.
- Disabling a Channel account or changing a Route target.
- Removing an open Audience or disabling an open-audience Route.
- Removing Project access, an Agent-configuration grant, or Fast-mode access.
- Changing an organization role.

When the Hub has a live Daemon relationship, it sends invalidation immediately. The Daemon replaces
or revokes affected Session authorization. The configured 15-minute lease remains the maximum
stale-authority window when the Hub cannot reach the Daemon. Approval responses always authorize
against current policy rather than trusting the policy from when the approval card was rendered.
Removing open Audience invalidates the Route's Conversation bindings, rejects new and follow-up
messages, and interrupts active Route-owned work so a revoked public entry point does not continue
running in the background.

## 16. Persistence boundary

Operational access data belongs in the Hub database:

- Organization membership.
- Team membership.
- Verified Channel identities.
- Access assignments.
- Verification challenges.
- Audit events.

Versioned configuration continues to own behavior:

- Channel account declarations and secret references.
- Routes and fallback behavior.
- Resolved Route Agent controls. Agent profiles may fill these values but are not stored as live
  authorization references.
- Route Audience and open-audience safeguards.
- Interaction, binding, reply, outbound, synchronization, and approval defaults.
- Automations and their source files.
- Configuration revisions.

This split avoids creating a new configuration revision whenever an administrator invites a Member,
links a Telegram identity, or moves someone between Teams. It also avoids a second writable access
source.

In managed access mode, Hub database assignments are authoritative for people and resources.
Existing channel `users` and `assignments` configuration has a one-time importer or a bounded
read-only compatibility adapter. It must not remain a second independently writable policy system.
Organization and account `defaultRoles` remain empty so an unmapped sender or newly invited Member
gains nothing. An open-audience Route compiles its explicit Audience into one built-in Route
default role containing only `channel.use` and `agent.interact`. It never receives approval,
Project, Agent-configuration, Fast-mode, Daemon, or Hub privileges.

## 17. Design-system use

The Hub area uses Paseo's existing Settings patterns:

- `SettingsSection` for every group of rows.
- Existing settings card and row styles for Members, Teams, Channel accounts, Routes, and access.
- `StatusBadge` for Connected, Disabled, Error, and Verified.
- `Combobox` for searchable Members, Teams, Daemons, Projects, optional Agent profiles,
  Automations, and Conversations.
- `DropdownMenu` for small fixed action lists.
- `AdaptiveModalSheet` for Link identity, Add Team member, and Add access.
- A full detail route for Add channel because it is a multi-step external setup flow.
- `confirmDialog` for revoke, unlink, remove, and disable operations.
- `Alert` for a recoverable account, validation, or activation error.

Desktop keeps the current 320px Settings sidebar and centered detail column. Compact layouts keep
the current full-screen list-to-detail push. Hub screens do not add another sidebar, dashboard shell,
navigation rail, or visual token set.

Clisbot-owned UI remains under `packages/app/src/clisbot/hub/**`. Shared Paseo UI contains only the
Hub group mount, account-provider mount, avatar mount, optional managed-Host metadata, and narrow
connection/admission hooks.

## 18. Deliberate MVP limits

The first version deliberately excludes:

- A separate Bot entity or Bot management page.
- Organization switching.
- Custom roles or a policy-expression editor.
- Assignment-level deny rules.
- A Custom Conversation selector.
- Persistent identity states beyond a verified mapping.
- A second resource graph or separate reverse-access editor.
- Project lifecycle privileges narrower than Daemon administration.
- Hub Usage and Billing in the unified client.
- A new Channel transport or a new Paseo Agent lifecycle.
- Guest accounts or an external-participant directory.
- Agent profiles as ACL resources, profile IDs on Agent sessions, or profile drift tracking.
- A separate Mode permission or a generic provider-feature policy language.
- A second server-side workflow draft model.
- Any end-user Hub configuration page outside Paseo.

These are omitted because the requested workflows do not need them. They can be added without
changing the core model if a demonstrated use case appears.

## 19. Compatibility and rollout

The compatibility contract remains:

- The Clisbot app works as an ordinary client with an upstream Paseo Daemon.
- A Clisbot Daemon in managed access `off` works with an upstream Paseo app.
- A Clisbot Daemon in managed access `external` requires the Clisbot app for TCP and relay access.
- Direct and relay transports keep carrying the same application protocol; managed access does not
  add transport-specific authorization.
- New wire fields remain optional and capability-gated according to the protocol compatibility
  rules.
- Existing Project workflow bundles migrate at Hub startup. New CLI/Paseo authoring uses
  organization Trigger documents; stable Project and `featureValues` fields remain additive to the
  current Trigger schema.

Deliver in this order:

1. Mount Hub sign-in and Account in the shared app, preserving the feature-off path.
2. Add session-authenticated Hub read, validate, activate, revision, activity, and run operations
   required by Paseo; keep configuration logic in the existing Hub services.
3. Enable BetterAuth Teams as a directory and add verified Channel identities plus access
   assignments.
4. Add Team and Access screens with owner wildcard, zero-access Member defaults, Project
   Agent-configuration grants, and explicit Fast-mode access.
5. Add structured Channels overview, Add channel, Routes, validation, and supervisor
   reconciliation.
6. Add the structured Automation editor, optional Apply Agent profile action, Advanced YAML,
   validation, activation, revisions, and activity inside Paseo.
7. Add explicit open Route Audience, safe execution defaults, admission limits, cost budgets, and
   audit.
8. Complete Daemon Project, Agent-configuration, Fast-mode, File, Terminal, approval,
   subscription, and outbound enforcement
   before enabling managed access `external` in production.
9. Import legacy channel users and assignments, remove the second writable policy path, and remove
   the old Hub configuration UI from the end-user build after Paseo reaches parity.

## 20. Acceptance flows

These are release-gating integration scenarios, not illustrative examples.

### One owner

1. The owner signs in and sees every enrolled Host, Project, Provider, Model, Thinking option, and
   optional Agent profile without creating an assignment.
2. The owner adds a Channel account and links their provider identity during setup.
3. `Who can use it` is already set to `Only you`; the owner does not open the access picker.
4. The owner chooses a Project and Agent controls directly, or optionally applies an Agent profile,
   activates the Route, and sends a test message.
5. The flow never asks the owner to create a Team or grant themselves access.
6. Every step, including Automation editing and Advanced YAML, stays inside Paseo.

### New Member without access

1. Admin invites a Member without selecting a Team.
2. The Member accepts and signs in.
3. The Member sees Account but no managed Host, Project, usable Agent configuration, Automation, or
   Channel resource.
4. A message from a linked external identity is denied until access is assigned.

### Team access

1. Admin adds the Member to Engineering.
2. Engineering has Slack public-conversation access and Project Developer access limited to Codex,
   GPT-5.6, Medium or High Thinking, with Fast mode off.
3. The Member's Effective access shows both entries and the Agent-configuration limits with
   `Via Engineering`.
4. Removing the Member from Engineering removes both unless another Team or direct assignment
   supplies them.

### Channel interaction

1. A verified Slack identity sends a message in `#engineering`.
2. The public-conversation assignment covers that Conversation.
3. Hub starts or continues only the fixed Route target and synchronizes the configured events.
4. The Member can use this Route even without direct Project access, but cannot browse the Project,
   Files, Terminal, or run the target Automation directly.
5. The same sender in an unlisted private channel is denied without revealing the target Project.

### Public or customer Channel

1. The owner selects one customer Conversation or a set of current public Conversation IDs.
2. The owner changes Audience from Members with access to Anyone in selected conversations.
3. The review shows the fixed target, exact Conversations, mention rule, final-answer-only sync,
   exact preapproved tools, and abuse limits before activation.
4. A customer without a Hub account invokes the Route in an allowed Conversation.
5. The sender can converse with that Route but cannot browse Paseo, switch the target, see Project
   metadata, use a Terminal, read Files directly, or approve a tool request.
6. The same sender outside the selected Conversation is denied. Disabling the Route rejects new and
   follow-up messages, invalidates its bindings, and interrupts active Route-owned work.

### Automation authoring

1. The owner opens `Hub → Automations → Add automation` in Paseo.
2. The owner chooses a trigger, Project, Provider, Model, Thinking, Mode, and tool ceiling; Fast mode
   starts off.
3. Applying an Agent profile fills the controls but creates no profile dependency.
4. Validate reports compiler and Daemon capability issues without activating anything.
5. Activate records one complete revision, makes it active atomically, and shows it in Activity.
6. A run uses that exact revision even after a newer revision is activated.
7. The flow never opens the standalone Hub website or asks for an API key.

### Direct Paseo work

1. The Member signs in and selects an accessible managed Host.
2. The app obtains one access ticket for the real connection.
3. The Daemon exposes only allowed Projects, Agent configurations, and matching optional Agent
   profiles.
4. Developer access permits Terminal use and ordinary command approval.
5. A Mode that would exceed those approval actions is rejected or reduced to the authorized
   ceiling; destructive command approval is denied.
6. Fast mode remains unavailable until `agent.fast.use` is explicitly granted.

### Revocation

1. Admin removes the Member from Engineering.
2. Hub invalidates affected Channel policy and managed Daemon leases.
3. New Channel messages are denied.
4. Active Paseo sessions lose the removed Project and Terminal authority or close when no Daemon
   connection authority remains.
5. A pending approval response is denied under the new policy.
