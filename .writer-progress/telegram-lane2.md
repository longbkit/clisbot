# TELEGRAM lane 2 — P0 live E2E campaign (W2)

Timestamps UTC. I own hub restarts exclusively. W1 owns Slack — no Slack posts.

## 17:20Z — lane start

- Topology: dev daemon 127.0.0.1:6867 (never restart), hub PID 960947 :6868, active revision v8a
  (telegram routes -> claude-sonnet agent [claude/claude-opus-4-8, default]; slack -> codex gpt-5.6-luna auto).
  Policy ops: telegram:8857655856 (master bot), slack:U8ZTVGJJF.
- Surfaces: basic group -5229819225; forum group $TELEGRAM_TEST_TOPIC_GROUP_ID (topics General/1/2).
- Bot under test: $TELEGRAM_DEV_BOT_TOKEN (@longluong3bot, 8678469181). Driver: $TELEGRAM_MASTER_BOT_TOKEN (8857655856).
- Prior lane cursors: master getUpdates offset ~944706787 (last observed update); dev-bot poll offset lastUpdateId ~318879741+ (from state file).

## 19:06Z — S0 sanity marker

- S0 posted (master msg 303). Hub log 19:06:49 'channel inbound steered an existing session' — ADMITTED.
- Waiting for dev-bot reply PONG-TG-S0 via master getUpdates.

## 19:08Z — S0 PASS

- Dev-bot reply "PONG-TG-S0" read back via master getUpdates (obs update 944706792, dev-bot msg 304, date 1787857612; hub steer 19:06:49Z; master msg 303 at 1787857609). Master-bot identity passes mayTrigger after the 19:02 restart.
- Master cursor now: after update 944706792.

## 19:08Z — E5 drive started

- E5 marker posted (explicit first-action AskUserQuestion instruction; question 'Which color do you want?', options Red/Blue; reply exactly PONG-TG-E5 <answer>).
- Watching for permission_requested + approval prompt post in group (~5 min window).

## 19:08Z — 17:15 anomaly DIAGNOSIS (live evidence)

- Master getUpdates drain (offset after S0) captured update 944706791 = msg 302, sender username "longbkit",
  text '@longluong3bot thời tiết hôm nay thế nào', date 1787850928 (≈17:15:28Z), chat -5229819225, no thread.
- "longbkit" is NOT the master bot (longluonggptbot / 8857655856) and NOT the dev bot (8678469181) — it is a
  THIRD bot/user present in the test group. Re-confirming from.id needed (offset already advanced) but the
  username + Vietnamese text + timing (17:15:28Z == hub.log ignored line) match exactly.
- CONCLUSION: the 17:15:28Z 'sender may not trigger this route' rejection was CORRECT behavior — a non-allowlisted
  third party (@longbkit) mentioned the bot under test; the mayTrigger gate (policy.ts:377) properly denied it.
  NOT a config/policy bug. The 17:02:18Z admit was the master-bot marker (cc0fdabe); the 17:15 reject was @longbkit.
  Same revision v8a, same hub — consistent, no anomaly.

## 19:09Z — E5: prompt POSTED (model called AskUserQuestion), answer REFUSED (class-not-approved)

- hub.log 19:08:46.772 "approval answer refused; request stays open" reason=class-not-approved.
- dev-bot msg 306 (master obs update 944706793, date 1787857638) posted the question card:
  "The agent has a question (AskUserQuestion): Which color do you want? 1. Red 2. Blue 3. Other
  Reply with `approve permission-47891a27-c2b1-40d5-b08b-9b07a6f8234d <option>` ... Anyone with approval rights for this tool class can answer."
