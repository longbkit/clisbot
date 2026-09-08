# Unified client Hub configuration UI

Date: 2026-09-01. Updated: 2026-09-05. Status: MVP implementation in progress against the acceptance flows below;
the intentionally deferred items are listed in section 18. Scope: make
the existing Paseo app the only end-user UI for Hub account, Channel, Automation, Team, access, and
configuration management, without introducing a second app shell or a separate product-level Bot
entity.

The [September 5 Automation-first delivery](2026-09-05-automation-first-channel-configuration.md)
adds a first-class Automation destination and in-context Channel input/reply configuration. It
preserves direct Channel–Agent Routes and the existing Channel revision owner; it supersedes
the placement of Automation operation solely inside Settings, not the underlying access model.

This document is the UI companion to
[Unified Paseo client and Managed Access Lite](2026-08-31-unified-client-managed-access-lite.md).
That document owns connection admission, access tickets, daemon leases, revocation, and enforcement.
This document owns what users see, how they configure access, and how the Hub turns those choices
into the managed-access policy. Where the earlier audit describes a separate Bot resource or its
Phase-C UI, this document supersedes that part of the proposal.

### Delivery priorities recovered from recent sessions

The September 3, 14:27 UTC progress review in session `01a056a9-5728-74c0-b46d-bdbbcb0fe9e3`
contains the original P0/P1 list. The user authorized parallel completion at 15:36 UTC and
reaffirmed the complete user flow on September 5. Later requests prioritize Slack setup recovery
(September 4, session `01a06d31-0b32-7f20-8b1f-2ed9d9a76f83`) and enrollment automatically leading
to a usable Host and Project (September 4, 17:59 UTC, the first session). These are the scope
sources; an old progress claim is not verification of current code.

P0 means an account, authorization, activation, or reply failure prevents safe everyday use.
P1 completes the owner/member journey without manual repair or leaving Paseo. The rows below group
the original items by user outcome; section 20 remains the acceptance contract. “Implemented”
means code exists; release acceptance still requires the indicated integration evidence.

| Priority | User outcome                                   | Implementation and acceptance                                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | Owner setup and Member invitations             | Implemented: setup completion, copyable invitations, fresh Account form lifetimes, invalid-invitation recovery, and PKCE continuation. Embedded HTTP and mounted UI tests pass; native/Electron round trips remain a runtime gate.                                                                                                                                 |
| P0       | Safe Project access                            | Implemented: catalog controls, multiple Agent configurations, explicit paired Host grant, owner wildcard and zero-access Member defaults. Embedded tests cover additive Team/Member authority, delegation ceilings and revocation.                                                                                                                                 |
| P0       | Channel activation reports actual state        | Implemented: review, access selection, reconciliation, runtime errors/Retry, Automation-first owner defaults and preserved inline Automation replies. A live inbound-to-reply journey remains an acceptance gate.                                                                                                                                                  |
| P0       | Automation preserves output authority          | Implemented: native Mode and fixed Hub tool authority review, explicit reply outputs, Project-bounded files, cost review and legacy read-only definitions. Channel MCP, Hub outputs and relay share the existing durable output budget; public tool-path Routes remain rejected.                                                                                   |
| P0       | Managed-access compatibility and revocation    | Implemented: `off` retains ordinary Paseo behavior; external TCP/relay require tickets. Canonical enrollment revocation disables the Daemon before sweeping/notifying leases and closing its Hub socket. Lease admission holds a Daemon row lock until commit. Session/resource tests and embedded revocation pass; full device/transport journey remains pending. |
| P1       | Account and Host onboarding stays recoverable  | Implemented: Account is reachable without Hosts, caches/forms follow account identity, CLI approval has bounded discovery, sync errors expose Retry, and permitted online Hosts offer Add Project.                                                                                                                                                                 |
| P1       | Team/Member access can be reviewed and changed | Implemented: Team resource/privilege preview before invitation, Member/Team context links, in-place assignment editing, inherited access, resource “Who has access,” and published Public Routes overview. Custom grants and unchanged constraints survive edits; detached confirmations cannot write.                                                             |
| P1       | Channel setup leads to usable conversations    | Implemented: Conversation picker, profile application, draft-preserving inline Automation, identity link, Automation-first owner preset, seeded focused Route editor with Back/Cancel, remote direct-Agent reply URL, and inbound Activity. Mounted editor tests cover draft/constraint preservation and cancellation.                                             |
| P1       | Automations can be authored and operated       | Implemented: description, declared inputs, installed provider events, profiles, timeout/run controls, Route backlinks, and run/step Activity details with retry and output counts.                                                                                                                                                                                 |
| P1       | Hub configuration stays inside Paseo           | Implemented: Provider Applications (including operator-owned instance credentials), Connections, API keys, Telegram creation, CLI enrollment and managed Host disconnect. A separate undefined operator dashboard is superseded by this existing ownership.                                                                                                        |

Do not reopen accepted Channel Workflow migration, encrypted credential storage, or legacy Hub
Project removal merely because their historical audits listed gaps. Key rotation, a shared Slack
transport across independent trigger/channel consumers, and unsupported advanced transport options
remain the separately documented non-blocking work unless a required flow demonstrates a blocker.
Do not introduce organization switching, custom roles, a second access graph, or a second app shell.

Release acceptance is still open for the complete owner/member journey on iOS, Android and packaged
Electron, and the live provider-inbound → selected target → reply journey together with direct/relay
reconnect and revocation. Native simulator/device and packaged Electron runs were not exercised in
this Linux workspace. Shared React tests, embedded DB tests, and socket-adapter tests are evidence for their
layers; they are not substitutes for those platform runs. No P0 release gate is marked complete on
that basis. PostgreSQL lock contention was not exercised on a separate PostgreSQL server; the embedded
regression checks canonical request, status, and revocation order.

Existing responsive Settings limitation (verified 2026-09-05): resizing across the compact breakpoint
remounts the detail subtree because upstream `SettingsScreen` renders separate compact and desktop
branches. An unsaved Route draft or Activity selection can therefore reset during that transition.
The Activity/dialog pass verifies each viewport and preserves drafts when canceling confirmation;
it does not fix this preexisting transition. A future shared Settings change should keep one stable
detail subtree across layouts, rather than add a second Channel draft cache.

### 2026-09-05 flow completion pass

Account now includes the shared Hosts section. Owners and administrators without a Host receive
the CLI enrollment command; Members without access are directed to their organization administrator.
Online Hosts expose Add project only with daemon management authority; Project-scoped Members open
the existing Host. Offline and failed connections retain their actual status and link to Paseo's
Connections settings.
The section has one Refresh Hosts action. A refresh error stays visible beside cached Hosts until
retry succeeds; the initial loading/error state never presents an empty organization. Binding/upsert
and restart failures also appear on the affected Host with Retry; leaving an account removes that
account's ephemeral failure state.

The September 5 sandbox follow-up exposed a dev runtime gap: Vite served Hub HTTP but did not forward
daemon WebSocket upgrades. The daemon remained `reconnecting` with a handshake timeout, so enrollment
did not complete the connection/publication flow. A dev-only adapter now loads the same TanStack SSR
entry for `/api/daemons/socket`; readiness verifies the unauthenticated 401 boundary. Live checks
confirmed sandbox reconnecting to Hub with no error and a relay client reaching the same server as
the local client. This does not establish the user's separate browser state. Missing connection
details now produce Offline or Waiting for connection with recovery guidance in both Account Hosts
and Configuration; Registering is reserved for an available offer being added to the Host registry.

CLI approval starts with a fresh daemon catalog, scopes each attempt to its account, organization,
and verification code, and ignores stale responses after leaving the form. Host discovery stops
after one minute with Retry and Open Hosts actions. Re-enrolling an existing daemon does not label
an unrelated existing Host as newly enrolled.

First-party OAuth and invitation links enter Settings Account after runtime bootstrap. Their
authorization parameters survive that navigation and resume through the Hub authorization endpoint
after account and invitation gates are satisfied. Invalid invitations block continuation; successful
acceptance removes only the consumed invitation parameter, preserving PKCE. Hub remains responsible for validating client,
redirect URI, scope, and PKCE. Both Provider Application setup and Configuration's Connect account
entry use the same browser-continuation recovery. Retrying reopens the existing attempt without
resubmitting credentials. Recognized callback results refresh authenticated Connection records;
inventory refresh failures remain visible and can be retried without replaying the setup write.

