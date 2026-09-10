# Unified Paseo client and Managed Access Lite

Date: 2026-08-31. Updated: 2026-09-05. Status: Managed Access Lite MVP implemented; explicit
post-MVP items remain in sections 5.4 and 12. Scope: put Hub account
and management surfaces in the shared Paseo app, let an authenticated user discover and open the
daemon Projects they may use, and preserve ordinary Paseo client/daemon compatibility when managed
access is disabled.

This design deliberately optimizes first for one-person and internal-company deployments. It is
not a commitment to preserve the current Hub UI, API, or data model when those surfaces do not earn
their place in the product vision.

### Post-merge audit against upstream `74a377ff6`

The Fusion branch now includes upstream `main` through merge commit `c41f38378`. The merge produced
16 conflicts: 12 package manifests, `package-lock.json`, `CHANGELOG.md`, `CLAUDE.md`, and the Hub CLI
command registry. Only the Hub CLI registry required a product-code merge: Fusion's local
`hub start`/`hub stop` commands and upstream's new `hub permissions` command were both retained.

Upstream has now added the authorization foundation that this proposal previously assumed did not
exist: `SessionAdmission`, `SessionAuthorization`, semantic daemon permissions, exhaustive inbound
and outbound RPC classification, Hub service principals, and live permission replacement. Managed
Access should extend that foundation with resource grants and lease-bound admission; it should not
create a second RPC authorizer.

Estimated ongoing upstream-merge complexity for the implemented MVP is **6/10**. The difficult changes
that cannot be isolated completely are concentrated in four seams:

1. **server admission:** resolve a ticket before `handleHello()` creates or resumes a Session;
2. **Session/resource enforcement:** apply Project-aware authorization to RPCs, subscriptions,
   pushed events, files, terminals, agents, and binary frames;
3. **managed Host connection lifecycle:** suppress session-level background probes and request a
   ticket only when establishing or recovering the user's actual connection; and
4. **client hello/reconnect:** await a fresh ticket for each real managed admission attempt while
   preserving the unchanged hello path when no provider is configured.

All Hub policy, ticket/lease implementation, privilege resolution, connection policy, and UI logic
outside those hooks must remain in Clisbot-owned modules.

## 1. Decision summary

Adopt a small, isolated **Managed Access Lite** layer:

1. Keep Paseo pairing, direct WebSocket/TCP connections, relay E2EE, `HostProfile`, agent RPCs, and
   provider lifecycles unchanged.
2. Add Hub login and Hub management surfaces to the shared Expo app behind a Clisbot-owned app
   capability flag. The same app package remains the UI for web, iOS, Android, and Electron.
3. Keep the existing BetterAuth organization roles (`owner`, `admin`, `member`). Promote the Hub's
   existing dotted privilege algebra into a cross-surface authorization contract, add only the
   missing Hub/daemon/Project privileges, and add member-to-resource role assignments. Do not add a
   new custom role editor or a second deny/inheritance implementation for Managed Access Lite.
4. Make an organization owner implicitly hold `*` for the organization and every resource enrolled
   into it, including daemons enrolled later. A one-person setup therefore needs no ACL setup.
5. For a real managed connection attempt, have the Hub mint a short-lived opaque `accessTicket`.
   The Clisbot app adds it to the existing WebSocket `hello`; the Clisbot daemon consumes it with
   the Hub and binds the returned principal, Projects, privileges, and lease to the Paseo session.
   Heartbeats and background route observation never mint tickets.
6. Do not add authorization behavior to relay or direct transports. They only carry the same
   application messages they carry today.
7. Add daemon mode `"off" | "external"`:
   - `off`: ordinary upstream Paseo behavior;
   - `external`: every relay or TCP connection requires managed access; authenticated local
     socket/pipe access remains the operator recovery path.
8. Keep the Clisbot app compatible with an upstream Paseo daemon. Keep the Clisbot daemon compatible
   with an upstream Paseo app when managed access is `off`. Requiring the Clisbot app for external
   connections when the Clisbot daemon is in `external` mode is intentional.

The minimum new owner chain is:

```text
Paseo app Hub account
  -> Hub account/bootstrap and access-ticket HTTP APIs
  -> existing HostProfile connection (direct or relay)
  -> existing WebSocket hello + schema-optional accessTicket
  -> Clisbot daemon managed-access adapter
  -> existing Session, agent, Project, file, terminal, and approval owners
```

The Hub decides who should receive authority. The daemon remains authoritative when exercising it.
Client-side hiding is only UX and is never the security boundary.

## 2. Compatibility is a product contract

### 2.1 Required compatibility matrix

| App                | Daemon                | Managed mode | Expected result                                                                                                                           |
| ------------------ | --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream Paseo app | Upstream Paseo daemon | n/a          | **CURRENT:** ordinary Paseo behavior.                                                                                                     |
| Clisbot app        | Upstream Paseo daemon | n/a          | Must work as an ordinary Paseo app. Upstream daemons use the existing protocol and do not request a Hub ticket.                           |
| Upstream Paseo app | Clisbot daemon        | `off`        | Must work as an ordinary Paseo app. Clisbot managed-access code is inactive.                                                              |
| Clisbot app        | Clisbot daemon        | `off`        | Ordinary Paseo behavior; Hub account features may exist in the app but do not change this daemon session.                                 |
| Upstream Paseo app | Clisbot daemon        | `external`   | Relay and TCP connections are rejected with an actionable upgrade/login error. Authenticated local socket/pipe recovery remains possible. |
| Clisbot app        | Clisbot daemon        | `external`   | A Hub-managed external connection succeeds with a valid ticket and is restricted to its Projects/privileges.                              |

**IMPLEMENTED:** a Host without a matching Hub `external` projection has no Hub ticket resolver and
continues through the ordinary `@getpaseo/client`/`HostRuntimeStore` path. If the same `serverId` is
already a manual Host and is enrolled with managed access `external`, the Hub binding supplies
tickets while retaining the user's TCP/SSH/relay choices and manual Host lifecycle. Signing out
removes that binding without deleting the manual Host. A daemon in `off` keeps owner admission and performs no
ticket lookup, session narrowing, resource filtering, or Hub availability check. Focused client,
Host-runtime, and WebSocket tests cover absent-ticket compatibility and the `off`/`external`
boundary; wire fields remain optional for old clients and daemons.

### 2.2 Managed access modes

```ts
type ManagedAccessMode = "off" | "external";
```

- `off`: ordinary Paseo trust and upstream compatibility.
- `external`: relay and all TCP connections require managed access; authenticated OS-local
  socket/pipe access remains the recovery path.

There is no `optional` mode because allowing an unticketed connection to recover full trust creates
a downgrade path without a product use case.

**Post-merge correction:** upstream Electron now supports `remoteSsh`, implemented as an SSH byte
stream to the daemon TCP port. The daemon can see that connection as loopback on the remote host, so
“non-loopback TCP only” cannot distinguish a real local browser from an SSH forward and would create
a managed-access bypass. Therefore `external` must cover loopback TCP too. SSH users who need
managed access must use the Clisbot app and ticket path; upstream SSH remains fully compatible when
mode is `off`.

### 2.3 Capability timing

**CURRENT:** the daemon sends `server_info` only after it accepts `hello`. Consequently a client
cannot wait for `server_info.features.managedAccessTickets` before deciding whether the first
`hello` needs a ticket.

**IMPLEMENTED:** each daemon registration publishes this pre-connection fact beside its existing
connection offer:

```ts
managedAccessMode: "off" | "external";
```

A missing field from an older daemon resolves to `off`; a Host without a matching Hub projection
follows the upstream path. `HubHostBinding` registers a ticket resolver only for `external`, including
when it reuses an existing manual Host for that same daemon. The post-hello
`server_info.features.managedAccessTickets` field remains useful for diagnostics and version-drift
validation, not initial ticket discovery. A Hub must not advertise an upstream daemon as a managed
Host when that daemon cannot consume tickets.

## 3. What `hello` already is

**CURRENT:** `hello` already exists in `packages/protocol/src/messages.ts` as
`WSHelloMessageSchema`. `@getpaseo/client` sends it after the WebSocket application transport is
ready, and `packages/server/src/server/websocket-server.ts` requires it within 15 seconds.

Today it carries:

- `clientId` — identifies and resumes the logical client session;
- `clientType` — mobile, browser, CLI, or MCP;
- protocol and app versions; and
- optional client capabilities.

The daemon uses it to create or resume a `Session`, then returns `server_info`. It is not the relay
pairing handshake and it is not HTTP password authentication.

The same `hello` serves all current application transports:

- **Direct:** it is the first application JSON message after the WebSocket opens. Direct exposure
  may separately use the existing HTTP/WebSocket bearer password.
- **Relay:** the relay first establishes Paseo's E2EE channel; `hello` then travels as encrypted
  application payload. The relay cannot read an `accessTicket` carried in it.
- **Desktop socket/pipe and SSH:** Electron's transport boundary carries the same WebSocket
  application bytes. SSH only tunnels to an already-running daemon; it does not add a different
  authorization protocol.

**IMPLEMENTED:** hello has exactly one Clisbot admission field:

```ts
accessTicket?: string;
```

It is optional on the wire so an upstream-compatible message remains valid. It is not optional in
policy: a relay or TCP connection in `external` is rejected when the field is absent or invalid.

This is the smallest transport-neutral seam. Putting the ticket in an HTTP header would work only
for direct connections because a relay connection terminates its outer WebSocket at the relay.
Putting it in `capabilities` would mix a secret with capability negotiation. Encoding it into
`clientId` or a URL would be both semantically wrong and more likely to leak.

Concept card: **Access ticket** is a short-lived, one-use credential issued by the Hub and consumed
by one enrolled daemon during `hello`; it is not a Hub app session, a pairing secret, a relay key,
or the longer-lived daemon access lease.

## 4. Authority model and permission catalog

This section is the canonical permission inventory for Managed Access Lite. The UI and resource
model are defined in
[Unified client Hub configuration UI](2026-09-01-unified-client-hub-configuration-ui.md).

### 4.1 Keep four authority layers distinct

The repository already has three authority vocabularies, and Managed Access adds a fourth:

1. **Daemon semantic permissions** classify WebSocket operation families. They are enforced by
   `SessionAuthorization` and are daemon-wide today.
2. **Hub organization capabilities** are coarse BetterAuth role capabilities used by Hub account
   operations.
3. **Hub API-key scopes** authorize non-interactive public API credentials.
4. **Product/resource privileges** express what a Hub Member may do with one Channel, Automation,
   Daemon, or Project. Hub resolves them; Hub and the Daemon enforce the relevant subset.

These names are not interchangeable. A UI access level such as `Developer` or `Administrator` is a
preset that expands into permissions; it is not itself a persisted permission.

Status values describe origin, not remaining work:

- `EXISTING`: retained from the Paseo/Hub baseline;
- `ADDED`: implemented for the unified client and Managed Access Lite; and
- `EXTENDED`: an existing Channel/config concept now also applies to Paseo Members.

### 4.2 Daemon semantic permissions

These exact names already exist in `packages/protocol/src/messages.ts` and are enforced through
`packages/server/src/server/authorization/**`.