- MASTER-DRIVER answer posted: `approve permission-47891a27-c2b1-40d5-b08b-9b07a6f8234d Red` (master msg 307).
- REFUSED. ROOT CAUSE (coordinator + R1 corroborate): AskUserQuestion -> tool class `other`;
  `approval.other` is NOT an authorable leaf (enums PRIVILEGE_LEAVES has file/config/command/command.destructive/channel only).
  Only a family-wildcard grant (`approval.*`) or global `*` covers `approval.other` (privilegeCovers).
  The master-bot's ops role currently lacks such a grant in the route scope.
- NOTE: `match: other` approval RULE is INVALID (isApprovalMatchPattern rejects "other"; not in TOOL_CLASSES, not a privilege pattern)
  -> adding that rule would FAIL pre-compile. The route decision for class `other` already defaults to `prompt` (no matching rule),
  which is why the prompt posted. The refusal is purely the RESPONDER privilege check (mayApprove/approverCheck policy.ts:463-472).
- FIX PLAN (write5, hub down): add grant `approval.*` to the master-bot's ops role in policy.yml (covers approval.other via family wildcard).
  Keep telegram routes -> claude-sonnet agent (claude-opus-4-8) so E5 continues on the claude agent. Re-drive FRESH E5 marker after restart.

## 19:14Z — revision v9 written + hub restarted (E5 privilege fix)

- write5 dry-run + real: ops role grants += approval.\* (family wildcard covers approval.other; not an authorable leaf).
  Pre-compile OK; daemon validate OK. Inserted + ACTIVATED revision 306e200d-fc1b-4fda-8b1a-4241329172e5 v9.
- NOTE: coordinator's suggested `match: other` approval RULE is INVALID (isApprovalMatchPattern rejects "other" — not in TOOL_CLASSES, not a privilege pattern). The route already defaults to `prompt` for class `other` (no rule -> prompt), which is why the card posted. The refusal was purely the RESPONDER privilege (mayApprove). Fixed via grant, not rule.
- Hub stopped (PID 960947), started (PID 975707). channels status: slack work + telegram work TRANSPORT=started.
- Re-driving FRESH E5 marker (old pending prompt id 47891a27 not re-answered).

## 19:18Z — E5 LIVE PASS (H2 claude provider approval engine live-exercised)

- Fresh E5 marker (master msg 308) -> hub steered -> claude agent called AskUserQuestion -> hub posted question
  card (dev-bot msg 309, obs update 944706794) with FRESH permission-id permission-49ce08b2-2abf-4c8f-b5f2-9bd10132b345.
- MASTER-DRIVER answer: `approve permission-49ce08b2-... Red` (master msg 310).
- hub.log 19:18:15.688 "approval answered in the channel thread" + "channel inbound answered an approval command" —
  the answer was ACCEPTED (the approval.\* grant on the ops role unblocked the class-not-approved refusal).
- AGENT REPLY read back: dev-bot msg 311 (obs update 944706795, date 1787858298) = EXACTLY "PONG-TG-E5 Red".
- E5 PONG assertion satisfied: PONG-TG-E5 Red. H2 (claude provider approval engine) live-exercised end-to-end:
  question-kind card posted, typed `approve <id> <option>` answer accepted, agent resumed with the chosen option, exact reply.
- Keying discriminator (answers keyed by FULL question text vs codex header key): the claude provider path keys
  updatedInput.answers by the FULL question text (hub approvals/index.ts buildResponse); the claude daemon consumed
  it correctly (agent proceeded with Red). Live-confirmed on the claude provider; the codex header-key subtlety from
  the prior lane remains a codex-only note.

## 19:26Z — S1 PASS (Case 2 re-route to codex works post-restart)

- S1 marker (master msg 312) -> hub.log 19:25:58 "thread bound to a new agent session" agentId 4f072ac8-aff1-4d37-8008-dcc8ee50749d
  (dispatched=true). daemon.log: "Created agent 4f072ac8 (codex)" provider=codex, model gpt-5.6-luna, mode auto.
