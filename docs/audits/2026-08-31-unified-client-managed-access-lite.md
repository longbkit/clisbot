# Unified Paseo client and Managed Access Lite

Date: 2026-08-31. Updated: 2026-09-02. Status: architecture proposal; no product code in this
document is implemented unless a section is explicitly marked **CURRENT**. Scope: put Hub account
and management surfaces in the shared Paseo app, let an authenticated user discover and open the
daemon Projects they may use, and preserve ordinary Paseo client/daemon compatibility when managed
access is disabled.

This proposal deliberately optimizes first for one-person and internal-company deployments. It is
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

Estimated ongoing upstream-merge complexity for the proposed MVP is **6/10**. The difficult changes
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
| Clisbot app        | Upstream Paseo daemon | n/a          | Must work as an ordinary Paseo app. Manual/upstream Hosts do not request a Hub ticket and use the existing protocol.                      |
| Upstream Paseo app | Clisbot daemon        | `off`        | Must work as an ordinary Paseo app. Clisbot managed-access code is inactive.                                                              |
| Clisbot app        | Clisbot daemon        | `off`        | Ordinary Paseo behavior; Hub account features may exist in the app but do not change this daemon session.                                 |
| Upstream Paseo app | Clisbot daemon        | `external`   | Relay and TCP connections are rejected with an actionable upgrade/login error. Authenticated local socket/pipe recovery remains possible. |
| Clisbot app        | Clisbot daemon        | `external`   | A Hub-managed external connection succeeds with a valid ticket and is restricted to its Projects/privileges.                              |

**PROPOSED:** the Clisbot app must not require Clisbot-only daemon behavior for a normal manual Host.
Its Hub module is an adapter, not a replacement for `@getpaseo/client` or `HostRuntimeStore`.

**PROPOSED:** the Clisbot daemon must be byte-equivalent in authorization behavior when mode is
`off`. Additive schemas remain parseable, but no ticket lookup, session narrowing, filtering, or
Hub availability dependency runs in this mode.

**GAP:** this matrix is not currently tested. It needs explicit old/new client-daemon fixtures in
addition to ordinary unit tests.

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

**PROPOSED:** the Hub's Managed Host descriptor is the source of this pre-connection fact:

```ts
managedAccess?: {
  mode: "external";
  ticketIssuer: "hub";
};
```

A manual Host has no such metadata and follows the upstream path. The post-hello
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

**PROPOSED:** add exactly one schema-optional field:

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

Status values below mean:

- `CURRENT`: implemented and enforced now;
- `MODIFY`: implemented under a narrower or obsolete meaning and must be extended or renamed; and
- `NEW`: not implemented.

### 4.2 Daemon semantic permissions

These exact names already exist in `packages/protocol/src/messages.ts` and are enforced through
`packages/server/src/server/authorization/**`.

| Permission          | Meaning today                                                                                            | Applies in | Status    | Required change for managed access                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.read`       | Read daemon status, diagnostics, configuration, and Provider information.                                | Daemon     | `CURRENT` | No rename. Grant only through owner/Daemon Administrator because output is daemon-global.                                                                                                                               |
| `daemon.manage`     | Restart/update the daemon and change configuration, Providers, skills/plugins.                           | Daemon     | `CURRENT` | Keep this exact meaning; do not reuse the name for a broader Hub product privilege.                                                                                                                                     |
| `tunnel.manage`     | Manage relay, Hub, service-tunnel, and public-endpoint relationships.                                    | Daemon     | `CURRENT` | No semantic change. Included only in the Daemon Administrator preset.                                                                                                                                                   |
| `access.manage`     | Manage pairing offers, principals, credentials, grants, and revocation.                                  | Daemon     | `CURRENT` | No semantic change. Included only in the Daemon Administrator preset.                                                                                                                                                   |
| `workspace.read`    | Read Projects, Workspaces, Agents, timelines, Files, diffs, terminal output.                             | Daemon     | `CURRENT` | Add Project/resource filtering to every request, subscription, and outbound projection.                                                                                                                                 |
| `workspace.write`   | Send prompts; control Agents; mutate Files, terminals, git, and scripts.                                 | Daemon     | `CURRENT` | Add Project/resource and narrower product-action checks before side effects.                                                                                                                                            |
| `workspace.manage`  | Create, rename, archive, and remove Projects and Workspaces.                                             | Daemon     | `CURRENT` | Keep separate from `project.use`; owner/Daemon Administrator only in the MVP.                                                                                                                                           |
| `automation.manage` | Manage daemon-owned schedules, heartbeats, and loops.                                                    | Daemon     | `CURRENT` | Keep separate from Hub Automations; the same word does not make them one authority domain.                                                                                                                              |
| `hub.execute`       | Let an enrolled Hub service principal create, validate, control, and observe Hub-owned Agent executions. | Daemon     | `CURRENT` | Enrollment stores `permissions: string[]`; Hub connections default to none, require this exact permission to execute, and reject a `server_info.permissions` mismatch. Never grant it to an interactive Member Session. |

The Daemon Administrator access level expands to the required current semantic permissions. Do not
create a second Hub product privilege also named `daemon.manage`: the existing permission alone
does not include tunnels, pairing/access management, or all read operations.

### 4.3 Hub authorities that already exist

Hub organization capabilities and the instance-operator flag are boolean checks in
`packages/hub/src/auth/organization-policy.ts` and `organization-contract.ts`; they are not resource
ACL rows.

| Authority            | Meaning today                                                                                | Applies in | Status    | Required change                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------- |
| `view`               | View the active organization.                                                                | Hub        | `CURRENT` | Map to the target `hub.view` action at the Paseo API boundary.                                    |
| `manageMembers`      | Invite/remove non-owner Members and change their roles.                                      | Hub        | `CURRENT` | Map to `hub.member.manage`; retain current owner safeguards.                                      |
| `manageOwners`       | Change/remove owner membership.                                                              | Hub        | `CURRENT` | Keep owner-only; do not expose as a general assignable action.                                    |
| `manageResources`    | Manage current organization Triggers, connections, Daemons, API keys, and related resources. | Hub        | `CURRENT` | Too coarse for unified UI; split endpoint checks into configuration, Channel, and access actions. |
| `isInstanceOperator` | Identify the account allowed to use instance-wide operator surfaces.                         | Hub        | `CURRENT` | Map to `hub.instance.manage`; never derive it from an organization Team or `admin` role.          |

Hub API-key scopes are also current, but apply only to API credentials:

| API-key scope            | Meaning today                                   | Applies in | Status    | Required change                                                                                                                                  |
| ------------------------ | ----------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects:read`          | List legacy Hub deployment Projects.            | Hub API    | `CURRENT` | Keep the current API-key meaning; do not reuse it as Member Project access.                                                                      |
| `configuration:validate` | Validate a legacy Project configuration bundle. | Hub API    | `CURRENT` | Keep the current meaning. Do not assume it is the Paseo Channel/Automation validation API before the management-API inventory is reviewed.       |
| `configuration:install`  | Install a legacy Project configuration bundle.  | Hub API    | `CURRENT` | Keep the current meaning. Any reusable application-service seam and the Paseo activation contract remain part of the explicit API decision gate. |
| `runs:dispatch`          | Dispatch a manual Workflow run.                 | Hub API    | `CURRENT` | Keep distinct from Member `automation.run`; whether its service is reused by Paseo remains an API-boundary decision.                             |
| `daemons:enroll`         | Enroll a Daemon into the organization.          | Hub API    | `CURRENT` | Keep as a machine/API credential scope.                                                                                                          |