| Permission          | Meaning                                                                                                  | Applies in | Origin     | Managed-access handling                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.read`       | Read daemon status, diagnostics, configuration, and Provider information.                                | Daemon     | `EXISTING` | Project-scoped sessions retain only the filtered catalog/status subset; daemon-wide read remains owner/Daemon Administrator only. |
| `daemon.manage`     | Restart/update the daemon and change configuration, Providers, skills/plugins.                           | Daemon     | `EXISTING` | Kept unchanged; not reused as a Hub product privilege.                                                                            |
| `tunnel.manage`     | Manage relay, Hub, service-tunnel, and public-endpoint relationships.                                    | Daemon     | `EXISTING` | Included only in the Daemon Administrator preset.                                                                                 |
| `access.manage`     | Manage pairing offers, principals, credentials, grants, and revocation.                                  | Daemon     | `EXISTING` | Included only in the Daemon Administrator preset.                                                                                 |
| `workspace.read`    | Read Projects, Workspaces, Agents, timelines, Files, diffs, terminal output.                             | Daemon     | `EXISTING` | Project/resource filtering now applies to requests, subscriptions, and outbound projections.                                      |
| `workspace.write`   | Send prompts; control Agents; mutate Files, terminals, git, and scripts.                                 | Daemon     | `EXISTING` | Project/resource and narrower product-action checks now run before side effects.                                                  |
| `workspace.manage`  | Create, rename, archive, and remove Projects and Workspaces.                                             | Daemon     | `EXISTING` | Remains separate from `project.use`; owner/Daemon Administrator only in the MVP.                                                  |
| `automation.manage` | Manage daemon-owned schedules, heartbeats, and loops.                                                    | Daemon     | `EXISTING` | Remains separate from Hub Automations.                                                                                            |
| `hub.execute`       | Let an enrolled Hub service principal create, validate, control, and observe Hub-owned Agent executions. | Daemon     | `EXISTING` | Service-principal only; never included in an interactive owner/Member ticket.                                                     |

The Daemon Administrator access level expands to the required current semantic permissions. Do not
create a second Hub product privilege also named `daemon.manage`: the existing permission alone
does not include tunnels, pairing/access management, or all read operations.

### 4.3 Hub authorities that already exist

Hub organization capabilities and the instance-operator flag are boolean checks in
`packages/hub/src/auth/organization-policy.ts` and `organization-contract.ts`; they are not resource
ACL rows.

| Authority            | Meaning                                                                                      | Applies in | Origin     | Unified-client handling                                                             |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------- |
| `view`               | View the active organization.                                                                | Hub        | `EXISTING` | Supplies `hub.view` at the Paseo API boundary.                                      |
| `manageMembers`      | Invite/remove non-owner Members and change their roles.                                      | Hub        | `EXISTING` | Supplies `hub.member.manage`; owner safeguards remain unchanged.                    |
| `manageOwners`       | Change/remove owner membership.                                                              | Hub        | `EXISTING` | Remains owner-only and is not a general assignable action.                          |
| `manageResources`    | Manage current organization Triggers, connections, Daemons, API keys, and related resources. | Hub        | `EXISTING` | Adapts to `hub.configure`, `channel.manage`, or `hub.access.manage` per endpoint.   |
| `isInstanceOperator` | Identify the account allowed to use instance-wide operator surfaces.                         | Hub        | `EXISTING` | Supplies `hub.instance.manage`; never derived from a Team or ordinary `admin` role. |

Hub API-key scopes are also current, but apply only to API credentials:

| API-key scope            | Meaning                                         | Applies in | Origin     | Unified-client handling                      |
| ------------------------ | ----------------------------------------------- | ---------- | ---------- | -------------------------------------------- |
| `projects:read`          | List legacy Hub deployment Projects.            | Hub API    | `EXISTING` | Kept separate from Member Project access.    |
| `configuration:validate` | Validate a legacy Project configuration bundle. | Hub API    | `EXISTING` | Kept as the API-key bundle-validation scope. |
| `configuration:install`  | Install a legacy Project configuration bundle.  | Hub API    | `EXISTING` | Kept as the API-key bundle-install scope.    |
| `runs:dispatch`          | Dispatch a manual Workflow run.                 | Hub API    | `EXISTING` | Kept distinct from Member `automation.run`.  |
| `daemons:enroll`         | Enroll a Daemon into the organization.          | Hub API    | `EXISTING` | Remains a machine/API credential scope.      |

The Paseo management API adapts these existing authorities to semantic actions at its boundary;
the resource operations themselves are documented in
[Unified client Hub configuration UI](2026-09-01-unified-client-hub-configuration-ui.md).

### 4.4 Cross-surface product and resource privileges

This is the canonical target catalog used by web, native, Electron, Slack, and Telegram. Hub role
and Team/direct assignments resolve these privileges. Only Project-scoped leaves needed by a
managed Paseo Session are sent to the Daemon.

In the MVP, `hub.*` and `channel.manage` are role-derived HTTP actions, not assignable resource
grants. The Access API rejects them in Team/Member assignments. `channel.use`, `automation.run`, and
Daemon/Project privileges are the assignable leaves.

| Privilege                      | Meaning                                                                                                       | Enforcement owner | Origin     | Implemented handling                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub.view`                     | View Hub account state and the resources already visible to the Member.                                       | Hub               | `ADDED`    | Thin action over current `view`; it never reveals unassigned resources.                                                                           |
| `hub.configure`                | Manage organization configuration, event connections, API keys, and Automation definitions/revisions.         | Hub               | `ADDED`    | Split from coarse `manageResources`; does not grant resource use.                                                                                 |
| `hub.access.manage`            | Assign Team/direct access to Channels, Daemons, Projects, and Automations.                                    | Hub               | `ADDED`    | Split from `manageResources`; every mutation remains organization-scoped and audited.                                                             |
| `hub.member.manage`            | Invite/remove Members and change non-owner membership.                                                        | Hub               | `ADDED`    | Map to current `manageMembers`; current owner rules remain authoritative.                                                                         |
| `hub.instance.manage`          | Manage instance-wide Apps and operator settings.                                                              | Hub               | `ADDED`    | Derived only from instance-operator authority, never from ordinary Team assignment.                                                               |
| `channel.manage`               | Connect, edit, test, enable/disable, and remove Channel accounts and Routes.                                  | Hub               | `ADDED`    | Replaces the unimplemented proposal `bot.manage`; there is no Bot product resource.                                                               |
| `channel.use`                  | Invoke one fixed Route in the assigned Conversations.                                                         | Hub               | `ADDED`    | May use only that Route's bound outbound actions; grants no generic Channel tool or direct Project, File, Terminal, or Automation access.         |
| `automation.run`               | Invoke an Automation directly from Paseo or a Member API.                                                     | Hub               | `ADDED`    | A fixed Channel Route is authorized by `channel.use` instead.                                                                                     |
| `daemon.connect`               | Obtain managed admission to one Daemon.                                                                       | Hub + Daemon      | `ADDED`    | Checked at ticket issue/consume; grants no RPC operation by itself.                                                                               |
| `project.use`                  | See and work with Agents, Workspaces, Files, and Project projections in one Project.                          | Hub + Daemon      | `ADDED`    | Compile to resource-scoped workspace read/write; do not include Project lifecycle management.                                                     |
| `workspace.create`             | Create a Workspace or Git worktree within an explicitly granted existing Project.                             | Hub + Daemon      | `ADDED`    | Requires an active lease, exact Project/source authorization, and daemon-owned worktree destination; does not grant Project lifecycle management. |
| `agent.interact`               | Start or continue an Agent interaction on an authorized Project or fixed Channel Route.                       | Hub + Daemon      | `EXTENDED` | Canonical replacement for current `bot.interact`; accept the old name only as a bounded config alias.                                             |
| `agent.create`                 | Create an Agent in an authorized Project using one allowed Agent configuration.                               | Daemon            | `ADDED`    | Enforce Project and resolved Provider/Model/Thinking constraints at creation.                                                                     |
| `agent.fast.use`               | Enable cost-bearing Fast mode for an Agent creation or fixed Route/Automation configuration.                  | Hub + Daemon      | `ADDED`    | Check `featureValues.fast_mode` during activation and Agent creation; off by default.                                                             |
| `terminal.use`                 | List, create, subscribe, read, input, capture, rename, kill, and receive binary frames for Project terminals. | Daemon            | `ADDED`    | Apply to every terminal text/binary path; it is narrower than `workspace.write`.                                                                  |
| `approval.file`                | Approve a provider request classified as File work.                                                           | Hub + Daemon      | `EXTENDED` | Already enforced for Channel responders; reuse the classifier and enforce in Paseo.                                                               |
| `approval.config`              | Approve a provider request classified as configuration work.                                                  | Hub + Daemon      | `EXTENDED` | Same cross-surface extension.                                                                                                                     |
| `approval.command`             | Approve command work; dot-subtree matching covers destructive commands unless explicitly denied.              | Hub + Daemon      | `EXTENDED` | Same cross-surface extension; compile denies before sending exact leaves to the Daemon.                                                           |
| `approval.command.destructive` | Approve commands classified as destructive.                                                                   | Hub + Daemon      | `EXTENDED` | Already a Channel leaf; enforce as the narrower Paseo decision too.                                                                               |
| `approval.channel`             | Answer a pending provider request classified as a Channel-native action.                                      | Hub + Daemon      | `EXTENDED` | Approval never supplies the underlying action or resource authority; the broker rechecks that ceiling.                                            |

`approval.other` remains deliberately unavailable: an unclassified request fails closed.

#### Channel tools and Member authority

`tool.*` and `channel.tool.<name>` are dormant P1 placeholders, not working Channel permissions.
They must not appear in the new Paseo access editor or in newly stored assignments.

- `packages/hub/src/channels/config/enums.ts:isPrivilegePattern` accepts both spellings, but
  `PRIVILEGE_LEAVES` contains no `tool.<name>` or `channel.tool.<name>` leaf.
  `packages/hub/src/channels/policy.ts:effectivePrivileges` evaluates only those closed leaves, and
  no current decision asks for a `tool.*` privilege. Granting `tool.*` therefore changes no runtime
  decision.
- `packages/hub/src/channels/policy.ts:classifyToolClass` maps an
  `AgentPermissionRequest.name` beginning with `channel.tool.` to the broad class `channel`.
  `mayApprove` then checks `approval.channel`; it never checks the corresponding
  `channel.tool.<name>` grant. The actual Hub MCP tools are named `message` and `send_file`, so this
  naming convention does not describe their current execution path either.
- An approval rule may currently parse `match: channel.tool.<name>`, but
  `ruleMatchCoversToolClass` turns it into `approval.channel.tool.<name>` and compares it with
  `approval.channel`. It cannot match. This is accepted-but-inert configuration, not action-level
  authorization.

Keep `*`, `bot.*`, and `approval.*` only as Hub role-authoring shorthand. Compile them to exact
leaves before issuing Daemon authority. Read old `tool.*` and `channel.tool.*` values during a
bounded compatibility period, report that they have no effect, and omit them when Paseo saves the
configuration. New validation should reject them; approval-rule validation should accept only the
five current tool classes, `approval.*` forms, and `*` until action-level policy exists.

The relevant OpenClaw reference is the generic `message` tool in pinned
`openclaw@2026.7.1-2`, not a family of tools named `channel.tool.<name>`:

```ts
interface MessageToolInput {
  action: MessageAction; // required
  channel?: string;
  target?: string;
  targets?: string[];
  accountId?: string;
  dryRun?: boolean;
  // action-specific optional fields follow
}

interface MessageActionEnvelope {
  channel: string;
  action: string;
  params: Record<string, unknown>;
  accountId?: string;
  requesterAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  toolContext?: MessageActionToolContext;
  idempotencyKey: string;
}
```