- REPLY read back: dev-bot msg 313 (obs update 944706796, date 1787858756->1787858763) = EXACTLY "PONG-TG-S1".
- Confirms telegram routes now point at codex under v10. B2-style follow-up evidence: the group root was cleared, so a FRESH
  codex agent minted (not a steer of the old claude cc0fdabe) — re-route proven.
- Agent count now: 4f072ac8 is new; total agents 10 (was 9).

## 19:31Z — Case 3 (B3+B4) starting: long codex turn in basic group

- Current group-root binding: 4f072ac8 (codex). Ledger entries = 33; master cursor after obs update 944706796.
- Plan: B3 marker (count 1..400) -> wait for turn start on 4f072ac8 -> STOP hub mid-turn -> restart ->
  B3R marker -> expect steer of SAME agent 4f072ac8 (no second agent) -> B4 dedupe (no re-posted chunks,
  ledger continuous) -> read back.

## 19:30Z — B3 note: first B3 marker (msg 314, count 1..400) completed under v10 progress=false

- turn-1 (4f072ac8) started 1787858824, posted final answer 1..400 as dev-bot msg 315 (obs 944706797, date 1787858841).
  Only final answer posted (progress was false). Turn completed ~17s -> NOT a valid mid-turn stop.
- v11 now has sync.progress=true on telegram. Driving a FRESH longer B3 (count 1..2000) so progress chunks post
  and the hub can be stopped mid-turn.

## 19:36Z — B3 restart-stop half DONE + hub restarted clean

- Fresh B3 marker (master msg 316, count 1..2000) -> turn-2 on 4f072ac8 started 1787859092.
- Progress chunks posted under v11 sync.progress=true: ledger entries 432/433/434 (ts 1787859193-1787859194), dev-bot msg 432/433/434.
- HUB STOPPED mid-turn (PID 993605, "Hub stopped via owner PID signal", port 6868 down). turn-2 in flight -> relay lost.
- HUB RESTARTED (PID 998766): boot 19:34:20 "channel plane started" x2, telegram account started, server :6868. NO crash-loop,
  NO orphan-recovery line (group binding already bound to 4f072ac8, not pending). channels status: both transports started.
- Agent on daemon SURVIVES the hub stop (agents are owned by the dev daemon, not the hub).
- Driving B3R marker next -> expect steer of SAME agent 4f072ac8 (agent count unchanged), no second agent minted.

## 19:36Z — B3 (restart/resume half) + B4 (ledger dedupe) PASS — timing corrected 19:46Z per coordinator

- CORRECTION (coordinator ground truth): the hub stop was POST-turn-output, not mid-turn. Ground truth:
  turn-2 (4f072ac8) started 19:31:32; its remaining output chunks dev-bot msg 317/318/319 (dates 1787859192-94 =
  19:33:12-14, containing B3-DONE in msg 319) posted PRE-STOP; the stop (PID 993605) was ~19:34:02 — AFTER the final
  chunk. So "mid-turn stop" is wrong; the stop happened after the turn's output had already posted.
- What the cycle still proves (assertions stand):
  - HUB RESTARTED clean (PID 998766, boot 19:34:20, channel plane started x2, no crash-loop).
  - B3R marker (master msg 320) -> hub.log 19:36:23 "channel inbound steered an existing session" agentId 4f072ac8
    (SAME agent, NO second agent minted; agent count unchanged = 10). STEER path fired (group already bound).
  - B3R reply (dev-bot msg 321, date 1787859387): "2001..2005\nPONG-TG-B3" — context RETAINED (continued from 2000).
  - B4 DEDUPE: ledger = 38 entries, 38 unique keys, 0 duplicate keys. No re-posted chunks across the stop/start:
    pre-stop posts (430 [1..400 final], 432/433/434 [turn-2 chunks]) did NOT re-appear; exactly one new ledger line
    post-restart (436 = B3R final). Each chunk posted exactly once.