The exact Paseo management API is not fixed by this permission catalog. Its existing-operation
inventory and reuse/generalization decision are the open gate in section 12 of
[Unified client Hub configuration UI](2026-09-01-unified-client-hub-configuration-ui.md).

### 4.4 Cross-surface product and resource privileges

This is the canonical target catalog used by web, native, Electron, Slack, and Telegram. Hub role
and Team/direct assignments resolve these privileges. Only Project-scoped leaves needed by a
managed Paseo Session are sent to the Daemon.

| Privilege                      | Meaning                                                                                                       | Enforcement owner | Status   | Required change                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `hub.view`                     | View Hub account state and the resources already visible to the Member.                                       | Hub               | `NEW`    | Thin action over current `view`; it never reveals unassigned resources.                                                                   |
| `hub.configure`                | Manage organization configuration, event connections, API keys, and Automation definitions/revisions.         | Hub               | `NEW`    | Split from coarse `manageResources`; does not grant resource use.                                                                         |
| `hub.access.manage`            | Assign Team/direct access to Channels, Daemons, Projects, and Automations.                                    | Hub               | `NEW`    | Split from `manageResources`; every mutation remains organization-scoped and audited.                                                     |
| `hub.member.manage`            | Invite/remove Members and change non-owner membership.                                                        | Hub               | `NEW`    | Map to current `manageMembers`; current owner rules remain authoritative.                                                                 |
| `hub.instance.manage`          | Manage instance-wide Apps and operator settings.                                                              | Hub               | `NEW`    | Derived only from instance-operator authority, never from ordinary Team assignment.                                                       |
| `channel.manage`               | Connect, edit, test, enable/disable, and remove Channel accounts and Routes.                                  | Hub               | `NEW`    | Replaces the unimplemented proposal `bot.manage`; there is no Bot product resource.                                                       |
| `channel.use`                  | Invoke one fixed Route in the assigned Conversations.                                                         | Hub               | `NEW`    | May use only that Route's bound outbound actions; grants no generic Channel tool or direct Project, File, Terminal, or Automation access. |
| `automation.run`               | Invoke an Automation directly from Paseo or a Member API.                                                     | Hub               | `NEW`    | A fixed Channel Route is authorized by `channel.use` instead.                                                                             |
| `daemon.connect`               | Obtain managed admission to one Daemon.                                                                       | Hub + Daemon      | `NEW`    | Checked at ticket issue/consume; grants no RPC operation by itself.                                                                       |
| `project.use`                  | See and work with Agents, Workspaces, Files, and Project projections in one Project.                          | Hub + Daemon      | `NEW`    | Compile to resource-scoped workspace read/write; do not include Project lifecycle management.                                             |
| `agent.interact`               | Start or continue an Agent interaction on an authorized Project or fixed Channel Route.                       | Hub + Daemon      | `MODIFY` | Canonical replacement for current `bot.interact`; accept the old name only as a bounded config alias.                                     |
| `agent.create`                 | Create an Agent in an authorized Project using one allowed Agent configuration.                               | Daemon            | `NEW`    | Enforce Project and resolved Provider/Model/Thinking constraints at creation.                                                             |
| `agent.fast.use`               | Enable cost-bearing Fast mode for an Agent creation or fixed Route/Automation configuration.                  | Hub + Daemon      | `NEW`    | Check `featureValues.fast_mode` during activation and Agent creation; off by default.                                                     |
| `terminal.use`                 | List, create, subscribe, read, input, capture, rename, kill, and receive binary frames for Project terminals. | Daemon            | `NEW`    | Apply to every terminal text/binary path; it is narrower than `workspace.write`.                                                          |
| `approval.file`                | Approve a provider request classified as File work.                                                           | Hub + Daemon      | `MODIFY` | Already enforced for Channel responders; reuse the classifier and enforce in Paseo.                                                       |
| `approval.config`              | Approve a provider request classified as configuration work.                                                  | Hub + Daemon      | `MODIFY` | Same cross-surface extension.                                                                                                             |
| `approval.command`             | Approve command work; dot-subtree matching covers destructive commands unless explicitly denied.              | Hub + Daemon      | `MODIFY` | Same cross-surface extension; compile denies before sending exact leaves to the Daemon.                                                   |
| `approval.command.destructive` | Approve commands classified as destructive.                                                                   | Hub + Daemon      | `MODIFY` | Already a Channel leaf; enforce as the narrower Paseo decision too.                                                                       |
| `approval.channel`             | Answer a pending provider request classified as a Channel-native action.                                      | Hub + Daemon      | `MODIFY` | Approval never supplies the underlying action or resource authority; the broker rechecks that ceiling.                                    |

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
compilation currently preapproves both tools whenever `outbound.path` is `tool`; it has no
per-Route action list and does not consult `approval.channel`. File sending is restricted to the
Hub home after symlink resolution, not to the Route's Project or declared output artifacts.