The provider-facing TypeBox schema is one flat object: only `action` is always required; the
runner validates the fields required by that action. Shared fields cover routing, text and media,
reply/thread IDs, reactions, reads, polls, rich presentation, channel/member identifiers, channel
structure, moderation, presence, and Gateway options. Provider discovery narrows the action enum
and contributes extra fields for the configured account. The pinned catalog has 56 unique action
names; they fall into these product use cases:

| Use case                      | Representative OpenClaw actions                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliver content               | `send`, `broadcast`, `reply`, `sendAttachment`, `upload-file`, `sticker`, `poll`, `thread-reply`                                                                                         |
| Read and inspect              | `read`, `search`, `reactions`, `list-pins`, `thread-list`, `member-info`, `role-info`, `channel-info`, `channel-list`, `download-file`                                                   |
| Change existing content       | `edit`, `unsend`, `delete`, `pin`, `unpin`, `poll-vote`, `react`                                                                                                                         |
| Manage conversation structure | `thread-create`, `topic-create`, `topic-edit`, `channel-create`, `channel-edit`, `channel-delete`, `channel-move`, `category-create`, `category-edit`, `category-delete`, `event-create` |
| Manage participants           | `addParticipant`, `removeParticipant`, `leaveGroup`, `role-add`, `role-remove`, `timeout`, `kick`, `ban`                                                                                 |
| Act as the Channel account    | `renameGroup`, `setGroupIcon`, `set-profile`, `set-presence`, `voice-status`, `emoji-upload`, `sticker-upload`                                                                           |

The action enum is account-sensitive. In the pinned references, Slack may expose `send`,
`react`/`reactions`, `read`, `edit`, `delete`, file download/upload, pins, member lookup, and emoji
listing. Its schema contributions add Slack file IDs, message timestamps, emoji, top-level posting,
and reply broadcast. Telegram may expose `send`, `poll`, `react`, `edit`, `delete`, sticker
send/search, and topic create/edit. Its extra schema fields describe poll duration and anonymity.
Account action flags can narrow both lists.

OpenClaw supplies useful capability and schema machinery, but its policy is not Member RBAC:

- provider/account action flags answer whether an adapter supports and enables an action;
- global or per-Agent `tools.message.actions.allow` answers which actions the Agent sees and may
  call;
- `tools.message.crossContext` answers whether a call may leave the current conversation or
  provider; and
- none of those checks a Hub Member, Team assignment, Channel account assignment, Conversation
  whitelist, or Route revision.

The current Clisbot implementation is intentionally smaller. Inbound messages already arrive as
the flat OpenClaw `FinalizedMsgContext` projection documented in
`pinned-vertical-contracts/inbound.md`. Outbound tool Routes attach two Hub MCP tools:

- `message { action?: "send", text: string, final?: boolean }`; and
- `send_file { path: string, caption?: string }`.

Both tools derive their target from the binding in the MCP URL and ultimately call the in-repo
vertical's `outbound.sendText` or `outbound.sendMedia`. The in-repo
`packages/channels/shared/src/plugin.ts:ChannelPlugin` contract has no `actions` adapter, so the
OpenClaw action discovery, schema contributions, and action dispatcher are not present. Route
compilation currently preapproves `message` whenever `outbound.path` is `tool`, plus `send_file`
only when the target has an absolute Project root; it has no per-Route action list and does not
consult `approval.channel`. File sending resolves both the root and requested file through symlinks
before enforcing containment.

Channel replies now use an opaque, random capability kept in Hub process memory. The URL contains
no serialized routing data. Its server-side record fixes the organization, revision and Route,
Channel account, Conversation/thread, Project root, and created Agent; unknown, expired, forged,
cross-organization, rebound, or revoked capabilities fail closed. Replacing a revision or stopping
its account revokes the affected capabilities. This feature needs no new database or transport.

The minimum safe evolution is:

1. Keep the tool name `message` and OpenClaw's `action`-based shape, but implement the broker in
   Clisbot-owned Hub code. Start with the current `send` text/media behavior; add provider actions
   only when a product flow needs them. Require `action` in newly advertised schemas, accept a
   missing action as `send` only for old sessions, and keep `send_file` as a compatibility alias
   while existing Agent sessions can still reference it.
2. Replace the base64 binding ref with a random server-side capability ID resolved through the
   existing durable thread binding and Agent session. The binding owns the organization, Route
   revision, Channel account, Conversation/thread, allowed actions, Project or output roots,
   expiry, and revocation state. The model cannot supply or broaden those fields; do not create a
   second general token framework.
3. Compile a Route's exact action ceiling into that capability. `channel.use` continues to mean
   “invoke this fixed Route in these Conversations”; it may use only the Route-bound actions and
   does not expose a general cross-channel tool to the Member.
4. At execution, parse the action first, resolve its concrete account and Conversation, then check
   provider capability, Route/Agent tool policy, and identity/resource authority. Tool exposure
   and human approval are not substitutes for this final check.
5. Keep `approval.channel` separate: it permits a Member to answer a pending Channel-action
   request within the request's already-authorized resource ceiling. It does not itself grant the
   right to execute that action or choose another target.

For the MVP, a Member using a fixed Route needs only `channel.use`. The Agent may reply only through
the Route capability bound to that Channel account and Conversation/thread.

Add semantic Member privileges only when Paseo exposes operations outside a fixed Route: for
example, a Member sends directly from Paseo, or an Agent sends from Conversation A to Conversation
B. Add only the leaves the shipped flow needs (`channel.message.send`, `channel.message.read`, or
`channel.message.manage`) and scope them to the assigned Channel account and Conversations.

Never grant raw `tool.*`, an implementation tool name, or an unscoped `message` action; none
identifies both the permitted action and Channel resource.

Do not add these proposed names:

- `bot.manage`: use `channel.manage`;
- `bot.interact`: migrate to `agent.interact`, with a bounded read alias for old Channel config;
- a second product-level `daemon.manage`: use the current Daemon permission through the
  Administrator preset;
- `agent.profile.use` or `agent.create.custom`: an Agent profile is an optional preset, and the
  resolved Agent configuration is authorized directly;
- `mode.use`: Mode is constrained by the applicable `approval.*` and automatic-tool ceiling; and
- generic `feature.use`: add explicit cost/security actions only when a real feature requires one.

### 4.5 Built-in role and access-level defaults

| Organization role | Hub authority                                                                                                      | Resource authority                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `owner`           | `*` for the organization; the bootstrap owner may separately be the instance operator.                             | Implicit `*` over every current/future enrolled Daemon, Project, Channel, Automation, Agent configuration, and Fast mode. |
| `admin`           | `hub.view`, `hub.configure`, `hub.access.manage`, `hub.member.manage`, and `channel.manage`; cannot manage owners. | Explicit use assignments; administration does not automatically expose source code, terminals, or Channel conversations.  |
| `member`          | `hub.view`.                                                                                                        | Explicit Team/direct assignments only.                                                                                    |

Owner wildcard is evaluated from current membership and is not materialized as one row per
resource. `hub.instance.manage` is added only when the account is the instance operator.

The first Project access levels expand as follows:

| Access level         | Product privileges                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Office worker        | `project.use`, `agent.interact`, `agent.create`, `approval.file`                                                                                                                      |
| Developer            | Office worker plus `workspace.create`, `terminal.use`, `approval.config`, and `approval.command`, with `approval.command.destructive` denied                                          |
| Full access          | Developer plus `approval.command.destructive` and `approval.channel`                                                                                                                  |
| Use Fast mode        | Adds `agent.fast.use`; separate and off by default for non-owners                                                                                                                     |
| Daemon Connect       | Adds `daemon.connect`; no Project or operation authority by itself                                                                                                                    |
| Daemon Administrator | Expands to the required current daemon semantic permissions, including daemon read/manage, tunnel, access, workspace lifecycle, and daemon automation management; never `hub.execute` |
| Channel Use          | `channel.use` for the fixed Route only                                                                                                                                                |
| Automation Run       | `automation.run` for direct invocation                                                                                                                                                |

Provider, Model, and Thinking grants are data constraints attached to a Project assignment, not
additional privilege names. A complete resolved configuration must match one grant; fields from
different grants are never cross-combined. Fast mode is then checked separately with
`agent.fast.use`.

`workspace.create` permits a new Workspace (Local or New worktree) only within an explicitly
authorized Project. It does not grant Project creation or Workspace rename, archive, removal, or
other daemon-wide `workspace.manage` operations. New Developer and Full access selections include
this leaf; persisted assignments remain literal permission lists and do not gain it automatically.
To extend an existing assignment, explicitly select Developer or Full access again and save the
reviewed grant. Update the daemon before granting this leaf: older managed-admission parsers reject
unknown Project privileges rather than silently discard restrictions.

Do not add a custom-role editor in the MVP. Reuse the existing dot-subtree, grant, deny, and extends
algebra in Hub, but send only exact resolved privilege leaves to the Daemon.

### 4.6 Resource grants

Team and direct assignments target Channel accounts/Conversations, Daemons, Projects, or
Automations. Agent profiles are not resources. Selecting a Project also records its allowed Agent
configuration grants and explicitly adds Daemon Connect in the same review.

An enrolled Daemon publishes a minimal snapshot of stable Project identity plus ready Provider,
Model, Thinking, and Mode-safety metadata. Hub uses it for the access editor and fail-closed
delegation checks. Filesystem paths are not portable identity and are not exposed merely to render
the editor.

These layers combine with `AND`, not `OR`:

```text
daemon semantic permission
+ exact resource grant
+ product privilege
+ Agent-configuration constraint when creating an Agent
```

For example, `workspace.write` admits the RPC family, `project.use` proves the target Project,
`agent.create` admits creation, and one Agent-configuration grant must match. Passing any one layer
never implies the others.

## 5. `accessTicket` lifecycle

This proposal chooses an opaque ticket because it is adequate for an online internal Hub and avoids
premature JWT/JWKS/signing-key work. The format deliberately contains no claims:

```text
paseo_dat_<base64url(32 cryptographically random bytes)>
```

The prefix is for secret scanning, redaction, and operator diagnosis. The random body provides 256
bits of entropy. The format and prefix are implemented by `AccessTicketService`.

### 5.1 Generation

The Clisbot app calls an authenticated Hub endpoint with `daemonId` and `clientId`. Hub:

1. resolves the current user, membership, organization, and target daemon;
2. rejects a target outside that organization;
3. verifies that the member has `daemon.connect`, with owner wildcard applied;
4. generates the random ticket;
5. persists only a SHA-256 hash plus organization, membership, user, daemon, `clientId`, expiry,
   and consumed timestamp; and
6. returns the plaintext once with a short expiry, initially 60 seconds.

Do not embed privileges, user details, Project IDs, signatures, or refresh credentials in the ticket.
Resolve current grants when the daemon consumes it, which avoids authorizing from a stale policy
snapshot created seconds earlier.

### 5.2 Consumption

The app obtains a fresh ticket for each actual initial connection, physical reconnect, or failover
attempt and includes it in `hello`. It does not obtain tickets for scheduler ticks, heartbeats,
latency display, or background observation of an inactive route. The daemon uses its existing Hub
enrollment credential to call a consume operation. Hub atomically:

1. hashes and finds the ticket;
2. verifies unconsumed state, expiry, daemon, and `clientId`;
3. marks it consumed; and
4. returns an opaque linked `principalId`, compiled daemon semantic permissions, Project/privilege
   grants, and lease expiry.

