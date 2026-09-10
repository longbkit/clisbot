# Channel plane admission & authorization

How a chat is authorized across the Paseo app and channels, why the channel plane cannot
yet run against a managed daemon, and the decided plan to fix it. **Read the top three
sections to review or implement**; everything under "Details & discussion" is supporting
analysis and the options already considered — it does not change the plan.

## Problem

1. **(Blocking) The channel plane can't be admitted in managed-access `external` mode.**
   The channel supervisor opens a trusted-client socket per account with **no
   `accessTicket`**; in `external` mode the daemon treats it as a managed subject and
   rejects it at `hello`. Channels therefore work only while the daemon is `off`. Commit
   `7b4e60919` fixed URL targeting only. (detail: _The open gap_)
2. **(Tech debt) Resolve-access duplicated in the Hub.** `resolveChannelAgentAccess`
   (channel Gate 1) and `resolveDaemonAccess` (app admission) resolve the same grants with
   two implementations in `store.ts`. (detail: _Consolidation (a)_)
3. **(Tech debt) Action→privilege duplicated.** "Which operation needs which product
   privilege" lives in the fusion daemon authorizer (`resource-authorizer`) and again in
   the Hub channel path. (detail: _Consolidation (b)_)

## Decided solution

- **Model — one decision point, two enforcement points.** The Hub computes all authority.
  It is enforced at **Gate 1** (Hub, per _sender_, before any RPC) and **Gate 2** (daemon,
  per _connection_, every RPC). Per-sender authorization is Gate 1 only; the daemon
  connection is a sender-blind **account** ceiling. (detail: _Chat from a channel_,
  _Gate A / Gate B_)
- **Channel admission — Phase 1 (do now).** Admit the channel connection in `external`
  mode by minting an `accessTicket` under the **org owner membership** → an **unrestricted
  lease** (full semantic permissions, `resourceMode: "daemon"`, Gate 2 pass-through).
  **No per-user lease, no dedicated service principal, no Gate-2 narrowing this stage.**
  `off` mode is unchanged. (detail: _Phase 1_)
- **Automation — leave on `hub.execution`.** Automation stays on the frozen
  `hub.execution.*` surface; do **not** build bot/conversation features on it. Migrating
  automation onto the managed-session substrate is deferred. (detail: _Channel and
  automation_)
- **Consolidation (fusion-internal).** (a) one shared resolve-access resolver; (b) one
  shared **op→product-privilege** map in a **fusion** module consumed by the fusion
  `resource-authorizer` and the Hub channel path. **Upstream `authorization/` (Gate A) is
  untouched.** (detail: _Consolidation_)

## Status — implemented 2026-09-10

Both A and B are implemented, gated green (`typecheck`, `lint`, `format`), and targeted tests pass.

- **A (Hub-only, no protocol/daemon edit).** The channel daemon client mints an `accessTicket`
  per (re)connect via `createChannelAccessTicketResolver`
  (`packages/hub/src/channels/daemon/access-ticket.ts`), gated on the Hub-stored
  `daemons.managedAccessMode` (not `server_info` — an `external` daemon rejects the unticketed
  hello _before_ sending `server_info`, so the mode is read first; it self-heals on reconnect).
  The composition root owns the access/ticket wiring (`application-runtime.ts`
  `createChannelDaemonAccessTicketFactory`); the supervisor supplies the account's route
  daemon reference + a stable per-account `clientId`. Lease refresh is the daemon's existing
  connection-agnostic machinery (`scheduleManagedLease`), inherited for free once admitted.
- **Live E2E (dev daemon 6867 flipped to `external`).** No-ticket trusted client rejected
  (`4401`); both accounts admitted with distinct `clientId`/lease; full Slack round-trip
  (mention → new agent session → reply, read-back content match) and Telegram round-trip
  (routed → agent session → reply, obs-log content match); survived a 1-minute lease across
  ~2 lifetimes with no disconnect (refresh); reconnect-with-fresh-ticket proven by the
  off→external flip drop/readmit plus a working turn after.
- **Finding (deferred):** in `external` mode, a _cold hub boot while the daemon is already
  `external`_ races the daemon↔hub relationship that consumes tickets — `startAccount`'s 15 s
  `waitForConnected` can expire before the relationship settles and tears the account down with
  no retry (`supervisor/index.ts` `stopHandle`). Steady-state embedded boot (sub-second
  loopback relationship) does not hit it; booting the Hub in `off` and flipping to `external`
  after it settles does not hit it. A robustness fix (defer instead of tear down on a transient
  daemon-unreachable timeout) is left for a follow-up.