There is also a capability-boundary gap: `encodeChannelReplyBindingRef` is base64-encoded JSON,
not an opaque or authenticated capability. A caller accepted by the loopback/instance-secret gate
can construct another syntactically valid account and Conversation reference. The supervisor
checks that the account is running but does not prove that the reference belongs to the Agent's
Route. This is acceptable only inside the present trusted-local boundary; it is not the public or
team authorization boundary.

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
| Developer            | Office worker plus `terminal.use`, `approval.config`, and `approval.command`, with `approval.command.destructive` denied                                                              |
| Full access          | Developer plus `approval.command.destructive` and `approval.channel`                                                                                                                  |
| Use Fast mode        | Adds `agent.fast.use`; separate and off by default for non-owners                                                                                                                     |
| Daemon Connect       | Adds `daemon.connect`; no Project or operation authority by itself                                                                                                                    |
| Daemon Administrator | Expands to the required current daemon semantic permissions, including daemon read/manage, tunnel, access, workspace lifecycle, and daemon automation management; never `hub.execute` |
| Channel Use          | `channel.use` plus `agent.interact` for the fixed Route only                                                                                                                          |
| Automation Run       | `automation.run` for direct invocation                                                                                                                                                |

Provider, Model, and Thinking grants are data constraints attached to a Project assignment, not
additional privilege names. A complete resolved configuration must match one grant; fields from
different grants are never cross-combined. Fast mode is then checked separately with
`agent.fast.use`.

Do not add a custom-role editor in the MVP. Reuse the existing dot-subtree, grant, deny, and extends
algebra in Hub, but send only exact resolved privilege leaves to the Daemon.

### 4.6 Resource grants

Team and direct assignments target Channel accounts/Conversations, Daemons, Projects, or
Automations. Agent profiles are not resources. Selecting a Project also records its allowed Agent
configuration grants and explicitly adds Daemon Connect in the same review.

**GAP:** Hub does not currently own a catalog of daemon-local Paseo Projects or Agent capabilities.
An enrolled Daemon must publish a minimal snapshot of stable Project identity plus Provider, Model,
Thinking, Mode, and feature choices. Do not use filesystem paths as portable identity or expose
them merely to render the access editor.

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
bits of entropy. Exact prefix spelling is proposed, not implemented.

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

**PROPOSED:** keep all Clisbot Hub UI/runtime code under an isolated boundary such as:

```text
packages/app/src/clisbot/hub/
  auth/
  api/
  account-store.ts
  managed-hosts.ts
  managed-host-connection-policy.ts
  settings/
  channels/
  automations/
  access/
```

The minimal shared-app hook sites are:

- one conditional provider at the application root;
- one conditional Account/Hub entry in Settings and the sidebar profile affordance;
- one Managed Host reconciliation adapter around `HostRuntimeStore`;
- one narrow connection-policy hook that disables inactive session probes only for Managed Hosts;
  and
- one optional `getAccessTicket()` callback passed to `@getpaseo/client` for real connection and
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

**PROPOSED:** Hub bootstrap returns only existing descriptor shapes plus optional ownership facts:

```ts
management: {
  kind: "hub";
  hubOrigin: string;
  organizationId: string;
  daemonId: string;
}
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

### 9.1 What establishes trust today

**CURRENT — transport/authentication:**

- A relay connection proves possession of the daemon public-key pairing material and establishes an
  E2EE application channel before the daemon processes `hello`.
- A direct connection is trusted by reachability unless the optional daemon password is configured;
  the password is checked during HTTP/WebSocket upgrade.
- Both paths then reach the same `handleHello` in
  `packages/server/src/server/websocket-server.ts`.

**CURRENT — session creation:** after validating protocol version and `clientId`, `handleHello`
creates a reconnectable trusted session or resumes the session retained under that `clientId`.
The connection already carries a `SessionAdmission` containing `principalId`, semantic
`permissions`, and optional Hub-execution agents. Ordinary trusted connections use the built-in
owner admission; Hub execution uses its own service principal and narrower permissions. A
disconnected external session may be retained briefly for reconnect, keyed by principal plus
`clientId`.

**CURRENT — what authorization means:** `SessionAuthorization` checks every inbound message in
`Session.handleMessage` and every outbound message in `Session.emit`. The exhaustive operation maps
in `packages/server/src/server/authorization/operation-permissions.ts` classify RPCs by semantic
permission. For example, agent fetch needs `workspace.read`, agent messaging and terminal input need
`workspace.write`, daemon configuration needs `daemon.manage`, and pairing needs `access.manage`.

The current permission set still does not contain Project, workspace, agent, terminal, or file-root
grants. It answers “may this principal perform this kind of operation on this daemon?”, not “may
Alice perform it on Project A?”. The same `fetch_agent_request` permission applies to every agent ID.

**GAP:** there is currently no authenticated Hub principal or resource grant on an ordinary Paseo
app `Session`. An ordinary trusted connection receives owner admission, so it remains an operator of
the whole daemon.

Concrete current case:

```text
Alice can establish a trusted connection
  -> hello creates SessionAdmission(principalId = "owner", permissions = all)
  -> project.list.request returns every active Project
  -> a known agentId can be fetched, messaged, archived, or approved
  -> a known cwd can be used for files
  -> a known terminalId can be subscribed to or controlled
