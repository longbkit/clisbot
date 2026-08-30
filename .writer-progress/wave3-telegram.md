# wave3-telegram sweep lane (W3-TG)

Live plane: hub PID 1383052, revision v21 `1cf59f56` active (confirmed via
PGlite read + /api/v1/channels: slack+telegram work `transport: started`).
Telegram routes (group + topic) on `codex` / `gpt-5.6-luna`,
`sync { progress: true, finalAnswers: true, subagents: { finalAnswers: true } }`.
Dev daemon 127.0.0.1:6867 (PID 290967) — codex available+enabled. Bot under
test `@longluong3bot` (8678469181); external sender `@longluonggptbot`
(8857655856, master token).

- 2026-08-28T06:35Z baseline: agent inventory = 15 channel agents, all idle
  pending=0 (59f6ea4d slack root, 4f072ac8 TG group root, a36eaa2d TG topic-1,
  35ed6461 TG topic-2-era, …). Dev-bot update offset 318879768. Ledger last key
  `-5229819225:447` / `-1004439007919:15`. Wave-3 code confirmed present in
  running bundle (subagent label, extractLocalMediaPaths/mediaPost) and in-repo
  telegram dist (sendMedia, callback_query poll seam).
- 2026-08-28T06:35Z CORE re-pass (case 1) PASS — W3A marker (master msg 333) →
  PONG-TG-W3A (dev-bot master read-back msg 334) group root; W3B follow-up
  (master msg 335) → PONG-TG-W3B (msg 336). hub.log 06:30:14 + 06:30:20 BOTH
  `channel inbound steered an existing session` agentId 4f072ac8 (same agent,
  no new mint — B2/C1 regression holds). Ledger +2 (-5229819225:449/:451).
  Evidence: /tmp/w3tg-core.log.
- 2026-08-28T06:34Z TOPIC ROUTING re-pass (case 2, A6/C3) PASS — forum
  `-1004439007919`: W3C marker thread=2 (topic-1) → reply PONG-TG-W3C read back
  at message_thread_id=2, hub.log 06:31:12 steered EXISTING topic-1 session
  35ed6461; W3D marker thread=3 (topic-2) → PONG-TG-W3D at thread=3, hub.log
  06:31:20 `conversation bound to a new agent session` 58af2b4a newSession=true
  (fresh topic-2 mint post-v21-boot); W3E unthreaded marker → PONG-TG-W3E at
  thread=null (General), hub.log 06:31:30 steered ea74c919 (existing General
  session). Two topics = two distinct agent threads (35ed6461 vs 58af2b4a),
  General its own (ea74c919) — per-topic bindings hold under v21. Ledger +3
  (-1004439007919:19/:21/:23). Evidence: /tmp/w3tg-topics.log.
- 2026-08-28T06:45Z C2 PROGRESS re-pass (case 3, wave-3 full sync on) PASS —
  W3F marker (master msg 337) into basic group bound root agent 4f072ac8 asked
  for 3 sequential `sleep 34` shell commands. Each ran via out-of-sandbox
  `/usr/bin/bash -lc`, so codex auto-review gated all three → 3 CodexBash
  approval prompts posted in-group + 3 "Running shell…" tool-call progress lines
  (msg 339/342/345, ~47s + ~40s apart, both ≥30s throttle). Each prompt was
  answered via the TYPED channel command `approve <id>` from the master bot
  (hub.log: 3× `channel inbound answered an approval command` agent 4f072ac8
  channel telegram detail "answered (allow)" — ids 56522910/1be81092/5f1002e7),
  which re-exercises the E2 typed-approval path on the TG lane. Agent then
  posted EXACTLY ONE final answer PONG-TG-W3F (msg 348). Multiple intermediate
  progress messages + one final = C2 satisfied. Agent back idle pending=0.
  (Note: the intermediate posts were approval-prompts, not clean progress
  snapshots, because the `sleep 34` commands hit the out-of-sandbox exec gate —
  a richer live exercise, not a regression.) Evidence: /tmp/w3tg-progress.log +
  /tmp/w3tg-progress2.log.