The daemon binds that result to the new or resumed logical session before sending `server_info` or
any resource projection. A consumed or invalid ticket cannot fall back to full trust in `external`
mode. If an admission attempt may have reached `hello` but the response is lost, the next actual
attempt requests another ticket because the previous one may already have been consumed. This is
event-driven connection recovery, not periodic ticket refresh; no retry token protocol is needed.

### 5.3 Lease and revocation

The Hub owns one instance-level managed-access policy setting:

```yaml
managedAccess:
  leaseDuration: 15m
```

`managedAccess.leaseDuration` defaults to `15m` and accepts a positive bounded duration from `1m`
through `1h`. The compiled runtime value is `leaseDurationMs`; the unit-bearing suffix stays out of
the authored setting because the value already carries its unit. This is not a second daemon
setting: daemon `managedAccess.mode` decides whether external sessions require Hub authority, while
Hub `managedAccess.leaseDuration` decides how long the authority it issues remains valid. A future
multi-tenant product may add an organization override bounded by the instance policy; the MVP needs
only the instance value.

The production deployment ingress is
`PASEO_HUB_MANAGED_ACCESS_LEASE_DURATION=15m`; embedded/test composition may pass the equivalent
typed config object. Keeping the environment name at the composition root avoids making the
workflow/project configuration bundle own an instance security policy.

The one-use ticket establishes a daemon access lease for the configured duration. The daemon may
refresh the lease with the Hub using its existing enrollment credential; this does not need a client
RPC. Before `external` may ship, membership removal, grant changes, logout-all-devices, daemon
revocation, and a lease-duration change must push invalidation through the existing daemon-Hub
relationship and close matching sessions. New or reconnected sessions then receive the current
duration. If that relationship is unavailable, an established session may live only until its
existing lease expires, then fails closed. With the default, 15 minutes is therefore the documented
worst-case revocation delay during a Hub/daemon partition.

Ticket plaintext must never enter URLs, persisted Host profiles, analytics, errors, or logs. Relay
protects it with E2EE. A direct `ws://` connection does not encrypt application traffic, so external
direct access should use `wss://`, a trusted private overlay such as Tailscale, or the existing
daemon password as defense in depth. The ticket limits authority; it does not replace transport
security.

### 5.4 Explicit non-goals

Do not add in the first version:

- JWT claims, JWKS, signing-key rotation, proof-of-possession keys, or offline verification;
- a ticket refresh token stored by the daemon client;
- ticket data in a pairing URL;
- a new relay protocol or Hub data proxy; or
- client-side ACL as a substitute for daemon enforcement.

A signed grant may replace opaque consume later if offline Hub operation becomes a demonstrated
requirement. The resource-privilege and lease contracts can remain unchanged.

Disconnecting a managed Host uses Hub's canonical enrollment revocation. The Daemon is marked
revoked before its active leases are swept and notifications sent; only then does the Hub connection
close. Ticket consumption and lease refresh hold a shared lock on the active Daemon row until their
lease transaction commits, so revocation cannot miss a lease admitted immediately before the change.
The same lifecycle hook covers CLI and organization revocation. The shared client requires both Hub
configuration authority and Daemon management authority for its Disconnect action.

## 6. Existing code: what it is for and how much should constrain the product

The current Hub was built to explore a control plane, not to define the final product shell. Its
present implementation value is uneven. Compatibility work should preserve useful contracts, not
turn every existing route, table, or screen into a permanent product constraint.

### 6.1 Existing seams worth reusing

| Existing code                                                             | **CURRENT** job                                                                                                                                                                                                                                | Relevance to this proposal                                                                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BetterAuth account and organization code under `packages/hub/src/auth/**` | Login, session, membership, invitations, organization selection, and coarse organization capabilities.                                                                                                                                         | Reuse identity and tenancy. Extend policy; do not invent a second user database.                                                                                                 |
| Daemon registration/registry under `packages/hub/src/daemons/**`          | Enroll a daemon, store organization ownership/public identity/credential verifier, and track connected presence.                                                                                                                               | Reuse as Managed Host authority and daemon authentication for ticket consumption.                                                                                                |
| Daemon relationship code under `packages/server/src/server/hub/**`        | Maintain the daemon's authenticated outbound relationship to Hub and carry Hub execution work through a service principal.                                                                                                                     | Reuse the credential and relationship for consume, lease refresh, catalog publication, and invalidation. Keep its semantic permissions separate from user resource grants.       |
| Shared Expo app under `packages/app`                                      | One UI/runtime across web, mobile, and Electron.                                                                                                                                                                                               | Correct owner for account/profile, Channels, Automations, Managed Hosts, and Team & Access screens.                                                                              |
| `HostProfile` and `HostRuntimeStore`                                      | Persist manual host connection descriptors and probe/connect direct or relay paths.                                                                                                                                                            | Reuse unchanged connection types; add optional Hub-management metadata, reconciliation, and one narrow hook selecting the managed connection policy.                             |
| Existing WebSocket `hello` and `Session`                                  | Identify/resume a client and create the daemon interaction session for both transports.                                                                                                                                                        | Smallest common place to bind managed authority.                                                                                                                                 |
| Hub Trigger/configuration and Channel policy                              | Organization-owned revisioned Triggers and Channel revisions, durable Workflow execution, direct-Agent/Workflow routing, canonical encrypted Connection references, multi-account concepts, roles/privileges, and approval policy experiments. | Reuse the Trigger, Channel revision, Connection, and privilege owners. Channel authoring already lives outside the legacy Project model; do not add another configuration store. |

### 6.2 Existing surfaces that are not product constraints

| Existing code                                            | **CURRENT** job                                                          | Direction                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate TanStack Hub dashboard and its route hierarchy  | Operates the current Hub through a second web application.               | Do not preserve merely because it exists. Port useful operations into the shared Paseo client and retire after parity.                                                     |
| Legacy Project configuration APIs                        | Validate/install the older Project bundle model for API-key/CLI callers. | Keep for compatibility while organization Triggers and Channel revisions remain the target authoring owners. Do not route new Channel state back through a legacy Project. |
| Dashboard server functions                               | Couple the current React dashboard to Hub operations.                    | Inventory their application-service value before choosing the Paseo management API; no obligation to retain the React server-function boundary.                            |
| CLI organization credential                              | Lets an approved CLI call broad organization API scopes.                 | Do not reuse as an end-user app session or daemon access ticket. Its authority and lifetime are too broad.                                                                 |
| Current navigation and settings information architecture | Reflects the existing Hub implementation.                                | Re-design around Account, Channels, Automations, Managed Hosts, Team & Access, and Hub configuration.                                                                      |

Assessment: the present Hub code has limited sunk-cost authority over the product vision. If keeping
an implementation seam makes the single-user flow harder, duplicates the Paseo client, or prevents
a clear team authorization model, replace or bypass that seam. The durable value demonstrated so
far is primarily:

- multi-tenant identity and organization scoping;
- daemon enrollment into an organization;
- organization Trigger revisions and durable Workflow execution;
- organization-owned Channel revisions, encrypted Connections, and multi-account routing; and
- role/privilege and approval-policy experiments.

This is not a recommendation to rewrite the Hub wholesale. It is a rule for evaluating each seam:
reuse it when it shortens the target owner chain, not because compatibility with an exploratory Hub
implementation is itself a product goal.

## 7. Shared client boundary

**CURRENT:** `packages/app` is already the common Expo UI for web and native, and Electron wraps its
web build. `packages/app/src/runtime/host-runtime.ts` persists and connects Host profiles; it does
not know about Hub accounts or managed ownership.

**IMPLEMENTED:** Clisbot Hub UI/runtime code is isolated under:

```text
packages/app/src/clisbot/hub/
  transport/
  account-provider.tsx
  api-client.ts
  contracts.ts
  host-synchronization.tsx
  settings/
  *-configuration.ts
```

The minimal shared-app hook sites are:

- one conditional provider at the application root;
- one conditional Account/Hub group inside the existing Settings navigation;
- one Managed Host reconciliation adapter around `HostRuntimeStore`;
- one narrow connection-policy hook that disables inactive session probes only for Managed Hosts;
  and
- one optional `resolveAccessTicket()` callback passed to `@getpaseo/client` for real connection and
  reconnection attempts.

This is an app-distribution capability flag, not a user-facing Settings toggle. A user signs out to
leave their Hub account; they do not enable or disable the product integration. Keep it separate
from daemon `managedAccess.mode`, which is an owner/operator enforcement setting.

Use the existing Expo app-config path:

```text
CLISBOT_HUB_ORIGIN present or absent at build or deployment
  -> packages/app/app.config.js
  -> expo.extra.clisbotHub
  -> packages/app/src/clisbot/hub/config.ts
```

The app-facing shape is:

```ts
clisbotHub?: { origin: string };
```

There is no separate boolean: presence enables the integration and absence disables it, avoiding an
invalid `enabled`-without-origin state. The upstream-compatible build default is absence. In that
case the Hub module is not mounted, no Hub requests run, no Hub credential storage is opened, no Hub
UI is visible, and host/session behavior remains ordinary Paseo. Official Clisbot builds supply the
Hub origin. Web, iOS, Android, and Electron still use the same shared app code.

**DECIDED — Hub app authentication:** browser deployments served from the Hub origin reuse
BetterAuth's HTTP-only session cookie. Native and Electron are registered first-party OAuth public
clients of the same BetterAuth instance. They open the system browser and use Authorization Code
with S256 PKCE; they have no client secret. The browser returns only a one-use code, which the app
exchanges together with its verifier for a short-lived access token and rotating refresh token.

On iOS and Android, keep the access token in memory and the refresh token in Keychain/Keystore
through Expo SecureStore. The callback uses a verified Universal Link/App Link where available, with
the registered app scheme as the platform fallback. Electron keeps the existing packaged
`paseo://app` renderer. Its main process owns browser launch, callback validation, token exchange,
refresh, and protected persistence; the renderer receives account state and a narrow authenticated
Hub request bridge, never the refresh token. Loading the Hub website as Electron's main renderer or
copying a browser cookie into Electron is not part of the design.

OAuth credentials authenticate the app only to Hub APIs. Hub still resolves current organization
membership and grants before issuing a daemon-specific `accessTicket`; OAuth tokens never replace
that ticket or carry a durable snapshot of daemon/Project authority. The existing CLI organization
credential is also a separate credential.

## 8. Managed Host discovery without transport changes

**CURRENT:** a Host profile can already contain direct or relay connection descriptors. Relay
descriptors carry the relay endpoint and daemon public key; direct connections may carry the
current URL/password configuration. `HostRuntimeController` runs its scheduler every 2 seconds. If
no connection is online, it opens candidate connections on a 2s, 5s, 10s, then 30s backoff and the
first usable candidate may become active. While online, the active `DaemonClient` sends its own
liveness heartbeat every 10 seconds and the Host runtime reads that cached RTT; this does not open
a second session. The runtime also opens every inactive candidate as a temporary full
`DaemonClient` every 120 seconds, completes `hello`, measures latency, and closes it. After three
measurements with at least a 40ms improvement, it may switch to the faster route.

That temporary-client behavior is valid for an ordinary trusted Paseo Host, but not for a Managed
Host: `hello` is session admission, so supplying `getAccessTicket()` to those probes would mint and
consume one-use credentials merely to measure an unused route.

**IMPLEMENTED:** Hub bootstrap returns only existing descriptor shapes plus ownership facts and the
daemon-published managed-access mode:

```ts
management: {
  kind: "hub";
  hubOrigin: string;
  organizationId: string;
  daemonId: string;
},
managedAccessMode: "off" | "external";
```