```

### 9.2 Resource ownership facts that already exist

The daemon already has most relationships needed to resolve a target to a Project; they are used
for lifecycle and UI projection today, not authorization:

| Target supplied by a request | **CURRENT** owner/resolution fact                                                                                                                | **GAP**                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `projectId`                  | `ProjectRegistry` owns the Project record.                                                                                                       | No session allow-list check.                                                                 |
| `workspaceId`                | `WorkspaceRegistry` record contains `projectId` and `cwd`.                                                                                       | Lookup proves existence, not caller authority.                                               |
| `agentId`                    | `agentId` identifies an agent session daemon-wide. Its live or stored record may carry `workspaceId`; that Workspace record carries `projectId`. | The lookup chain exists, but agent handlers do not use it to authorize the caller.           |
| `terminalId`                 | `TerminalManager` returns a terminal carrying `workspaceId` and `cwd`.                                                                           | Subscribe/input/kill checks existence only.                                                  |
| file `cwd` + relative path   | File service confines the relative path under the caller-supplied `cwd`.                                                                         | `cwd` itself is trusted input and is not required to belong to an allowed workspace/Project. |

**PROPOSED:** extend the existing authorization module with one resource resolver that converts each
target to its canonical `projectId`. A resource-limited request whose target cannot be resolved to an
active, allowed Project fails closed. Existing registries remain owners of identity; authorization
does not create a parallel Project/workspace/agent registry.

For `agentId`, the resolver must follow records rather than parse the ID:

```text
agentId -> live/stored agent.workspaceId -> Workspace.projectId -> allowed Project?
```

**CURRENT:** Session already follows this chain when it adds Project placement to agent-list and
agent-detail responses. That placement tells the client where to show the agent; it is not an access
check. For example, `send_agent_message_request` resolves the agent and sends the prompt without
checking whether the session may access the resolved Project.

**PROPOSED cases:**

- `agent-a -> workspace-a -> project-a`, and the session may use `project-a`: allow the requested
  agent operation only when its narrower privilege such as `agent.interact` or `approval.*` also
  holds.
- `agent-b -> workspace-b -> project-b`, but the session may only use `project-a`: return a
  not-found-style result.
- The agent has no `workspaceId`, its Workspace no longer exists, or that Workspace's Project no
  longer exists: the Project cannot be proven, so deny in `external` mode. Do not treat an unresolved
  agent as daemon-global. Mode `off` preserves ordinary Paseo behavior.

### 9.3 What replaces the proposed `AccessContext`

**CURRENT:** there is still no type named `AccessContext` and no
`packages/server/src/server/managed-access/` directory. However, the nearest mechanism is no longer
an RPC-scope array. `packages/server/src/server/websocket-server.ts` now defines
`SessionAdmission { principalId, permissions, hubExecutionAgents? }`, and
`packages/server/src/server/authorization/index.ts` defines `SessionAuthorization`. `Session`
already owns one of these authorizers and can replace its semantic permissions.

Therefore do **not** add a parallel `AccessContext` authorizer. Extend the existing admission and
authorization types with resource privileges and lease state. Keep ticket issue/consume HTTP code
in a small managed-access adapter, but hand the result into the upstream authorization owner.

`packages/server/src/server/auth.ts` remains unrelated: it validates the daemon password for
HTTP/WebSocket reachability. The app's React `SessionContext` is client state and is also unrelated.

Do not flatten Projects and privileges into two independent arrays; that would create a false
cross-product. For example, terminal access on Project A plus ordinary access on Project B must not
become terminal access on both.

**PROPOSED shape:** Hub evaluates scoped role assignments and attaches exact effective privilege
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

### 9.4 Where the context binds to a session

**CURRENT:** `attachSocket()` creates a `PendingConnection` with a `SessionAdmission` before
`hello`. Direct and relay sockets currently default to owner admission. `handleHello()` is
synchronous, derives the reconnect key from `admission.principalId + clientId`, then creates or
resumes the Session. The existing seam is useful, but a ticket carried inside `hello` cannot have
produced that admission yet.

**PROPOSED — new external connection:**

1. `handleHello` receives the schema-optional `accessTicket`.
2. In mode `external`, a relay or TCP connection without a ticket is rejected before
   `createSessionConnection`.
3. An async admission resolver consumes the ticket with Hub and returns the linked `principalId`,
   semantic permissions, Project/privilege grants, and lease expiry.
4. The daemon verifies connection authority, daemon identity, `clientId`, expiry, and its enrolled
   Hub relationship.
5. The resolver replaces the pending owner/default admission before the reconnect key is computed.
   Only then may `createSessionConnection`, resume, `server_info`, or any resource snapshot run.

**PROPOSED — reconnect:** every external physical reconnect presents a fresh ticket. It must resolve
to the same principal as the retained logical session. If the effective grant fingerprint changed,
the safest MVP behavior is to discard the retained Session and bootstrap a new one rather than try
to purge every old subscription/cache in place. A different principal using the same `clientId` is
rejected.

**PROPOSED — lease change/revocation:** close the affected managed session and require a new ticket.
This is simpler and safer than mutating authority inside a live session. Loopback, plugin, and the
existing daemon-owned Hub execution connection remain separate trust classes and must not
accidentally inherit this external-user policy.

`updatePrincipalPermissions()` already proves that upstream can narrow a live principal, but it
changes only semantic permissions. Closing a resource-limited Session remains the safer MVP because
it also clears Project subscriptions, visibility caches, upload slots, and terminal streams.

### 9.5 Project, workspace, and agent discovery

**CURRENT:**

- `project.list.request` lists every non-archived Project from `ProjectRegistry`.
- `fetch_workspaces_request` and `fetch_agents_request` support filters, paging, sync cursors, and
  subscriptions, but those filters are supplied for UI/query behavior, not security.
- Session subscribes to registry and `AgentManager` mutations. Project, workspace, agent, timeline,
  permission, and attention events can later be pushed to the session.
- Selective timeline delivery limits streams to agent IDs the client says it is viewing. It is a
  performance/UI mechanism; the client may subscribe to any agent ID.

**PROPOSED:** filter bootstrap lists before paging/sync state is seeded, and validate subscriptions
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

**CURRENT:** handlers such as `fetch_agent_request`, `send_agent_message_request`, timeline fetch,
archive/delete/cancel, and `agent_permission_response` resolve an ID and operate on it. Existence is
checked; caller ownership is not. `create_agent_request` can also be driven by `workspaceId`, caller
agent, or a client-supplied `cwd`.

**PROPOSED:** resolve target → workspace → Project and require both its resource grant and the
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

### 9.7 Files and download/upload paths

These are three different surfaces and must not be treated as one path flow.

#### Workspace file operations

**CURRENT:** browse/read, write, create/rename/duplicate/delete, file subscriptions, Project-icon
lookup, and download-token requests carry a client-supplied `cwd`. The file service safely confines
the relative `path` under that root, including canonical-path checks against symlink escape. However,
the caller chooses the root itself and `WorkspaceFilesSession` does not consult `WorkspaceRegistry`.

This answers only “did `path` escape from `cwd`?”, not “may this user access `cwd`?”. A trusted client
could send `cwd=/company/project-b` and `path=secrets.txt`; keeping the path under Project B still
does not authorize Alice, who has access only to Project A.

**PROPOSED:** in `external`, canonicalize `cwd`, resolve it to an active Workspace and Project, then
require `project.use` before reading metadata/content, mutating a file, or installing a watcher. An
unknown root fails closed. Session close or revocation disposes its authorized watchers. Owner
wildcard covers every registered Project, not every path readable by the daemon OS user. Mode `off`
retains ordinary Paseo arbitrary-root behavior for local recovery and upstream compatibility.

#### Download

**CURRENT:** download is a two-step capability flow:

```text
WebSocket file_download_token_request(cwd, path)
  -> daemon resolves one absolute file path and issues a random, one-use token
  -> browser GET /api/files/download?token=...
  -> token is consumed and that file is streamed