- B3 restart/resume mechanism VALID: hub stop -> agent survives on daemon -> hub restart -> steer same agent ->
  context-retained resume. The literal "stop mid-turn" characterization is NOT claimed (stop was post-output).

## 19:46Z — HOLD acknowledged (coordinator 19:45Z) + state check

- HOLD: no hub stop/write/start until coordinator all-clear (W1 driving F-09 fresh + A7 on hub 998766).
- STATE NOTE (no conflict): my D2 cycle (write8 -> v12, master bot dropped from ops) was written ~19:38 and the hub
  was already restarted on v12 (PID 1006893, boot 19:42:02) BEFORE the hold arrived. Verified no W1 Slack cycle was
  straddled: hub.log shows W1's slack "bound a thread" 19:42:07 and "approval answered in the channel thread"
  19:45:45 (post my 19:42 restart, on the running v12 hub) — clean, no straddle.
- B3 timing corrected in progress file (stop was post-output, not mid-turn; assertions stand).
- D2 marker NOT yet posted (holding). D2 revision v12 (49277ba0) is ACTIVE. Will post D2 marker + read-back after all-clear,
  OR note: posting a marker is NOT a restart-gated action — but per HOLD I hold all remaining cycle-driving until all-clear
  to avoid interleaving with W1. PREP-OK items only until all-clear.

## 19:47Z — PREP (no-restart) analysis for remaining cases (done during HOLD)

- D3 (outbound off): route-level `sync: { finalAnswers: false, progress: false }` (overrides org floor finalAnswers=true).
  Schema SyncDefaultsSchema (schema.ts:75-93). Expected: turn completes (watch trusted-client) but NOTHING posts
  (ledger unchanged, no master-bot-visible reply).
- D4 (inbound off): the kill-switch composition is isEnabled = envFlag && org.enabled && channelEnabled && account.enabled
  (policy.ts:273-280). There is NO per-route "inbound" boolean; the four kill-switch levels are env > org > channel > account.
  "Inbound disabled" = the gate ignores. Closest authorable knob that keeps the route outbound-capable but drops inbound:
  NOT cleanly separable at route level (inbound is gated by transport existence + mayTrigger + requireMention). If truly
  ambiguous after 15 min -> log UNVERIFIED-with-reason. (May instead demonstrate D4 via the D2 mechanism: a sender the
  route does not admit is ignored at the gate while the route stays outbound — which D2 already exercises.)
- D1 (inheritance fold org<account<route): foldDefaults (compile.ts:410-440) — org floor ORG_DEFAULTS, then account
  `defaults:`, then route leaves; pick() first-set-wins from most-specific layer. Demo: set an account-level default
  (e.g. sync.progress true for ALL telegram) vs a route-level override, observe effective behavior with a marker pair.
- A8 (forum binding.key:channel): deriveBindingKey (bindings/index.ts:45-51) — bindingKey "thread" uses conversation.threadId
  (topic-1 vs topic-2 = separate sessions); "channel" collapses to rootConversationId (one session for whole forum). Set
  the topic route's `binding: { key: channel }`, then topic-1 mints a session, topic-2 STEERS the same (one agent). Revert to thread.
- Baseline (case 7): v-baseline = telegram routes -> codex, policy.yml assignments restored to [slack:U8ZTVGJJF, telegram:8857655856],
  ops grants restored to [bot.interact, approval.command] (v8a minus the claude-sonnet route pointer; claude-sonnet agent entry
  dropped or kept). Decide at final write.

## 19:51Z — D2 POLICY DENIAL PASS (v12 allowlist drop, all-clear 19:52Z)

- D2 marker (master msg 322, date 1787860287) -> hub.log 19:51:27.408 WARN "channel inbound ignored"
  channel=telegram account=work dispatched=false reason="sender may not trigger this route".
