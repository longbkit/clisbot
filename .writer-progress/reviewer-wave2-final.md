# Reviewer Wave-2 Final (R3) — P0 channel live-E2E, Slack lane

Written 2026-08-28 ~01:20Z. I am the final verifier for wave 2. Writer W-C
(task "W-C H6 answer + restore + FIN2") reported done; this is the
evidence-verified, per-case verdict. All claims cross-checked against
ground truth (hub.log, Slack API read-back, the send ledger, the pi rollout,
the write-script source, the captured v16 baseline). I did NOT open the live
PGlite (hub owns the data dir); the write-script source + captured baseline +
FIN2 live behavior are sufficient for the baseline-restore/approval.\* proof.

## Per-case verdict

| Case                 | Verdict                    | Evidence (independently re-checked, not just W-C's word)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2**               | CONFIRMED                  | R2-confirmed + re-verified: marker `E2E-SLACK-P0-20260827-C2` ts `1787876332.034419`; 3 progress snapshots 48s apart (all ≥30s throttle) + exactly one final `PONG-SLACK-C2` ts `1787876487.706169` (in channel read-back); codex `59f6ea4d` steered; ledger 41→48.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **H3**               | CONFIRMED (BLOCKED-by-env) | opencode IS a builtin daemon provider but live `status=unavailable` (0 models) + `command -v opencode` rc=1 (binary absent). No revision burned. Doc row carries the exact evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **H4**               | CONFIRMED (BLOCKED-by-env) | cursor is NOT a daemon provider (`list_available_providers` = claude/codex/opencode only) + `command -v cursor`/`cursor-agent` rc=1. No revision burned. Doc row exact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **H5**               | CONFIRMED (BLOCKED-by-env) | `provider_diagnostic(grok)` → "Provider grok is not configured" (trusted /ws RPC); no `agents.providers` in dev-home config.json; not in BUILTIN_PROVIDER_IDS; ACP `providerOptions` is `z.object({}).strict()` so a route could not carry the command anyway. No revision burned. Doc row exact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **H6**               | CONFIRMED (PARTIAL)        | pi agent `861f72ab` bound (00:39:48, W-B drive #2) then **steered** (01:02:47.435) on the WITH-mention answer `E2E-SLACK-P0-20260828-H6-ANSWER` ts `1787878966.652169` → exact **`PONG-SLACK-H6 Red`** in-thread ts `1787878969.132419` (read-back matched; ledger 51→52). The named delta (ask_user question-kind permission card) did NOT fire: `ask_user` is not in pi 0.84.2's toolset (rollout shows plain-text "Pick a color: Red or Blue?"), so no question-kind permission reached the plane. 401 on pi's default model path fixed by hub-config pin `pi-work = {provider: pi, model: llmproxy/qwen3.8-27b}` (a route revision, not daemon state). Channel-answer half CLOSED; delta is provider-toolset-bound, honestly recorded as PARTIAL not PASS.                                                                                                                                      |
| **C6**               | CONFIRMED                  | R2-confirmed (Telegram chunking: 2 in-order chunks, 5197 chars >4000, all 40 tips, per-observer ids matched by content+order+time, F-02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **F-10**             | CONFIRMED                  | Code fix on disk: `packages/hub/src/channels/policy.ts:436` adds `prompt-not-open` to the `ApproverCheck` reason union; `approvals/index.ts:219` returns it on the `prompt === undefined` early-return, distinct from `class-not-approved` (`:477`). Doc row matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **baseline-restore** | CONFIRMED                  | ONE cycle. **stop<write<start** proven by the port sampler: 6868 DOWN `01:03:15.759` → `01:05:09.206` (2m54s, whole DB-write window); write at 01:04:44 inside the window; old hub 1277777→zombie. PASEO_PASSWORD accepted (no `invalid-daemon-password`; `channel daemon connected` x2 on boot). New hub PID **1287335**: `channel plane started` x2 (`01:05:07.606`/`01:05:08.649`) + `server started :6868` (`01:05:08.708`) + `slack socket mode connected` (`01:05:09.392`) + telegram account started. **approval.\* survives:** the `baseline` scenario (`.hub-revision-write.mjs:162`) returns the captured v16 files **byte-unchanged** (`files.map(f => ({path, content}))` — no YAML round-trip), so `policy.yml` with the `approval.*` grant is preserved verbatim in v20; FIN2 then live-proved the codex route shape. Active revision **v20** `41476705-e03b-4c58-84ea-fda0f1180545`. |
| **FIN2**             | CONFIRMED                  | Post-restore marker `E2E-SLACK-P0-20260828-FIN2` ts `1787879137.406609` at channel root → hub.log 01:05:38.675 `steered an existing session` `59f6ea4d` (STEER of the bound root codex agent, NOT a new mint) → exact **`PONG-SLACK-FIN2`** ts `1787879141.901639` (I re-read the channel independently; ledger 52→53). Zero new agent mints in the 00:58–01:06 window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

No case is REFUTED. H6 is correctly held at PARTIAL (not overstated to PASS);
H3–H5 carry the exact block evidence; C2/C6/F-10/restore/FIN2 are all green.

## Assertion-script truthfulness spot-check

`scripts/slack-live-assert.mjs` (post mode): posts via `slack-cli` (user cred),
polls hub.log for bind/steer since t0, diffs the send ledger, reads the
thread back matching on **content** (F-02). W-C honestly flagged that for
FIN2 the script's `--expect "PONG-"` matched the marker text itself (the marker
embeds `PONG-SLACK-FIN2`), so the script's PASS reply-match was a self-match —
the lane log correctly defers to the channel read-back as authoritative. I
re-verified FIN2's bot reply directly (ts `1787879141.901639`, bot
`U08N4UZM8CF`, exactly `PONG-SLACK-FIN2`), so the underlying PASS is true even
though the script's reply-match was weak. H6's VERDICT (`steer=861f72ab
replyTs=1787878969.132419`) matches the raw hub.log steer line + the in-thread
reply exactly. Script reported truthfully.