```

The default token lifetime is 60 seconds. The HTTP request intentionally needs only that capability
token, but token issuance currently has no Project authorization.

**PROPOSED:** perform the Workspace/Project check before issuing the token. Keep the existing HTTP
download route and one-use token format unchanged; it does not need to repeat Hub login. For the MVP,
a token already issued remains usable once until its short expiry even if the Session is revoked.
Per-Session token invalidation can be added later if immediate download revocation becomes a product
requirement.

#### Upload and uploaded attachments

**CURRENT:** `file.upload.request` does **not** contain `cwd` and does not write into a Project. It
opens a Session-owned transfer slot; binary frames identified by `requestId` write a temporary file
under the daemon's Paseo home, then return an `uploaded_file` attachment containing its server path.
When that attachment is sent to an agent, the prompt currently uses the supplied attachment path.
This is safe only under Paseo's existing trusted-client assumption; Project authorization cannot be
derived at upload start because no target Project or agent is named yet.

**PROPOSED:** do not invent a Project check for the staging upload itself. Bind the upload slot and
completed upload handle to the managed Session. When the client attaches it to an agent message:

1. resolve the target `agentId` to an allowed Project and require `project.use`;
2. resolve the uploaded handle from daemon-owned Session state; and
3. do not trust a client-supplied filesystem `path` as proof of an upload.

A future operation that copies an upload into a Project is a separate Project file mutation and must
authorize the destination Workspace before writing. Binary upload chunks are accepted only for a
slot opened by the same authorized Session.

### 9.8 Terminals, including binary frames

**CURRENT:** `TerminalSessionController` already associates terminals with `workspaceId` and `cwd`,
and directory subscriptions use a `(cwd, workspaceId)` key. This is isolation between workspace
identities for correct UI state, not user authorization.

Current sensitive paths include:

- list all terminals when `list_terminals_request` omits `cwd`;
- list/subscribe by directory;
- create using `workspaceId` or legacy `cwd` resolution;
- subscribe/capture/rename/input/kill using `terminalId`; and
- input/resize binary frames using the stream slot assigned at subscription time.

**PROPOSED:** every path requires `terminal.use` on the terminal/workspace's Project in addition to
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

**CURRENT:** `agent_permission_response` accepts both `{ behavior: "allow" }` and
`{ behavior: "deny" }` and forwards them to the provider through `respondToAgentPermission`. There
is no caller check. Permission request/resolution events are broadcast from `AgentManager` like
other agent events.

**CURRENT:** sending or steering a normal human message sets `clearPendingPermissions: true`; the
provider uses this to deny/clear permissions blocking the steer. This does not approve the sensitive
operation, but it means “respond” is broader than the authority that needs protection.

**CURRENT:** agent creation/configuration can select provider permission modes and tool policy.
Guarding only the approval button would be ineffective if the same user could launch an agent in a
bypass/no-prompt mode or preapprove the tool. Voice mode also has a narrow daemon-owned auto-allow
path for its recognized speak permission.

**PROPOSED:**

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

**CURRENT:** upstream now classifies daemon-global operations explicitly. Configuration, update,
restart, plugins, and skills use `daemon.manage`; pairing and grant changes use `access.manage`; Hub
and relay relationship changes use `tunnel.manage`; diagnostics/status use `daemon.read`; Project
and workspace lifecycle uses `workspace.manage`. A Session without the required semantic permission
receives `access_denied` before the handler runs.

**PROPOSED:** expose `Administrator` as a UI access level that compiles to the exact current daemon
semantic permissions it is meant to receive. Do not add another product privilege named
`daemon.manage`, and do not collapse upstream's `access.manage` or `tunnel.manage` boundaries inside
daemon code. A Member with only `daemon.connect` plus Project grants receives none of these
daemon-global permissions.

The exhaustive operation classification already exists and uses TypeScript `Record` coverage, so a
new upstream RPC causes a compile failure until classified. Managed Access adds resource resolution
after this existing operation check; it does not maintain a second RPC-name table.

### 9.11 Outbound enforcement and errors

**CURRENT:** `Session.emit` checks the outbound message type against semantic permissions. It still
cannot distinguish two `agent_stream` messages belonging to different Projects. Project updates are
published across authorized sessions; selective subscriptions and query filters are not ACLs.

**PROPOSED:** authorize before constructing or emitting resource-bearing text and binary messages.
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
`channel.use` and `agent.interact` only for its assigned Conversations. It does not grant direct
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

`CURRENT` symbols below exist now. `NEW` paths and symbols are the proposed implementation names,
not claims about current code.

### 11.1 Wire and daemon client

| Relative file path                                   | Function / class / schema                                                                            | Smallest change                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/messages.ts`                  | `WSHelloMessageSchema` (**CURRENT**)                                                                 | Add optional `accessTicket`; keep old hello payloads valid.                                                                                                          |
| `packages/protocol/src/messages.ts`                  | `ServerInfoStatusPayloadSchema` (**CURRENT**)                                                        | Add optional diagnostic feature `managedAccessTickets`.                                                                                                              |
| `packages/protocol/src/messages.ts`                  | `MutableDaemonConfigSchema`, `MutableDaemonConfigPatchSchema` (**CURRENT**)                          | Add `managedAccess.mode` with `off` or `external`; default and missing value resolve to `off`.                                                                       |
| `packages/protocol/src/access-privileges.ts`         | `ACCESS_PRIVILEGES`, `AccessPrivilege`, `privilegeCovers()`, `classifyPermissionRequest()` (**NEW**) | Own the pure cross-surface privilege catalog, dot-subtree matching, and provider-neutral approval classification used by Hub and daemon.                             |
| `packages/protocol/src/messages.wire-compat.test.ts` | `WSHelloMessageSchema` and `ServerInfoStatusPayloadSchema` compatibility suites (**CURRENT**)        | Prove old/new hello and `server_info` parsing in both directions.                                                                                                    |
| `packages/client/src/daemon-client.ts`               | `DaemonClientConfig`, `DaemonClient.sendHelloMessage()` (**CURRENT**)                                | Add optional async `getAccessTicket()` and await it for each actual initial hello or physical reconnect; absent callback preserves the current payload and behavior. |
| `packages/client/src/daemon-client.test.ts`          | `DaemonClient` hello/reconnect suites (**CURRENT**)                                                  | Prove no-provider compatibility, fresh ticket per actual reconnect, heartbeat without ticket fetch, and ticket-fetch failure without an unticketed fallback hello.   |

### 11.2 Daemon

