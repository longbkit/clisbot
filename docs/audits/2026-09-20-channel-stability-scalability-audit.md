# Channel stability and scalability audit (2026-09-20)

Read-only audit of the path channel message → Hub → Host → agent → reply, ranked by how much each finding hurts the target: many people chat with one bot at once and every one of them gets a fast answer. The findings describe the code as audited; the Status table below says what has changed since. Line numbers are from `clisbot-paseoclaw-fusion` at `42cd0969c`.

Tags: **V** read in code, **I** inferred, not measured.

## Status (2026-09-21)

| Finding                      | State                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1 silent drop, wedged thread | Fixed — retry, marker release/TTL, sender notice                                                                   |
| 2 serial pump                | Fixed — continuous worker pool (no pass barrier), due-time wake; lanes scoped to the session                       |
| 3 dead transport             | Fixed in the supervisor (`account-restart.ts`). Telegram's 30 s poll backoff is a verbatim upstream file and stays |
| 4 Host socket                | In-flight calls fail on drop (`7d551b304`); create/send RPC timeout is 90 s. No Hub-side ping yet                  |
| 5 config save bounces bots   | Fixed — per-account `revisionSignature`                                                                            |
| 6 sessions never released    | Open. `fetch_agents` is paged now                                                                                  |
| 7 create throttle            | Fixed — per-Host gate, defer when full. Pre-warmed sessions open                                                   |
| 8 lease leak                 | Fixed — reconcile against running agents when a scope is full                                                      |
| 9 output order               | Per-agent ordering fixed. Durable retry of a failed relay post open                                                |
| 10, 12–15                    | Open                                                                                                               |
| 11 poison message            | Partly — daemon receipt refusals dead-letter at once and the sender is told; other errors keep the 24 h policy     |