Hub resource caches include the account identity and do not show the previous account's data while
the new account loads. The UI continues to use shared React Native components, Paseo settings
primitives, and theme tokens. Hub UI lives under `clisbot/hub`; app layout and Settings retain small
mount/cache/navigation seams. The existing Settings ScrollViews provide a scroll-to-top callback
through a Clisbot-owned context so the focused Route editor opens visibly on compact and desktop
layouts, using the same React Native API. Hub backend changes reuse enrollment, access leases, audit events and
output accounting. They add no daemon RPC or wire contract.

For older Hub setup responses that omit `appSetupRequired.membership`, the client derives it from
the single matching organization entry in `memberships`. Missing, ambiguous, or contradictory
membership data is rejected. This HTTP-only compatibility normalization has a tagged removal gate;
it does not infer a role from the instance-operator flag. Normalization stays within the setup state;
other account-state schemas remain unchanged.

Validation includes the CLI form lifecycle, account-entry navigation readiness, account-scoped
query transitions, Host state/authority projection, provider continuation and callback recovery,
and the real embedded PGlite browser-claim HTTP integration. The dev browser rendered Account and
an actionable failed sign-in at desktop and 390px widths. Native iOS/Android and packaged Electron
were not exercised in this pass; shared code and typechecking do not replace that runtime proof.
The dev browser also verified that leaving/reopening Account clears the visible credential draft.
The Tailscale dev proxy now forwards `/mcp` and `/agent-executions` to Hub; a POST with an invalid
Channel capability reaches Hub and is rejected with 401 rather than receiving Expo HTML. This proves
routing and the rejection path, not a successful provider send.

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
Account, where Sign out remains available. There is no organization switcher in the first version.

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
- **Provider Application** is one provider-side app registration, such as one Slack App or GitHub
  App.
- **Connection** is one organization installation/account and the canonical encrypted credential
  owner, such as a Slack App installed in one workspace.
- **Channel account** is the conversational behavior configured for one Connection, such as the
  Routes and reply policy enabled for a Slack workspace or Telegram account.
- **Channel identity** is a verified external-user identity mapped to a Member within one provider
  Connection.
- **Conversation** is a DM, channel, group, thread, or topic handled by a Channel account.
- **Audience** says who may invoke a Route. Conversation visibility says where the Conversation
  exists; it does not decide the Audience.
- **External participant** is a provider sender invoking an explicitly exposed Route without acting
  as a Hub Member. It is not a guest account and receives no general Hub or Paseo access.
- **Route** selects which fixed Agent configuration or Automation handles a matching Conversation
  and, when configured, matching message text.
- **Automation** is the Paseo UI name for one organization-owned Trigger/Workflow definition and
  its immutable revisions.
- **Agent configuration** is the resolved Agent controls used to start work: Provider, Model, Mode,
  Thinking, feature values such as Fast mode, and provider options.
- **Agent profile**, **Agent session**, **Project**, **Workspace**, **Host**, and **Daemon** keep
  their existing Paseo meanings.

There is no separate product entity named `Bot`.

A Telegram bot token or Slack app is represented by its Channel account. What it does is represented
by Routes. Who may use it is represented by Channel access. The target behavior is an Agent
configuration in a Project, or an Automation. Another product object between those concepts would
duplicate their ownership without adding a user-visible capability.

The requested “access by bot” maps to Channel-account access. Two Telegram bot Connections normally
have two Channel accounts. Two Slack App installations in the same workspace are distinct
Connections and may each have Channel behavior. When one Channel account has several ordered
Routes, its Member/Team Conversation access applies to the matching Member Routes; an open Audience
remains an explicit per-Route choice.

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
- Provider Applications and organization Connections, including multiple Applications per provider,
  multiple Connections per Application, GitHub's existing installation/repository selection, and
  encrypted credential envelopes whose master key remains outside the database.
- Organization-owned Channel configuration revisions. Each revision stores an ordered
  `HubBundleFile[]` in the Hub database: `.paseo/hub.yml`, Channel policy, and Channel-account YAML
  are serialized configuration documents, not temporary files on disk.
- Channel accounts reference a canonical `connectionId`. Provider credentials live only in their
  encrypted Application or Connection owner; Channel revision YAML contains no token or secret
  reference.
- The Channel control plane's accounts, ordered Routes, inheritance, transport state, provider
  adapters, direct `agent + environment` targets, and organization Workflow targets. One account
  can use direct Agent and Workflow targets on different Routes.
- `hub.yml` already carries the complete direct-Agent definition required for the current Channel
  runtime: Provider, optional Model, Mode, Thinking option and provider options. Its daemon
  Environment carries `daemon`, `cwd`, and optional worktree configuration. The existing resolver
  converts those named records into the daemon create-Agent request.
- Direct Agent and Workflow paths now pass the same Channel admission rules: sender authority,
  mention requirement, follow-up mode, idle TTL, and existing-binding state.
- Channel revision deployment compiles candidate `hub.yml` first and validates Channel Agent,
  Environment, and enabled organization Workflow references against that same candidate before
  writing the revision.
- Its dotted privilege matching and provider-neutral approval classification.
- Its ability to evaluate an unmapped channel sender as a raw principal and apply Route default
  roles. This is the narrow implementation seam for public participation; it is not yet a safe
  public-access product flow.
- Stable Paseo Project IDs and the Daemon's existing Provider, Model, Thinking, feature, and Agent
  profile catalogs.
- The daemon's `SessionAdmission`, `SessionAuthorization`, semantic permissions, live permission
  replacement, and Hub service-principal relationship.
- Organization-owned Triggers, one self-contained YAML document per Trigger, immutable revisions,
  atomic per-Trigger activation, durable execution, and Activity.
- A new Trigger has one `run` with an explicit Daemon, absolute `cwd`, Provider, Mode, optional
  Model, Thinking and provider options. The Hub-to-Daemon execution protocol already carries those
  Agent controls and optional feature values.
- Organization Workflow runs, Agent executions, and launch intents retain the owning Workflow ID
  and revision. The Channel Workflow path does not create or consult a synthetic runtime Project.

No Hub frontend is inherited. The Hub website's React pages, routes, dashboard shell, components,
and client state are behavior references only. Every end-user Hub management screen is implemented
as new Paseo client code under `packages/app/src/clisbot/hub/**`, using Paseo navigation and design
patterns while calling the retained Hub backend.

The implemented baseline includes Team and invitation management, verified Channel-identity
self-linking, Team/direct Access, Provider Application and Connection setup, guarded disconnect with
consumer projection, structured Channel and Automation editors, Advanced YAML, immutable revision
history, Channel test/retry, Automation Manual Run and Activity, managed Host discovery, and
owner-first setup. These surfaces use one management API and the existing Hub domain stores; they do
not introduce another configuration source.

Route matching supports Conversation kind, exact IDs, and an optional literal text condition.
Candidate activation validates Agent, Environment, Project, enabled Automation, Connection, and
open-audience invariants before writing a revision. Reconciliation then restarts enabled Channel
accounts from that exact snapshot and exposes per-account failure/retry state.

The remaining items are deliberate follow-ups, not hidden MVP dependencies: provider-wide inbound
transport multiplexing when one streaming Connection independently feeds Channel runtime and event
Automations; fanout of one message to several targets with per-target idempotency; stable authored
Automation-ID references; regex/expression routing; custom roles; multi-Team invitation; and
runtime metadata for safely classifying daemon-local custom Modes. A Channel Route that invokes an
Automation already shares its Channel-account transport and is unaffected by the multiplexer item.

## 4. Organization roles and resource access

Organization roles control Hub administration. They do not automatically grant access to Channels,
Daemons, Projects, or Automations.

The canonical permission inventory, including whether each name was retained, added, or extended,
is in section 4 of
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
      kind: "channel_account";
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

Account's Hosts list exposes **Rename** to organization Owners/Admins through the unified
management API, delegating normalization, organization scoping, and duplicate-name checks to the
existing Hub daemon rename owner. This changes the shared daemon slug, not the local Appearance
alias. Host management metadata remembers the last shared slug so ordinary labels follow a rename
without reconnecting, while user-chosen local labels are retained.

Add project checks the selected Host's advertised `workspace.manage` permission before opening
filesystem or clone steps. Missing permission is reported immediately; older daemons without the
optional permission projection continue to rely on backend enforcement. A denied action on a
visible Project/resource reports `access_denied`; foreign or unknown resources remain hidden as
`resource_not_found`. User messages omit protocol request names and error codes.

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
scoped by provider Connection so the same Slack user ID in two workspaces is not treated as one
identity, while removing and recreating Channel behavior over the same Connection does not destroy
the verified mapping.