- NO agent minted: agent inventory unchanged = 11 (live-trusted-client list before/after D2 marker both 11).
- NO dev-bot reply: master getUpdates shows no dev-bot (8678469181) message after the D2 marker (the 4 replies are
  pre-D2 turn-2/B3R artifacts dated 19:33-19:36, obs ids already accounted). Ledger unchanged = 38 entries.
- mayTrigger gate (policy.ts:377) correctly denied the master bot now that telegram:8857655856 is absent from the ops
  assignment in v12. D2 PASS.
- NEXT: restore allowlist (write9: add telegram:8857655856 back to ops identities) -> start -> sanity S2 marker -> PONG-TG-S2.

## 19:53Z — D2 RESTORE PASS (v13)

- write9: ops assignment identities restored to [slack:U8ZTVGJJF, telegram:8857655856]. Pre-compile OK. ACTIVATED 5ed91f34 v13.
- Hub restarted (v13). S2 marker (master msg 323) -> hub.log 19:53:06 "channel inbound steered an existing session" (admitted).
- REPLY read back: dev-bot msg 324 (date 1787860389) = "PONG-TG-S2". D2 restore complete.

## 19:53Z — A8 starting: forum binding.key:channel collapse

- Current forum state: topic-1 (thread 2) + topic-2 (thread 3) bindings were CLEARED earlier (pre-S1).
  Under default binding.key=thread each topic mints its own session. Plan: set topic route binding.key=channel
  (write10) -> post A8a into topic-1 (mints session 1) -> post A8b into topic-2 (expect STEER of the SAME session,
  one agent for the whole forum) -> live-trusted-client shows +1 agent only.

## 19:55Z — A8 PASS (forum binding.key:channel collapse, v14)

- write10: topic route binding.key=channel (group route unchanged=thread). Pre-compile OK. ACTIVATED 1f89239c v14. Hub restarted.
- A8a marker into topic-1 (chat -1004439007919, message_thread_id 2, master msg 12): hub.log 19:54:56 "thread bound to a NEW agent
  session" agentId ea74c919-feea-4331-b798-6a1f188dc726 (MINTED; agent count 11->12). Reply dev-bot msg 13 = "PONG-TG-A8".
- A8b marker into topic-2 (message_thread_id 3, master msg 14): hub.log 19:55:31 "channel inbound STEERED an existing session"
  agentId ea74c919 (SAME agent, NO second mint; agent count stayed 12). Reply dev-bot msg 15 = "PONG-TG-A8".
- One agent for the whole forum under binding.key=channel: CONFIRMED. Topic-1 mints, topic-2 steers the same session.
- NEXT: revert topic route binding.key to "thread" (write11, next revision) to restore the A6-proven default.

## 19:58Z — A8 REVERT + D1/D3/D4 revision (write11, v15)

- write11 (hub down, P6868 free): topic route delete binding.key (back to "thread") + delete route.sync;
  group route sync={finalAnswers:true,progress:true,toolCalls:false} + interaction.requireMention:true;
  account defaults.sync={finalAnswers:false,progress:false,toolCalls:false}. Pre-compile OK. ACTIVATED 48643aef v15.
- Hub restarted (v15). This restores A6-proven thread keying (A8 reverted) AND sets up the D1/D3/D4 shape:
  account-level sync floor all-off, group-route sync override on, requireMention restated at route.

## 20:05Z — D1 PASS (inheritance fold org<account<route; route overrides account)

- D1 marker posted to BASIC group (route-level sync.progress=true overrides account sync floor false).
- hub.log ~20:03 "channel inbound steered an existing session" agentId 4f072ac8 (group root, already bound).
- REPLY read back: dev-bot msg 441 (date 1787860725) posted to the group. Ledger gained entry -5229819225:441.
- PROOF: account-level sync floor is all-false (would suppress all posts); the group ROUTE's sync override
  (progress+finalAnswers true) is what let the marker's reply post. Most-specific-wins fold confirmed live.

## 20:00Z — D3 PASS (sync direction off: outbound disabled -> in-only; turn completes, nothing posted)