## Rule-conformance

- **stop<write<start invariant:** CONFIRMED. Port sampler (1 Hz) shows 6868
  DOWN for the entire DB-write window; write strictly between stop and start.
- **PASEO_PASSWORD accepted:** no `invalid-daemon-password`; `channel daemon
connected` x2 on the new boot (a rejected password would show the link down).
- **Both transports started:** `channels status` → slack work + telegram work
  `TRANSPORT=started`, integrity/load ok, pin `openclaw@2026.7.1-2`.
- **Rails clean:** dev daemon **290967** alive (1d23h+); production **1013/1045**
  alive (4d8h) untouched; port 6767 owned by the production daemon (950545);
  dev daemon still on 127.0.0.1:6867.
- **No new FATAL:** 0 `FATAL` lines in hub.log (entire file); 0 since wave start.
- **No token values:** lane4 + p0-live-scenarios.md clean of token/password/
  secret-like assignments (grep empty); vars referenced by name only.
- **No crosstalk:** the send ledger touches only `C07U0LDK6ER` (`$SLACK_TEST_CHANNEL`).
- **No full test-suite runs:** only targeted reads/greps; no vitest workspace runs.
- **No daemon-side channel-state mutation beyond hub config:** the only
  out-of-band file touched in the stop window (`.dev/paseo-home/config.json`,
  01:04) is the inert checkout-local dev-home (gitignored, nothing listens on
  6768, not the live dev daemon's home `.clisbot-dev`); the channel-plane
  config lives in the `.clisbot-dev` PGlite. No daemon state changed.

## Final live state

- **Active revision:** v20 `41476705-e03b-4c58-84ea-fda0f1180545` (v16 content).
- **Hub PID:** 1287335 (boot 01:05:05; stable, no reconnects/FATAL since
  `slack socket mode connected` 01:05:09).
- **Routes:** slack + telegram both on `codex` (gpt-5.6-luna) at the org floor;
  policy `ops` role keeps the `approval.*` grant; dev daemon on 6867 untouched.

## Doc follow-ups

None required. The register (H3–H6/C2 rows, C6, F-10), the two acceptance
mapping rows (497/499), and the wave-2 close note (535–571) are all accurate:
no overstated PASS, blocked rows carry the exact evidence, no `|` inside table
cells (each new row is a clean 4-cell row), and the close note is truthful about
W-B being reaped mid-lane (~00:44Z, memory pressure) and W-C completing the
H6 answer re-drive + baseline restore + FIN2.

One optional precision note (NOT a defect, no change required): the H6 row /
close note / lane4 attribute W-B's inert no-mention "Red" (00:42:05, posted
into the bound+active thread) to "explicit-mention admission mode." The inert
outcome is factually correct (it produced no steer and no reply; only the
later with-mention answer steered). `hub.log` captures only INFO/WARN (0 DEBUG
lines), so the exact drop layer for an unmentioned message is not visible in
the log; the attribution matches the repo's canonical contract
(`docs/audits/pinned-vertical-contracts/ingress-gates.md` — "Unmentioned
slack-cli traffic is ignored — the plane sees nothing"; CLAUDE.md "the channel
runtime admits bot-authored Slack traffic only in explicit-mention mode").
Verdict: PLAUSIBLE-precise, operator-level framing correct, no doc edit needed.