| Relative file path                                                             | Function / class / type                                                                                                                                                          | Smallest change                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/server/persisted-config.ts`                               | `PersistedConfigSchema` (**CURRENT**)                                                                                                                                            | Accept and persist `daemon.managedAccess.mode`; missing value remains `off`.                                                                                                                                       |
| `packages/server/src/server/bootstrap.ts`                                      | `createInitialMutableDaemonConfig()` (**CURRENT**)                                                                                                                               | Project the persisted managed-access setting into the live daemon config used by the WebSocket server.                                                                                                             |
| `packages/server/src/server/daemon-config-store.ts`                            | `pickSupportedPatchFields()`, `DaemonConfigStore.applySupportedPatch()` (**CURRENT**)                                                                                            | Admit validated managed-access patches and publish the live change without bypassing the existing config owner.                                                                                                    |
| `packages/server/src/server/authorization/index.ts`                            | `SessionAuthorization`, `OWNER_PERMISSIONS`, `DaemonPermission` (**CURRENT**)                                                                                                    | Extend the existing authorizer with daemon-wide versus Project privilege grants, Agent-configuration constraints, lease state, and narrower Agent/Fast/terminal/approval checks; do not add a parallel authorizer. |
| `packages/server/src/server/authorization/operation-permissions.ts`            | `INBOUND_PERMISSION`, `OUTBOUND_PERMISSION`, `requiredPermissionForInbound()`, `requiredPermissionForOutbound()` (**CURRENT**)                                                   | Keep upstream's exhaustive RPC-to-semantic-permission classification unchanged except when a genuinely new operation is added; resource checks happen after it.                                                    |
| `packages/server/src/server/managed-access/ticket-admission.ts`                | `ManagedTicketAdmissionResolver` (**NEW**)                                                                                                                                       | Consume a ticket through the enrolled Hub relationship and return daemon-native semantic permissions plus resolved resource privileges; own no Session dispatch policy.                                            |
| `packages/server/src/server/authorization/resource-resolver.ts`                | `SessionResourceGrants`, `SessionResourceResolver` (**NEW**)                                                                                                                     | Resolve Project/workspace/agent/terminal/file targets through existing registries and choose not-found versus `access_denied`.                                                                                     |
| `packages/server/src/server/websocket-server.ts`                               | `SessionAdmission`, `PendingConnection`, `VoiceAssistantWebSocketServer.handleHello()`, `.resumeSession()`, `.createSessionConnection()`, `.createSocketSession()` (**CURRENT**) | Make hello admission async in `external`, replace pending default admission before reconnect lookup, and exempt only authenticated local socket/pipe/internal sessions.                                            |
| `packages/server/src/server/session.ts`                                        | `SessionOptions`, `Session.handleMessage()`, `.handleBinaryFrame()`, `.emit()`, `.setPermissions()` (**CURRENT**)                                                                | Carry resource privileges beside current semantic permissions; enforce them before side effects and before resource-bearing text/binary output.                                                                    |
| `packages/server/src/server/session.ts`                                        | `Session.listFetchAgentsEntries()`, `.handleFetchAgent()`, `.handleSendAgentMessageRequest()`, `.handleAgentPermissionResponse()` (**CURRENT**)                                  | Resolve Agent → Workspace → Project; require `agent.interact` for interaction and the classified `approval.*` privilege for explicit allow.                                                                        |
| `packages/server/src/server/session/files/workspace-files-session.ts`          | `WorkspaceFilesSession` and its `handleFile*` methods (**CURRENT**)                                                                                                              | Inject the authorizer; validate `cwd` before file I/O, watchers, and download-token issuance; bind uploads to the Session rather than trusting attachment paths.                                                   |
| `packages/server/src/server/file-upload/index.ts`                              | `FileUploadStore` (**CURRENT**)                                                                                                                                                  | Retain completed upload handles long enough to verify Session ownership when an attachment is used; preserve current temp-file cleanup.                                                                            |
| `packages/server/src/terminal/terminal-session-controller.ts`                  | `TerminalSessionController.dispatch()`, `.handleBinaryFrame()` (**CURRENT**)                                                                                                     | Gate list/create/subscribe/control with `terminal.use`; bind each binary slot to the authorized terminal and Project.                                                                                              |
| `packages/server/src/server/hub/relationship-remote.ts`                        | `HubRelationshipRemote`, `DirectHubRelationshipRemote` (**CURRENT**)                                                                                                             | Add daemon-authenticated ticket consume/lease refresh operations beside enrollment and revocation.                                                                                                                 |
| `packages/server/src/server/hub/relationship-controller.ts`                    | `HubRelationshipController`, `.updatePermissions()` (**CURRENT**)                                                                                                                | Reuse its authenticated service-principal relationship for Project catalog publication and lease invalidation; do not reinterpret Hub roles in the daemon.                                                         |
| `packages/server/src/server/managed-access/managed-access.integration.test.ts` | managed Session matrix (**NEW**)                                                                                                                                                 | Cover owner/member, two Projects, guessed IDs, files, terminal JSON/binary, approvals, reconnect, revocation, `off`, direct, and relay paths.                                                                      |

### 11.3 Hub

| Relative file path                                              | Function / class / type                                                                                                                  | Smallest change                                                                                                                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/hub/src/index.ts`                                     | `loadRuntimeConfig()` (**CURRENT**)                                                                                                      | Read `PASEO_HUB_MANAGED_ACCESS_LEASE_DURATION`; absence produces the `15m` default rather than an unbounded lease.                                                                                     |
| `packages/hub/src/application-runtime.ts`                       | `ApplicationCompositionOptions`, `hubApplicationOptions()` (**CURRENT**)                                                                 | Thread the compiled instance managed-access policy from the composition root into `HubRuntimeOptions`.                                                                                                 |
| `packages/hub/src/auth/server.ts`                               | `createAuthServer()`, `AuthServer.resolveAccount()`, `.resolveOrganizationAccess()` (**CURRENT**)                                        | Reuse BetterAuth identity and active organization; add its OAuth Provider with registered first-party public clients, S256 PKCE, token refresh/revocation, and Hub-API resource binding.               |
| `packages/hub/src/auth/organization-contract.ts`                | `OrganizationRole`, `ORGANIZATION_ROLES` (**CURRENT**)                                                                                   | Reuse `owner` / `admin` / `member` as the MVP role vocabulary.                                                                                                                                         |
| `packages/hub/src/channels/config/enums.ts`                     | `PRIVILEGE_FAMILIES`, `PRIVILEGE_LEAVES`, `isPrivilegePattern()` (**CURRENT**)                                                           | Re-export/use the shared catalog; retain `bot.interact`/`bot.*` only as bounded read aliases, and diagnose inert `tool.*`/`channel.tool.*` instead of writing them.                                    |
| `packages/hub/src/channels/config/schema.ts`                    | `RouteMatchSchema`, `OutboundDefaultsSchema`, `RouteSchema` (**CURRENT**); `ChannelActionPolicySchema` (**NEW**)                         | Add optional literal `contains` for new-binding target selection plus the exact Route-bound reply-action ceiling and Project/output roots; preserve ordered single-target Routes and current defaults. |
| `packages/hub/src/channels/config/privileges.ts`                | `privilegeCovers()`, `roleGrants()`, `rolesGrant()` (**CURRENT**)                                                                        | Reuse the shared dot-subtree primitive and keep Hub role-composition semantics unchanged.                                                                                                              |
| `packages/hub/src/channels/policy.ts`                           | `routeMatches()`, `matchRoute()`, `resolvePrincipal()`, `privilegeHolds()`, `effectivePrivileges()`, `classifyToolClass()` (**CURRENT**) | Keep first-match routing, Channel identity/scope adaptation, and `approval.channel` classification here; do not interpret a tool name as execution authority.                                          |
| `packages/hub/src/channels/bindings/index.ts`                   | `BindingEngine.admit()`, `.bindOrSteer()`, `.createAgent()` (**CURRENT**)                                                                | Existing direct bindings win over later text selection; pass the durable binding and compiled Route action ceiling into Agent creation, and invalidate it with target/security changes.                |
| `packages/hub/src/channels/plane/types.ts`                      | `ChannelReplyBindingRef`, `encodeChannelReplyBindingRef()`, `decodeChannelReplyBindingRef()` (**CURRENT**)                               | Replace client-decodable routing JSON with an opaque binding capability ID; keep old decoding only for bounded active-session compatibility.                                                           |
| `packages/hub/src/channels/control-plane.ts`                    | `compileControlPlaneSnapshot()`, `createChannelAgentSpecResolver()` (**CURRENT**)                                                        | Compile candidate `hub.yml` with Channel documents, pass additive Agent feature values, attach the Channel broker, and preapprove only actions compiled for that Route.                                |
| `packages/hub/src/channels/channel-reply.ts`                    | `createChannelReplyServer()`, `messageTool()`, `messageCall()`, `fileTool()`, `fileCall()` (**CURRENT**)                                 | Evolve `message` toward the OpenClaw action subset, resolve the binding server-side before every call, constrain files to Project/output roots, and retain `send_file` as a compatibility alias.       |
| `packages/hub/src/channels/supervisor/index.ts`                 | `ChannelSupervisorImpl.reconcile()` (**CURRENT**)                                                                                        | Apply each active revision by stopping removed/disabled accounts and restarting every enabled account from the new snapshot; report retryable per-account runtime failures.                            |
| `packages/hub/src/managed-access/config.ts`                     | `ManagedAccessConfigSchema`, `compileManagedAccessConfig()` (**NEW**)                                                                    | Own `managedAccess.leaseDuration`, default it to `15m`, validate `1m` through `1h`, and compile it to `leaseDurationMs`.                                                                               |
| `packages/hub/src/managed-access/policy.ts`                     | `privilegesForOrganizationRole()`, `effectiveResourcePrivileges()` (**NEW**)                                                             | Map BetterAuth membership and scoped role assignments into the same privilege semantics used by channel principals; apply owner wildcard without changing dashboard capabilities.                      |
| `packages/hub/src/db/schema.ts`                                 | resource-role assignment, Project catalog, access ticket, and lease tables (**NEW**)                                                     | Persist organization-scoped role assignments, daemon-local Project snapshots, ticket hashes/consumption, and lease state.                                                                              |
| `packages/hub/src/db/types.ts`                                  | `Database` managed-access methods and record types (**NEW**)                                                                             | Add the storage contract used by the service; implement the same contract in `packages/hub/src/db/pg.ts` and `packages/hub/src/db/memory.ts`.                                                          |
| `packages/hub/src/managed-access/contracts.ts`                  | bootstrap, issue, consume, refresh, and invalidation schemas (**NEW**)                                                                   | Define schema-validated HTTP inputs/outputs; never return filesystem paths or plaintext stored tickets.                                                                                                |
| `packages/hub/src/managed-access/service.ts`                    | `ManagedAccessService.bootstrap()`, `.issueTicket()`, `.consumeTicket()`, `.refreshLease()`, `.invalidateLeases()` (**NEW**)             | Resolve scoped role assignments into exact effective privilege leaves, apply owner wildcard, atomically consume tickets, and own lease lifecycle.                                                      |
| `packages/hub/src/app.ts`                                       | `HubRuntimeOptions`, `HubOperations`, `createHubApplication()` (**CURRENT**)                                                             | Compile the instance managed-access policy, compose `ManagedAccessService`, and expose narrow handlers; do not place policy in TanStack route components.                                              |
| `packages/hub/src/routes/api/app/bootstrap.ts`                  | `Route` (**NEW**)                                                                                                                        | Authenticated browser/native app bootstrap.                                                                                                                                                            |
| `packages/hub/src/routes/api/app/access-tickets.ts`             | `Route` (**NEW**)                                                                                                                        | Issue a one-use ticket for `{ daemonId, clientId }`.                                                                                                                                                   |
| `packages/hub/src/routes/api/daemons/access-tickets/consume.ts` | `Route` (**NEW**)                                                                                                                        | Authenticate the enrolled daemon and atomically consume a ticket; lease refresh can be a sibling route when implemented.                                                                               |