- D3 marker posted to FORUM topic-1 (thread 2) — forum topic route has NO route.sync override, so it inherits
  the ACCOUNT defaults.sync all-false (outbound off). This is the "in-only" half.
- Under restored thread keying the old topic-1 binding was cleared, so it MINTED a NEW agent 35ed6461-dfa5
  (hub.log 19:58:57 "thread bound to a new agent session", dispatched=true, "Created agent ... (codex)",
  "Starting Codex app-server turn").
- Agent 35ed6461 completed its turn: live-trusted-client status=idle pending=0. INBOUND WORKED (agent minted
  - ran a real codex turn).
- OUTBOUND OFF HELD: through ~5+ min poll, ledger stayed 42 (no entry for the D3 marker), and master getUpdates
  shows NO dev-bot (8678469181) message in forum topic-1 after the D3 marker (date>=1787860735) = [].
  Nothing posted. D3 PASS: turn completed but sync-outbound-off suppressed the reply.

## 20:14Z — D4 PASS (gate: unmentioned marker into UNBOUND conversation ignored; requireMention floor)

- D4a (bound/active control): unmentioned marker into the BASIC group root (master msg 327) -> hub.log 20:06:34
  "channel inbound STEERED an existing session" agentId 4f072ac8. ADMITTED. This is CORRECT, not a D4 failure:
  requireMention gates FIRST-MENTION session creation only; an unmentioned msg into an already-bound, still-active
  session is admitted as a follow-up because followUp.mode defaults to "auto" (admitFollowUp, bindings/index.ts:375-386).
- D4-proxy (unbound gate): unmentioned marker into FORUM topic-2 (thread 3, master msg 17) — topic-2 is UNBOUND.
  hub.log 20:08:46.318 WARN "channel inbound ignored" channel=telegram account=work dispatched=false
  reason="not mentioned; requireMention is on". NO agent minted (inventory stayed 13). NO dev-bot reply in topic-2.
- requireMention:true is the ORG floor default (ORG_DEFAULTS.interaction.requireMention=true); v15's group-route
  interaction.requireMention:true is a RESTATEMENT of the floor (not a change). The gate is live and fails closed:
  unmentioned -> ignored at firstMention/recoverPending (bindings/index.ts:164-165,258-259). D4 PASS (gate half).
- NOTE: P0 has no per-route "inbound off" boolean; the 4 kill-switch levels disable the whole transport (incl.
  outbound). D4 is demonstrated via the requireMention gate as the in-only/outbound-still-works proxy; the literal
  "inbound off" knob is UNVERIFIED-with-reason (not a P0 surface).

## 20:16Z — write12 BASELINE REVERT (v16) + FIN SANITY PASS

- Hub stop: `npm run cli -- hub stop` (CLISBOT_HOME=/home/node/.clisbot-dev) timed out at 15s (normal); port 6868 freed
  ~2s after, PID 1025724 stayed Ssl ~10s then zombie (Zs). DB write ONLY after port-free + zombie (no lock contention).
- write12 (baseline restore, v15 -> v16): telegram/work.yml reverted to the clean START-STATE (v10 shape) —
  both routes carry only match/agent(codex)/environment(work); the wave's route-level sync/interaction overrides
  and the account-level defaults.sync block are DELETED; fallback: deny: true preserved. Everything now falls
  back to the ORG FLOOR (binding.key: thread; sync { finalAnswers: true, progress: false, toolCalls: false,
  threadLink: final-only }; requireMention: true; followUp auto/60min).
- policy.yml UNTOUCHED by write12: ops grants KEEP [bot.interact, approval.command, approval.*] + the master-bot
  identity telegram:8857655856 assignment (restored at v13). The approval.\* family wildcard is REQUIRED for the
  E5/H2 live proof (AskUserQuestion -> tool class `other`, not an authorable leaf) — KEPT per task + coordinator.