Relay remains an opaque E2EE router. Direct/TCP remains the existing direct WebSocket path. Hub may
advertise both in an ordered candidate set, but a Managed Host does not run the ordinary inactive
session probes. On initial use it tries the preferred candidate as the user's real connection. If
that attempt fails, it obtains a fresh ticket and tries the next candidate. While connected, only
the existing 10-second heartbeat monitors the active route. A liveness failure triggers real
reconnect/failover and therefore a fresh ticket; a healthy connection is not replaced merely
because an inactive route might now be faster.

Ticket acquisition happens at `hello`, after the candidate transport is open. A candidate that is
unreachable at the transport layer therefore consumes no ticket. Once an attempt may have sent
`hello`, the next candidate uses a new ticket rather than assuming the prior one remains unused.

This gives a stable Managed Host zero background ticket churn and zero temporary Paseo Sessions.
If route reachability or latency for inactive candidates later proves necessary, add a
transport-level open/close probe that sends no Paseo `hello`, creates no Session, and uses no
ticket. That probe can establish path reachability but must not be presented as proof of daemon
identity or authorization. It is not part of the MVP. Ordinary manual/upstream Hosts retain the
current adaptive probing behavior unchanged.

A Tailscale address or other direct URL must be configured or operator-confirmed; Hub should not
guess reachability from a hostname or from daemon presence at the Hub. Hub presence proves only
that the daemon can reach Hub, not that this particular app can reach its direct address.

For the MVP, Hub may advertise a relay descriptor, any operator-approved `wss://` descriptor, and a
`ws://` descriptor only for loopback or when the operator explicitly records that it is carried by a
trusted private overlay such as Tailscale. Do not infer that trust from an IP range or hostname, and
do not advertise plaintext `ws://` on an ordinary LAN or public listener. This is Hub-side
validation of an existing direct descriptor, not a new transport.

The daemon publishes a full Project-catalog snapshot when its authenticated Hub relationship is
established and whenever its Project configuration changes. Hub replaces that daemon's snapshot
atomically; the MVP does not need a per-Project delta protocol. The concrete internal message name
can follow the relationship module's naming convention during implementation because it does not
change the product or authorization contract.

On logout or organization switch, disable/remove only Hub-managed registry entries and stop their
leases. Preserve every manual Host.

## 9. Daemon enforcement boundary

### 9.1 Trust and authorization layers

**Existing transport authentication:**

- A relay connection proves possession of the daemon public-key pairing material and establishes an
  E2EE application channel before the daemon processes `hello`.
- A direct connection is trusted by reachability unless the optional daemon password is configured;
  the password is checked during HTTP/WebSocket upgrade.
- Both paths then reach the same `handleHello` in
  `packages/server/src/server/websocket-server.ts`.

**Existing session creation:** after validating protocol version and `clientId`, `handleHello`
creates a reconnectable trusted session or resumes the session retained under that `clientId`.
The connection already carries a `SessionAdmission` containing `principalId`, semantic
`permissions`, and optional Hub-execution agents. Ordinary trusted connections use the built-in
owner admission; Hub execution uses its own service principal and narrower permissions. A
disconnected external session may be retained briefly for reconnect, keyed by principal plus
`clientId`.

**Implemented authorization:** `SessionAuthorization` checks every inbound message in
`Session.handleMessage` and every outbound message in `Session.emit`. The exhaustive operation maps
in `packages/server/src/server/authorization/operation-permissions.ts` classify RPCs by semantic
permission. For example, agent fetch needs `workspace.read`, agent messaging and terminal input need
`workspace.write`, daemon configuration needs `daemon.manage`, and pairing needs `access.manage`.

`SessionAuthorization` now also carries daemon-wide or Project-restricted resource authority and a
lease. `ManagedResourceAuthorizer` resolves each workspace, agent, terminal, and file root to a
Project before a restricted operation runs. Semantic permission and resource privilege must both
pass. Ordinary `off` sessions still receive owner admission and remain whole-daemon operators.

Concrete `off` case:

```text
Alice can establish a trusted connection
  -> hello creates SessionAdmission(principalId = "owner", permissions = all)
  -> project.list.request returns every active Project
  -> a known agentId can be fetched, messaged, archived, or approved
  -> a known cwd can be used for files
  -> a known terminalId can be subscribed to or controlled
```

### 9.2 Resource ownership facts that already exist

The daemon's existing registries remain the source of ownership identity; managed authorization
uses them instead of creating a parallel resource registry:

| Target supplied by a request | Existing owner/resolution fact                                                 | Managed-access enforcement                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `projectId`                  | `ProjectRegistry` owns the Project record.                                     | Require an exact Project grant.                                                                           |
| `workspaceId`                | `WorkspaceRegistry` record contains `projectId` and `cwd`.                     | Resolve to Project, then require its exact privilege.                                                     |
| `agentId`                    | A live/stored Agent carries `workspaceId`; that Workspace carries `projectId`. | Follow the full chain; unresolved legacy records fail closed.                                             |
| `terminalId`                 | `TerminalManager` returns a terminal carrying `workspaceId` and `cwd`.         | Resolve before list/subscribe/control and retain the authorized identity for binary frames.               |
| file `cwd` + relative path   | File service already confines the relative path under the root.                | Canonicalize the root, resolve it to an allowed Workspace/Project, then retain existing path confinement. |

**IMPLEMENTED:** `ManagedResourceAuthorizer` converts each
target to its canonical `projectId`. A resource-limited request whose target cannot be resolved to an
active, allowed Project fails closed. Existing registries remain owners of identity; authorization
does not create a parallel Project/workspace/agent registry.

For `agentId`, the resolver must follow records rather than parse the ID:

```text
agentId -> live/stored agent.workspaceId -> Workspace.projectId -> allowed Project?
```

The same relationship previously used for UI placement is now also evaluated before managed Agent
operations. The concrete cases are:

- `agent-a -> workspace-a -> project-a`, and the session may use `project-a`: allow the requested
  agent operation only when its narrower privilege such as `agent.interact` or `approval.*` also
  holds.
- `agent-b -> workspace-b -> project-b`, but the session may only use `project-a`: return a
  not-found-style result.
- The agent has no `workspaceId`, its Workspace no longer exists, or that Workspace's Project no
  longer exists: the Project cannot be proven, so deny in `external` mode. Do not treat an unresolved
  agent as daemon-global. Mode `off` preserves ordinary Paseo behavior.

### 9.3 What replaces the proposed `AccessContext`

There is deliberately no parallel `AccessContext` type. The implemented chain is:

```text
ManagedAccessAdmissionResolver
  -> SessionAdmission in websocket-server.ts
  -> SessionAuthorization in authorization/index.ts
  -> ManagedResourceAuthorizer in managed-access/resource-authorizer.ts
```

`SessionAdmission` carries the principal, semantic permissions, optional Project map, resource mode,
lease identity/expiry, and the pre-existing Hub-execution capability. `SessionAuthorization` owns
the active lease and Project map; `ManagedResourceAuthorizer` translates concrete IDs/paths through
the daemon's registries. Ticket HTTP code remains on the Hub/relationship boundary.

`packages/server/src/server/auth.ts` remains unrelated: it validates the daemon password for
HTTP/WebSocket reachability. The app's React `SessionContext` is client state and is also unrelated.

Do not flatten Projects and privileges into two independent arrays; that would create a false
cross-product. For example, terminal access on Project A plus ordinary access on Project B must not
become terminal access on both.

**Implemented shape:** Hub evaluates scoped role assignments and attaches exact effective privilege
leaves to admission. Do not send role names, wildcard patterns, or deny rules to the daemon:

```ts
interface ResolvedAgentConfigurationGrant {
  providerId: string;
  modelIds: "*" | readonly string[];
  thinkingOptionIds: "*" | readonly string[];
}

interface ProjectAuthorization {
  privileges: ReadonlySet<
    | "project.use"
    | "agent.interact"
    | "agent.create"
    | "agent.fast.use"
    | "terminal.use"
    | "approval.file"
    | "approval.config"
    | "approval.command"
    | "approval.command.destructive"
    | "approval.channel"
  >;
  agentConfigurations: readonly ResolvedAgentConfigurationGrant[];
}

interface SessionAdmission {
  principalId: string; // opaque daemon principal linked to the Hub subject
  permissions: readonly DaemonPermission[];
  projects: ReadonlyMap<string, ProjectAuthorization>; // projectId -> exact grant
  resourceMode?: "daemon" | "projects";
  leaseId?: string;
  leaseExpiresAt?: number;
  hubExecutionAgents?: HubExecutionAgents; // existing service-principal capability
}
```

The daemon checks exact membership in each resolved set. For example, a role that grants
`approval.command` and denies `approval.command.destructive` produces `approval.command` but not the
destructive leaf. The daemon does not need to interpret Hub organization IDs, memberships, roles,
assignments, wildcard patterns, or deny/extends rules. Hub evaluates those concepts when the ticket
is consumed and returns an opaque linked principal plus daemon-native permissions and already-
resolved resource privileges. Owner wildcard is evaluated by Hub and can compile to daemon-wide
resource mode; it is not expanded into one row per Project.

Upstream intentionally groups agent and terminal code execution under `workspace.write`. The Hub's
`terminal.use`, `agent.interact`, `agent.create`, `agent.fast.use`, and `approval.*` privileges
remain useful interaction controls, but they are not a sandbox boundary: a user allowed to run an
agent may still cause code execution without opening a terminal. Implement them as narrower
operation constraints inside `SessionAuthorization`, not as a claim that terminal denial removes
all execution authority.

In mode `off`, the existing owner admission remains unchanged; no Hub ticket, resource grant, or
lease is created or consulted.

### 9.4 Where managed authority binds to a session

`attachSocket()` still creates a `PendingConnection` with default admission before `hello`. The
implemented `handleHello()` path is asynchronous only when `external` policy applies:

1. `handleHello` receives the schema-optional `accessTicket`.
2. In mode `external`, a relay or TCP connection without a ticket is rejected before
   `createSessionConnection`.
3. An async admission resolver consumes the ticket with Hub and returns the linked `principalId`,
   semantic permissions, Project/privilege grants, and lease expiry.
4. The daemon verifies connection authority, daemon identity, `clientId`, expiry, and its enrolled
   Hub relationship.
5. The resolver replaces the pending owner/default admission before the reconnect key is computed.
   Only then may `createSessionConnection`, resume, `server_info`, or any resource snapshot run.

**Implemented reconnect:** every external physical reconnect presents a fresh ticket. It must resolve
to the same principal as the retained logical session. If the effective grant fingerprint changed,
the safest MVP behavior is to discard the retained Session and bootstrap a new one rather than try
to purge every old subscription/cache in place. A different principal using the same `clientId` is
rejected.

**Implemented lease change/revocation:** close the affected managed session and require a new ticket.
This is simpler and safer than mutating authority inside a live session. Loopback, plugin, and the
existing daemon-owned Hub execution connection remain separate trust classes and must not
accidentally inherit this external-user policy.

`updatePrincipalPermissions()` already proves that upstream can narrow a live principal, but it
changes only semantic permissions. Closing a resource-limited Session remains the safer MVP because
it also clears Project subscriptions, visibility caches, upload slots, and terminal streams.

### 9.5 Project, workspace, and agent discovery

**Existing discovery mechanics:**

- `project.list.request` lists every non-archived Project from `ProjectRegistry`.
- `fetch_workspaces_request` and `fetch_agents_request` support filters, paging, sync cursors, and
  subscriptions, but those filters are supplied for UI/query behavior, not security.
