# Channel vs Paseo app: two ways a chat is authorized

A chat can reach an agent from **the Paseo app/web** or from **a channel** (Slack,
Telegram). The two paths decide authority on different axes and at different layers.
Don't conflate them. This is the short map; the authoritative facts live in
[permissions.md](../permissions.md) (§"Channel command access") and the full gap
write-up in [2026-08-31 §12.1](2026-08-31-unified-client-managed-access-lite.md#121-channel-supervisor-admission-open-gap).

## At a glance

|                          | Paseo app/web                                                 | Channel (Slack/Telegram)                                          |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Subject                  | The logged-in Member                                          | The message sender (`slack:U123`)                                 |
| Authority decided        | Per-user, at the daemon                                       | Per-sender, at the **Hub**, before any daemon RPC                 |
| Daemon connection        | One session **per user**, ticketed                            | One trusted socket **per channel account**, shared by all senders |
| Daemon sees the subject? | Yes                                                           | No — it only sees the account lease                               |
| Enforced by              | Daemon (`SessionAuthorization` + `ManagedResourceAuthorizer`) | Hub (`authorizeChannelPrivilege`)                                 |

## Chat from the Paseo app/web — per-user managed session

The logged-in Member asks the Hub for an `accessTicket` bound to `(user, daemon,
clientId)`, 60 s TTL. Mint resolves the **current session user**
(`management-api/index.ts:2127-2136` → `organization-access.ts` `requireSession`);
`tickets.ts:54` `issue()` first checks the user's grants via
`store.resolveDaemonAccess`, which requires `daemon.connect` and, per project,
`project.use`.

The daemon admits the ticket at `hello` (`websocket-server.ts:1752-1787`), turns
it into a lease, and builds `SessionAuthorization` + `ManagedResourceAuthorizer`
(`session.ts:817-818`). Every RPC is then checked with three AND layers
(`session.ts:1925`):

1. **Semantic permission** — the op→permission table
   (`authorization/operation-permissions.ts`); e.g. `send_agent_message_request →
workspace.write`, reads → `workspace.read`.
2. **Per-project privilege** — `resource-authorizer.ts:615` resolves the target to a
   project and requires `project.use` + the op's privilege (`agent.interact`,
   `terminal.use`, `approval.*`).
3. **Agent-configuration grant** — create/config re-checks the resolved
   provider/model/thinking against the project's granted configurations
   (`resource-authorizer.ts:516-546`).

## Chat from a channel — per-sender Hub authority + shared account lease

Two axes; keep them apart.

- **Axis A — per-sender authority (Hub).** `senderIdentity` → `resolveChannelMember`
  via `channelIdentities` → a linked Member, else the **Guest** subject
  (`store.ts:1065`, `887-924`). `authorizeChannelPrivilege` checks `channel.use` on
  the `channel_account` resource, scoped to the conversation; then `agent.interact`
  / `agent.create` / `approval.*` via `daemon.connect` + `project.use` +
  the matching `agentConfigurations` grant (`store.ts:891-1006`). The daemon never
  sees the sender. The agent replies only through a Route capability bound to that
  conversation.
- **Axis B — per-account daemon lease.** The supervisor holds **one** trusted-client
  socket per channel account, shared by every sender, scopes `["*"]`, authenticated
  by the optional daemon password + loopback trust (`channels/daemon/ws-client.ts`).
  It is the account's outer ceiling, not where per-sender authority is decided —
  one socket can't tell its senders apart.

## Guest — does it exist? Yes. There are two; only one is live.

- **Live: the Access Guest _subject_.** `subjectKind: "guest"`, `subjectId: "guest"`
  (`GUEST_ACCESS_SUBJECT_ID`, `access/contract.ts:40-42`). An unlinked sender falls
  back to Guest grants; Guest holds nothing by default; operators assign its
  privileges through Access like a Member/Team. Linking **switches** the subject to
  the Member — it never merges Guest authority. Implemented and tested
  (`access/guest.test.ts`), surfaced in the app access editor (`subjectKind` enum in
  `clisbot/hub/contracts.ts`). Authoritative: [permissions.md §"Channel command
  access"](../permissions.md).
- **Dead: the channel actor-_role_ "guest".** `channels/policy/roles.ts` projects
  `owner/admin/member/guest` for slash-command gating. It has **no live importers** —
  command authority now comes from direct privilege checks
  (`channels/commands-context.ts:83-87`: `channel.use`, `agent.interact`,
  `agent.create`, `approval.config`), and permissions.md states the role projection
  grants no command authority. Treat `roles.ts` as superseded (delete, or mark it).

## Link identities — `/link`

`channelIdentities` maps `(organizationId, connectionId, externalSubjectId) →
memberId`. A Member requests a code in Paseo (`issueChannelIdentityChallenge`,
gated by `canLinkChannelIdentity`), runs `/link <code>` from the channel, and
`consumeChannelIdentityChallenge` binds the sender to the Member
(`store.ts:563-881`). After linking, the sender resolves to that Member's own and
Team grants (Axis A) instead of Guest.

## The open gap — the channel plane can't be admitted in `external` mode

In `external` mode the daemon treats any non-`hub`, non-`local_ipc`, non-plugin
client as a managed subject — loopback TCP included
(`websocket-server.ts:1745-1750`) — and admission **requires** an `accessTicket`
(`:1752-1763`). The supervisor's per-account socket carries none:
`ChannelDaemonClientOptions` has no field for one (`channels/daemon/client.ts:22-44`)
and the `hello` sends none. So the channel plane works only while the target daemon
is `off`; commit `7b4e60919` fixed URL targeting only.

The app path doesn't solve it: the mint endpoint resolves the current logged-in user
(`management-api/index.ts:2133`, `requireSession`), and a headless supervisor has no
user session.

### Fix direction

Three pieces (full rationale in [§12.1](2026-08-31-unified-client-managed-access-lite.md#121-channel-supervisor-admission-open-gap)):

1. A channel-plane **service principal** — a Member holding `daemon.connect` plus the
   project grants each route needs — to mint tickets against headlessly.
2. Add `accessTicket` (+ a resolver) to `ChannelDaemonClientOptions`, minting a fresh
   ticket per reconnect. N accounts = N tickets/leases, each with its own `clientId`.
3. Provision a lease that satisfies all three AND layers above: `workspace.read` +
   `workspace.write`; per project `project.use` / `agent.create` / `agent.interact`
   / `terminal.use` / `approval.*`; and `agentConfigurations` matching each route's
   provider/model. Moving off today's `["*"]` narrows the lease to the enumerated
   projects — a route pointing outside it fails at the resource gate even when the
   semantic permission passes.

Keep one connection per account for now (failure isolation). The right long-term unit
is `(daemon, principal, resolved grants)` with a ref-counted, lifecycle-decoupled
socket; move to it before raising account count or going multi-daemon.

### Verify both states

- **daemon `off`:** the legacy/unmodified path still works (upstream compat).
- **daemon `external`:** the channel plane is admitted and narrowed to the granted
  projects.