### 11.4 Shared app

| Relative file path                                               | Function / class / type                                                                                                                   | Smallest change                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/app.config.js`                                     | `expo.extra.clisbotHub` (**NEW optional config entry**)                                                                                   | Include `{ origin }` only when `CLISBOT_HUB_ORIGIN` is supplied; absence is the upstream-compatible default.                                                                                      |
| `packages/app/src/clisbot/hub/config.ts`                         | `ClisbotHubAppConfig`, `resolveClisbotHubAppConfig()` (**NEW**)                                                                           | Return validated config or `null`; config presence is the capability flag and is not a Settings preference.                                                                                       |
| `packages/app/src/clisbot/hub/api-client.ts`                     | `HubApiClient`, `HubRequestTransport` (**NEW**)                                                                                           | Call account, bootstrap, and ticket APIs through browser cookie, native bearer, or Electron IPC adapters; keep Hub credentials out of `HostProfile`.                                              |
| `packages/app/src/clisbot/hub/auth/oauth-client.ts`              | `HubOAuthClient` (**NEW**)                                                                                                                | Own state, PKCE verifier/challenge, authorization URL, code exchange, in-memory access token, refresh rotation, and logout for native builds.                                                     |
| `packages/app/src/clisbot/hub/auth/secure-store.native.ts`       | `HubRefreshTokenStore` (**NEW**)                                                                                                          | Persist only the native rotating refresh token through Expo SecureStore; clear it on logout, organization reset, or invalid refresh.                                                              |
| `packages/app/src/clisbot/hub/account-provider.tsx`              | `HubAccountProvider`, `useHubAccount()` (**NEW**)                                                                                         | Own signed-out/loading/signed-in account state across web, iOS, Android, and Electron's renderer.                                                                                                 |
| `packages/app/src/clisbot/hub/managed-host-reconciler.ts`        | `ManagedHostReconciler` (**NEW**)                                                                                                         | Convert Hub bootstrap descriptors into existing direct/relay `HostConnection` shapes and reconcile them with the host registry.                                                                   |
| `packages/app/src/clisbot/hub/managed-host-connection-policy.ts` | `ManagedHostConnectionPolicy` (**NEW**)                                                                                                   | Order existing candidates, disable inactive session probes, and request failover only after the active connection fails; own no transport implementation.                                         |
| `packages/app/src/types/host-connection.ts`                      | `HostProfile` (**CURRENT**)                                                                                                               | Add optional Hub-management metadata only; do not add a new transport type or persist tickets.                                                                                                    |
| `packages/app/src/runtime/host-runtime.ts`                       | `HostRuntimeStartOptions`, `HostRuntimeController.start()`, `.runProbeCycle()`, `.switchToConnection()`, `HostRuntimeStore` (**CURRENT**) | Accept a narrow Managed Host policy hook: skip temporary inactive `DaemonClient` probes, but retain active liveness and event-driven connect/failover; leave manual/upstream Hosts unchanged.     |
| `packages/app/src/runtime/host-runtime.test.ts`                  | `HostRuntimeController` probe/activation suites (**CURRENT**)                                                                             | Prove stable Managed Hosts create no inactive clients or tickets, transport failures before `hello` mint no ticket, failover performs a real admission, and manual Hosts retain adaptive probing. |
| `packages/app/src/app/_layout.tsx`                               | `RootLayout` (**CURRENT**)                                                                                                                | Mount `HubAccountProvider` only when the Clisbot Hub app capability is enabled.                                                                                                                   |
| `packages/app/src/screens/settings-screen.tsx`                   | `SettingsSidebar`, `SettingsScreen` (**CURRENT**)                                                                                         | Mount only the signed-out entry or signed-in Hub group; Channels, Automations, Team, Access, Configuration, and Managed access details remain Clisbot-owned screens.                              |
| `packages/app/src/components/left-sidebar.tsx`                   | `LeftSidebar`, `SidebarFooter` (**CURRENT**)                                                                                              | Replace or augment the Settings affordance with the conditional user-profile entry without duplicating account state.                                                                             |

### 11.5 Electron

| Relative file path                                            | Function / class / type                                                        | Smallest change                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/features/hub-auth/controller.ts`        | `HubAuthController`, `HubRefreshTokenStore` (**NEW**)                          | Launch the system browser, validate callback state, exchange code plus verifier, rotate tokens, and persist the refresh token with OS-backed encryption; fail closed when protected storage is unavailable. |
| `packages/desktop/src/main.ts`                                | `bootstrap()`, `app.on("open-url")`, `app.on("second-instance")` (**CURRENT**) | Route only the registered Hub callback to `HubAuthController`; keep the main renderer on the packaged `paseo://app` origin.                                                                                 |
| `packages/desktop/src/preload.ts`                             | `window.paseoDesktop` context bridge (**CURRENT**)                             | Expose a narrow Hub-auth/account/request IPC surface; never expose refresh-token values or arbitrary-URL authenticated fetch.                                                                               |
| `packages/app/src/clisbot/hub/auth/electron-transport.web.ts` | `ElectronHubRequestTransport` (**NEW**)                                        | Adapt the shared `HubApiClient` to the desktop IPC bridge without putting OAuth credentials in renderer storage.                                                                                            |