- **B (fusion-internal).** One shared resolve-access core (`subjectAssignments` +
  `accumulateProjectGrants` in `store.ts`) and one op→product-privilege map
  (`packages/protocol/src/managed-access-privileges.ts`) consumed by the Gate-B
  `resource-authorizer` and the Hub channel path. Upstream `authorization/` (Gate A) untouched
  (empty working-tree diff). Parity test locks channel/app decisions together.

## Checklist & acceptance

### A. Channel admission — Phase 1 (primary)

- [x] Principal = the **org owner membership** (owner → unrestricted admission,
      `store.ts:1202`). No new "service" member. Resolve it from the org's `members` row
      with `role = "owner"`; resolve the target `daemonId` from the account's channel
      config daemon reference (the same reference `resolveChannelAgentAccess` uses).
- [x] Supervisor mints **in-process**: `tickets.issue({ organizationId, daemonId, userId,
membershipId, clientId })` directly (`tickets.ts:54`) — no HTTP, no browser session.
      One **stable `clientId` per channel account** (N accounts → N tickets/leases).
- [x] Add `accessTicket` (+ resolver, re-minted per reconnect) to
      `ChannelDaemonClientOptions` (`channels/daemon/client.ts:22-44`); `ws-client` sends
      it in `hello`.
- [x] One code path, gated on `server_info` managed mode: `off` → no ticket (trusted as
      today); `external` → ticket required.
- **Acceptance:**
  - [x] **No wire/protocol change:** `accessTicket` is already an optional field on `hello`
        (the app uses it); the channel client only populates it. No protocol schema and no
        upstream file changes. No new feature flag — the change stays inside the
        already-gated channel plane (`CLISBOT_HUB_CHANNELS_ENABLED`).
  - [x] daemon `off`: legacy/unmodified path still works (upstream + base Paseo app pair).
  - [x] daemon `external`: channel plane admitted; drives create / message / terminal /
        approval under the unrestricted lease; a live marker message completes end-to-end.
  - [x] **Lease lifecycle:** the account stays admitted past lease expiry (refresh) and
        across a socket reconnect (fresh ticket), with no dropped turns.
  - [x] **Multi-account:** two accounts on one daemon admit independently (distinct
        `clientId`, distinct lease).
  - [x] Gates green: `npm run typecheck` + `npm run lint`.

### B. Consolidation (with or after A; fusion-internal)

- [x] (a) Extract one shared **resolve-access** resolver used by both
      `resolveChannelAgentAccess` and `resolveDaemonAccess` (`store.ts`), with a subject
      adapter (membership | sender→member/guest) and a scope (one | all projects) on top.
- [x] (b) Extract the **op→product-privilege** map to a **fusion** module (e.g. beside
      `packages/protocol/src/managed-access.ts`); the fusion `resource-authorizer` and the
      Hub channel path both consume it. Key by wire operation (superset; channel queries
      its subset).
- [x] Do **not** touch `packages/server/src/server/authorization/` (Gate A, upstream) or
      merge the product map into `operation-permissions.ts`.
- **Acceptance:**
  - [x] Parity test: the same grants yield an identical decision via the channel adapter
        and the app adapter (locks against drift).
  - [x] `git diff upstream/main -- packages/server/src/server/authorization/` is empty.
  - [x] Channel-only authority (`channel.use`, conversation scope, reply/outbound,
        `/link`, `approval.channel`) stays in channel code; daemon-only authority stays in
        the daemon — neither is forced into the shared map.
  - [x] App path unchanged: existing managed-access tests stay green
        (`resource-authorizer.test`, `tickets.integration`, `access/guest.test`,
        `access/channel-privilege.test`).

### Out of scope (deferred, recorded)

- Gate-2 narrowing (per-project lease) — Phase 2.
- Per-user / per-admission-scope connections — evaluated and rejected (_Per-user
  connection_).
- Single Hub↔daemon socket with per-principal lease multiplexing — recorded,
  deferred with explicit revisit triggers (_Single-link per-principal
  multiplexing_).
- Automation migration off `hub.execution`.

---

# Details & discussion (reference)

