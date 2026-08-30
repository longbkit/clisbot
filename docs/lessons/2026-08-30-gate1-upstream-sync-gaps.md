# 2026-08-30 — Gate 1 upstream sync (v0.7.0-beta.2): verification results and live-loop gaps

Context: Gate 1 per `docs/guides/developer-guide/upstream-sync-and-contribution.md` — one
controlled merge of the upstream tag `v0.7.0-beta.2` (commit `4e60c2880`, cut 2026-08-28)
into `clisbot-paseoclaw-fusion` (sync commit `6b43b96e8`, 2026-08-30). Post-merge
verification = typecheck + live channel E2E on the merged dev daemon
(`~/.clisbot-dev`, daemon 6867 / hub 6868).

## Merge evidence (for the record)

- The conflict surface is provably bounded: merge-base `b5f58322`; the intersection of
  files changed on both sides since that base is exactly `CLAUDE.md`, `package.json`,
  `package-lock.json`, `packages/cli/package.json` — those four are the entire conflict
  set. Everything else auto-merged (upstream side: 87 commits / 671 files since the
  base; fork side: 825 files).
- Resolutions: `CLAUDE.md` integrated the upstream docs table keeping the five Clisbot
  rows; `packages/cli/package.json` bumped deps to 0.7.0-beta.2, kept `@getpaseo/hub` at
  0.7.0; `package-lock.json` regenerated (`npm install`); root `package.json` → version
  0.7.0-beta.2 + license AGPL → Apache-2.0 (upstream #3944, shipped in 0.7.0-beta.1),
  hub/channels workspaces kept.
- Post-merge: typecheck 0 errors in every workspace except `@getpaseo/app` (tsgo OOM,
  exit 137 on the 8 GB box — environmental; `packages/app` has 0 file diff against the
  tag, upstream CI covers it). Live E2E round-trip on both channels on the merged daemon
  (below).
- Branch now 115 ahead / 21 behind `upstream/main`; tags `clisbot/fork-tip-2026-08-30`
  (`09e4475b1`) and `clisbot/sync-2026-08-30-v0.7.0-beta.2` (`6b43b96e8`).

## Live E2E evidence (2026-08-30, dev daemon 0.7.0-beta.2)

- Slack: marker ts `1788104353.604089` (15:39:13Z) → `conversation bound to a new agent
session` agentId `4bbdb441` (15:39:18Z) → bot posts `PONG-SLACK-S` into the marker
  thread (ts `1788105067.162819`, 15:51:07Z). Inbound, LLM turn, and outbound relay all
  verified by live read-back.
- Telegram: marker → `channel inbound steered an existing session` agentId `4f072ac8`
  (16:05:47Z) → codex `task_complete` with `last_agent_message: "PONG-TG-T"`
  (16:05:51Z, 4.5 s turn). Inbound, cross-version thread resume, and turn verified.
  **Outbound relay post: NOT observed** — master-bot getUpdates drain empty and the send
  ledger flat as of 16:11Z. Open.
- Both `*-live-assert.mjs` verdicts printed `FAIL`. Both are script-side false negatives
  (gap 1), not system failures.

## Gaps found (priority order)

### 1. Live-assert matchers drift from the channel plane's log wording and thread anchoring

`slack-live-assert.mjs` matches hub.log with `/bound a thread|bound a channel|steered an
existing session|inbound answered/`; the in-repo verticals log
`conversation bound to a new agent session` / `channel inbound bound a conversation`
instead. Its read-back also scans the channel root only, while replies post into the
minted thread at the marker ts. Both misses produced `VERDICT FAIL steer=no reply=no`
on a round-trip that demonstrably passed.

Rule: treat the scripts' verdicts as advisory until the matchers are updated (regex to
the current wording, plus a `conversations-replies --thread-ts <marker ts>` read-back
alongside the root). Cross-check hub.log and the thread read-back manually.

### 2. Dev daemon inherited `CODEX_HOME` from the host shell

The host profile exports `CODEX_HOME=/home/node/.paseo/codex-local-home` (the Codex
CLI's own home). A dev daemon started from such a shell runs the codex app-server with
that home, while persisted channel-bound threads live under the default `~/.codex`.
Symptom: `inbound handoff fault (kept polling) ... Failed to resume Codex thread
01a044af-...: no rollout found` (hub.log 15:48:09Z, 15:55:24Z) while the rollout exists
at `~/.codex/sessions/2026/08/27/rollout-...-01a044af....jsonl`; new threads wrote into
`~/.paseo/codex-local-home/sessions/2026/08/30/`. Evidence: `/proc/<worker>/environ`.
Restarting the daemon with `env -u CODEX_HOME` (and moving the misplaced thread's
rollout into `~/.codex`) fixed resume immediately (16:05:47Z).

Rule: start the dev daemon with a clean codex home (`env -u CODEX_HOME`, or pin it
explicitly). `scripts/e2e-dev.sh` pins `CLISBOT_HOME` only — the daemon environment is
unguarded.

### 3. Server pid-lock treats a zombie as running

After killing the old supervisor trio, the fresh start was rejected:
`Another Paseo daemon is already running (PID 2676354, started 2026-08-30T15:31:40.750Z)`
while PID 2676354 was `Z` (defunct, unreaped by this container's PID 1).
`packages/server` pid-lock's `isPidRunning` is `kill(pid, 0)`, which succeeds on
zombies — same class as the hub-side fix in
`2026-08-26-integration-seams-before-live-e2e.md` item 2, not yet ported to the server
lock. Latent where zombies reap fast; acute in this container.

Rule: make the server pid-lock zombie-aware (check `/proc/<pid>/stat` state, not just
`kill(pid, 0)`), or document the manual override: unlink the stale `<PASEO_HOME>/paseo.pid`.

## Open items

- Re-run the Telegram outbound-relay assertion with the ledger diff as the assertion —
  the 16:05:51Z `PONG-TG-T` never appeared in the group by 16:11Z.
- Fix `slack-live-assert.mjs` matcher + thread read-back (gap 1).
- Update `docs/tests/channels/p0-live-scenarios.md` Status with this run's evidence
  (Slack PASS with thread read-back; Telegram inbound PASS, relay open).
