# One lost SSE request blocked a Slack channel (2026-09-22)

Slack app `sale-clisbot`, channel ai-for-sale, Host `uat-sale-sandbox`. First messages of new threads went unanswered (09:41, 11:59, 12:00, 14:21), and after 14:21 every later top-level message in the channel was silent too. Nothing crashed; the pod was healthy.

## Chain

1. **The event stream attempt hung and the watchdog did not end it.** `daemon.log` for agent `67f211f7`: attempts 1–4 `ECONNREFUSED` (server not listening yet), attempt 5 connected about 1 s after spawn and returned only at undici's 300 s headers timeout: `outcome=watchdog phase=first-record elapsedMs=301728 err="Headers Timeout Error"`. The 30 s watchdog fired, but the abort did not end the fetch. `opencode.log` shows the request never reached OpenCode's handler; attempt 6 connected at once (`global event connected` at exactly +5 min). OpenCode was not slow. Repros with a never-answering server and a listen-without-accept socket, on the pod's Node, abort fine, so the reason the abort was lost is still unknown.
2. **The first turn gave up** at the 45 s ready timeout: `your message was not sent`.
3. **The daemon recorded a known non-delivery as unknown.** The send receipt stayed `pending` and the submission ledger stayed `pending`, so every replay was refused (`agent_request_outcome_unknown`, "refusing to deliver the logical message twice").
4. **The Hub changed the request on replay.** The first prompt went out with `steer:false`, and the replay went through the follow-up path with `steer:true`. Same `messageId`, different fingerprint: `agent_request_key_conflict`.
5. **The Hub retried a permanent error for 24 h**, and a `failed` row blocks its lane. Every top-level message in a Slack channel shared the `root` lane, so one poison row silenced the channel. The sender was never told.
6. **Every channel agent kept its own `opencode serve`** and none was ever reclaimed: no provider implemented `isIdleForRelease`, and the Hub's timeline subscription counted as a viewer. 11 processes, about 1 GB of 8 GB free, inotify at 8192 exhausted.

## Fixes

| Layer                   | Fix                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OpenCode event consumer | Each attempt has its own deadline (5 s to the first record, 30 s on the open stream) that does not depend on the abort working |
| Daemon requests         | `PromptNotDeliveredError` deletes the receipt; the submission becomes `withdrawn`; a replay of the same message delivers       |
| Hub bindings            | First prompt and follow-up send the same way (`steer`), so a replay has the same fingerprint                                   |
| Hub ingress             | Receipt refusals dead-letter at once; every dead-letter posts one notice in the source thread                                  |
| Hub lanes               | lane = the session the message lands in (`deriveBindingKey`), so one stuck session blocks only itself                          |
| Hub drain               | Continuous worker pool per account; one slow dispatch holds only its own worker                                                |
| Idle reclaim            | OpenCode certifies idle; the Hub subscribes with `keepsAgentsResident: false`                                                  |

## Lessons

- **A retry that cannot succeed is worse than no retry.** Check the whole loop: the error class at each hop, what the replay sends, and whether the receiver can tell "not sent" from "unknown".
- **Never let an abort be the only way out of a wait.** Race the wait against the deadline and walk away from it.
- **A lane is exactly as wide as a session.** Wider blocks strangers; narrower loses order.
- **Read both sides' logs before blaming the slow side.** "OpenCode took 5 minutes" was really one request the daemon waited on for 5 minutes.

Still open: the Hub Postgres pool has no explicit size (defaults to 10 for every account), the outbound pacer has no per-send timeout, and node `fs.inotify.max_user_watches` is 8192.