```ts
interface ChannelIdentity {
  id: string;
  organizationId: string;
  membershipId: string;
  connectionId: string;
  externalSubjectId: string;
  displayName?: string;
  verifiedAt: string;
}
```

The unique identity key is:

```text
organizationId + connectionId + externalSubjectId
```

Only verified identities are stored as Channel identities. A short-lived verification challenge
owns the pending state. An attempt to claim an identity already linked to another Member returns a
clear conflict error; it does not create a persistent `conflict` identity state. Connection health
is displayed on the Connection/Channel account, not copied onto each identity.

### Link identity

1. Choose a Channel account; Paseo resolves its provider Connection.
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

The invitation flow adds one optional Team selection after organization role, reusing BetterAuth's
existing invitation `teamId`. Nothing is selected by default. The review shows that Team and its
current assignment count before the invitation is sent. Add a Member to further Teams after they
accept; the MVP does not add a second invitation-to-Teams relation.

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

Reuse the Hub Provider Application and Connection backend, but keep behavior separate from
credentials:

```text
Provider Application
  → one or more organization Connections/installations
      → optional Channel account behavior
      → optional Automation event sources
```

An Application owns provider-app registration and runtime credentials. A Connection owns one
organization installation/account and its encrypted credential. A Channel account owns only
conversational behavior and references the Connection by `connectionId`. It never owns or copies a
token. Token-native providers such as Telegram may use a provider-specific encrypted Connection
without inventing a generic Application merely for symmetry.

The current backend supports multiple Applications per provider and multiple Connections per
Application. GitHub keeps its existing App installation and repository-selection flow. The same
Connection may be used by Channel behavior and an Automation source; consumers must not create
credential copies. Sharing one physical provider transport between both consumers remains a
runtime concern, not a reason to split the credential model.

The target runtime has one Application-owned inbound transport fan out normalized events to Channel
and Automation consumers. Until a provider implements that multiplexer, Paseo must prevent enabling
the same streaming Connection as two independent transport owners and explain the conflict. This
does not affect multiple ordered direct-Agent/Workflow Routes inside one Channel account: they share
the Channel account's single inbound transport.

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
  Used by Channels and Automations

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
destructive confirmation. Replacing either a Connection credential or its Provider Application
credential keeps stable resource identity and immediately restarts every active Channel account in
the active organization that consumes it, so runtime cannot continue using the old credential while
the UI shows the new one.

`Remove Channel account` disables and removes the conversational configuration, Routes, and
running Channel handle; it is not the same operation as disconnecting the provider installation.
If no other Channel or Automation uses the Connection, the confirmation defaults
`Also disconnect provider account` to on. If the Connection is shared, the UI keeps it, names its
remaining consumers, preserves verified identities scoped to that Connection, and does not offer a
misleading destructive shortcut.

`Disconnect provider account` lives on the Connection. It first lists every Channel and Automation
consumer. The administrator must remove, disable, or move those consumers before the credential is
revoked, so no active configuration is left pointing at a deleted Connection.
Disconnecting also invalidates its Channel identity mappings because their provider scope can no
longer be verified.

The consumer list is one backend read model over two authoritative sources: `connectionId` values
in the active organization Channel revision and resolved Connection references in active
organization Trigger revisions. Removal and disconnect validation use that same resolver; the UI
must not infer usage from whichever list happens to be loaded.

### Add channel

Channels opens with the configured accounts. Selecting an account opens its Routes and runtime
actions. `Add Channel account` starts account setup; `Add Route` starts a new Route for the selected
account, and editing an existing Route opens that Route alone. Creation and edit forms replace the
overview while open. Their action labels describe the job being saved, and Cancel returns without
writing. After activation succeeds, the editor closes and the configured account is selected;
inventory refresh or Team-access follow-up errors are reported without presenting the completed
create form for resubmission.

New Routes use `Activate Route`; edits use `Save Route`. New replies default to a thread, while
editing preserves the stored reply anchor, including the legacy provider default. Reply choices
are labeled `Text forward` and `Use Channel tool`; these labels retain the existing relay/tool
configuration values and output ownership.

Account and Route secondary actions use Paseo's shared overflow menu. Route reorder arrows retain
explicit accessible names. `Who can use this?` reveals existing access and neutral `Your Channel
identities` navigation; provider Connection details describe the connected credential, not a Member
grant or proof that the current user has linked an identity.

`Who can use this?` is also where `access.dmPolicy: pairing` is decided. The queue behind
`GET channel-accounts/:channel/:account/pairing` is a decision list, not a notification feed: a
stranger who direct-messages a paired account is shown a short code and parked, and an operator
approving them is what grants access. So the code leads every row — it is the only way to tell one
waiting stranger from another — waiting rows sort first, and a decided row keeps its decision and
offers no action, because a denial is final on the Hub. A 404 reads as "this Hub has no pairing
queue" rather than "nobody is waiting".

Provider Connection creation is opened explicitly from account setup when needed. It reuses the
existing Connection form and preserves the surrounding account draft. A second always-open
`Add Connection` form is not part of the Channels overview. `Advanced YAML` starts collapsed and is
available outside the focused editor; it still edits the same complete revisioned configuration.
Opening it shows a multiline editor using Paseo's shared input and monospace token, with bounded
internal scrolling. The normal scope hint replaces a warning panel; validation and activation errors
remain beside the draft. The plain form model belongs to the signed-in Channels screen, so collapsing
the editor or opening Activity or a Route form preserves unsaved YAML. Account changes clear that
local lifetime. A newer active revision preserves a dirty draft but blocks activation until the user
explicitly discards it and reloads; a clean draft follows the new revision. Editing invalidates prior
validation, and delayed validation results cannot mark a newer draft valid. Validate writes nothing;
Activate still submits all three roots (`resource`, `policy`, and `accounts`) through the existing
backend validation and expected-revision replacement.

Adding a Channel account is one full-page flow because it combines external verification and Route
configuration:

1. **Connection:** choose an existing Connection or connect and verify a new provider account.
2. **Where:** choose the first Conversation scope: one or more exact Conversations, direct
   messages, public Conversations, or all Conversations when policy permits it.
3. **When:** choose `Every eligible message` or `Message contains…`. This is Route selection, not an
   Automation input.
4. **What should happen:** show `Run an Automation` first, then
   `Start or continue an Agent`. Automation is the recommended bounded path, but direct Agent work
   remains available for an open-ended conversation.
5. **Target:** choose an existing Automation or create one using the normal Automation form. For a
   direct Agent, choose the Project, Workspace behavior, Provider, Model, Thinking, Mode, optional
   feature values such as Fast mode, provider settings, and optional Agent profile shortcut.
6. **Access and replies:** review `Who can use it`, Team assignments, reply synchronization,
   Channel actions, tool approvals, output roots, and limits. A confirmed single-member organization
   whose member is the signed-in owner displays `Only you`; otherwise the default is
   `Members with access` and no Team is selected. This label does not create or change a grant.
7. **Review and activate:** show the Connection, ordered Route, fixed target, Audience, cost and
   security safeguards, then validate, activate, reconcile runtime, and offer a real test message.

For a new Channel account with no existing direct or Team grants, `Members with access` initially
allows only organization owners. Existing grants remain effective when editing an account. For
`Anyone in selected conversations`, the explicit Route Audience admits participants under the
open-audience safeguards below. The Channel account may be saved as disabled before a Route is
complete.

When the provider proves the installing user's identity, setup offers to link it to the signed-in
owner automatically. Telegram setup presents the one-time link command before the final test. A
one-owner organization therefore needs no separate Team or Access setup before testing the Route.

`Running` reports that the provider transport has started. Route selection, sender identity and
access, mention rules, and execution limits are separate admission checks. A matched Route with
`sender may not trigger this route` has received the message but denied sender access; restarting
a Running account is not evidence that access has been repaired. Review the verified provider
identity in Account and the Channel account's existing access in Manage access. Linking an identity
does not grant new privileges, and `Only you` does not bypass identity verification. Use inbound
Activity to verify admission; a successful outbound test reply does not prove sender eligibility.

Channels separates four views. `Accounts` is the canonical Route editor; `Catalog` is setup and
capability discovery; `Operations` is the durable ingress queue; `Activity` is inbound admission.
Activity shows up to 25 inbound events per page, with account, Route position, and outcome filters,
explicit Older/Newer navigation, and Refresh. Opening one event reveals its Conversation, sender, admission result, and recovery actions;
the list does not repeat full warning panels. Returning from details preserves the filters and page.
The Hub uses an organization-scoped timestamp/ID cursor and indexed audit queries rather than loading
the full event history. Failed page requests retain the last loaded page with an explicit retry state.
Historical account IDs and Route positions remain audit facts when current configuration changes;
they do not identify the current Route at the same position.

