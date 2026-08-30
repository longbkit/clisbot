# 2026-08-30 — Gate 1 upstream sync (v0.7.0-beta.2): verification results and live-loop gaps

Context: Gate 1 per `docs/guides/developer-guide/upstream-sync-and-contribution.md` — one
controlled merge of the upstream tag `v0.7.0-beta.2` (commit `4e60c2880`, cut 2026-08-28)
into `clisbot-paseoclaw-fusion` (sync commit `6b43b96e8`, 2026-08-30). Post-merge
verification = typecheck + live channel E2E on the merged dev daemon
(`~/.clisbot-dev`, daemon 6867 / hub 6868).

## Merge evidence (for the record)

- The overlap surface is bounded: merge-base `b5f58322`; the intersection of
  files changed on both sides since that base is exactly `CLAUDE.md`, `package.json`,
  `package-lock.json`, `packages/cli/package.json`. Git reported three textual conflicts:
  `CLAUDE.md`, `package-lock.json`, and `packages/cli/package.json`; root `package.json`
  auto-merged but still required semantic review. Everything else auto-merged (upstream
  side: 87 commits / 671 files since the base; fork side: 825 files). Auto-merge is not
  proof of semantic compatibility; the gates below own that evidence.
- Resolutions as originally attempted: `CLAUDE.md` integrated the upstream docs table keeping the five Clisbot
  rows; `packages/cli/package.json` bumped deps to 0.7.0-beta.2, kept `@getpaseo/hub` at
  0.7.0; `package-lock.json` regenerated (`npm install`); root `package.json` → version
  0.7.0-beta.2 + license AGPL → Apache-2.0 (upstream #3944, shipped in 0.7.0-beta.1),
  hub/channels workspaces kept.
- Post-merge: typecheck 0 errors in every workspace except `@getpaseo/app` (tsgo OOM,
  exit 137 on the 8 GB box — environmental; `packages/app` has 0 file diff against the
  tag). Slack completed a live round-trip; Telegram inbound/resume/turn passed but
  outbound was not observed. Therefore the complete Gate 1 did **not** pass in this run.
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
- Both `*-live-assert.mjs` verdicts printed `FAIL`. Slack was a script-side false negative.
  Telegram was a real open outbound result until a later run supplies send-ledger evidence.

## Gaps found (priority order)

### 1. Live-assert matchers drift from the channel plane's log wording and thread anchoring

`slack-live-assert.mjs` matches hub.log with `/bound a thread|bound a channel|steered an
existing session|inbound answered/`; the in-repo verticals log
`conversation bound to a new agent session` / `channel inbound bound a conversation`
instead. Its read-back also scans the channel root only, while replies post into the
minted thread at the marker ts. Both misses produced `VERDICT FAIL steer=no reply=no`
on a round-trip that demonstrably passed.

Correction: the Slack matcher now accepts the current conversation wording and reads a
root marker through `conversations-replies --thread-ts <marker ts>`. Telegram now uses
its channel-host send ledger as outbound evidence because Telegram does not reliably
deliver one bot's group messages to another bot's `getUpdates` stream.

### 2. The regenerated lockfile did not match the merged manifest

The merged server manifest pinned `@anthropic-ai/claude-agent-sdk` `0.3.246`, while the
committed lock and installed tree still resolved `0.3.220`; `npm ls` returned
`ELSPROBLEMS`. Deleting a monorepo lock and resolving from scratch also risks unrelated
semver and platform-optional churn.

Rule: resolve manifests first, use the upstream release lock as the base, reconcile with
`npm install --package-lock-only --ignore-scripts`, review the lock diff, then require
clean `npm ci`, `npm ls --workspaces --depth=0`, and exact checks for
release-changed pins before a sync can be verified. Full transitive `npm ls --all` is
advisory in this repository because optional cross-platform and peer dependencies report
known noise even after a clean install.

### 3. Dev daemon inherited `CODEX_HOME` from the host shell

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

### 4. Server pid-lock treats a zombie as running

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

- Corrective run at 18:20Z used the ledger-aware assertion: marker message `366` →
  `channel inbound steered an existing session` agent `4f072ac8` with
  `dispatched: true`, but after 303 seconds the send ledger remained `93 → 93` and the
  script reported `VERDICT FAIL steer=yes outbound=no`. Telegram outbound remains a
  real blocker, not assertion drift.
- Treat `clisbot/sync-2026-08-30-v0.7.0-beta.2` as the historical merge point, not a
  verified tag. Create a new `sync-verified-*` tag only after every gate passes.
- Update `docs/tests/channels/p0-live-scenarios.md` Status with this run's evidence
  (Slack PASS with thread read-back; Telegram inbound PASS, relay open).

## Corrective verification after this lesson

- Dependency baseline: preserved the known-working fusion lock and replaced only the
  stale nested Claude Agent SDK `0.3.220` entries with the upstream release's exact
  `0.3.246` package and platform entries. `npm ci --dry-run`, workspace-level `npm ls`,
  and the exact SDK check pass. A real clean `npm ci` was attempted with the dev Hub and
  daemon stopped but was OS-killed with exit 137 on this 8 GB box; incremental
  `npm install` completes. Clean-install verification therefore remains blocked by the
  environment. Full transitive `npm ls --all` also reports known optional/peer noise and
  is not a release gate.
- Assertions: Slack historical check now returns PASS against marker thread
  `1788104353.604089`. A new Slack marker bound agent `eff3719e` but the agent waited on
  a permission, so that re-drive was stopped rather than auto-approved. Telegram's new
  ledger-aware run produced the real outbound failure recorded above.
- Result: corrected lock contract, but **no verified sync tag** until a clean install
  completes on a sufficiently resourced runner and Telegram outbound passes.