- dry-run verified the exact v10-shape telegram file; real run: channel pre-compile OK, daemon agent-validate OK.
  ACTIVATED revision d35c9a83-3424-46de-bdfe-df06f2615a39 v16.
- Hub started (PID 1043368, env -i + PASEO_PASSWORD from ~/.clisbot-dev/.daemon-password). channel plane started x2
  (20:15:15/16); `npm run cli -- channels status` -> slack work + telegram work TRANSPORT=started, integrity ok.
- NOTE: pre-FIN, the D4a control steer (20:06:34, unmentioned into bound active group root) had spawned codex-turn-6
  on group-root agent 4f072ac8; that turn's final-answer post landed during the hub-stop window, so it did not
  reach the relay (ledger held 42 through the stop) — expected, not a fault. Agent now idle pending=0.

## 20:17Z — FIN SANITY PASS (baseline v16 live)

- FIN marker (master msg 328, date 1787861775, mentioned @longluong3bot into basic group -5229819225):
  hub.log 20:16:16.221 "channel inbound steered an existing session" (admitted -> bound group-root agent 4f072ac8,
  codex, under the restored org-floor binding.thread keying).
- REPLY read back via master getUpdates: dev-bot msg 329 (date 1787861778) = "PONG-TG-FIN" (exactly).
  Per-observer ids: the hub relay's own ledger records this same post as dev-bot-side messageId 444
  (ledger 42 -> 43, timestamp 1787861778548). Exactly ONE relay post (org-floor sync finalAnswers:true,
  progress:false) — the final answer only, no progress chunks. Baseline relay outbound confirmed live.
- group-root agent 4f072ac8 idle pending=0 after the FIN turn; no second agent minted (inventory 13).

## 20:20Z — campaign live cases COMPLETE (S0, E5+H2, S1, B3+B4, D2+restore+S2, A8, D1/D3/D4, baseline+FIN all recorded)

- Remaining: doc updates in docs/tests/channels/p0-live-scenarios.md (case 7) then final report to main.

## 20:28Z — doc updates + final report SENT (campaign complete)

- docs/tests/channels/p0-live-scenarios.md updated (coordinator/reviewer had already recorded most D/E rows
  from my cross-checked hub.log evidence; my edits):
  - B3 row + acceptance B3 entry: corrected scope per coordinator — "post-turn-output stop, not a true mid-turn
    stop"; no-second-mint + context-retained resume + dedupe PASS; true mid-turn hub stop NOT exercised.
  - B4 row + acceptance B4 entry: same corrected wording ("B3 hub stop→start (post-turn-output stop)").
  - D4 row: factual correction — both D4 markers were UNMENTIONED; the discriminator is the BOUND-vs-UNBOUND
    conversation (followUp auto admits an unmentioned follow-up into a bound active session; the gate fires only
    at firstMention/recoverPending on an unbound conversation), not mention presence; requireMention:true is the
    org floor so v15's route restatement changed nothing.
  - New finding F-11: the 17:15:28Z "sender may not trigger this route" reject = third party @longbkit (not
    master bot, not dev bot), correct mayTrigger denial, not a config/policy bug.
  - New "Campaign close" section: baseline v16 d35c9a83 (routes back to codex @ org floor; approval.\* grant KEPT
    — E5 depends on it), FIN PONG-TG-FIN (ledger 42→43, exactly one relay post), final live state.
- `npm run format:files -- docs/tests/channels/p0-live-scenarios.md` run; table integrity verified (D-section
  rows all 6 fields; no pipes in cells).
- Lint clean (.hub-revision-write12.mjs, master-driver.mjs). No TypeScript source changed this session, so no
  typecheck needed.
- Final live state: hub PID 1043368 :6868, active revision v16 d35c9a83, both verticals transport=started,
  telegram ledger 43, dev daemon (127.0.0.1:6867) never restarted. FINAL REPORT SENT TO MAIN.