New denied Activity entries distinguish an unlinked sender from a linked Member who lacks access
to that conversation. When the account still has an eligible current Connection, `Link my identity`
opens the existing Account identity form with that Connection selected. An event does not prove which
Connection an account uses today; removed accounts must not fall back to another Connection. The user
copies its one-use command and sends it through the provider to prove ownership; opening the form creates no identity
or access grant. After verification, send a new message because ignored messages are not replayed.
`Manage access` handles missing Member or Team grants. Older generic denial entries offer both
checks without claiming which prerequisite failed. Explicit open-audience Routes retain their
separate admission rules.

Optional Provider Application setup does not block linking an existing Channel Connection.
Account shows `Your Channel identities` for both authenticated `appSetupRequired` and `active`
Members, and a Connection-prefilled identity link opens in either state. Both states have the normal
Account and Hosts view; the app removes the redundant `Finish setup` action. Optional Provider
Applications remain under Hub Configuration. Identity reads and one-use challenges still use the
current membership and the Connection's server-reported linking permission. Opening Account does
not post setup completion, install credentials, or grant access.

The Hub retains its existing setup status, completion endpoint, and persisted flag for compatibility.
Its setup response now includes the same authorized Team, organization-creation, and invitation
facts as an active response, so an unfinished optional step cannot hide pending invitations.
These additive HTTP fields remain optional for older Hub responses; unknown Team data is not an
empty Team or proof of a sole owner. Password, organization-selection, and invitation gates remain
enforced. Regression coverage includes a setup-pending owner with an existing Slack Connection,
the real Account-to-identity form, pending invitations, and legacy responses without the new facts.

### Catalog and capabilities

`Channels → Catalog` lists every channel the build knows, whether or not an account exists for it:
its prerequisites, its transports and what each one requires, its channel-specific tools, the health
of each configured account, and its capability matrix.

The Hub owns the catalog (`packages/hub/src/channels/catalog.ts`) and publishes it at
`GET channel-catalog` behind `channel.manage`. `packages/app/src/clisbot/hub/channel-catalog.ts` is
the client model over that read and carries no catalog of its own: the load state the setup surfaces
render, and the derivations that need one served entry and nothing else. Every channel surface reads
it through `useChannelCatalog`, which holds one cache entry for five minutes because the catalog
changes only when the Hub is upgraded.

Three answers, three states. Pending is `loading`. The management API's unknown-route 404 is
`unavailable` — "the catalog is not available on this Hub, update it" — and never an empty catalog,
which would read as "no channels exist". Anything else is `error` carrying the Hub's own message.
The contract keeps channel ids, capability names and tool names open strings so a newer Hub's
vocabulary cannot fail the page's parse; `channel-catalog.fixture.ts` is a captured response the
contract tests parse, not a mirror to drift from.

A channel whose `status` is `planned` is shown as coming and cannot be connected. A channel with
accounts that the catalog does not carry is listed after the catalog, with its accounts and queue
intact and no setup guidance — neither an unavailable catalog nor a channel the Hub runs without
publishing makes its own accounts invisible.

Account health joins three reads: the authored account, its `channel-accounts/status` row
(transport state, `detail`, and the per-account `ingress` counts), and the `connections` entry the
account references, which is where the provider identity lives. The status row carries no identity,
so an account whose Connection cannot be resolved reports that rather than guessing.

The capability matrix reports five states: Available, Needs setup, Restricted, Unsupported, and Not
verified. The inputs are the catalog's capability list, the catalog's own narrowing notes, and the
account's transport state. There is no per-capability evidence anywhere in the Hub contract, so a
running account's capability is `Not verified`, never `Available`: the catalog is a claim, and a
claim rendered as a green check is a UI that lies. `Available` is reachable only from a `verified`
set the derivation already accepts and no Hub sends yet. `Restricted` restates a catalog note —
Google Chat and Feishu receive card clicks but render no card, Zalo's media is inbound images only,
Discord's slash commands and interaction callbacks are not wired.

### Connecting a channel

`Connect` opens the catalog-driven credential form. Two contracts meet in it and they are not the
same list: the catalog names a channel's credential and explains it, while `POST connections` is
`.strict()` about which keys it accepts. Telegram's catalog entry carries `webhookUrl` and
`webhookSecret`; its Connection credential is a bot token alone. Discord's config key is `token` and
its Connection field is `botToken`. So `CONNECTION_SHAPES` in
`channel-connection-form.ts` is the request contract — the credential shape and the fields per
channel — and the served catalog entry supplies each field's label, help and transports.

This is the app's only Add-connection surface. `AddChannelConnection` picks the channel and mounts
the same form, and the Channels accounts editor, the Catalog view and Hub Configuration settings all
go through it. A channel becomes connectable everywhere at once the moment the Hub's catalog carries
it and `CONNECTION_SHAPES` knows its body. Slack Socket Mode is created from a Provider Application,
which only an instance operator administers, so it is offered only to one; the accounts editor is
otherwise open to every channel the Hub runs.

Four credential shapes and one login: a single secret (Telegram, Discord, Zalo Official Bot), a
field set (Feishu: app id, app secret, and the verification token and encrypt key its webhook
transport requires), a service-account document pasted or named as a path on the daemon host
(Google Chat), the existing Slack Socket Mode pair, and a QR login (Zalo Personal). Transport choice
drives which fields are required rather than adding fields the Hub would reject; the account's
transport itself is authored on the account, not the Connection.

Guided validation restates the rules the Hub enforces — the `xapp-`/`xoxb-` prefixes, the Zalo
webhook secret's 8–256 bounds, the 128-character account name, and that a pasted service account is
JSON whose `type` is `service_account`. The Hub remains authoritative; these only save a round trip.
Its answers become guidance: `connection_unavailable` at 422 is "the provider rejected this
credential", at 502 "the provider could not be reached, the credential may be fine, try again". A
404 is "this Hub does not ship this channel". Secret values never reach rendered state — the form
model publishes `filled`, not the value, and only the request builder reads them.

Zalo Personal is the only QR channel today, and the path
(`channel-accounts/:channel/:accountId/qr/:verb`) is not shaped around it. Its five verbs
(`packages/channels/zalouser/HUB-WIRING.md` §7) are non-blocking and the app polls: start or relink
shows a code, a poll answers pending, linked or failed, and the code expires after about three
minutes. A `failed` whose message is about expiry means generate a new one, and relink is routine
rather than an error — a personal session dies for ordinary reasons.

The panel learns what the Hub can do from the answers, not from a build-time flag. A 404 settles it
in the terminal `unavailable` phase, which offers no action because upgrading the Hub is the only
fix. A 503 is the channel runtime being down right now, so it settles as an ordinary failure and
leaves `Show QR code` on offer. `needs-login` on a `channel-accounts/status` row is the only signal
that an account is waiting to be linked, so that row's `Link with QR` action is where an operator
starts — the Catalog view is for discovery, the account row is where the work is.

### Ingress operations

`Channels → Operations` is the durable queue's operator surface over `channel-ingress`: depth per
account with the oldest pending age and blocked-lane count, the dead-letter list, resubmit, prune,
and refresh. Dead letters are the Hub's redacted rows — ids, counts, timestamps and failure text,
never the payload — and the app names the fields a row may render so a later contract addition
cannot leak a message body into the list.

Resubmit only ever sends dead-lettered ids, because that is all the Hub reopens; sending a completed
row's id is a request that does nothing, which reads as a broken button. Prune confirms
destructively and states what it deletes: completed and dead-lettered rows past the Hub's retention
window, never pending or in-flight work. Both operations need the `channel.manage` authority, and a
404 from the endpoint is rendered as "not available on this Hub" rather than an error.

### Routes

A Route combines three facts:

```text
where a message arrived and optional text required to select it
+ which Project and Agent configuration, or Automation, handles it
+ synchronization and approval behavior
```

Routes are ordered and the first matching Route wins. A match always has a Conversation kind, may
limit stable provider Conversation IDs, and may add one literal `contains` string. The MVP does not
add regex, a visual expression builder, or fanout.

```yaml
routes:
  - match:
      kind: channel
      ids: [C_SUPPORT]
      contains: "#triage"
    workflow: support-triage
  - match:
      kind: channel
      ids: [C_SUPPORT]
    agent: support-agent
    environment: production
```