- Session subscribes to registry and `AgentManager` mutations. Project, workspace, agent, timeline,
  permission, and attention events can later be pushed to the session.
- Selective timeline delivery limits streams to agent IDs the client says it is viewing. It is a
  performance/UI mechanism; the client may subscribe to any agent ID.

**IMPLEMENTED:** filter bootstrap lists before paging/sync state is seeded, and validate subscriptions
before recording them. Every pushed event resolves its Project again before delivery. A removal is
sent only for a resource previously visible to that session.

Concrete case:

```text
Alice: Project A -> project.use
Bob:   Project B -> project.use

Alice project.list                 => [Project A]
Alice fetch_workspaces/fetch_agents => only entries under Project A
Project B agent emits timeline      => Alice receives nothing
Alice subscribes with Bob's agentId => not-found style response; no subscription retained
```

Filtering only the first list is insufficient: without the event check, a later
`agent_stream`, `agent_permission_request`, `project.update`, or workspace update would reveal the
hidden resource.

### 9.6 Direct requests and guessed IDs

**Before managed resource enforcement:** handlers such as `fetch_agent_request`, `send_agent_message_request`, timeline fetch,
archive/delete/cancel, and `agent_permission_response` resolve an ID and operate on it. Existence is
checked; caller ownership is not. `create_agent_request` can also be driven by `workspaceId`, caller
agent, or a client-supplied `cwd`.

**IMPLEMENTED:** resolve target → workspace → Project and require both its resource grant and the
operation privilege before calling the existing handler/manager. Do not move agent lifecycle side
effects into managed-access code.

Examples:

- Alice knows an agent ID from Project B and calls `fetch_agent_request`: return the same public
  shape as an unknown agent; do not reveal that Project B or the agent exists.
- Alice calls `send_agent_message_request` for Project A: require `project.use`, then call the
  existing prompt path unchanged.
- Alice creates an agent with a Project A workspace: allow with `project.use`.
- Alice supplies an arbitrary `cwd`, a Project B workspace, or an unresolved legacy agent: deny
  before filesystem or provider work starts.

For managed external sessions, a Project must be registered before it can be used. The current
loopback/`off` flow may continue opening an arbitrary directory and thereby create/register a
Project as Paseo does today.

Hub-owned Channel and Automation execution uses the separate `hub.execute` service principal. It
still cannot trust an authored `{ projectId, cwd }` pair: before Agent creation,
`DaemonExecutions` asks the daemon-owned registry to resolve the `cwd` or worktree source and
requires the result to equal `projectId`. Unknown or mismatched placement fails before provider or
filesystem side effects, including for organization owners and Daemon Administrators.

### 9.7 Files and download/upload paths

These are three different surfaces and must not be treated as one path flow.

#### Workspace file operations

**Existing file boundary:** browse/read, write, create/rename/duplicate/delete, file subscriptions, Project-icon
lookup, and download-token requests carry a client-supplied `cwd`. The file service safely confines
the relative `path` under that root, including canonical-path checks against symlink escape. However,
the caller chooses the root itself and `WorkspaceFilesSession` does not consult `WorkspaceRegistry`.

This answers only “did `path` escape from `cwd`?”, not “may this user access `cwd`?”. A trusted client
could send `cwd=/company/project-b` and `path=secrets.txt`; keeping the path under Project B still
does not authorize Alice, who has access only to Project A.

**IMPLEMENTED:** in `external`, canonicalize `cwd`, resolve it to an active Workspace and Project, then
require `project.use` before reading metadata/content, mutating a file, or installing a watcher. An
unknown root fails closed. Session close or revocation disposes its authorized watchers. Owner
wildcard covers every registered Project, not every path readable by the daemon OS user. Mode `off`
retains ordinary Paseo arbitrary-root behavior for local recovery and upstream compatibility.

#### Download

**Existing download flow:** download is a two-step capability flow:

```text
WebSocket file_download_token_request(cwd, path)
  -> daemon resolves one absolute file path and issues a random, one-use token
  -> browser GET /api/files/download?token=...
  -> token is consumed and that file is streamed
```

The default token lifetime is 60 seconds. The HTTP request intentionally needs only that capability
token, but token issuance currently has no Project authorization.

**IMPLEMENTED:** perform the Workspace/Project check before issuing the token. Keep the existing HTTP
download route and one-use token format unchanged; it does not need to repeat Hub login. For the MVP,
a token already issued remains usable once until its short expiry even if the Session is revoked.
Per-Session token invalidation can be added later if immediate download revocation becomes a product
requirement.

#### Upload and uploaded attachments

**Existing upload flow:** `file.upload.request` does **not** contain `cwd` and does not write into a Project. It
opens a Session-owned transfer slot; binary frames identified by `requestId` write a temporary file
under the daemon's Paseo home, then return an `uploaded_file` attachment containing its server path.
When that attachment is sent to an agent, the prompt currently uses the supplied attachment path.
This is safe only under Paseo's existing trusted-client assumption; Project authorization cannot be
derived at upload start because no target Project or agent is named yet.

**IMPLEMENTED:** do not invent a Project check for the staging upload itself. Bind the upload slot and
completed upload handle to the managed Session. When the client attaches it to an agent message:

1. resolve the target `agentId` to an allowed Project and require `project.use`;
2. resolve the uploaded handle from daemon-owned Session state; and
3. do not trust a client-supplied filesystem `path` as proof of an upload.

A future operation that copies an upload into a Project is a separate Project file mutation and must
authorize the destination Workspace before writing. Binary upload chunks are accepted only for a
slot opened by the same authorized Session.

### 9.8 Terminals, including binary frames

**Existing terminal identity:** `TerminalSessionController` already associates terminals with `workspaceId` and `cwd`,
and directory subscriptions use a `(cwd, workspaceId)` key. This is isolation between workspace
identities for correct UI state, not user authorization.

Current sensitive paths include:

- list all terminals when `list_terminals_request` omits `cwd`;
- list/subscribe by directory;
- create using `workspaceId` or legacy `cwd` resolution;
- subscribe/capture/rename/input/kill using `terminalId`; and
- input/resize binary frames using the stream slot assigned at subscription time.

**IMPLEMENTED:** every path requires `terminal.use` on the terminal/workspace's Project in addition to
the base Project being visible. A list without `cwd` returns only authorized terminals. A managed
legacy cwd-only request must resolve unambiguously to an allowed workspace or fail closed.

`subscribe_terminal_request` authorizes the terminal before assigning a binary slot. The slot keeps
the resolved Project identity; binary input/resize is accepted only while the lease and
`terminal.use` remain valid. Session close/revocation detaches all active streams. Checking only the
JSON subscribe request would otherwise leave a binary control bypass.

Concrete case: Alice may work in Project A but lacks `terminal.use`. She still sees agents/files in
A, but terminal lists are empty and create, subscribe, text input, binary input, capture, rename,
and kill are denied.

### 9.9 Permission requests and permission-mode bypasses

**Existing provider flow:** `agent_permission_response` accepts both `{ behavior: "allow" }` and
`{ behavior: "deny" }` and forwards them through `respondToAgentPermission`. Managed sessions now
filter permission events by Project and authorize every response before forwarding it.

**Existing interaction behavior:** sending or steering a normal human message sets `clearPendingPermissions: true`; the
provider uses this to deny/clear permissions blocking the steer. This does not approve the sensitive
operation, but it means “respond” is broader than the authority that needs protection.

**Existing Agent configuration:** agent creation/configuration can select provider permission modes and tool policy.
Guarding only the approval button would be ineffective if the same user could launch an agent in a
bypass/no-prompt mode or preapprove the tool. Voice mode also has a narrow daemon-owned auto-allow
path for its recognized speak permission.

**IMPLEMENTED:**

- require `project.use` to see the permission event or send an explicit deny;
- classify every provider permission request with the same provider-neutral classifier used by the
  channel approval flow, then require the matching Project privilege: `approval.file`,
  `approval.config`, `approval.command`, `approval.command.destructive`, or `approval.channel`;
- fail closed when a request cannot be classified into a grantable `approval.*` leaf;
- keep message-driven clear/deny under `project.use` because it cannot authorize the blocked tool;
- prevent a caller without higher authority from selecting a permission mode/tool policy above the
  organization's allowed ceiling; Mode has no separate permission and must remain within the
  applicable `approval.*` and automatic-tool ceiling;
- require `agent.fast.use` when `featureValues.fast_mode` is enabled; and
- treat any daemon-owned auto-allow as an explicit, tested policy exception. Disable it for managed
  sessions if it cannot be proven narrower than the organization policy.

Concrete case: Alice has `project.use`, `agent.interact`, `agent.create`, and `approval.file`, but no
`approval.command` or `agent.fast.use`. She can continue chatting, create an allowed Agent, approve
a file request, or deny any request. An explicit allow for a command is rejected; a destructive
command is checked against the narrower
`approval.command.destructive` leaf under the existing dot-subtree/deny semantics. Changing
Mode/provider options to bypass prompts or enabling Fast mode is also rejected, so the UI gate
cannot be bypassed at Agent creation.

### 9.10 Daemon-global operations

**Existing semantic classification:** upstream classifies daemon-global operations explicitly. Configuration, update,
restart, plugins, and skills use `daemon.manage`; pairing and grant changes use `access.manage`; Hub
and relay relationship changes use `tunnel.manage`; diagnostics/status use `daemon.read`; Project
and workspace lifecycle uses `workspace.manage`. Managed Access adds one narrow exception for
`workspace.create.request` and its response when an active project-scoped Session has
`workspace.create`; resource authorization still verifies its explicit Project and source root.
Other operations without the required semantic permission receive `access_denied` before the
handler runs.

**IMPLEMENTED:** `Administrator` is a UI access level that compiles to the exact current daemon
semantic permissions it is meant to receive. Do not add another product privilege named
`daemon.manage`, and do not collapse upstream's `access.manage` or `tunnel.manage` boundaries inside
daemon code. A Member with only `daemon.connect` plus Project grants receives no effective
daemon-global access: the compatibility `daemon.read` namespace is narrowed to filtered Provider
catalog, liveness, and resource-bearing Agent status frames, while config, diagnostics, usage,
Provider diagnostics, skills, and daemon status fail closed.

The exhaustive operation classification already exists and uses TypeScript `Record` coverage, so a
new upstream RPC causes a compile failure until classified. Managed Access adds resource resolution
after this existing operation check; it does not maintain a second RPC-name table.

### 9.11 Outbound enforcement and errors

**Existing base check:** `Session.emit` checks the outbound message type against semantic
permissions. That check alone cannot distinguish two `agent_stream` messages belonging to different
Projects; selective subscriptions and query filters are not ACLs.

**IMPLEMENTED:** authorize before constructing or emitting resource-bearing text and binary messages.
Lists omit unauthorized entries. A direct lookup of an unauthorized resource normally returns the
same not-found result as a nonexistent resource to avoid confirming IDs. A known daemon-global
operation without its required privilege may return `access_denied` because daemon existence is
already established by the connection.

Extend the existing authorization owner. A request must pass all applicable checks (`AND`), in this
order:

1. **Semantic permission:** may this principal perform this operation family on the daemon?
2. **Resource grant:** does the resolved Daemon/Project belong to this principal's authority?
3. **Product privilege:** may the principal perform the specific interaction, such as
   `agent.interact`, `agent.create`, `agent.fast.use`, `terminal.use`, or the classified
   `approval.*` leaf?

