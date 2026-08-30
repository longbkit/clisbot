# Telegram lane W2 (W-A) — C6 live + docs

Start: 2026-08-27 23:06 UTC

- Topology verified: daemon 127.0.0.1:6867 (PID 290967, up 1-21h), hub 127.0.0.1:6868
  (PID 1043368, started 20:15:08, plane started 20:15:15/16, revision v16 baseline).
- hub.log: only FATAL is 16:39:16 (prior hub lifetime). No new FATAL since 20:15.
- FIN marker 20:16:16 steered an existing session; ledger 43 entries, last
  `-5229819225:444` @ 1787861778548.
- Dev-bot poll offset baseline: lastUpdateId 318879767.

## C6 — long-answer chunking

- Plan: one marker into the basic group (-5229819225) instructing a single final
  answer > 4000 chars, no splitting. Marker: E2E-TG-P0-20260827-C6.

## C6 — PASS (live, baseline v16) 2026-08-27 23:07Z

- Marker E2E-TG-P0-20260827-C6: master msg 330, date 1787872054, basic group -5229819225,
  instructed group-root agent to reply with a 40-tip list (single final answer, no split).
- hub.log 23:07:35.477 "channel inbound steered an existing session" agentId 4f072ac8,
  channel=telegram account=work dispatched=true. Single steer, no second steer / no error.
- Plane chunker split the single logical answer into 2 chunks:
  chunk0 ledger -5229819225:446 ts 1787872076902 (3986 chars, under 4000 limit)
  chunk1 ledger -5229819225:447 ts 1787872077565 (1211 chars)
- (a) order: ledger 446 < 447; master read-back msg 331 (date 1787872076) before msg 332
  (date 1787872077), group root, thread=null.
- (b) ledger: exactly 2 NEW group-root entries this turn (446,447); no other entry created in window.
- (c) read-back via master getUpdates: chunk0+chunk1 concat = 5197 chars (>4000), all 40 numbered
  tips present in exact sequence 1..40, no missing/dup chunk (boundary overlap probe = false;
  3986+1211=5197 exact). Per-observer ids (F-02): dev ids 446/447 matched master 331/332 by
  content+order+time, not id.
- No hub restart this lane; daemon (PID 290967) untouched; no new FATAL in hub.log.

## Docs (scope 2 + 3) — done

- C3 acceptance-mapping row: replaced stale "C3 PARTIAL … live re-drive pending the next build:hub"
  with "C3 PASS (Slack thread-anchored PASS; Telegram topic reply-anchoring live-proven 13:11Z — F-07 closed live)".
- C6 row: UNVERIFIED -> PASS 2026-08-27 23:07Z with chunk-count/ledger/read-back evidence.
- `npm run format:files -- docs/tests/channels/p0-live-scenarios.md` run. Table integrity re-checked:
  C6 row = 5 pipes (4 cells, matches C4); C3 acceptance row = 3 pipes (2 cells, matches siblings); no `|` in cells.
- No code changes this lane.

## Final health 23:11Z

- daemon 127.0.0.1:6867 (PID 290967) up, untouched. hub 127.0.0.1:6868 (PID 1043368) up, revision v16.
- zero new FATAL since 23:00. DONE.