The authoritative permission facts live in [permissions.md](../permissions.md)
(§"Channel command access") and [2026-08-31 §12.1](2026-08-31-unified-client-managed-access-lite.md#121-channel-supervisor-admission-open-gap).

## Two ways a chat is authorized

A chat reaches an agent from **the Paseo app/web** or from **a channel** (Slack,
Telegram). The two decide authority for different subjects, at different layers.

|                          | Paseo app/web                                                 | Channel (Slack/Telegram)                                  |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| Subject                  | The logged-in Member                                          | The message sender (`slack:U123`)                         |
| Authority decided        | Per-user, at the daemon                                       | Per-sender, at the **Hub**, before any daemon RPC         |
| Daemon connection        | One session **per user**, ticketed                            | One socket **per channel account**, shared by all senders |
| Daemon sees the subject? | Yes                                                           | No — it only sees the account lease                       |
| Enforced by              | Daemon (`SessionAuthorization` + `ManagedResourceAuthorizer`) | Hub (`authorizeChannelPrivilege`)                         |

### Chat from the Paseo app/web — per-user managed session

The logged-in Member asks the Hub for an `accessTicket` bound to `(user, daemon,
clientId)`, 60 s TTL. Mint resolves the **current session user**
(`management-api/index.ts:2127-2136` → `organization-access.ts` `requireSession`);
`tickets.ts:54` `issue()` checks the user's grants via `store.resolveDaemonAccess`
(requires `daemon.connect` and, per project, `project.use`). The daemon admits it at
`hello`, turns it into a lease, and builds `SessionAuthorization` +
`ManagedResourceAuthorizer` (`session.ts:817-818`).

### Chat from a channel — one decision point, two enforcement points

The Hub **computes** authority (the decision point); it is **enforced** at two points that
answer different questions. Label them by question/subject/enforcement point, not by "who
computes" — the Hub computes both.

- **Gate 1 — per sender, at the Hub, before any RPC.** "May _this sender_, in this
  conversation, do this now?" `senderIdentity` → `resolveChannelMember` via
  `channelIdentities` → a linked Member, else the **Guest** subject (`store.ts:1065`,
  `887-924`). `authorizeChannelPrivilege` checks `channel.use` on the `channel_account`
  resource (conversation-scoped), then `agent.interact` / `agent.create` / `approval.*`
  via `daemon.connect` + `project.use` + `agentConfigurations` (`store.ts:891-1006`).
  Enforced for every message — plain chat too (`execution.ts:515-532` gates a queued
  message on `agent.interact` before dispatch). Fail here → nothing reaches the daemon.
- **Gate 2 — per connection, at the daemon, on every RPC.** "Is _this connection's
  principal_ allowed this RPC at all?" One socket per account, shared by every sender, so
  the daemon **cannot see the sender** — Gate 2 is sender-blind. Its subject is the
  account's connection login; its ceiling is the lease.

Complementary, not redundant: Gate 1 is fine-grained but the daemon must trust it; Gate 2
is coarse but the daemon enforces it independently. For the app the two gates share one
subject (the user) and look like one; the channel **splits** them (N senders : 1 account
lease). Today Gate 2 for channels is a trusted session, scope `["*"]`, only when the
daemon is `off` — **vacuous** — so channels currently rely entirely on Gate 1.

## Gate A (upstream semantic) vs Gate B (fusion product)

The daemon runs **two independent checks** per inbound message (`session.ts:1925-1930`):

```
inbound RPC
  ├─ Gate A (semantic)  authorization.allowsInbound → operation-permissions[type] → permissions.has(...)
  └─ Gate B (product)   resourceAuthorizer.allowsInbound (only if lease isRestricted) → allowsProject(project, privilege)
```

- **Gate A is upstream Paseo.** `packages/server/src/server/authorization/` (`index.ts` =
  `SessionAuthorization`, `operation-permissions.ts`) exists on `upstream/main` (PR #3981,
  "establish semantic session permissions"). Each connection carries a flat
  `DaemonPermission` set (`workspace.read/write/manage`, `daemon.read/manage`,
  `tunnel.manage`, `access.manage`, `automation.manage`, `hub.execute`). Trusted client =
  owner set (full); enrolled Hub = persisted perms (e.g. `hub.execute`). This is upstream's
  **entire** permission model — a flat set + an RPC→permission table, **no per-project /
  resource scoping**.
- **Gate B is fusion.** `packages/server/src/server/managed-access/` (resource-authorizer,
  tickets, types) does **not** exist on `upstream/main`. It adds the product/resource
  layer: per-project `project.use` / `agent.create` / `agent.interact` / `terminal.use` /
  `approval.*` / `agentConfigurations`, plus tickets/leases. For channel's owner lease it
  is pass-through (`isRestricted()` false).

Consequence: **leave Gate A (upstream) untouched** — editing it fights `upstream/main`.
The only duplication worth consolidating is in Gate B + the Hub channel path (both fusion).

## Ticket vs lease — where the permissions live

Three distinct things; do not conflate:

```
1. GRANTS (Hub, durable)       source of truth (owner = full; member = specific grants)
      │  resolveDaemonAccess() reads these
2. TICKET (mint, Hub)          60 s opaque token: (org, daemon, member, clientId). NO permissions.
      │  daemon redeems at hello → Hub consume() re-resolves grants NOW
3. LEASE (consume, Hub→daemon) permissions + resourceMode + projects + expiry. Authority lives here.
      ▼  daemon holds it in memory (SessionAuthorization + ManagedResourceAuthorizer)
   Gate 2 enforces each RPC against the lease
```

- The **ticket carries no permissions** (`daemon_access_tickets`, `tickets.ts:69-82`) — it
  only proves "this member may open a managed session here." Deliberately empty so
  authority is **re-resolved live at consume/refresh**; a revoked grant between mint and
  consume is caught.
- Permissions are attached at **consume** (`tickets.ts:112-142`, `resolveDaemonAccess`) and
  delivered as the **lease**. Ticket → (consume) → lease are **two records**
  (`daemon_access_tickets` vs `daemon_access_leases`); there is no "lease ticket".
- Reconnect = mint a new (single-use) ticket; a live connection = **refresh the lease**
  (re-resolve + extend), no new ticket.

### `daemon_access_leases` stores identity, not permissions

Columns (`schema.ts:785`): `id, organizationId, daemonId, userId, membershipId, clientId,
expiresAt, revokedAt, createdAt`. It is a **revocation handle + expiry**, with **no
permissions column** — the permission set lives only in the daemon's in-memory
`SessionAuthorization`, re-resolved at consume/refresh. The table has **no channel-account
column and no sender column**.

| Surface                  | `userId` / `membershipId`        | `clientId`              | Leases                                                    |
| ------------------------ | -------------------------------- | ----------------------- | --------------------------------------------------------- |
| Web app                  | the logged-in **human**          | per app-client          | per real user                                             |
| Channel (Phase-1, owner) | the **owner** (fixed, all accts) | **per channel account** | N accounts → N, all under owner, told apart by `clientId` |

Slack senders never appear in these tables — they live only in `channelIdentities` + Gate 1
at the Hub. This is the structural reason per-sender authority cannot be at the daemon.

## Channel and automation — shared daemon primitives, separate admission

Channel rides the **stock trusted-client RPCs** (`create_agent_request` /
`send_agent_message_request` / `agent_permission_response`, the same the app uses), which
dispatch to the **shared** `createAgentCommand` / `sendPromptToAgent` /
`respondToAgentPermission` primitives (channel-reuse plan lines 77-79; `hub.md:57`,
`hub.md:32`). **Channel is unified with the app path, not automation.** The scoped
`hub.execution.*` RPCs are a **frozen legacy-compat surface** ("no form rides it by design
at P0, expected to sunset with the P1 grant engine" — channel-reuse plan line 24/79);
automation still rides it.

|                     | Automation (hub relationship)                                                                              | Channel (control plane)                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Transport           | `"hub"`, daemon-attached (`bootstrap.ts:1261`), admission `{principalId, permissions, hubExecutionAgents}` | trusted-client, one per account (`channels/daemon/ws-client.ts`)         |
| Managed gate        | **bypassed** (`transport !== "hub"` is false, `websocket-server.ts:1749`)                                  | **is a managed subject** → needs a ticket (the gap)                      |
| RPC surface         | **narrow**: `hub.execution.agent.create` / `.validate` / `.control` (`session.ts:2397-2405`)               | **full session**: create, repeated message, approval, terminals, streams |
| Permission required | `hub.execute` (`operation-permissions.ts:93-95`)                                                           | `workspace.write`, etc.                                                  |

Two hard facts keep them non-interchangeable: **no wildcard** in managed access
(`SessionAuthorization.allows` = `permissions.has(x)`, `authorization/index.ts:73,119`; the
"unrestricted" owner set is `daemon.read`+`workspace.read`+`workspace.write` (+admin),
`store.ts:24-31`, excluding `hub.execute`); and `hub.execution.*` needs a
`HubExecutionController`, present only on the `"hub"` transport (`session.ts:995-997`).

### The `hub.execute` ceiling (why automation can't grow into a real bot on it)

Automation reuses a daemon Agent for a binding via `reuse: binding`
(`2026-09-02-channel-workflow-integration-gaps.md`), carried by `reuseAgentId` on
`hub.execution.agent.create.request` (`protocol/messages.ts:2936-2941`). Limits the bot
vision hits:

- **No steer.** Continuity is **re-create-with-reuse** — each inbound is a new
  `hub.execution.agent.create` with a fresh `prompt` and a new AgentExecution record
  (`2026-09-02` line 61), not `send_agent_message_request` into the live turn.
- **No file/terminal driving.** A Hub execution Session holds only `hub.execute` and
  cannot call file or terminal operations (`2026-08-31` §9.9, line 1226).
- **Accreting on a frozen surface.** Approvals for a Workflow Agent already resolve through
  the trusted-client approval path (`2026-09-02` line 75) — a hybrid piling features onto
  the surface slated to sunset.

**Direction:** do not deepen the `hub.execution` dependence. The full-capability substrate
(create + steer + approve + terminal + per-resource scoping, with binding/session reuse) is
the **managed session** (trusted-client RPCs + the P1 lease), which channel and the app
already use. When automation is ready to take over the channel use case, move its execution
onto that substrate and sunset `hub.execution`.

## Guest — two concepts, one live

- **Live: the Access Guest _subject_.** `subjectKind: "guest"`, `subjectId: "guest"`
  (`GUEST_ACCESS_SUBJECT_ID`, `access/contract.ts:40-42`). An unlinked sender falls back to
  Guest grants (none by default; operator-assignable). Linking **switches** the subject to
  the Member, never merges. Tested (`access/guest.test.ts`); surfaced in the app access
  editor (`subjectKind` enum). Authoritative: [permissions.md](../permissions.md).
- **Dead: the channel actor-_role_ "guest".** `channels/policy/roles.ts` projects
  `owner/admin/member/guest` for slash-command gating, but has **no live importers** —
  command authority comes from direct privilege checks (`commands-context.ts:83-87`). Treat
  `roles.ts` as superseded.

## Link identities — `/link`

`channelIdentities` maps `(organizationId, connectionId, externalSubjectId) → memberId`. A
Member requests a code (`issueChannelIdentityChallenge`, gated by
`canLinkChannelIdentity`), runs `/link <code>` from the channel, and
`consumeChannelIdentityChallenge` binds the sender to the Member (`store.ts:563-881`). After
linking, the sender resolves to that Member's own + Team grants (Gate 1) instead of Guest —
**the same grants and checks the web app applies.** A linked channel user is thus
authorized like the app at Gate 1; for a per-user daemon session they use "Open in Paseo"
(`2026-08-31` §10), which mints their own ticket under their own membership.

## Trust model & tradeoffs (channel-account model)

Why one shared full lease **per channel account** — not per user — is sound:

- **The daemon already trusts the Hub to resolve authority.** `resolveDaemonAccess` runs at
  the Hub; the daemon enforces what it returns. Gate 1 is the same trust relationship.
- **A full (owner) lease = the daemon fully trusts the Hub for channel traffic**, so the
  Hub may sub-delegate per sender. Narrowing (Phase 2) matters only when the Hub is a
  _different trust domain_ than the daemon (hosted/team/multi-tenant). Single operator →
  full trust is correct; "no use case yet" = "not multi-tenant yet".

What it rests on:

- **Safety reduces to sender-identity integrity.** Safe iff the Hub↔daemon link is
  authenticated (it is) and `senderIdentity` cannot be forged (the channel vertical
  verifies the platform signature before dispatch; `/link` binding is member- or
  admin-initiated).
- **Orthogonal to account-vs-per-user.** If `senderIdentity` is forgeable, per-user
  connections do not help — the attacker impersonates the victim and inherits their
  authority either way. The account-level connection adds no attack surface.

The real tradeoff is the duplication (Problem 2/3, and _Consolidation_ below): the product
layer — which project, terminal, provider/model, agent configuration — is resolved twice
and classified twice. This is the substance of authorization, not a side detail; consolidate
it.

## Per-user connection inside the channel path — evaluated, not adopted

Correction to an earlier claim: the daemon authorizes an agent by its **project**, not by
the connection that created it (`resource-authorizer.ts:615` → `allowsProject`), so two
users steering one shared agent is technically fine when both leases cover the project. The
real reasons not to adopt per-user connections:

| Case                          | Per-user connection? | Why                                                                          |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| DM / personal thread (1 user) | ✓ = web app          | 1 user ↔ 1 agent; equals "Open in Paseo"                                     |
| Shared thread, 2+ linked      | ⚠ technically works  | cross-connection steer/approve OK if leases cover the project                |
| Thread includes a **Guest**   | ✗ hard blocker       | Guest has no membership → `tickets.issue` needs `membershipId` → cannot mint |
| Outbound / stream             | ✗ model mismatch     | relay + approvals want **one** connection per agent/binding, not per sender  |

Plus connection explosion/lifecycle (§12.1) and marginal benefit (per-sender authority is
already at Gate 1). Verdict: keep shared-connection + Gate 1; per-user daemon identity only
via "Open in Paseo". The per-admission-scope evolution is
[§12.1](2026-08-31-unified-client-managed-access-lite.md#121-channel-supervisor-admission-open-gap).

## Single-link per-principal multiplexing — recorded, deferred

A later idea, kept here so a re-read lands it fast: treat the Hub↔daemon
connection as **one transport pipe** and carry the **lease per principal** over
it. The daemon holds a map of leases keyed by principal and picks the ceiling
per inbound message from a principal/lease reference the Hub stamps. This is the
"one socket, per-principal authority" shape — distinct from per-user _sockets_
(above) and from the account owner lease (Phase 1).

Why it reads as the natural model:

- **Transport and authorization are separate concerns.** Hub↔daemon is one
  process talking to one process. Opening N sockets to represent N principals
  imports the many-_device_ client topology (app/web: one socket per human) into
  a place that is one-to-one — more moving parts than the underlying reality.
- **Less duplicated authorization.** If the daemon enforces daemon-owned
  authority per principal, the Hub could stop re-checking daemon permissions.

Why not now:

- **The protocol binds one lease per connection, fixed at `hello`** (verified).
  `accessTicket` is a single optional field (`protocol/src/messages.ts:7004`); a
  `Session` holds one `SessionAuthorization` + one `ManagedResourceAuthorizer`
  (`session.ts:659-660`); `allowsInbound(message)` takes no principal reference
  (`session.ts:1999`, `authorization/index.ts:38`); a renewed ticket for the same
  key **closes and reopens** the connection rather than stacking a second lease
  (`websocket-server.ts:1683-1689`). Multiplexing requires the daemon to hold a
  lease _map_ and every inbound RPC to carry a principal/leaseId reference — a
  change to the inbound dispatch in `session.ts`, the most churn-heavy upstream
  file (657 lines in the pending v0.8 merge). High divergence cost against
  `upstream/main`.
- **An idle extra socket is cheap** (verified), so per-user _sockets_ (the
  alternative) are not blocked by cost: a bare authenticated socket allocates an
  in-memory `Session` plus a few listener registrations on shared singletons; no
  file watcher, PTY, git poll, or per-agent stream exists until the client
  subscribes to a workspace/terminal/timeline. The cost that scales with
  concurrent principals is shared-bus listener fan-out, not OS handles.
- **The stated driver — "less duplicated authorization logic" — splits in two.**
  Removing duplicated _code_ (write the check once) is the
  [Consolidation](#consolidation) fix: one shared resolver + one shared
  op→privilege map, no transport change. Removing duplicated _runtime
  enforcement_ (the daemon checks, the Hub skips) is the bigger thing that needs
  per-principal authority, and it sacrifices Gate 1's early reject
  (`execution.ts:515` stops a message before it costs a dispatch/execution
  record). The frontend/backend analogy argues for keeping both enforcement
  points with shared logic — consolidation — not collapsing to one point.
- **Under a trusted Hub the security delta is small.** Per-_socket_ binding
  (connection = credential) is structurally stronger than a Hub-stamped
  per-message tag _only_ if you defend against the Hub itself. The Hub is
  first-party infrastructure already trusted to resolve authority (the whole
  model), so the tag is the correct trust relationship — not a weakness, and not
  a reason to pay the transport cost.

**Revisit when both hold:** (1) a concrete driver appears — many concurrent
linked principals so per-socket listener fan-out actually hurts, a real need for
single runtime enforcement, or a move off the trusted-Hub assumption (hosted /
multi-tenant / audit-per-user); and (2) you commit to collapsing to one
Hub↔daemon socket. Absent both, Phase 1 transport + [Consolidation](#consolidation)
already satisfy "one link" and "less duplicated logic."

## Consolidation

Two separate duplications, both **fusion-internal** (Gate A / upstream `authorization/`
untouched).

### (a) Resolve-access: one resolver

`resolveDaemonAccess` (app) and `resolveChannelAgentAccess` (channel) differ only in
**subject** (membership vs `senderIdentity → member|guest`), **scope** (all projects vs one),
and **output shape**; the core is identical (owner/`daemon.manage` → unrestricted; require
`daemon.connect`; require `project.use`; union privileges; gather `agentConfigurations`).
Extract the core:

```
resolveProjectPrivileges(assignments, daemonId, projectPk) → { unrestricted, privileges, agentConfigurations }
subjectAssignments(AccessSubject) → assignments[]        // AccessSubject = member | guest
// app:     membership  → subjectAssignments → all projects  → shape {permissions, resourceMode, projects}
// channel: sender→member|guest → subjectAssignments → one project → resolveProjectPrivileges
```

Channel keeps its own `channel.use` / conversation resource gate on top; the app keeps its
semantic-permission + `resourceMode` output shaping.

### (b) Action→product-privilege: one shared map

Channel actions become the same wire RPCs the app sends, so derive the required privilege
from **one** table keyed by wire operation:

- Put `REQUIRED_PRIVILEGE_BY_OPERATION[wireType] → productPrivilege` in a **fusion** module
  (e.g. beside `packages/protocol/src/managed-access.ts`).
- The fusion `resource-authorizer` (Gate B) and the Hub channel path both consume it; the
  Hub keys off the wire RPC it is about to send instead of hardcoding `agent.interact` etc.
- It is **build-time code reuse, not a wire contract** (no protocol-compat burden): each
  surface enforces with its own copy (channel → Hub only; app → daemon only).

**Boundaries (do not force symmetry):** the shared map is the **overlap** only (ops that
become daemon wire RPCs), keyed by operation as a superset — channel queries its subset,
daemon queries all. Channel-only authority (`channel.use`, conversation, reply/outbound,
`/link`, `approval.channel`) stays in channel code; daemon-only authority (`daemon.manage`,
`tunnel.manage`, workspace lifecycle, pairing, binary frames, file paths) stays in the
daemon. And leave upstream `operation-permissions.ts` (Gate A, semantic) alone — the product
map is a separate fusion layer beside it, never merged into it.

## The open gap (Phase 1) and Phase 2

In `external` mode the daemon treats any non-`hub`, non-`local_ipc`, non-plugin client as a
managed subject (`websocket-server.ts:1745-1750`) and requires an `accessTicket`
(`:1752-1763`). The supervisor's socket carries none; `ChannelDaemonClientOptions` has no
field for one (`channels/daemon/client.ts:22-44`). The app mint path can't help — it resolves
the current logged-in user (`management-api/index.ts:2133`, `requireSession`) and a headless
supervisor has no session. Phase 1 (above) mints under the owner membership in-process.

**Phase 2 — narrow Gate 2 (deferred).** Provision a scoped lease (per project `project.use`
/ `agent.create` / `agent.interact` / `terminal.use` / `approval.*` + `agentConfigurations`)
— the channel-reuse plan's P1 grant engine applied to the channel session. Only then does
the daemon hold a real independent ceiling for channels. Accepted tradeoff until then: the
lease is unrestricted and **Gate 1 is the only real limit**, the same posture as today's
trusted `["*"]`, now also working in `external`. Keep one connection per account for now; the
long-term unit is `(daemon, principal, grants)` with a ref-counted socket
([§12.1](2026-08-31-unified-client-managed-access-lite.md#121-channel-supervisor-admission-open-gap)).