Ordinary trusted Paseo Sessions enter with owner permissions and daemon-wide resources. A Hub
execution Session has only its service-principal permissions, such as `hub.execute`; it cannot call
file or terminal operations. A managed user Session receives equal or narrower semantic permissions
plus Project grants from ticket admission.

Concrete managed-client cases:

```text
send_agent_message_request(agent-a)
  semantic permission workspace.write  -> pass
  agent-a -> project-a; project.use     -> pass
  result                                -> allow

send_agent_message_request(agent-b)
  semantic permission workspace.write  -> pass
  agent-b -> project-b; no project.use  -> fail
  result                                -> not found

daemon config update
  semantic permission daemon.manage    -> fail
  result                                -> access_denied
```

This preserves upstream's permission model and restricted Hub execution principal. Managed Access
adds the missing per-resource dimension without redefining RPC names as authority.

## 10. Fast Channel-to-work flow

The primary product path is:

```text
Sign in to Hub
  -> choose or connect one encrypted provider Connection
  -> Add Channel account behavior
  -> choose Conversation, optional message-text condition, and Audience
  -> choose a fixed Automation first, or direct Project + Agent controls
  -> optionally Apply Agent profile
  -> choose the Route-bound Channel reply actions and output roots
  -> validate the complete candidate revision
  -> activate, restart the Channel account from the new snapshot, and test the Route
  -> Open in Paseo
  -> obtain accessTicket
  -> connect direct or through relay
  -> open the selected Project
```

Managing the Channel account or Route requires `channel.manage`, but using one fixed Route requires
only `channel.use` for its assigned Conversations. It does not grant direct
Project, File, Terminal, or Automation access. `Open in Paseo` separately requires
`daemon.connect`, `project.use`, and the narrower Project privileges in the catalog.

Hub Route/Automation execution and an interactive user Session remain different principals. A
Route retains a fixed target and execution ceiling rather than inheriting its creator's future
authority. An Agent profile may fill Agent controls but is not an authorization resource or a live
dependency.

Routes are ordered alternatives: the first Conversation/text match selects exactly one target. An
existing direct Channel binding continues its Agent after follow-up admission instead of changing
target because later text matches another Route. Fanout is outside this MVP and must be designed
together with per-target idempotency. The complete Channel configuration, UI, persistence, and
runtime-reconciliation contract is owned by
[Unified client Hub configuration UI](2026-09-01-unified-client-hub-configuration-ui.md).

## 11. Minimum source-change map

The paths and symbols below are the implemented seams. They are intentionally concentrated so a
future upstream merge sees small protocol/runtime hooks and Clisbot-owned policy modules.

### 11.1 Wire and daemon client

| Relative file path                          | Function / class / schema                                      | Implemented responsibility                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/managed-access.ts`   | `ManagedAccessModeSchema`, `MutableManagedAccessConfigSchema`  | Owns the shared `"off" / "external"` daemon-policy vocabulary.                                                                |
| `packages/protocol/src/messages.ts`         | `WSHelloMessageSchema`, daemon config and server-info schemas  | Optional `accessTicket`, `managedAccess.mode`, and diagnostic capability. Missing optional fields preserve old-wire behavior. |
| `packages/client/src/daemon-client.ts`      | `DaemonClientConfig.resolveAccessTicket`, `sendHelloMessage()` | Resolve a fresh ticket only for an actual hello. With no resolver, the hello is byte-compatible with ordinary Paseo.          |
| `packages/client/src/daemon-client.test.ts` | `DaemonClient` hello tests                                     | Covers absent resolver, one ticket per actual hello, and fail-closed ticket-resolution errors.                                |

### 11.2 Daemon

| Relative file path                                                    | Function / class / type                                                      | Implemented responsibility                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/bootstrap.ts`                             | `initialManagedAccessConfig()`, daemon composition                           | Loads mutable mode, wires Hub ticket consume/lease refresh, republishes mode changes, and keeps `off` independent of Hub admission.                               |
| `packages/server/src/server/authorization/index.ts`                   | `SessionAuthorization`                                                       | Combines existing daemon semantic permissions with Project grants and lease state.                                                                                |
| `packages/server/src/server/authorization/operation-permissions.ts`   | `requiredPermissionForInbound()`, `requiredPermissionForOutbound()`          | Remains the exhaustive RPC-family classifier; Project/resource checks are a second authorization dimension.                                                       |
| `packages/server/src/server/managed-access/types.ts`                  | `ManagedAccessAdmission`, `ProjectAuthorization`                             | Carries already-resolved exact privilege leaves and Agent-configuration constraints; the daemon does not interpret Hub roles.                                     |
| `packages/server/src/server/managed-access/resource-authorizer.ts`    | `ManagedResourceAuthorizer`                                                  | Resolves Project/workspace/agent/terminal/file ownership through existing registries and fails closed when ownership cannot be proven.                            |
| `packages/server/src/server/path-utils.ts`                            | `isSameOrDescendantPath()`                                                   | Normalizes POSIX/Windows traversal and sibling boundaries before containment checks; managed async paths also resolve symlinks and their nearest existing parent. |
| `packages/server/src/server/websocket-server.ts`                      | `SessionAdmission`, `handleHello()`, `admitManagedAccess()`                  | Consumes the hello ticket before reconnect/session creation in `external`; local IPC and the daemon-owned Hub service session remain separate.                    |
| `packages/server/src/server/session.ts`                               | `Session.handleMessage()`, `.handleBinaryFrame()`, `.emit()`                 | Filters discovery and pushed events, rejects guessed IDs, and applies Agent/approval checks before side effects.                                                  |
| `packages/server/src/server/session/files/workspace-files-session.ts` | `WorkspaceFilesSession`                                                      | Resolves and authorizes canonical Workspace/Project roots before file I/O, subscriptions, or download-token issue.                                                |
| `packages/server/src/server/file-upload/index.ts`                     | `FileUploadStore`                                                            | Binds staged uploads to the session that created them before later attachment use.                                                                                |
| `packages/server/src/terminal/terminal-session-controller.ts`         | `TerminalSessionController.dispatch()`, `.handleBinaryFrame()`               | Applies `terminal.use` to terminal JSON and binary paths.                                                                                                         |
| `packages/server/src/server/hub/relationship-remote.ts`               | `DirectHubRelationshipRemote.consumeAccessTicket()`, `.refreshAccessLease()` | Performs daemon-authenticated ticket consumption and lease refresh through the enrolled Hub relationship.                                                         |
| `packages/server/src/server/hub/relationship-controller.ts`           | `HubRelationshipController`                                                  | Publishes daemon facts and receives targeted lease revocation without moving Hub policy into daemon code.                                                         |
| `packages/server/src/server/hub/daemon-executions.ts`                 | `DaemonExecutions.create()`, `requireProjectPlacement()`                     | Verifies Project plus canonical daemon-owned cwd/worktree placement before a Hub service-principal Agent create or reuse.                                         |

### 11.3 Hub

| Relative file path                                | Function / class / type                                         | Implemented responsibility                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/hub/src/auth/server.ts`                 | `createAuthServer()`, `AuthServer`                              | Reuses BetterAuth sessions/organizations and exposes first-party Authorization Code + S256 PKCE for native/Electron clients.         |
| `packages/hub/src/auth/client-authorization.ts`   | `ClientAuthorization`                                           | Owns authorization-code, access-token, refresh-token, rotation, and revocation state for public app clients.                         |
| `packages/hub/src/access/contract.ts`             | privilege/resource schemas and access-level catalog             | Defines shared stable names; Hub-management actions remain role-derived and are not assignable as Member resource grants.            |
| `packages/hub/src/access/store.ts`                | `AccessStore`, `resolveDaemonAccess()`                          | Resolves Team/direct assignments, owner wildcard, exact daemon permissions, Project privileges, and Agent-configuration grants.      |
| `packages/hub/src/access/delegation.ts`           | `assertAutomationConfigurationDelegation()`                     | Rejects unsafe delegated Agent configurations, including Fast/unattended/auto-approval and missing approval privileges.              |
| `packages/hub/src/access/daemon-projects.ts`      | `listDaemonProjectCatalog()`                                    | Projects the daemon-published stable Project and Agent-configuration catalog for management and delegation checks.                   |
| `packages/hub/src/managed-access/tickets.ts`      | `AccessTicketService`, `readAccessLeaseDuration()`              | Issues/atomically consumes opaque one-use tickets and refreshes configurable 15-minute leases from current authority.                |
| `packages/hub/src/managed-access/revocation.ts`   | `AccessLeaseRevocation`                                         | Revokes affected leases after membership/access mutations and notifies connected daemons immediately; expiry remains the fallback.   |
| `packages/hub/src/managed-access/http.ts`         | daemon ticket/lease handlers                                    | Provides authenticated daemon consume and refresh operations.                                                                        |
| `packages/hub/src/management-api/index.ts`        | `ManagementApi`, `handleAccessAssignments()`, `handleDaemons()` | Exposes shared Paseo/CLI management resources, user ticket issue, daemon bootstrap, and semantic management-action checks.           |
| `packages/hub/src/db/schema.ts`                   | access assignment, Project catalog, ticket, and lease tables    | Persists policy and only ticket verifiers; `memory.ts` and `pg.ts` implement the same database contract.                             |
| `packages/hub/src/application-runtime.ts`         | `createApplicationRuntime()`, `createManagementApi()`           | Composes Access, ticket/lease, management, Channel, Automation, and daemon notification owners.                                      |
| `packages/hub/src/provider-applications/index.ts` | `ProviderApplications.onConfigurationChanged()`                 | Emits a redacted post-commit credential-change fact so current runtime consumers can reload without exposing or duplicating secrets. |

### 11.4 Shared app

| Relative file path                                        | Function / class / type                                           | Implemented responsibility                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/app.config.js`                              | `expo.extra.clisbotHub`                                           | Build capability: absent means no Hub UI, request, storage, or Host side effect.                                                              |
| `packages/app/src/clisbot/hub/config.ts`                  | `getHubConfiguration()`, `parseHubConfiguration()`                | Validates the Hub origin once for all platforms.                                                                                              |
| `packages/app/src/clisbot/hub/transport/oauth.ts`         | PKCE URL/token helpers                                            | Shared state, verifier/challenge, callback, and token request contract.                                                                       |
| `packages/app/src/clisbot/hub/transport/create.native.ts` | `NativeHubTransport`                                              | Uses system-browser PKCE and Expo SecureStore for the rotating app credential.                                                                |
| `packages/app/src/clisbot/hub/transport/create.web.ts`    | `BrowserHubTransport`, `ElectronHubTransport`                     | Browser uses same-origin HTTP-only cookie; Electron delegates authenticated requests to the main-process IPC adapter.                         |
| `packages/app/src/clisbot/hub/api-client.ts`              | `HubApiClient`                                                    | Shared typed HTTP operations for account, management resources, bootstrap, and access-ticket issue.                                           |
| `packages/app/src/clisbot/hub/account-provider.tsx`       | `HubAccountProvider`, `useHubAccount()`                           | One cross-platform signed-out/loading/setup/signed-in state owner.                                                                            |
| `packages/app/src/clisbot/hub/cli-login-screen.tsx`       | `HubCliLoginScreen`                                               | Approves CLI login, observes the resulting Host enrollment, and opens the shared Add Project flow with that Host preselected.                 |
| `packages/app/src/clisbot/hub/host-synchronization.tsx`   | `HubHostSynchronization`, `HubHostBinding`                        | Reconciles Hub Daemons into existing Host profiles and registers a ticket resolver only for published `external` mode.                        |
| `packages/app/src/clisbot/hub/managed-host-discovery.ts`  | `hubHostDiscoveryRefetchInterval()`                               | Bounds the faster Daemon-catalog refresh used only while an approved enrollment is expected to add a Host.                                    |
| `packages/app/src/runtime/host-session-access.ts`         | `registerHostAccessTicketResolver()`, `resolveHostAccessTicket()` | Isolates the optional Clisbot admission hook from the upstream Host transport model.                                                          |
| `packages/app/src/runtime/host-runtime.ts`                | `HostRuntimeController`                                           | Resolves a ticket only for real connection admission/reconnect; no ticket is created for ordinary background health probes.                   |
| `packages/app/src/screens/settings-screen.tsx`            | `SettingsSidebar`, `SettingsScreen`                               | Reuses the existing App/Host Settings shell and mounts Clisbot-owned Account, Channels, Automations, Team, Access, and Configuration screens. |
| `packages/app/src/clisbot/hub/sidebar-account.tsx`        | `HubSidebarAccountButton`                                         | Opens the existing Account route; feature-off and signed-out states render no avatar.                                                         |
| `packages/app/src/components/left-sidebar.tsx`            | `SidebarFooter`                                                   | Adds one optional Clisbot-owned avatar mount beside the unchanged Settings button.                                                            |