In this example a new `#triage` message runs the Automation; another eligible message starts or
continues the direct Agent. `contains` is a non-empty, case-sensitive literal substring of the
normalized `InboundMessage.text`; matching does not trim, case-fold, remove the marker, or mutate the
text delivered to the selected target. The UI labels it `Contains exact text`. Route ordering is
visible and reorderable. A Route without `contains` is the catch-all for that Conversation scope and
belongs after more specific Routes.

An existing direct thread/Conversation binding continues its already selected Agent session after
the normal follow-up checks; later message text does not silently switch that live session to an
Automation. Text matching selects a target when no direct binding owns the inbound. This uses the
current durable binding and Agent ID; it does not introduce a product-visible `routeId`. Changing a
target or its security policy invalidates affected bindings before the new revision is used.

Admission must capture the active Channel revision and selected Route position in the existing
binding or Workflow event context. Restart reattachment, output delivery, and approval callbacks do
not carry the original message text and therefore must use that captured immutable selection rather
than run `contains` again with missing text. The revision-plus-position pair is an internal pointer
inside an immutable revision, not a durable Route resource. If that revision is no longer active,
the continuation is accepted only when reconciliation retained an equivalent target/security
ceiling; otherwise it is invalidated and current authorization is rechecked.

For an Automation target, each accepted inbound creates a durable Automation run. The optional
Workflow `reuse: binding` setting may reuse its Agent across those runs, but Route selection and
Agent reuse remain separate decisions.

`parseInvocation(payload.text, workflow.inputs)` runs only after an Automation Route has been
selected. It parses leading declared `name=value` values such as
`priority=high investigate` into Automation inputs. It neither chooses between direct Agent and
Automation nor replaces Route `contains` matching.

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

The structured form keeps the current wire/configuration contract. `hub.yml` stores named Agent and
Environment records; the Channel account file stores `agent + environment` or `workflow`:

```yaml
# .paseo/hub.yml, serialized inside the active Channel DB revision
environments:
  production:
    kind: daemon
    daemon: sandbox
    cwd: /work/support
agents:
  support-agent:
    provider: codex
    model: gpt-5.6
    mode: default
    thinkingOptionId: high
    options: {}
```

The names are serialization references, not a new product entity. Paseo resolves them into the
Project and Agent form. A newly configured direct Route creates or reuses those records; editing one
Route uses copy-on-write when a named Agent or Environment is shared, so it cannot silently change
other Routes. Advanced YAML may deliberately edit shared records and must show every affected
consumer before activation.

Workspace behavior reuses the existing Environment choices: use the Project folder, branch into a
new isolated worktree, check out an existing branch, or check out a pull request. `Use Project
folder` is the one-owner default. The UI writes the existing Environment `worktree` shape rather
than inventing a second Workspace model.

The direct-Agent representation includes additive `featureValues` in both Hub Agent schemas and
passes it through `createChannelAgentSpecResolver()`. Fast mode uses
`featureValues.fast_mode` and the `agent.fast.use` check. Provider, Model, Mode, Thinking, provider
options, daemon, cwd, and worktree retain their existing shapes.

The Route editor reuses the current interaction, binding, reply, outbound, synchronization, and
approval settings. It shows the effective compiled value beside any inherited value so the user
does not need to read several YAML files to understand the result.

The `Reply method` labels are `Text forward` and `Use Channel tool`. `Text forward` uses the existing
`outbound.path: relay` behavior; `Use Channel tool` uses `outbound.path: tool`. The display names do
not change stored configuration or the provider transport. New Routes default `Reply in a thread`
to on. Editing preserves an existing explicit or omitted legacy reply anchor rather than silently
changing its behavior.

The tool
capability is generated from the fixed Route and target Project: it preapproves text replies and,
when an absolute Project root is available, file sending to the invoking Conversation. Review shows
this authority separately from native Provider Mode. No arbitrary MCP tool-policy or file-root
editor exists; authored Agent `toolPolicy` remains rejected by the compiler.

Files must remain inside the Project root after resolving symlinks. The current upload runs in the
Hub process, so the Hub must be able to access that Project folder; remote Daemon file transfer is
not implemented. Open Audience requires automatic final-text replies; the compiler rejects a tool
reply path. Workflow tool sends reserve the same durable output budget as Hub output tools and relay
delivery; a file and its optional separately posted caption consume separate sends. Member direct
Agent Routes retain their existing tool behavior without an Automation output budget. Provider-native actions such as
reactions, polls, edits, or pins appear only after the Hub action broker and in-repo vertical support
them. They are Route behavior and do not grant direct Project or Automation access.

Changing a Route target shows the old and new Project, Agent controls, tool ceiling, and cost impact
before activation. It does not silently create direct Project or Automation access for any Team. An
open-audience Route requires a fresh safeguard review, and any target change invalidates the
Route's active Conversation bindings.

Saving first compiles the complete candidate `HubBundleFile[]`, including candidate `hub.yml`, then
validates every Channel Agent, Environment, Workflow, Connection, policy, and Route reference against
that same candidate. Only a valid candidate becomes a new immutable active DB revision.

Activation and runtime application are two observable outcomes because a database commit and an
external provider transport cannot be one transaction. After activation, the MVP restarts every
enabled Channel account from the new snapshot, stops disabled or removed accounts, and reports the
status of each account. Restarting all enabled accounts is intentionally simpler and safer than a
configuration-fingerprint diff while edits are infrequent. A start failure leaves the valid
revision active, marks the account `Runtime error`, and offers Retry; the UI must not report the
account as applied merely because the revision was saved.

Ordered alternative Routes already support direct Agent and Automation behavior in one account.
Sending one inbound message to several targets is deferred together with the per-target idempotency
needed to make that fanout safe. Current Workflow-name references are acceptable for the MVP:
dispatch resolves the enabled Workflow by name and persists its stable ID and exact revision on the
accepted event. A later stable-ID authoring reference is a low-risk rename improvement, not an MVP
blocker.

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

Team/Member access assignments may use all four scopes. An open Audience is stricter: it must name
at least one exact Conversation ID, including for DMs, and group/shared/public conversations must
also require a mention. This prevents a public entry point from silently expanding to future or
unknown Conversations. The observed-Conversation picker supplies known IDs and the form always
retains manual ID entry for a Conversation the Hub has not observed yet. The shared Channels and
Access selector shows each selected name alongside its canonical ID, supports multiple selections,
and accepts comma-separated or newline-separated IDs through an explicit ID editor. Available
configured-destination metadata enriches the same picker without changing its values. Route scope is
explicit: `Any matching conversation` preserves existing wildcard configurations, while `Selected conversations`
requires at least one ID. Removing the last selected ID leaves that scope specific and blocks saving;
it never silently broadens a Route or Access assignment.

Configured destinations can also show provider metadata from Slack `conversations.info` or Telegram
`getChat`, using the current account's Connection. These optional read-only lookups enrich authored
IDs rather than enumerate a provider directory. They use an already-started account; unavailable
vertical support or a stopped runtime retains IDs without starting or reauthorizing the Connection.
A rebuildable cache is scoped to the organization,
Connection, and credential configuration, with 256 entries per provider namespace, a 15-minute
positive lifetime, and a 60-second negative lifetime. One response includes at most 200 configured
destinations and spends at most 20 uncached lookups, four at a time; cached results do not consume that
budget. Permission, rate-limit, missing-name, or network failures retain the raw ID. Known thread or
topic parents may show their Conversation name; unobserved parents and unavailable topic names are
not guessed. A nested ID observed under multiple parents shows the raw ID and an ambiguity hint,
without implying that one parent name uniquely identifies its scope. Names do not change matching,
routing, or access authority.

`Send test message` first obtains a read-only preview of the exact canonical text and destination,
showing available names alongside raw IDs, reply/thread placement, and the absence of attachments.
The confirmation separates `Send to` from `Message to send`. Only the exact preview text appears in
the message block; destination details and explanatory notes stay outside it. The screen-scoped
confirmation accepts this structured body while ordinary confirmations retain their text message.
On compact screens, detailed confirmations open taller so the canonical short message is visible
initially; long content scrolls independently of the action buttons.
Confirmation submits the preview fingerprint, text, and revision. A changed destination, Connection,
configuration revision, or unapplied runtime revision is rejected before sending. Older clients retain
the existing test endpoint; the app requires a preview-capable Hub before offering this send action.
This outbound test does not start an Agent or Automation and does not prove inbound sender access.