No semantic source change is expected in `packages/relay`: `createClientChannel()` and
`createDaemonChannel()` in `packages/relay/src/encrypted-channel.ts` continue carrying opaque hello
bytes.

Avoid moving, renaming, or formatting upstream-owned files. Every shared-file change should be a
small additive hook delegating to a Clisbot-owned module.

## 12. Rollout

### Phase A — prove compatibility and single-user value

- Add the app capability flag and Account/profile shell.
- Add the web cookie adapter plus native/Electron Authorization Code with S256 PKCE adapters; keep
  Electron's renderer on `paseo://app` and its refresh token in the main process.
- Add owner wildcard and Hub bootstrap.
- Publish daemon Project catalog and existing connection descriptors.
- Add opaque ticket issue/consume and the hello field.
- Apply the Managed Host connection policy: no inactive session probes; ticket only at real
  initial connect, physical reconnect, or failover admission.
- Keep production daemons in `off`; exercise `external` only in integration tests or isolated
  staging until its enforcement surface is complete.
- Let an owner configure a fixed Channel Route and open its Project in Paseo.

### Phase B — safe external operation

- Complete Project projection and guessed-ID enforcement.
- Gate terminal, permission response, and daemon management.
- Add lease refresh/invalidation.
- Enable `external` per enrolled daemon through an owner-confirmed operation.
- Ship actionable old-app and expired/revoked-ticket errors.

### Phase C — company access UI

- Add Team & Access assignments for admin/member.
- Add Channel Route targeting rules and access audit events.
- Port only useful Hub configuration surfaces into the shared app.
- Retire the separate Hub dashboard after functional parity, not before.

A Managed Access custom-role/deny editor, fine-grained file privileges, and signed offline grants
are later work driven by demonstrated need. Existing channel role/deny/extends behavior remains in
force and must not be replaced by a second evaluator.

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

The unavoidable differences are concentrated in four seams: server admission, Session/resource
enforcement, managed Host connection lifecycle, and client hello/reconnect. All remaining Hub
policy, ticket/lease implementation, privilege resolution, and UI logic must stay in
Clisbot-owned modules.

With these boundaries, merge risk remains approximately **6/10**, but conflicts should be
materially easier to resolve because upstream-owned changes are short hooks rather than large
business-logic blocks. The direction should be reconsidered if implementation starts duplicating
Paseo transports/lifecycle ownership, makes Hub availability necessary while mode is `off`, or
preserves the current separate Hub application at the expense of the one-product flow.
