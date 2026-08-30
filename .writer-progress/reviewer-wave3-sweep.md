# REVIEWER — wave-3 live E2E sweep, FINAL verdict

(2026-08-28; live hub PID 1383052, port 6868, revision v21 `1cf59f56`, home ~/.clisbot-dev)

Reviewer watchdog: polled both `.writer-progress/wave3-{slack,telegram}.md` + `/tmp/w3{slack,tg}-*`
growth ~every 10-15 min; cross-checked every PASS/FAIL claim against `~/.clisbot-dev/hub.log`
plane events + the lane read-back logs. No stall flag ever fired (both lanes moved continuously
06:25→07:12Z). Evidence-verify + rail checks below.

## SLACK lane (revision v21) — live surface `$SLACK_TEST_CHANNEL` = C07U0LDK6ER

| #   | Case                                   | Lane verdict                  | Reviewer                                          | Evidence check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------- | ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | CORE re-pass (root bind + steer)       | PASS                          | **VERIFIED-OK**                                   | hub.log 06:28:24 `bound a conversation` c81fb3ad newSession + 06:31:07 `steered` same c81fb3ad; read-back ts 1787898510.400039 / 1787898669.419739 match; ledger 53→55.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | C2 PROGRESS (full-sync)                | PASS                          | **VERIFIED-OK**                                   | c2-driver.log: 4 progress + EXACTLY ONE final `PONG-SLACK-C2` ts 1787898965.582419; ledger 58→66 (+8). Fresh agent 7157e4f1 (06:31:39 newSession).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | C9/D5 SUBAGENT RELAY                   | FAIL (provider-toolset-bound) | **VERIFIED-OK (fail is real + correctly scoped)** | c9b22a65 bound 06:42:11. Subagent genuinely ran (answer 391 in root final `PONG-SLACK-C9` ts 1787899349.384419) but the `▶ …(subagent):` prefix line NEVER posted (grep `▶`/`(subagent)` across all slack evidence = NONE). Root cause verified in source: codex `codex-app-server-agent.ts:1993 subAgentRoutes` only emits `provider_subagent` frames for a native `sub_agent` tool_call / `CollabAgentToolCall` w/ receiverThreadIds; codex-cli 0.149 spawned via `exec`→`multi_agent_v1__spawn_agent` → zero frames → relay had nothing to relay. Correctly scoped OUT of the channel plane (provider wire-frame emission). |
| 4   | G7 media outbound                      | G7 PASS, G8-G11 unit-only     | **VERIFIED-OK**                                   | g7-thread.csv: media post 1787900239.045299 (FileCount=1, HasMedia=true, file F0BU5UDDMEC) BEFORE text post 1787900239.119809 `PONG-SLACK-G7`; raw abs-path line stripped from caption; ledger keyed on Slack file id (work:C07U0LDK6ER:F0BU5UDDMEC). Agent dcd9c474 (06:56:54).                                                                                                                                                                                                                                                                                                                                               |
| 5   | E4/E6 live gate                        | PASS                          | **VERIFIED-OK**                                   | e4e6.log: bad Bearer→401 invalid_credentials; loopback no-Bearer well-formed ref→200 tools/list lists `message` tool; malformed ref→400 parse error (not 401/500); /api/v1/channels→200 both accounts; /api/v1/channels/config→404 (F-05 no read-only config).                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | Approval card re-drive (typed approve) | PASS                          | **VERIFIED-OK**                                   | 6 exec-gate cards (5 on C2 + 1 on G7), each typed `approve permission-exec-…` → hub.log 5× `approval answered … allow` 06:33-06:36 + 06:57:15; in-place decided-state ("Approved CodexBash … by slack:U8ZTVGJJF", same ts, not re-posted) = F-09 holds on v21.                                                                                                                                                                                                                                                                                                                                                                 |

## TELEGRAM lane (revision v21) — basic group + topic group