- 2026-08-28T06:53Z C9/D5 SUBAGENT RELAY re-pass (case 4, wave-3 NEW) PASS —
  W3G marker (master msg 24) into forum topic-2 steered existing topic-2 agent
  58af2b4a, instructed to use the Sub-agent tool. Codex spawned a collab
  subagent; the relay posted the subagent text with the EXACT wave-3 label
  prefix `▶ Sub-agent (subagent):` into topic-2 (dev-bot msg 27 + 28 + 32,
  message_thread_id=3, ledger -1004439007919:27/:28/:32). The root turn then
  posted its final answer `PONG-TG-W3G` LAST (dev-bot msg 34, thread=3,
  ledger :34). subagent-before-final ordering holds. The subagent's own exec
  calls hit the out-of-sandbox gate and were answered via typed `approve`
  (hub.log 06:51:01 `approval answered … channel telegram`, agent 58af2b4a,
  allow) — same E2 path. Agent 58af2b4a idle pending=0 after. This is the
  C9 `sync.subagents.finalAnswers: true` consumer landing live on the TG lane.
  Evidence: /tmp/w3tg-sub-wait.log + /tmp/w3tg-sub-wait2.log.
- 2026-08-28T07:00Z G7–G11 MEDIA OUTBOUND (case 5, wave-3 NEW) FAIL — the
  native media post is never delivered; everything AROUND it is correct and
  observed. Drove two markers into forum topic-1 (message_thread_id=2): first
  (W3H) pointing at an 8x8 PNG, second re-drive (W3H2, master msg 39) pointing
  at a valid 64x64 PNG (curl-confirmed postable to the same topic-1 — msg 41-46
  via curl/native-FormData/grammy all succeeded). Relay behavior observed in
  both: (a) the absolute path was EXTRACTED, (b) it attempted the native media
  post BEFORE the caption (hub.log `channel media post failed` then caption),
  (c) the caption `PONG-TG-W3H2` (dev-bot msg 40, thread=2) had the raw path
  line STRIPPED, (d) caption landed in the correct topic-1. But the media post
  itself threw in the live hub: hub.log 06:56:13 + 07:00:08 `channel media post
failed / error "Network request for 'sendPhoto' failed!"` + `relay media post
failed; the ledger row stays recoverable` (filePath w3-media-64.png).
  READ-BACK confirmed NO photo/doc message ever reached topic-1.
  ROOT CAUSE (reproduced in isolation, not a simulator limit): the account
  config sets `timeoutSeconds: 20`, so `buildTelegramClientOptions` (bot-api.ts)
  injects `createTelegramClientFetch` (telegram-policy.ts) into grammy's client.
  Any custom `fetch` handed to grammy breaks MULTIPART uploads in this
  Node/undici env while JSON works: grammy hands the custom fetch a Node
  `Readable` body (not global FormData, not a Request) and undici's global
  fetch cannot transmit it → `HttpError "Network request for … failed!"` (no
  status). Isolation matrix (grammy 1.44.0, real api.telegram.org, real topic-1):
  A custom-fetch-only sendPhoto -> FAIL (same error)
  B grammy-native timeoutSeconds -> OK (msg 47)
  C fetch + timeoutSeconds (hub path)-> FAIL (same error)
  D hub path but JSON sendMessage -> OK (msg 48)
  E identity passthrough fetch -> FAIL (same error)
  So the defect is the injected custom-fetch path for file uploads, independent
  of image size / simulator image-processor (the earlier 8x8 IMAGE_PROCESS_FAILED
  via curl was a separate simulator quirk; the 64x64 proves the transport is the
  blocker). Fix belongs to the wave-3 verticals lane (G7–G11 media outbound):
  the L1 media send must not route a multipart upload through the injected
  timeout-fetch, or that fetch must normalize the grammy `Readable` body before
  delegating to undici. NOT re-driven as PASS — no revision change / hub restart
  is in scope for this lane. Evidence: /tmp/w3tg-media2.log,
  .writer-progress/grammy-isolate.mjs, .writer-progress/grammy-bodyprobe.mjs,
  hub.log media-post lines above.
