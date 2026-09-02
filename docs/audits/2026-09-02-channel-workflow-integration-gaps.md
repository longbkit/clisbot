# Channel Workflow Integration Audit

Date: 2026-09-02

Status: implemented; Slack and Telegram live E2E accepted

## Decision

- Hub owns Provider Applications, Connections, Channel drivers, Triggers, Workflows, policy, and
  outputs. Paseo daemon owns Agent lifecycle. There is no separate Channel service.
- OpenClaw-derived plugins stay in process behind `plugin.gateway.startAccount(context)` and
  `plugin.outbound.sendText(...)`.
- Credentials flow `Hub DB -> decrypt with external master key -> driver memory`. No `secretRef`,
  persisted OpenClaw credential config, or credential lease exists.
- Channel configuration has immutable, organization-owned revisions and no alternate ownership or
  compatibility fallback.
- Organization Workflows execute from their own immutable revision: receipt, Workflow run, and
  AgentExecution carry `workflowId`; no synthetic runtime Project is created or consulted.
- A route chooses either direct `agent` + `environment` or an enabled organization `workflow`.
  One account may use both on different routes.
- One common admission decision runs before the direct/Workflow branch. Both paths enforce
  `requireMention`, `mayTrigger`, follow-up mode, idle TTL, and existing-binding state.
- Revision deployment compiles `hub.yml` from the candidate files first, then validates Channel
  Agent/Environment references against that candidate bundle.

## Configuration

Existing Channel words and meanings stay unchanged: `interaction`, `binding`, `reply`, `outbound`,
`sync`, and `approval`. A direct route resolves `agent` and `environment` from the Channel resource
registry. A Workflow route resolves `workflow` from enabled organization Triggers.

```yaml
routes:
  - match: { kind: dm }
    agent: coding-agent
    environment: platform
  - match: { kind: channel, ids: [C123] }
    workflow: engineering-assistant
```

The route's effective Channel configuration is copied into the durable Workflow output context;
the Workflow engine remains the execution owner.

## Reuse

`reuse` exists only on Workflow steps and is independent of `auto_archive`:

- absent: create a new Agent;
- `binding`: reuse the same step's Agent across runs for the same Channel binding;
- `steps.<id>`: reuse an earlier step's Agent in the same run;
- archived Agent: restore it before the new turn;
- incompatible provider, model, environment, or authority: fail closed and do not reuse.

Every inbound accepted by `interaction.followUp` creates a new Workflow run. Runs sharing a binding
are serialized in receipt order, including across Hub workers, so `reuse: binding` cannot race.
Every run still creates new step and AgentExecution records even when the daemon Agent is reused.

Trigger acceptance and execution have one owner: the organization Workflow revision. Manual,
Slack, GitHub, Discord, Linear, and Channel events all persist `workflowId`; Trigger runs,
AgentExecutions, and launch intents do the same. No Project route, fallback, adapter, or ownership
union remains in this path.

## Replies and approvals

- A step may post only when its `allow_outputs` contains the matching `<channel>.reply`.
- `outbound.path: relay` applies the existing `sync` settings and records/counts every delivery.
- `outbound.path: tool` attaches the existing Channel reply MCP only to allowed steps; relay stays
  silent.
- No implicit “last Agent wins” rule exists.
- Approval cards and typed approvals resolve against the Workflow Agent with the matching open
  prompt, then run the existing participation and approval-authority checks.
- `reply.anchor`, native media, delivery dedupe, and direct-route behavior are unchanged.
- `sync.progress.progressMessage` controls running tool snapshots;
  `sync.toolCalls` controls terminal tool lines. Hub's internal `finish_execution` control tool is
  never relayed by either surface; useful Agent tools remain governed by those existing knobs.

## Proactive audit fixes

- One Slack Socket Mode connection is shared per Application token and routes strictly by
  workspace, so one Application can back multiple workspace Connections.
- Inbound and outbound runtime state is account-scoped; loading a second account cannot redirect
  the first account's stores or ledger.
- Slack acknowledges socket envelopes before media, inbound, or approval work. Telegram prevents
  two active pollers from consuming one bot token.
- Workflow output requires both durable route context and the matching declared
  `<channel>.reply`; output context alone grants nothing.
- `/status` and `/stop` resolve only active Workflow executions for the current route.
- Telegram passes account abort into the active `getUpdates` request, so Hub shutdown is graceful.

## Remaining non-blocking gaps

| Gap                        | Follow-up                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Restart-specific assertion | Add a fault-injection E2E proving persisted output context reattaches relay/approval before a replayed event. |
| Remote tool path           | Define authenticated Hub reachability for a daemon that is not on the Hub host; relay already works.          |
| Accepted no-op settings    | Implement or reject `transport.errorPolicy`; define the companion allowlist before enabling `inlineButtons`.  |

MCP mutation after Agent creation is intentionally not required now: reuse reloads/restores the
Agent with the current execution MCP and tool policy before sending the next prompt.

## Verification evidence

- Telegram: inbound `telegram:work:523` -> run
  `e51bf185-fffb-481f-a537-d48752f1bc90` succeeded; both steps succeeded; API observer found final
  message `409`; ledger contains exactly one posted outbound (`524`, assistant).
- Slack: inbound `slack:work:1788369330.469049` -> run
  `068e09b3-eac3-49d0-93b7-331245dac638` succeeded; both steps succeeded; API read-back found final
  `1788369372.406699`; ledger contains exactly one posted outbound (assistant).
- Telegram `reuse: binding` restored the prior compatible `prepare` Agent. `reply` correctly did
  not reuse it because its output authority differs; positive same-run reuse and every
  incompatibility dimension are covered by the Workflow regression suite.
- Slack: 178 tests; Telegram: 258 tests; focused Hub flow: 200 cases (1 skipped); Hub typecheck and
  production build passed. PostgreSQL Testcontainers cannot run on this host; the encrypted
  Connection integration and embedded migration passed against real PGlite.

## Acceptance

1. One account can mix direct and Workflow routes without duplicating credentials.
2. Every Workflow step executes; only explicitly allowed steps can reply.
3. Both reuse modes preserve `auto_archive` semantics and reject incompatible reuse.
4. Same-binding runs execute in receipt order and archived Agents can be restored.
5. Replays do not duplicate Workflow runs, Agent creation, or Channel delivery.
6. Direct routes remain unchanged when Workflow routing is unused.
7. Workflow routes cannot bypass mention, sender authorization, follow-up mode, or idle TTL.
8. A revision that changes both `hub.yml` and Channel routes validates against the new candidate
   Agent/Environment catalog.
9. `finish_execution` never becomes a user-visible progress or tool message.
10. Aborting an account interrupts active channel network waits and permits graceful Hub shutdown.

## Upstream boundary

OpenClaw compatibility and Channel projection stay in Clisbot-owned Channel modules. Shared Hub and
Paseo changes are limited to generic Workflow reuse, durable output accounting, and the optional
daemon `reuseAgentId` wire field. Upstream-owned modules are not renamed or moved.