### 11.5 Electron

| Relative file path                            | Function / class / type                | Implemented responsibility                                                                                                                      |
| --------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/features/hub-client.ts` | `DesktopHubClient`, `allowedHubPath()` | Runs loopback PKCE in the main process, encrypts the refresh token with `safeStorage`, rotates it, and allows only fixed Hub API path families. |
| `packages/desktop/src/main.ts`                | desktop bootstrap                      | Registers the Hub client while keeping the renderer on the packaged `paseo://app` origin.                                                       |
| `packages/desktop/src/preload.ts`             | `window.paseoDesktop.hub` bridge       | Exposes sign-in/sign-out/account/request methods without exposing credentials or arbitrary authenticated URLs.                                  |

No semantic source change is expected in `packages/relay`: `createClientChannel()` and
`createDaemonChannel()` in `packages/relay/src/encrypted-channel.ts` continue carrying opaque hello
bytes.

Avoid moving, renaming, or formatting upstream-owned files. Every shared-file change should be a
small additive hook delegating to a Clisbot-owned module.

## 12. Delivery and rollout

The MVP implementation includes the shared Account/Settings shell, browser/native/Electron
authentication adapters, owner wildcard, daemon/Project bootstrap, opaque ticket and lease
lifecycle, `external` admission, Project/resource enforcement, Team/direct access, Channel Route
configuration, and Automation management. An owner can sign in and use every enrolled daemon
without creating Team or Access rows.

Rollout remains operationally staged:

1. ship the Clisbot client and daemon with every daemon defaulting to `off`;
2. verify owner access and the local IPC recovery path for each daemon;
3. enable `external` per daemon from its existing Host Settings page; and
4. invite Members, place them in Teams, and add only the required Channel, Automation, Daemon, and
   Project access.

Deliberate post-MVP work is limited to demonstrated needs: custom role/deny editing, finer-grained
file privileges, signed offline grants, multi-target Channel fanout/idempotency, provider-wide
conversation discovery, and richer access-event reporting. None is required for the owner or the
fixed public/customer Channel flows documented here.

### 12.1 Channel supervisor admission (open gap)

> Plain-language map of the two authorization paths, the Guest subject, and `/link`:
> [2026-09-10 Channel vs Paseo app](2026-09-10-channel-vs-app-admission.md).

This design covers the interactive app's host session. It does not cover the channel supervisor's
own daemon connection, which is a separate, unresolved gap.

Two authority axes must not be conflated. A channel **sender's** Member authority is resolved and
enforced at the Hub, before any daemon RPC: the plane's `senderIdentity` (e.g. `"slack:U123"`) maps
through `channelIdentities` to a Member (or the Guest subject) and is checked against Access
assignments — `channel.use` baseline, then `agent.interact` / `agent.create` / `approval.*` /
Agent-configuration grant, scoped to the `channel_account` resource, the conversation, and the
target daemon/Project (`packages/hub/src/access/store.ts:891-924`; `permissions.md` §"Channel
command access"). The daemon never sees the sender. The supervisor's daemon **lease** is the other
axis: one service principal per channel account, shared by every sender and conversation on that
account. It is the account's outer ceiling, not where per-sender Member authority is decided.
Per-member authority cannot move into the lease because one account connection cannot distinguish
its senders; the two axes share a privilege vocabulary but evaluate different subjects at different
layers.

The supervisor opens one trusted-client WebSocket **per channel account**
(`packages/hub/src/channels/supervisor/index.ts:7-9`; connect at `index.ts:1328`), authenticated
only by the optional daemon password and loopback trust
(`packages/hub/src/channels/daemon/ws-client.ts:189-199`). Its `hello` carries no `accessTicket`,
and `ChannelDaemonClientOptions` has no field to add one
(`packages/hub/src/channels/daemon/client.ts:22-44`). In `external` mode the daemon treats every
non-`hub`, non-`local_ipc`, non-plugin client as a managed subject — loopback TCP included
(`packages/server/src/server/websocket-server.ts:1745-1750`) — so the connection is rejected at the
hello gate (`websocket-server.ts:1759-1763`). The channel plane therefore works only while the
target daemon is `off`. Commit `7b4e60919` fixes URL targeting for a remote daemon pod; it does not
make the session admissible.

Kept for now: one connection per account. The failure-isolation reason is sound at small scale, but
the account is the wrong axis for admission — the natural unit is `(daemon, principal, resolved
grants)`. Accounts routing to the same project/grants on one daemon produce redundant leases, and
the "a shared daemon connection would die with the first plane stop" constraint (`index.ts:9`) is
lifecycle coupling, not a demux barrier (`agent_stream` already carries `agentId`). Before raising
account count or going multi-daemon/multi-tenant, move to one managed session per admission scope
with a ref-counted, lifecycle-decoupled socket, and record the change here.

When admission is built, the supervisor's lease must carry more than `daemon.connect`. These are
three distinct layers, combined with `AND` by two different enforcers:

1. **Semantic permissions** (`ManagedAccessAdmission.permissions`, gated by `SessionAuthorization`):
   `workspace.read` + `workspace.write`. Create, message, and terminal input all map to
   `workspace.write` (`packages/server/src/server/authorization/operation-permissions.ts:59,61,161,177`).
2. **Per-project product privileges** (`ManagedAccessAdmission.projects[pid].privileges`, gated by
   `ManagedResourceAuthorizer`): `project.use`, `agent.create`, `agent.interact`, `terminal.use`,
   and the needed `approval.*`, for each project a route targets
   (`packages/server/src/server/managed-access/types.ts:6-43`; enforced in
   `managed-access/resource-authorizer.ts`). `resourceMode` must be `"projects"`; when unrestricted
   this authorizer is pass-through.
3. **Agent-configuration grant** (`projects[pid].agentConfigurations`): `agent.create` and
   `agent.interact` re-check the resolved provider/model/thinking against the project's granted
   configurations (`resource-authorizer.ts:479-541`), so an otherwise-authorized create still fails
   if the route's provider is not granted.

`daemon.connect` is the Hub gate checked at ticket issue/consume only; it grants no RPC and never
appears in the lease. Moving the plane from today's full `["*"]` trust to a scoped lease narrows it
to enumerated projects: a route pointing outside the lease fails at the resource gate even when the
semantic permission passes.

## 13. Verification and decision gates

### Compatibility

- Clisbot app connects to a pinned upstream Paseo daemon through direct and relay paths.
- Pinned upstream Paseo app connects to a Clisbot daemon in `off` through direct, relay, and desktop
  SSH paths.
- `off` runs no Hub ticket or filtering code and matches current trusted-session behavior.
- Upstream app is rejected over relay, TCP, and SSH in `external`; authenticated local socket/pipe
  recovery and the ticketed Clisbot app work.
- A manual Host in the Clisbot app never becomes Hub-managed merely because the user is signed in.
- A stable Managed Host uses the active client's heartbeat without issuing tickets or creating
  temporary Sessions for inactive direct/relay candidates.
- Initial connect, physical reconnect, and failover obtain a fresh ticket per actual admission
  attempt; a failed candidate never falls back to an unticketed `hello`.
- Manual/upstream Hosts retain the existing adaptive candidate probing and switching behavior.

### Authorization

- Native/Electron authorization rejects mismatched state, verifier, issuer, client, redirect URI,
  and replayed/expired codes; refresh rotation invalidates replay as configured.
- Electron never exposes refresh tokens or arbitrary authenticated fetch through renderer IPC.
- The bootstrap owner sees current and newly enrolled organization daemons without assignment rows.
- Admin/member grants cannot cross organization boundaries.
- A member sees only allowed Projects and cannot recover hidden data by guessing Project, workspace,
  agent, terminal, download, or subscription identifiers.
- Absence of `agent.interact`, `agent.create`, `agent.fast.use` when Fast mode is requested,
  `terminal.use`, or the matching `approval.*` privilege blocks every corresponding path, not just
  its visible button. Daemon-global paths independently require their exact current semantic
  permission.
- The same permission request is classified to the same `approval.*` leaf and produces the same
  allow/deny decision whether the responder uses Slack, Telegram, web, mobile, or Electron.
- Ticket consume is atomic, daemon/client-bound, time-bounded, redacted, and cannot fall back to full
  trust in `external`.
- `managedAccess.leaseDuration` defaults to `15m`, rejects values outside `1m` through `1h`, and a
  runtime change invalidates affected leases before the new duration is issued.
- Revocation closes or expires authority within the documented lease bound.

### Product and mergeability

- Web, iOS, Android, Electron, Slack, and Telegram use the same Hub privilege vocabulary and
  evaluation semantics; only identity and presentation adapters differ.
- A build without `expo.extra.clisbotHub` has no Hub UI, request, credential-storage, or connection
  side effect.
- An `upstream/main` rehearsal reports shared-file conflict surface separately from isolated
  Clisbot-owned code.
- Hub UI/API/data seams are evaluated against the target owner chain; existing implementation is
  not preserved without product value.

### Efficient verification strategy

Run the narrow owner of each changed seam first: protocol/hello, ticket/access resolution,
WebSocket admission, resource authorization, Host synchronization, shared Hub UI helpers, and
Electron IPC. Then run typechecks sequentially and one shared web build after all lanes are merged.
Do not rerun an unchanged package's broad suite for every neighboring patch.

Hub integration tests use in-process PGlite and require no container runtime. Real PostgreSQL or
Testcontainers is reserved for a small parity gate around row locking, concurrent one-use ticket
consumption, and migration behavior that PGlite cannot prove. Native and Electron reuse the shared
TypeScript/UI tests; each platform adds only its credential/transport boundary tests. This keeps the
matrix small without dropping checks at security or cross-platform boundaries.

The unavoidable differences are concentrated in four seams: server admission, Session/resource
enforcement, managed Host connection lifecycle, and client hello/reconnect. All remaining Hub
policy, ticket/lease implementation, privilege resolution, and UI logic must stay in
Clisbot-owned modules.

With these boundaries, merge risk remains approximately **6/10**, but conflicts should be
materially easier to resolve because upstream-owned changes are short hooks rather than large
business-logic blocks. The direction should be reconsidered if implementation starts duplicating
Paseo transports/lifecycle ownership, makes Hub availability necessary while mode is `off`, or
preserves the current separate Hub application at the expense of the one-product flow.