How the fixed parts fit together is in [the channel platform](../features/channels/README.md#starting-a-session-without-losing-the-message).

## The path

Vertical transport → durable admission (`channel_ingress_queue`) → per-account drain → plane (route, audience, limits) → bindings (`workspace.create` → `create_agent` → `send_agent_message` on the Host socket) → agent stream back over the same socket → relay or MCP `message` tool → outbound pacer → platform.

## Tier 1 — a user gets silence

### 1. A failed first message is completed, not retried, and wedges its thread (V)

`createRouteSession` throwing (`host_not_connected`, the 30 s create timeout, any daemon error) lands in `settleCreationFailure` (`packages/hub/src/channels/bindings/index.ts:500`), which returns `ignored`. `dispatchInbound` (`channels/supervisor/index.ts:2114`) sees no deferral and completes the row. No retry, no dead-letter, no notice. A failed first `sendAgentMessage` (`bindings/index.ts:404`) does the same with the session already bound.

The pending marker stays with no expiry. Every later message in that thread reaches `recoverPending` (`bindings/index.ts:527`), finds no agent, and is completed silently too. This is the open item in [2026-09-20-channel-host-transport.md](2026-09-20-channel-host-transport.md#still-open). A follow-up on a bound thread throws instead, so it retries; only the first-message path drops.

Direction: return a deferral (`retryAfterMs`) for Host-away and create timeout so the durable queue holds the message; release the marker on a definite failure (`host_not_connected` never reached the daemon) and expire it after a bounded wait otherwise; tell the sender once.

### 2. One serial pump per account (V)

`drainOnce` claims a row and awaits its whole dispatch before claiming the next (`channels/ingress/drain.ts:370-379`). A dispatch for a new thread is about 20 DB round trips plus three Host RPCs, one of which spawns a provider process. Ten people mentioning the bot in ten threads are served one after another, and the typing/reaction surface opens inside the dispatch (`bindings/index.ts:342`), so the tenth sees nothing at all until the first nine sessions exist. One RPC waiting out its 30 s timeout stalls the whole bot.

The claim statement is already built for parallel workers: lanes are `channel:account:conversation:thread` and serialized in SQL (`db/channels.ts:728`). Only the pump is single.

Also: a pass stops at 32 claims and loops again only when `requested` is set (`drain.ts:395-405`), so a backlog over 32 waits for the 15 s timer; retry-due and deferred rows are woken only by that timer.

Direction: N concurrent claim loops per account (start with 4–8); keep pumping while the last pass hit `batchLimit`; arm a timer for the nearest `available_at`; raise the processing surface at admission, before the claim.

### 3. A dead transport stays dead (V)

`observeMonitor` (`channels/supervisor/index.ts:1779-1808`) marks a transport `failed` and logs. Nothing restarts it; `reconcile()` runs only on a configuration save. The Telegram liveness tracker is fed but `detectStall` is never called. `ingress/health.ts` is a read-only operator view. Telegram's poll backoff for any non-429 fault starts at 30 s and grows to 600 s (`packages/channels/telegram/src/fusion/polling-session-restart-policy.ts:6-9`), so one network blip costs at least 30 s of inbound.

Direction: supervised restart with backoff; a watchdog on last-successful-poll / socket activity and queue-head age; start network-error backoff at 1–2 s.

### 4. The Host socket hides a drop for 30 s per call (V)

When the Host socket drops, the registry rejects only its own pending map (`daemons/registry.ts:649`). The channel client's RPCs live in `DaemonSessionProtocol.pending`, and `rejectAll` is called only from `stop()` (`channels/daemon/enrolled-client.ts:68-72`), so each in-flight call waits out `DEFAULT_RPC_TIMEOUT_MS` = 30 s (`channels/daemon/session-protocol.ts:35`). With finding 2 that stalls the account; with finding 1 it then drops the message. The Hub side of the socket sends no ping, so a half-open connection is found only by TCP.

The Hub gives up on `send_agent_message` at 30 s while the daemon may take 60 s to accept it (`packages/server/src/server/agent/agent-prompt.ts:285`): a slow resume is reported as a failure for a turn that then runs.

Direction: reject in-flight calls on Host disconnect; ping/pong on the Hub side; per-RPC timeouts (send > 60 s, create longer than a cold start under load) with idempotent retry on the same `messageId`.

### 5. Saving configuration bounces the bots (V, scope I)

`reconcile` restarts every account whose `revisionId` differs unless `revisionSignature` matches, and that signature covers only Route default Agent controls (`supervisor/index.ts:866-893`). Restart is teardown → drain stop → plane stop → start, one account at a time. The revision looks org-wide, so one Route edit appears to restart every bot. During the gap, tool-path sends fail "not started" (`supervisor/index.ts:950`), delayed outbound sends are lost, and open-audience runs are cancelled.

Direction: a per-account signature; restart only accounts whose own compiled config changed, in parallel; swap route tables in place where the transport and credentials are unchanged.

## Tier 2 — degrades with load or time

### 6. Channel sessions are never released (V)

The daemon reaper closes a session only when `isIdleForRelease?.()` is true (`packages/server/src/server/agent/agent-manager.ts:1979`); no provider implements it, so the 30-minute default never fires. Each Codex agent is a `codex app-server` child process. The Hub archives nothing but one-off command agents. Process count and RAM on the Host grow by one per conversation ever started.

It compounds: `fetch_agents` returns one page of 200 and the Hub ignores `hasMore` (`channels/daemon/client.ts:347`), so past 200 agents pending-marker recovery, command lookups and `readRunningAgentIds` (typing state) miss agents.

Direction: the Hub closes or archives a bound session after follow-up TTL plus a grace period (upstream-friendly, Fusion-owned); page or filter `fetch_agents` by label; cap resident channel agents per Host.

### 7. Session create is the latency floor and has no throttle (V, cost I)

`createAgentInternal` awaits binary resolution, process spawn, `initialize`, workspace-write, collaboration modes and skills loading, then persistence (`agent-manager.ts:1477-1527`). There is no concurrency limit on the daemon, and with limits unset the Hub's limiter takes no lease (`channels/plane/execution-limiter.ts:83`). Today the serial pump is the only thing protecting a Host from N simultaneous spawns; fixing finding 2 without a cap moves the pile-up to the Host and pushes creates past the 30 s timeout into finding 1.

Each new workspace also schedules an unqueued structured-generation naming job and a forced git snapshot with `includeForge: true` (`packages/server/src/server/workspace-auto-name.ts:214`, `session.ts:6600`), competing with the real agent start.

Direction: a per-Host create semaphore in the Hub (ship with finding 2); a small pre-warmed session pool per Route is the real fix for first-reply latency; queue naming at concurrency 1–2.

### 8. Execution leases leak (V)

A lease is released by a terminal stream event, detach, dispatch failure, or the `maxRuntimeSeconds` timer. With `maxConcurrentRuns` set and no runtime ceiling, one missed terminal event (Host reconnect gap, daemon crash, agent killed) wedges the scope until the plane restarts, and messages re-defer every 5 s. Open-audience Routes default to 2 concurrent runs and 900 s, so they self-heal after 15 minutes; a Member Route with only a concurrency limit does not. `bind` runs after `bindOrSteer` returns (`channels/execution.ts:1253`), so a turn that fails fast can emit its terminal event first (I).

Direction: reconcile leases against running agents on an interval and on Host reconnect; default runtime ceiling whenever a concurrency limit is set.

### 9. Output can arrive out of order, and a failed relay post is lost (V)

Each stream frame is `void plane.onStreamEvent(...)` (`supervisor/index.ts:1388`): no head-of-line blocking across conversations, but no ordering within one agent either, and the pacer orders a conversation only when a sent-per-minute limit exists (`channels/plane/outbound-pacer.ts:50`). A tool line can land after the final answer; an approval card before the text that led to it.

A failed relay post is marked `failDelivery` and nothing replays it (`channels/relay/index.ts:561`). A Hub crash between record and confirm leaves the row `recorded`, which a replay would skip. The tool path is better: the failure returns to the agent.

Direction: a per-agent promise tail with bounded depth; a durable retry over `failed` and stale `recorded` rows.

### 10. The Hub receives every agent's stream, fanned out to every account (V)

The Hub's hello declares no capabilities, so the daemon streams all agents and `agent.timeline.set_subscription.request` is a round trip that changes nothing (`packages/server/src/server/session.ts:1340`, `:2599`). The registry hands each frame to every account's subscriber after up to six `safeParse` attempts (`daemons/registry.ts:394-476`). Cost is accounts × stream events, including agents the channel plane does not own. When this is fixed, two things break unless handled: all accounts share one subscription source on the daemon and would overwrite each other's set, and nothing resubscribes after a Host reconnect.

`subscribed`, relay turn state (with full answer texts), pacer routes and `lastActivity` are never pruned.

### 11. A poison message holds its lane for 24 hours (V)

Dead-letter needs 8 attempts **and** 24 h of age (`packages/channels/core/src/channels/message/ingress-retry-policy.ts:14-17,100`), and lanes are FIFO. One message that keeps throwing blocks its thread for a day, silently. The policy file is ported verbatim, so change it through config (`retryPolicy` is already an option on the drain), not by editing the port.

### 12. Slack acks after media download (V)

`provider.ts:199-215` awaits media folding (10-minute download timeout), enqueue and the ledger write before the deferred ack. The DB deadline equals Slack's 3 s ack window. Redeliveries are deduped, so this is delay and socket-health risk, not loss. Direction: persist, ack, download media in the drain.

### 13. Database (V schema, I plans)

- Without `DATABASE_URL` the Hub runs embedded PGlite: one connection for every drain, the UI and the API. A multi-user install needs Postgres.
- The `pg` pool is the default 10 and not configurable (`packages/hub/src/db/postgres.ts:141`). Parallel drains (finding 2) need this exposed.
- `noOlderUnfinishedLaneRow` walks a lane's completed history (30-day retention) and `claim_idx` has no account prefix. Partial indexes on unfinished statuses fix both.

### 14. State lost on Hub restart (V)

`lastActivity` (every follow-up needs a fresh mention), execution leases, waiting notices (posted twice), pacer queues (delayed sends lost), relay accumulators (half-streamed answer truncated). Reply capabilities are persisted, fire-and-forget. Events emitted while the Hub was down are not replayed.

### 15. Two Hub processes can run one account (V by absence)

No ownership lock. Telegram would flap on 409; Slack would split events across sockets; limiter and stream state are per process. Take a session-level advisory lock per account before `startAccount`.

## Order of work

1. **Stop silent loss** — findings 1 and 4: defer instead of complete, release/expire markers, reject in-flight RPCs on Host drop, tell the sender once.
2. **Parallel and instant** — findings 2 and 7 together: concurrent claims, per-Host create semaphore, processing surface at admission, pool size.
3. **Self-healing** — findings 3, 5, 8: transport restart and watchdog, per-account reconcile, lease reconciliation.
4. **Capacity** — findings 6, 10, 13, then 9, 11, 12, 14, 15; pre-warmed sessions once the rest is stable.