Channel accounts have one built-in user access level:

- `Use` grants `channel.use` for the fixed Route in the assigned Conversations.
  It does not grant direct access to the target Project or Automation.

## 11. Channel authorization

When a message arrives from Slack, Telegram, or another provider, Hub evaluates:

```text
1. Which Channel account received it?
2. Does an active direct binding already own this Conversation/thread?
3. Otherwise, which first ordered Route matches its Conversation and optional text condition?
4. Is the sender a verified Hub Member?
5a. Member Route: does owner, Team, or direct Channel access cover this Conversation?
5b. Open-audience Route: does its Audience cover this participant and Conversation?
6. Do mention, follow-up, idle, message-type, approval, and output rules admit this event?
7. Does the request fit the Route's execution, abuse, and cost limits?
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

Selecting an open Audience starts from a conservative preset:

- Specific Conversation IDs rather than a future-expanding scope.
- Mention or command required for group, shared, and public Conversations.
- Final-answer-only synchronization and text replies only.
- Fast mode off, conservative rate/concurrency/input/runtime limits, and no external approvals.

An authorized owner or administrator may deliberately broaden synchronization, file output,
feature values, and limits within the hard boundaries below. Open Audience itself remains limited
to exact Conversation IDs. The review must show the effective result and estimated cost.
Configuration flexibility never weakens these hard invariants:

- Enabling or changing open Audience requires both Hub configuration and access-management
  authority, unless the current Member is the organization owner.
- The Route has a server-fixed Agent or Automation target. Message content cannot replace its
  Daemon, Project, Provider, Model, Mode, feature values, generated action grants, or Project file root.
- Context and bindings are keyed by Channel account, Conversation, and thread or topic. A customer
  Conversation cannot reuse another Conversation's Agent session or history.
- External participants never receive Project metadata, filesystem paths, diagnostics, internal
  approval details, Hub membership, or Paseo access merely because output synchronization is on.
- External participants cannot approve a tool request. The Route may auto-run only actions in its
  server-side, Conversation-bound capability. File sending remains confined to declared Project
  output roots even when an administrator enables it.
- Tool-path replies use an opaque, expiring Hub capability bound to the organization, Channel
  account, Conversation, selected Route revision, and created Agent. Replacing the Route or
  stopping its account revokes the capability. Its URL contains no routable Channel identifiers.
- Fast mode requires `agent.fast.use`, an explicit cost warning, and a Route budget. An External
  participant never receives that privilege; the fixed Route either has it at activation or cannot
  enable Fast mode.
- A public Automation must compile every step under the same explicit target, tool, output, and
  runtime ceiling. One unconstrained step makes the Route invalid. Any preapproved tool must enforce
  its own resource and argument scope; prompts are not authorization.
- Hub enforces configured upper bounds for per-sender and per-Route rate, concurrency, input size,
  attachments, runtime, and idle lifetime before starting or continuing work. An organization may
  choose stricter values but cannot exceed instance safety ceilings.
- Provider self-messages and redeliveries retain the existing loop and deduplication protection.
- Denials use a generic response and do not reveal whether a Project, Agent configuration,
  Automation, or Member exists.
- Activity records the Channel account, Route, Conversation, provider sender ID, outcome, and limit
  decision for audit and abuse investigation. It does not create a Hub Member or Channel identity.

These controls are the public automation boundary. Prompt intent, classifier output, and model
instructions never broaden the fixed target or tool policy.

Hub checks the daemon-published runtime Mode catalog during activation. An open-audience direct
Agent or Automation must resolve to a known attended Mode; an omitted Mode resolves through the
published default. Custom or unknown Modes without safety metadata and every unattended Mode fail
closed.

## 12. Automations and Configuration

`Hub → Automations` is the Paseo UI for the Hub's existing workflow architecture. It does not move
workflow state into the client and it does not create a second workflow engine.

### Existing Trigger architecture

The current Hub already owns the server-side model Paseo should reuse:

- One organization-owned Trigger is authored as one self-contained YAML document and stored as
  immutable database revisions.
- A `single_run` Trigger may listen to one or more GitHub, Slack, Discord, Linear, or manual events,
  then starts one Agent run with an explicit Daemon, absolute `cwd`, Agent controls, prompt, limits,
  environment values, and bounded outputs.
- Saving validates and activates one Trigger atomically. Accepted runs retain the exact compiled
  revision through the durable execution engine.
- A Channel Route may target an enabled organization Workflow by name. Dispatch resolves that name,
  then persists the stable Workflow ID and exact active revision on the provider event, Workflow
  run, Agent execution, and launch intent.
- Channel direct-Agent and Workflow paths share sender, mention, follow-up, idle, and binding
  admission. Workflow output uses the Route's compiled reply/sync ceiling.
- Organization Workflows execute directly under their own identity and revision. No hidden runtime
  Project is created or consulted.
- Existing direct provider Trigger sources retain their automatic provider reply output. A
  Channel-routed Workflow receives only the Channel reply output permitted by its compiled
  Route/Trigger ceiling. `hub.finish_execution` remains available to every execution.
- Legacy multi-step Workflow revisions remain runnable where supported, but the first structured
  Paseo editor creates the standard one-run Trigger shape.

The relevant seams are `packages/hub/src/triggers/configuration/**`,
`packages/hub/src/triggers/store.ts`, `packages/hub/src/triggers/dashboard.ts`,
`packages/hub/src/triggers/channel/**`, `packages/hub/src/workflows/engine.ts`, and the Trigger
operations in `packages/hub/src/public-api/operation-manifest.ts`. The Hub React Trigger pages are
presentation references only; Paseo calls retained backend services through the management contract
chosen after the decision gate below.

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
6. For a Channel-triggered Automation, optionally enable `Continue the same Agent`. This compiles
   to Workflow `reuse: binding`; otherwise every run creates a new Agent. Reuse is independent of
   auto-archive and must fail closed when target, Agent controls, or authority are incompatible.
7. Review native Provider Mode and the generated Hub action grants separately. Enable Slack or
   Telegram Channel replies explicitly; editing preserves authored grants. A Channel tool Route
   additionally grants Project-bounded file sending. These fixed grants are derived from existing
   output and Project configuration, not an arbitrary tool-policy or file-root editor.
8. Review target access, automatic tool authority, Fast-mode cost, runtime limits, and exposed
   outputs.
9. Validate. Validation is read-only and does not create or activate a revision.
10. Activate. Activation submits one self-contained Trigger document, records a new revision, and
    atomically replaces that Trigger's active revision.

The MVP does not add a separate server-side draft model. Edits remain an explicitly labelled local
draft until activation. Activation includes the base revision ID; if another administrator has
activated a newer revision, Paseo returns a stale-revision conflict and asks the editor to review
the new source rather than silently overwriting it.

New multi-step authoring is not part of this MVP. A legacy multi-step Automation remains runnable
and visible, but read-only until a deliberate multi-step editor and contract are added.

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

### Management API

The inventory found reusable Hub application services but no pre-existing single API suitable for
every Paseo client:

- the public API authenticates API keys or CLI credentials and already owns Project bundle and
  Automation operations;
- the existing Hub pages call `ProjectDashboard`, `TriggerDashboard`, `ProviderApplications`,
  Connection operations, and `OrganizationAccess` through TanStack server functions and a browser
  cookie; and
- the Channel CLI endpoints authenticate an instance secret or loopback caller and expose only the
  early add/list/status and YAML-user commands.

`packages/hub/src/management-api/**` is now the Clisbot-owned HTTP adapter over those domain
services and persistence paths; it is a transport boundary, not a second configuration backend.
It authenticates a BetterAuth browser session or first-party app credential, checks the
organization named in the request, then calls the existing owner. Hub page server functions and
older CLI commands remain compatibility callers. New CLI operations can use the same resource
contract without introducing a CLI-specific backend.

The resource families are `projects`, `automations`, `provider-applications`, `connections`,
`channel-configuration`, `teams`, `channel-identities`, `access-assignments`, and `daemons`. They are
organization-scoped under `/api/management/v1/organizations/:organizationId/**`; account and app
authorization endpoints remain under `/api/auth/**`. Names describe durable domain resources, not
Paseo screens or a specific provider.

Channel behavior has one revisioned contract. A read returns the active revision and its structured
configuration. Validation accepts a complete candidate without writing it. Replacement requires the
caller's expected active revision, compiles the same candidate, stores one immutable revision,
activates it atomically, and reconciles Channel runtimes. Structured forms and Advanced YAML both
produce that candidate. A CLI command reads the active candidate, applies one pure edit, and submits
the same replacement operation. There is no separate Channel-account mutation path and no second
writable source.

Automation validation and save continue through `OrganizationTriggerStore`; Project configuration
continues through `ProjectConfigurationStore`; Provider Applications and Connections continue
through their existing capability owners; Member invitation and organization-role changes continue
through `OrganizationAccess`. Teams, verified Channel identities, access assignments, app
credentials, managed Daemon catalogs, and access tickets are new resources because no current Hub
service owns them.

All mutations use optimistic concurrency where the resource is revisioned, return the existing
problem/error vocabulary, redact credentials, and enforce authorization on the Hub. UI visibility
is never the access boundary. The existing `/api/v1/**` public API stays compatible; management
authentication is not added to it implicitly.

The implemented adapter currently exposes:

- `provider-applications`: list the existing redacted `ProviderApplications.overview()` and verify
  or replace GitHub, Slack Webhook, Discord, or Linear Application credentials through
  `ProviderApplications.verifyAndSave()`;
- `connections`: list organization Connections, create token-native Telegram or Slack Socket
  Connections, or begin a provider OAuth/installation Connection from a verified Application;
- `channel-configuration`: read, validate, or atomically replace the active Channel candidate;
  list revisions; project observed Conversations; and expose account test/retry operations;
- `automations`: list, validate, create, or replace organization Trigger documents under the
  Automation product name; list revisions and Activity; project runnable Automations; and dispatch
  a least-data Manual Run; and
- `teams`, `channel-identities`, `access-assignments`, and `daemons`: the management and Managed
  Access resources described in this document.

Provider secrets remain write-only. A Connection projection carries its owning
`providerApplicationId` but never credential material. Application configuration remains
instance-operator-only; an organization owner or administrator may create a Connection from an
already verified Application. Connection projections include every Channel, Automation, and
Project consumer; disconnect fails while any consumer remains. Provider setup guidance and Slack
delivery retry are also exposed by the adapter. Daemon managed-access mode remains a Host-owned
setting through the existing daemon configuration RPC; the Hub management API does not duplicate
that write.

The additive `projectId`, `featureValues`, `reuse: binding`, Route `contains`, binding-first
follow-up, captured asynchronous Route context, Connection validation, and restart-based
reconciliation are implemented. The remaining presentation cleanup is to remove the old Hub
configuration pages from an end-user build once deployment has switched to Paseo, while retaining
authentication/OAuth callbacks, application services, compilers, revisions, and runtime.

Implementation seams below use that management façade and retain the same domain owners:

| Relative file path                                  | Existing symbol                                                          | Implemented responsibility                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/hub/src/config/compiler.ts`               | `AgentSchema`, `EnvironmentSchema`, `CompiledAgent`                      | Add Agent `featureValues` and daemon-Environment `projectId`; keep current fields and named-reference behavior.                            |
| `packages/hub/src/config/bundle.ts`                 | `JsonAgentSchema`, `compileHubBundle()`                                  | Parse/compile the same additive field for DB-backed Channel revisions.                                                                     |
| `packages/hub/src/channels/control-plane.ts`        | `compileControlPlaneSnapshot()`, `createChannelAgentSpecResolver()`      | Validate Connection references, pass Project/Agent controls into Agent creation, and retain candidate-bundle validation.                   |
| `packages/hub/src/channels/config/schema.ts`        | `RouteMatchSchema`, `RouteSchema`                                        | Add optional non-empty literal `contains`; keep exactly one direct-Agent or Workflow target.                                               |
| `packages/hub/src/channels/config/compile.ts`       | `CompiledRoute`, `compileRoute()`                                        | Carry the normalized text condition without changing declaration-order precedence.                                                         |
| `packages/hub/src/channels/policy.ts`               | `routeMatches()`, `matchRoute()`                                         | Match Conversation facts plus message text; first match still wins.                                                                        |
| `packages/hub/src/channels/execution.ts`            | `resolveRoute()`, `handleAgentMessage()`, `admitWorkflowMessage()`       | Prefer an existing direct binding, pass text for new Route selection, capture revision plus Route position, and retain shared admission.   |
| `packages/hub/src/db/channels.ts`                   | `ChannelStore.recordChannelInboundActivity()`                            | Persist a bounded inbound admission audit fact for Member and open-audience Routes without message text, credentials, or display payload.  |
| `packages/hub/src/channels/bindings/index.ts`       | `BindingEngine.admit()`, `.bindOrSteer()`                                | Continue the bound Agent without text reselection; persist the immutable selection in binding context and invalidate affected bindings.    |
| `packages/hub/src/channels/supervisor/index.ts`     | `ChannelSupervisorImpl.reconcile()`                                      | On a new active revision, stop removed/disabled handles and restart every enabled handle from the new snapshot; return per-account status. |
| `packages/hub/src/triggers/channel/provider.ts`     | `ChannelWorkflowRequestPayloadSchema`, `createChannelWorkflowProvider()` | Carry selected Channel revision/Route context into durable Workflow output and approvals; never rematch a callback without original text.  |
| `packages/hub/src/triggers/configuration/schema.ts` | `TriggerAgentSchema`, `TriggerTargetSchema`, `TriggerRunSchema`          | Add optional `featureValues`, target `projectId`, and `reuse: binding`.                                                                    |
| `packages/hub/src/triggers/configuration/index.ts`  | `compileTriggerDocument()`                                               | Map the additive fields into the existing compiled step and launch path.                                                                   |
| `packages/hub/src/management-api/index.ts`          | `ManagementApi.restartChannelAccountsUsingConnection()`                  | Restart active Channel consumers immediately after a token-native credential is replaced, without waiting for a configuration revision.    |
| `packages/hub/src/provider-applications/index.ts`   | `ProviderApplications.onConfigurationChanged()`                          | Publish a redacted post-commit event after direct save or OAuth/install completion; never expose credential material to the subscriber.    |
| `packages/hub/src/application-runtime.ts`           | `restartProviderApplicationChannelConsumers()`                           | Resolve every affected Connection and restart its enabled Channel accounts within the active organization.                                 |
| `packages/app/src/screens/settings-screen.tsx`      | `SettingsSidebar`, `SettingsScreen`                                      | Add only the Hub navigation/account mount points to shared Paseo code.                                                                     |
| `packages/app/src/clisbot/hub/**`                   | new Clisbot-owned screens and state                                      | Own Account, Channels, Automations, Team, Access, Configuration, forms, drafts, validation, activation status, and tests.                  |
| `packages/app/src/clisbot/hub/sidebar-account.tsx`  | `HubSidebarAccountButton`                                                | Render the signed-in avatar and open the existing Account route; feature-off and signed-out states render nothing.                         |
| `packages/app/src/components/left-sidebar.tsx`      | `SidebarFooter`                                                          | Add one optional Clisbot-owned avatar mount without replacing the existing Settings action.                                                |

Required focused tests live beside those seams: schema/compiler tests for the new optional fields;
Route-order, text-match, active-binding and direct/Workflow admission tests; candidate-revision and
Connection validation tests; restart/retry supervisor integration tests; Connection-consumer
deletion tests; and Paseo form state/navigation tests for owner and public/team presets.

### Configuration screen

`Hub → Configuration` is also entirely inside Paseo and contains lower-frequency administration:

- Provider Applications and Connections for GitHub, Slack, Discord, Telegram, or other sources.
  One Connection may serve Automation events and Channel conversation behavior; the consumer list
  makes that reuse visible.
- API keys.
- Instance-operator Provider Application setup where the underlying Hub capability requires it.

Channel and Automation revision history remains with its owning detail screen. Host configuration,
including managed-access mode, remains in the existing Host section.

Usage and Billing remain outside the first unified-client MVP. Host Usage remains unchanged. Hub
Usage can return only when the product has an organization-level metric or billing workflow that
cannot be represented by Host Usage.

## 13. Project, Agent configuration, and Daemon access

An enrolled Daemon publishes the minimum catalog required by the Hub access and delegation checks:
stable Project IDs and names plus ready Provider, Model, Thinking, and Mode safety metadata. It
updates the snapshot when the catalog changes. Route and Automation editors use the same live Paseo
Provider snapshot and optional Agent profiles already exposed by the selected Host. Filesystem
paths and inaccessible resource details are not part of the member-facing Hub catalog.

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
the compiled Project or Agent controls. Immediately before a Hub-owned Agent is created, the Daemon
resolves the configured `cwd` or worktree source through its active Workspace/Project registry and
requires it to belong to the asserted `projectId`. Hub never guesses path prefixes, and an owner or
Daemon Administrator cannot use a correct Project ID to relabel an unrelated filesystem path.

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
- Disconnecting the identity's Provider Connection.
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

- `HubBundleFile[]` for Channel behavior, stored inside immutable organization Channel revisions:
  `hub.yml`, Channel policy, and one account document per Channel account.
- Channel account declarations and canonical `connectionId` references. Credentials and secret
  references never appear in revision content.
- Routes and fallback behavior.
- Named Agent and Environment definitions in `hub.yml`, resolved for each direct Route. Agent
  profiles may fill these values but are not stored as live authorization references.
- Route Audience and open-audience safeguards.
- Interaction, binding, reply, outbound, synchronization, and approval defaults.
- Automations and their source files.
- Configuration revisions.

This split avoids creating a new configuration revision whenever an administrator invites a Member,
links a Telegram identity, or moves someone between Teams. It also avoids a second writable access
source.

Encrypted credentials belong to Provider Application or Connection rows in the Hub database, not
to operational access data and not to versioned behavior. The external master key remains outside
the database and Hub data directory. A raw revision, API response, log, or database query over
configuration rows must never reveal a submitted credential.

In managed access mode, Hub database assignments are authoritative for people and resources.
Existing channel `users` and `assignments` configuration has a one-time importer or a bounded
read-only compatibility adapter. It must not remain a second independently writable policy system.
Organization and account `defaultRoles` remain empty so an unmapped sender or newly invited Member
gains nothing. An open-audience Route compiles its explicit Audience into one built-in Route
default role containing only `channel.use`. It never receives approval,
Project, Agent-configuration, Fast-mode, Daemon, or Hub privileges.

## 17. Design-system use

The Hub area uses Paseo's existing Settings patterns:

- `SettingsSection` for every group of rows.
- Existing settings card and row styles for Members, Teams, Channel accounts, Routes, and access.
- `StatusBadge` for Connected, Disabled, Error, and Verified.
- `Combobox` for searchable Members, Teams, Daemons, Projects, optional Agent profiles,
  Automations, and Conversations.
- Access subject and resource pickers always expose autocomplete. Subjects are grouped into
  Teams and Members, with Member email included in search. Resources are grouped into Hosts,
  Projects, Channel accounts, and Automations; parent names distinguish resources with the same
  name and are searchable. Each group initially renders at most 50 matches, retaining its selected
  match. Search considers the full loaded catalog before limiting results, and a truncation hint
  explains how to narrow the list. This bounds rendered options; it does not add server pagination.
- `DropdownMenu` for small fixed action lists.
- `AdaptiveModalSheet` for Link identity, Add Team member, and Add access.
- A focused detail view within the existing Settings screen for Add Channel account and Add Route;
  no additional router or app shell owns these forms.
- Web confirmations, including Access grants and removals, use the shared app
  `ConfirmationProvider` through `confirmDialog`, rendered with `AdaptiveModalSheet` and standard
  buttons. Channel forms mount a scoped instance of that same provider and use `useConfirmation`,
  including structured test-send previews and cancellation when the requesting form leaves.
  No browser blocking confirmation is used. The action row fills the shared footer's available
  width; the body scrolls independently while the footer stays within the current compact snap
  point. Button geometry and modal sizing remain owned by the shared Paseo primitives. Compact
  confirmations stack full-width actions so longer labels such as `Send test message` remain
  readable. Native and Electron confirmation backends retain their existing ownership.
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
- A product-visible Route entity/`routeId`; ordered Routes and existing durable bindings are enough
  for the current selection and follow-up model.
- Fanout from one inbound message to multiple Agent/Automation targets. It must be designed together
  with per-target idempotency rather than added as an independent flag.
- Stable Automation-ID references in authored Channel Routes. The current name is resolved and the
  accepted event pins ID plus revision; revisit only when rename behavior earns it.
- Any end-user Hub configuration page outside Paseo.
- Concurrent Channel runtime for multiple organizations in one Hub process. The current Supervisor
  requires one active organization and fails closed on ambiguity; the management and access model
  remains organization-scoped.

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
- New CLI/Paseo Automation authoring uses organization Trigger documents. Stable Project identity,
  `featureValues`, and one-run `reuse` remain additive to the current Trigger schema.
- Channel Agent and Environment names, ordered Route arrays, Workflow-name references, and
  `connectionId` remain compatible configuration contracts; the Paseo form edits them rather than
  replacing them with a second model.

The implementation keeps these shipped boundaries:

1. one generic management HTTP adapter over existing Hub owners, never screen-specific write APIs;
2. structured Channel/Automation forms and Advanced YAML compile into the same revisioned domain
   documents;
3. all shared UI/auth/data hooks live under `packages/app/src/clisbot/hub/**`, with small Settings,
   Host-runtime, and Electron mount points;
4. owner wildcard and zero-access Member defaults are resolved by Hub, not duplicated in clients;
5. Channel execution, Automation delegation, managed daemon admission, and direct Paseo sessions
   enforce their own resource boundary before side effects; and
6. mode `off` and a build without Hub configuration retain ordinary upstream-compatible behavior.

Deploy with daemons in `off`, verify the owner flow and local recovery path, then enable `external`
per Host. Removing the old Hub presentation from an end-user deployment and importing legacy
channel-user rows are deployment/migration tasks; they do not create a second writable policy path
or require users to leave Paseo.

## 20. Acceptance flows

These are release-gating integration scenarios, not illustrative examples.

### One owner

1. The owner signs in and sees every enrolled Host, Project, Provider, Model, Thinking option, and
   optional Agent profile without creating an assignment. After approving CLI login, Paseo keeps a
   bounded Daemon-catalog reconciliation active while the terminal enrolls the Daemon. Its published
   Connection Offer is added through the existing Host registry (or reuses its matching manual
   Host), then the same screen offers `Add a Project` with that Host preselected; these catalog
   reads do not issue access tickets.
2. The owner adds a Channel account and links their provider identity during setup.
3. `Who can use it` is already set to `Only you`; the owner does not open the access picker.
4. The owner sees `Run an Automation` first and can create or select the standard one-Agent
   Automation. They may instead choose direct Agent work, configure Project and Agent controls, or
   optionally apply an Agent profile.
5. `Use Project folder` is preselected; worktree/branch/PR choices remain available without forcing
   extra setup. Selecting a Project resolves its root from the existing Paseo Host directory,
   matching both Host server ID and Project ID, and writes that absolute path into the existing
   Environment `cwd`. The root is shown without asking the owner to re-enter it. The
   `Use a custom working directory` switch reveals the optional path field; existing custom paths remain visible and
   unchanged when editing. Changing Host or Project clears the previous path. Missing directory
   data shows loading or connection/retry guidance instead of guessing a path from the Project
   name. This shared field is used by direct Channel targets and Automation forms, including inline
   creation. The daemon remains authoritative for validating that the path belongs to the Project.
6. Activation validates the candidate, restarts the account from the new snapshot, and reports a
   successful real test message or a retryable runtime error.
7. The flow never asks the owner to create a Team or grant themselves access.
8. Every step, including Automation editing and Advanced YAML, stays inside Paseo.

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

1. The account has an ordered `contains: "#triage"` Automation Route followed by a direct-Agent
   catch-all for `#engineering`.
2. A verified Slack identity sends `#triage investigate the failed build`; the public-conversation
   assignment covers that Conversation.
3. Hub selects the first Route, dispatches the exact active Automation revision, and
   `parseInvocation` parses only the Automation's declared inputs.
4. A later new message without the marker selects the direct Route. Once that direct thread is
   bound, ordinary follow-ups continue its Agent instead of switching target from message text.
5. The Member can use either fixed Route without direct Project access, but cannot browse the Project,
   Files, Terminal, or run the target Automation directly.
6. The same sender in an unlisted private channel is denied without revealing the target Project.

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
7. When `Continue the same Agent in this conversation` is enabled, same-binding runs are serialized
   and reuse only a compatible Agent; otherwise each run creates one.
8. The flow never opens the standalone Hub website or asks for an API key.

### Channel account removal and shared Connection

1. One Slack Connection is used by a customer Channel account and a release Automation source.
2. Removing the Channel account stops and removes its conversational behavior but reports that the
   Connection remains in use by the Automation.
3. Disconnect is unavailable until the administrator removes or moves the Automation consumer.
4. Removing an account whose Connection has no other consumer offers
   `Also disconnect provider account`, selected by default.

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