- 2026-08-28T07:10Z E2-TG CALLBACK re-pass (case 7) — SEAM PRESENT (wave-3),
  NOT live re-driven (human-only + no live card). Findings: (a) the wave-3
  `callback_query` inbound seam IS wired in the running bundle AND the in-repo
  dist — `packages/channels/telegram/src/transport/poll.ts` (parses
  `callback_query`, silent `answerCallbackQuery` ack, hands the raw update to
  the shared `channelRuntime.approvalAction` seam) + `dist/transport/
approval-callback.js`. This is the previously-DEFERRED E2 Telegram half
  (register ref: docs/tests/channels/p0-live-scenarios.md E2 row, "Telegram
  half DEFERRED"). (b) It cannot be live re-driven this lane: a
  `callback_query` update is produced ONLY by a real user tapping an inline
  keyboard button — the Bot API has no endpoint to synthesize/trigger one, and
  the only external-sender driver available here is the master bot (a bot),
  which cannot tap an inline keyboard. (c) Moreover the live revision posts NO
  TG card at all: the telegram account config has no `transport.inlineButtons`
  (absent = `off` default), so the approval prompt is text + typed command only
  — no `reply_markup` inline keyboard to tap even for a human. Enabling cards
  needs a `transport.inlineButtons` revision write + hub restart, both out of
  scope for this lane. Net: the shared resolver that a tap would feed is already
  live-proven on the TG lane via the typed `approve` path (cases 3 & 4 above —
  hub.log `channel inbound answered an approval command` … answered (allow));
  the tap→`callback_query`→resolver half is wave-3 wired + human-only, recorded
  as CONFIRMED-not-re-driven, not PASS/FAIL. Evidence: poll.ts + dist seam grep
  above; register ref E2 row.
- 2026-08-28T07:50Z G10 CHUNK-THREADING re-drive PASS (case 5b, D-016 fix,
  stop-window #37 hub PID 1415609, revision v21) — W3C1 marker (master msg 59)
  into forum topic-1 (message_thread_id=2): a 4200+ char time_t essay with a
  PNG path early. Read-back: photo (msg 60, D-015 media fix still holding —
  native photo in topic-1, raw path line STRIPPED) + 4 text chunks (msg 61→64,
  final msg 64 closes with PONG-TG-W3C1), ALL 5 rows at message_thread_id=2,
  0 scattered rows (pre-fix the continuation chunks landed at thread=null/
  General). Chunk-0-only reply-to / card semantics unchanged. Evidence:
  /tmp/w3tg-chunk3.log + /tmp/w3tg-chunk3.json.
- 2026-08-28T07:12Z C6 CHUNKING re-pass (case 6) PASS — W3C6 marker (master
  msg 352) into the basic group asked the bound root agent (4f072ac8) to write
  a 6000+ char pure-TEXT essay (no tools/exec) with a distinct HEAD line
  `HEAD-W3C6` as the very first chars and a TAIL line `TAIL-W3C6` as the very
  last. Read-back: the reply was delivered across 7 dev-bot messages (msg 353→359,
  in date order, ~112s turn): chunk 0 (msg 353, len 3995) opens with
  `HEAD-W3C6`, chunk 7 (msg 359, len 1455) closes with `TAIL-W3C6`, and every
  intermediate chunk is 3994–4000 chars — all well under the 4096 Bot API cap
  and the vertical's 4000 split limit. Total payload 25434 chars, HEAD and TAIL
  both present ⇒ no truncation. This is the C6 multi-chunk delivery path
  (`splitTelegramPlainTextChunks` at 4000, thread params ride chunk 0 only —
  F-07) landing live on the TG lane. Agent back idle. Evidence:
  /tmp/w3tg-chunk.log.

## VERDICT (W3-TG lane, live re-pass on revision v21 `1cf59f56`)

All cases re-driven against the live surfaces on 2026-08-28 (bot under test
`@longluong3bot`; external sender master bot; read-back self-verified via
getUpdates content+order+time). Dev daemon 290967 never touched; the live hub
was restarted ONLY in the two controlled stop-windows (#36 hub 1411418 for the
D-015 media fix; #37 hub 1415609 for the D-016 chunk-threading fix) — both on
revision v21, no revision write. All channel agents returned to
`idle pending=0` after the sweep.

1. CORE re-pass (basic group, marker→reply + follow-up steer): **PASS**.
   W3A/W3B markers (master 333/335) → PONG-TG-W3A/W3B (dev-bot 334/336) at group
   root; hub.log `steered an existing session` agent 4f072ac8 both times (no new
   mint — B2/C1 hold). /tmp/w3tg-core.log.
2. TOPIC ROUTING (forum, topic-1/topic-2/unthreaded + per-topic bindings):
   **PASS**. W3C (thread 2)→PONG-TG-W3C @thread=2 (steered 35ed6461); W3D
   (thread 3)→PONG-TG-W3D @thread=3 (fresh mint 58af2b4a); W3E (unthreaded)→
   PONG-TG-W3E @thread=null General (steered ea74c919). Two distinct topic
   agents + a distinct General session. /tmp/w3tg-topics.log.
3. C2 PROGRESS (wave-3, full sync on): **PASS**. W3F marker → 3 sequential
   spaced out-of-sandbox exec steps, each gated → 3 approval prompts + 3
   "Running shell…" progress lines (msg 339/342/345, ~47s/~40s apart), each
   answered via typed `approve <id>` (re-exercises the E2 typed-approval path),
   then EXACTLY ONE final PONG-TG-W3F (msg 348). /tmp/w3tg-progress\*.log.
4. C9/D5 SUBAGENT RELAY (wave-3 NEW): **PASS**. W3G marker → codex collab
   subagent; relay posted `▶ Sub-agent (subagent):`-labeled lines into topic-2
   (dev-bot 27/28/32, thread=3), root final PONG-TG-W3G LAST (dev-bot 34).
   subagent-before-final holds; `sync.subagents.finalAnswers:true` consumer live.
   /tmp/w3tg-sub-wait\*.log.
5. G7–G11 MEDIA OUTBOUND (wave-3 NEW): **FAIL at sweep time (real L1 transport
   defect) → FIXED + RE-DRIVEN PASS 2026-08-28 (D-015 + D-016)**.
   Relay wiring was CORRECT and observed (path extracted → native media post
   attempted in the right forum topic BEFORE the caption → caption PONG-TG-W3H2
   [dev-bot 40, thread=2] with the raw path line STRIPPED), but the native
   `sendPhoto` post threw in the live hub and no media message ever landed.
   RESOLUTION: D-015 (injected-fetch Node-Readable→web ReadableStream +
   duplex:"half", `leaves/telegram-policy.ts`) fixed the upload transport;
   stop-window #37 (hub 1415609) carried the rebuilt vertical dist. G7+G8+G9
   re-driven PASS (M1: native photo + native document + caption-last in
   topic-1). G10 then exposed a second defect (D-016: continuation chunks
   dropped `message_thread_id`) — also fixed + re-driven PASS (W3C1: photo +
   4 text chunks ALL at thread=2, 0 scattered).
   ROOT CAUSE (reproduced in isolation, NOT a simulator limit): the telegram
   account sets `timeoutSeconds: 20` → `buildTelegramClientOptions` injects
   `createTelegramClientFetch` into grammy's client; ANY custom fetch breaks
   MULTIPART uploads in this Node/undici env while JSON works (grammy hands the
   custom fetch a Node `Readable` body that undici's global fetch can't transmit
   → `HttpError "Network request for … failed!"`). Isolation (grammy 1.44.0,
   real api.telegram.org, real topic-1): custom-fetch sendPhoto FAIL,
   grammy-native-timeout sendPhoto OK (msg 47), hub-path JSON sendMessage OK
   (msg 48), identity-fetch sendPhoto FAIL. Fix belongs to the wave-3 verticals
   lane (G7–G11): don't route a multipart upload through the injected
   timeout-fetch, or normalize the `Readable` body before delegating. No hub
   restart / revision change in scope this lane. /tmp/w3tg-media2.log,
   .writer-progress/grammy-isolate.mjs + grammy-bodyprobe.mjs, hub.log 06:56:13
   & 07:00:08 `channel/relay media post failed`.
6. C6 CHUNKING: **PASS**. W3C6 marker (6000+ char pure-TEXT essay, no tools) →
   7 ordered dev-bot messages (353→359), chunk 0 opens `HEAD-W3C6`, chunk 7
   closes `TAIL-W3C6`, each 1455–4000 chars (all < 4096 cap), 25434 total, no
   truncation. `splitTelegramPlainTextChunks`@4000 + F-07 (thread on chunk 0
   only) live. /tmp/w3tg-chunk.log.
7. E2-TG CALLBACK: **SEAM PRESENT (wave-3), NOT live re-driven** (human-only +
   no live card). The wave-3 `callback_query` inbound seam IS wired in the
   running bundle + in-repo dist (poll.ts parses `callback_query`, silent
   `answerCallbackQuery` ack → shared `channelRuntime.approvalAction`;
   dist/transport/approval-callback.js) — the previously-DEFERRED E2 Telegram
   half. It cannot be live re-driven here: a `callback_query` fires only on a
   real user tap (no Bot API synthesizes one; the master-bot driver is a bot and
   can't tap an inline keyboard), and the live revision posts NO TG card at all
   (telegram account has no `transport.inlineButtons` → `off` default). The
   resolver a tap would feed is already live-proven on the TG lane via typed
   `approve` (cases 3 & 4). Recorded CONFIRMED-not-re-driven; enabling needs a
   `transport.inlineButtons` revision write + hub restart (out of scope).
   Register ref: docs/tests/channels/p0-live-scenarios.md E2 row.

NOT-IMPLEMENTED / open gaps carried out of this lane:

- G7–G11 native media OUTBOUND was broken live on the TG lane — see case 5
  root cause. (NOTE 2026-08-28: the "and by symmetry likely on Slack too"
  clause was WRONG — the defect was the Telegram vertical's grammy-injected-
  fetch boundary (grammy hands the injected fetch a Node `Readable` multipart
  body that undici can't transmit); Slack media outbound is a JSON external-
  upload to the Slack Web API and PASSed live on the Slack lane, so there was
  no shared defect. D-015.) FIXED 2026-08-28: D-015 (injected-fetch
  Readable→web ReadableStream normalization, `leaves/telegram-policy.ts`) —
  G7+G8+G9 re-driven PASS live (M1 re-drive: native photo + native document +
  caption-last, paths stripped, in topic-1). G10 (long reply + media) then
  exposed a SECOND, separate defect: continuation chunks dropped
  `message_thread_id` (D-016) — fixed 2026-08-28, re-driven live (see
  /tmp/w3tg-chunk3.log).
- E2-TG `callback_query` inbound tap is wave-3 wired + human-only; a live tap
  needs `transport.inlineButtons` on (a revision write) + a human tap.
- No `transport.inlineButtons` is set on the live telegram account, so no
  native approval card (inline keyboard) has ever been posted live on the TG
  lane — the E1-TG post half remains open (the E1 Slack post half was live
  2026-08-27; the E1/E2 TG halves were DEFERRED into wave-3 and are now wired
  but unverified-live).

Housekeeping: fixture files left in /home/node/.clisbot-dev/workspace/
(w3-media-20260828.png/.pdf, w3-media-64.png) — inert, safe to delete. 0 pending
permissions across all channel agents at end of sweep.
