# Lane: wave3 H5 grok live re-drive (final P0 case)

## 2026-08-28 — pre-state (before stop-window #38)

- Hub PID 1415609 @ 127.0.0.1:6868, active revision v21 `1cf59f56` (wave-3 `w3` base: slack+telegram routes on codex gpt-5.6-luna, full sync {progress, finalAnswers, subagents.finalAnswers}; pi-work/grok-work DEFINED but unreferenced).
- Dev daemon PID 290967 @ 127.0.0.1:6867 — NEVER touch (2d+ elapsed, `Sl`).
- Daemon has NO active foreground turn (withActiveForegroundTurn=0, byLifecycle idle:19/error:1) → clean to stop the hub.
- LLM layer probe (read-only, authed): grok available + Enabled; list_provider_models(grok) → grok-4.6, grok-4.5. GREEN. (The "probe before burning a revision cycle" speedup — grok is live, NOT blocked-by-environment like H3/H4.)
- External sender pre-checked live: slack-cli conversations-history on $SLACK_TEST_CHANNEL (C07U0LDK6ER) via user cred SLACK_MCP_XOXP_TOKEN → read OK (wave-3 markers visible; bot=vai U08N4UZM8CF, external user U8ZTVGJJF). NEVER SLACK_BOT_TOKEN as driver.
- Plan: STOP → write `h5w3` (slack route → grok-work {provider:grok, model:grok-4.6}) → START → drive H5 marker (no-tool `PONG-SLACK-H5`) → read-back → record H5 PASS or provider-boundary. Then STOP → write `w3` (restore codex baseline) → START → FIN3 marker → read-back. Log to /tmp + this file at each step.

## stop-window #38 (h5w3 drive)

- [STOP] 08:12:34 — `hub stop` (15s grace timeout = documented-normal; prior PID 1415609 drained by 08:13:13, 6868 free).
- [WRITE] 08:13 — `node .hub-revision-write.mjs h5w3`: pre-compile OK (agents claude-sonnet, codex, grok-work, pi-work); live-validate grok-work (grok) OK + codex OK; **inserted + ACTIVATED revision v22 `ffa34643`** (slack route agent → grok-work {provider: grok, model: grok-4.6}; telegram route unchanged → codex).
- [START] 08:13:32 — hub PID **1419991** @ 6868; `/api/v1/channels` → 200; `channels status`: slack+telegram work transport `started`; hub.log: channel plane started (rebound 0), slack socket mode connected, telegram account started (botId 867846918).
- [DRIVE-0 ABORTED 08:15] marker posted at the CHANNEL ROOT → plane log 08:15:25 `channel inbound steered an existing session` agentId **59f6ea4d** (the wave-2 FIN2 codex session — the root binding). That turn is CODEX, not grok; a `PONG-SLACK-H5` from it must NOT count as H5 evidence. Driver stopped before read-back. **Lesson (register-worthy):** channel-ROOT markers steer the pre-existing root binding; provider-matrix re-drives need a FRESH thread root (seed, unmentioned → ignored by mention-gate) + the mentioned marker IN that thread → new binding key → new agent mint on the route target (same keying as A8's differential proof: fresh marker mints a new agent).
- [DRIVE-1] driver updated: seed root (unmentioned) → mentioned marker in-thread. grok ACP cold-start expected (first `grok agent stdio` spawn on this daemon).
- [DRIVE-1 RESULT] seed ts=1787905015.711049 (08:16:55, unmentioned → ignored by mention gate, correct), marker in-thread ts=1787905019.419119 (08:16:59, explicit mention).
  - hub.log 08:17:09.603 `conversation bound to a new agent session` agentId **e7c3b708-dd6d-42b7-b00e-478b9808f12e**, `newSession: true`, dispatched: true.
  - daemon.log: 08:16:59.913 `Creating agent in /home/node/.clisbot-dev/workspace (grok)` → 08:17:09.555 `Created agent e7c3b708… (grok)`; `create_agent_request` latency 9644ms = grok ACP cold start (`grok agent stdio` first spawn; `ws_slow_request` level 40, benign).
  - agent state `agents/home-node-.clisbot-dev-workspace/e7c3b708….json`: **`provider: "grok"`**.
  - daemon ws_metrics window: 5× `timeline:reasoning` + 5× `timeline:assistant_message` + `turn_completed` all on e7c3b708; ACP session metadata shows `model_id: grok-4.6`, `subscription_tier_display: SuperGrok`.
  - **REPLY ts=1787905035.196209** (08:17:15) in thread 1787905015.711049, bot author, read back via slack-cli: "17 × 23 is 391. / I say that on line 1 of this answer. / PONG-SLACK-H5." — exact marker line LAST. Ledger `work:C07U0LDK6ER:1787905035.196209` recordedAt 08:17:15.388.
  - **H5 = LIVE PASS (grok ACP through the channel plane): external sender → mention-gated plane → route agent grok-work → daemon create_agent(grok, grok-4.6, ACP stdio) → real grok turn (reasoning+assistant frames) → relay post in-thread → slack-cli read-back.** Zero approval prompts this turn (no tools, no exec gate).
  - Side effects, recorded honestly: (a) DRIVE-0 root marker (08:15:23) steered the pre-existing root binding → codex 59f6ea4d; its reply "17 \* 23 = 391. I say it on line 1." ts=1787904932.424119 (08:15:32, channel root, NO PONG line — driver aborted before read-back; not H5 evidence, codex turn, agent now idle). (b) two `channel inbound ignored / not mentioned` warns 08:16:19.261 + 08:16:34.598: no channel message at those instants (socket-mode redelivery of the DRIVE-0 event is the working hypothesis — not verified); both dispatched:false, zero side effects.

## stop-window #39 (restore wave-3 base `w3` + FIN3)

- [STOP] 08:22:22 — `hub stop` on PID 1419991 (15s grace timeout = documented-normal; 6868 free, 1419991 → zombie `Zs` by 08:23:37). Daemon clean at stop: `withActiveForegroundTurn: 0`, idle:20.
- [WRITE] 08:23 — `node .hub-revision-write.mjs w3`: pre-compile OK; route agent targets: **codex(codex/gpt-5.6-luna:auto)** (slack + telegram); validate codex OK; **inserted + ACTIVATED revision v23 `01272bc5`**. (v23 is the wave-3 base content; the number advanced from v22 because the h5w3 revision consumed v22. v16 `baseline` was NOT written — consistent with the documented wave-3 closeout.)
- [START] 08:24:10 — hub PID **1425257** @ 6868; `/api/v1/channels` → 200; both verticals transport `started`; telegram account started (botId 867846918); slack socket mode connected.
- [FIN3] seed ts=1787905462.666359 (08:24:22, unmentioned) → marker in-thread ts=1787905465.769859 (08:24:25, mentioned) → hub 08:24:31.570 `conversation bound to a new agent session` agentId **5305f25b** (newSession) → agent state `provider: "codex"` → **bot reply EXACT `PONG-SLACK-FIN3` ts=1787905478.307859** (08:24:38) read back via slack-cli. Wave-3 base restored + re-proven live.
- **FINAL LIVE STATE (after H5 closeout):** active revision v23 `01272bc5` (wave-3 w3 content: slack+telegram routes on codex gpt-5.6-luna, full sync); hub PID 1425257 @ 6868, `/api/v1/channels` → 200, both transports started; dev daemon 290967 @ 6867 **never restarted** (2d 6h 47m elapsed at closeout). grok provider override remains in `~/.clisbot-dev/config.json` (rollback = `removeProviders:["grok"]`) — intentional, it is the dev-daemon onboarding state for the H5 scenario.