| #   | Case                  | Lane verdict                     | Reviewer                                                       | Evidence check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------- | -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CORE re-pass          | PASS                             | **VERIFIED-OK**                                                | w3tg-core.log: W3A master 333→PONG-TG-W3A dev 334; W3B 335→336; hub.log 06:30:14 + 06:30:20 BOTH `steered` 4f072ac8 (no re-mint).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | TOPIC ROUTING (A6/C3) | PASS                             | **VERIFIED-OK**                                                | topics.log: W3C thread=2→PONG-TG-W3C @2 (steer 35ed6461); W3D thread=3→PONG-TG-W3D @3 (fresh mint 58af2b4a); W3E unthreaded→PONG-TG-W3E @null General (steer ea74c919). hub.log 06:31:12/06:31:20/06:31:30 match; per-topic bindings hold.                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | C2 PROGRESS           | PASS                             | **VERIFIED-OK**                                                | progress2.log: 3 out-of-sandbox exec steps each gated → 3 approval prompts + 3 "Running shell…" (msg 339/342/345, ≥30s apart), each typed `approve` (3× hub.log `answered an approval command` 4f072ac8), EXACTLY ONE final PONG-TG-W3F msg 348.                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | C9/D5 SUBAGENT RELAY  | PASS                             | **VERIFIED-OK**                                                | sub-wait.log: `▶ Sub-agent (subagent):` prefix lines posted into topic-2 (dev msg 27 + 28 + 32, thread=3); sub-wait2.log: root final `PONG-TG-W3G` msg 34 LAST; subagent-before-final holds. This IS the wave-3 `sync.subagents.finalAnswers:true` consumer landing live.                                                                                                                                                                                                                                                                                                                                                              |
| 5   | G7–G11 MEDIA OUTBOUND | FAIL (real L1 transport defect)  | **VERIFIED-OK (fail is real + root cause verified in source)** | hub.log 06:56:13 + 07:00:08 `channel media post failed / relay media post failed; ledger row stays recoverable` (sendPhoto). Read-back (media2.log): NO photo/doc ever landed topic-1; caption PONG-TG-W3H2 (dev 40, thread=2) path-stripped. Root cause verified in source: `bot-api.ts buildTelegramClientOptions` injects `createTelegramClientFetch`(timeoutSeconds) → any custom fetch breaks grammy MULTIPART uploads in this undici env (grammy hands it a Node `Readable` body undici's global fetch can't transmit); JSON sendMessage unaffected. Lane's A/B/C/D/E isolation matrix on disk (.writer-progress/grammy-\*.mjs). |
| 6   | C6 CHUNKING           | PASS                             | **VERIFIED-OK**                                                | chunk.log: 6000+ char essay → 7 ordered dev msgs 353→359, HEAD-W3C6 opens chunk0, TAIL-W3C6 closes chunk7, all 1455–4000 chars (<4096 cap), 25434 total, no truncation. `splitTelegramPlainTextChunks`@4000 + F-07 live.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7   | E2-TG callback_query  | SEAM PRESENT, not live re-driven | **VERIFIED-OK (correctly not a false PASS/FAIL)**              | poll.ts callback_query seam confirmed (lines 33/128/234, silent answerCallbackQuery → shared approvalAction); dist/transport/approval-callback.js has the seam. Cannot be live-driven: only a human button-tap fires `callback_query` (bot driver can't tap; no `transport.inlineButtons` set → no card posted). Recorded CONFIRMED-not-re-driven.                                                                                                                                                                                                                                                                                     |

## RAIL ENFORCEMENT — **NO VIOLATIONS**

- Dev daemon PID 290967: untouched the entire sweep (etime continuous 2d05h→2d05h, never restarted).
- Live hub PID 1383052: never stopped/restarted by either lane (same PID; the only v21 restart was main/coordinator's controlled stop→write→start BEFORE the sweep window, 06:18:52).
- Surfaces: ONLY configured ones — Slack C07U0LDK6ER ($SLACK_TEST_CHANNEL); Telegram topic group -1004439007919 + basic group -5229819225 (from .env names). No ad-hoc channels/DMs/groups/topics.
- No token values written to any /tmp lane log (long-base64 blob scan clean).
- No full test suites run during the sweep (all single-case live drives + single-file vitest in the earlier code wave).

## KEY WAVE-3 FINDING for main (C9 subagent relay is LIVE NON-DETERMINISTIC on codex)

The two lanes observed OPPOSITE live results on the same C9 feature in the same sweep, and both
are evidence-accurate:

- SLACK: subagent spawned via `exec`→`multi_agent_v1__spawn_agent` → codex emitted ZERO
  `provider_subagent` frames → `▶ …(subagent):` line did NOT fire (FAIL, provider-toolset-bound).
- TELEGRAM: codex routed the spawn through the native collab tool → `provider_subagent` frames
  emitted → `▶ Sub-agent (subagent):` prefix DID fire (PASS).
  This is provider-routing-dependent, not a channel-plane bug. Main should record C9 as a known
  live flake on codex (fires only when codex uses the native-collab spawn path). A deterministic C9
  proof needs either repeated drives or a provider/model that reliably routes subagents through the
  native collab path. NOT a re-drive-expecting-determinism situation.

## MINOR EVIDENCE-ACCURACY NOTE (does not invalidate any verdict)

The TG verdict's open-gaps note says G7–G11 media is "broken on TG (and by symmetry likely on
Slack too, since both share the injected-fetch transport pattern)". That is NOT supported: Slack
media uses a different JSON external-upload flow (getUploadURLExternal → postUploadBytes →
completeUploadExternal, no grammy multipart) and Slack G7 just PASSed live. Do not re-drive Slack
media as-if-broken — it is working.

## SCRIPT-HYGIENE NOTE (for next wave)

Both lanes share `~/.clisbot-dev/hub.log`; several intermediate `.log` "hub.log:" capture lines
(e.g. w3slack-c2.log, w3tg-sub-wait.log tail) grabbed a CONCURRENT other-lane inbound line
(because the grep wasn't channel/agentId-filtered). The final PONG read-backs + verdicts are all
channel-correct and unaffected, but next-wave assertion scripts should filter hub.log by
channel + agentId to avoid sibling-lane cross-contamination in the logs.

## REVIEWER-INTRODUCED EVIDENCE (exclude from any re-read of topic-1)

Reviewer raw-connectivity probe during TG media diagnosis posted a dev-bot photo into topic-1:
msg 49, date ~1787900766, message_thread_id=2. This is reviewer diagnostics, not relay output —
exclude it if topic-1 history is re-read. (The TG lane's own A/B/C/D/E curl/grammy isolation
tests also left msgs ~41-48 in topic-1.)

## WHAT MAIN MUST DRIVE NEXT

1. **G7–G11 TG media FAIL is the one real defect.** Fix in the verticals lane
   (packages/channels/telegram/src/client/bot-api.ts / telegram-policy.ts): the L1 media send must
   NOT route a multipart upload through the injected timeout-fetch, OR that fetch must normalize
   the grammy `Readable` body before delegating to undici. This is a CODE change → needs a revision
   write + hub restart (H5/H6-style stop-window). Primary "drive next" item.
2. **C9 subagent relay**: record as live non-deterministic / provider-toolset-bound on codex (see
   KEY FINDING). Do NOT burn cycles re-driving expecting a deterministic prefix.
3. **E1/E2-TG card + callback tap**: need a `transport.inlineButtons` revision write + a HUMAN
   button tap (a bot can't tap). Deferred to a manual/human pass; not automatable.
4. Slack media: working live (G7 PASS). No re-drive needed; correct the "by symmetry" note.
