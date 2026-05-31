---
title: Persistence Store Inventory
description: Living inventory and governance rules for clisbot persisted stores.
---

# Persistence Store Inventory

## Purpose

This document is the source of truth for durable clisbot stores.

Use it before adding, splitting, or changing a persisted store. The goal is to
avoid unplanned store growth, duplicated state ownership, hidden concurrency
risks, and AI-generated "one more JSON file" drift.

## Scope

This inventory covers clisbot-owned durable stores under `CLISBOT_HOME`,
configured credential files, and runtime state files.

It does not cover:

- source files such as `package.json`
- docs, templates, fixtures, or test-only JSON files
- HTTP request or response JSON payloads
- logs, pid files, sockets, or other non-JSON runtime artifacts unless they
  own durable state semantics

## New Store Gate

Before adding a persisted store, answer all of these questions in the design or
PR:

1. Which existing store is insufficient, and why can the new data not live
   there?
2. Which product system owns the store and its lifecycle?
3. Is the data canonical state, diagnostic state, a projection, or a secret?
4. What is the file path, and is it configurable or derived from `CLISBOT_HOME`?
5. Which process paths can read or mutate it: runtime, HTTP listener, monitor,
   one-shot CLI, runner subprocess, or tests?
6. What is the concurrency model: `json-storage`, owner process, single-writer
   invariant, or temporary unmanaged?
7. What is the retention or cleanup policy?
8. What migration or compatibility behavior is needed for existing files?
9. What test proves cross-process, independent-store, or concurrent access if
   more than one process can touch it?
10. Has this document been updated with the new store or with the reason the
    old store was extended instead?

Default rule: extend an existing owner store when the ownership, lifecycle, and
retention match. Create a new store only when mixing the data would make the
existing store harder to own, secure, migrate, or clean up.

## Storage Primitive Rule

For file-backed JSON that can be read or mutated from multiple processes or
request paths, use `src/infra/json-storage.ts`.

- Use `withJsonFileMutation` for read-modify-write updates.
- Do not hand-roll `readFile -> JSON.parse -> mutate -> writeFile` in owner
  systems.
- Owner systems still own schema validation, normalization, migration,
  retention, pruning, config reload suppression, and domain side effects.
- Unlocked fresh reads are acceptable only when the caller can tolerate either
  the old complete snapshot or the new complete snapshot.
- Secrets must preserve owner-only file mode, usually `0o600`.

Current exception classes must be intentional:

- config-owned writes may need schema migration, pruning, and reload
  suppression around the storage primitive
- subprocess-owned diagnostic records may be single-writer by construction
- stores already using a bounded file lock may be migrated later when touching
  them for related work

## Inventory

Status values:

- **Canonical**: user/runtime behavior depends on this durable state.
- **Diagnostic**: used for status, troubleshooting, or recovery hints.
- **Secret**: contains credentials or auth material.
- **Needs review**: current implementation works in known flows, but its
  concurrency or consolidation model should be revisited before expansion.

| Store | Path | Owner | Shape | Status | Coordination | Retention / cleanup | Planning note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| App config | `~/.clisbot/clisbot.json` or `CLISBOT_CONFIG_PATH` | `src/config/core` | `ClisbotConfig` document | Canonical | Config schema, migrations, and config-owned write APIs; owner-claim uses bounded lock | Operator controlled; backups during upgrade | Keep as control plane. Do not bypass config APIs. If general config writes become concurrent, wrap the config-owned mutation path with shared storage while preserving migration/reload behavior. |
| Runtime credentials | `<state>/runtime-credentials.json` | `src/config/channels` | Runtime-only credential map by channel/bot/field | Secret | Synchronous JSON read/write with `0o600` mode | Removed/deactivated by runtime lifecycle commands | Candidate for `json-storage` with `mode: 0o600` if concurrent credential mutation grows. Do not merge with app config. |
| Canonical credential files | `<credentials>/<channel>/<bot>/<field>` | `src/config/channels` | Plain secret token file, not JSON | Secret | Direct owner-only file write | Operator controlled | Included here so JSON-store planning does not accidentally duplicate secret storage. |
| Zalo Personal auth session | `<credentials>/zalo-personal/<bot>/auth-session` by default | `src/channels/zalo-personal` | Zalo auth session JSON with cookie, imei, user agent, user hint | Secret | Direct JSON read/write with `0o600` mode | Removed by logout | Keep separate from token files because it is provider auth session material. Candidate for storage primitive only with secret mode preserved. |
| Session store | `<state>/sessions.json` or `app.session.storePath` | `src/agents/session` | `sessionKey -> StoredSessionEntry`; includes active `sessionId`, runtime, loops, queues, recent conversation | Canonical | In-process path lock plus temp rename | Long-lived runtime state; cleanup is session/loop/queue owned | High-value candidate for `json-storage` because runtime and one-shot control commands can both mutate session-owned state. Do not split loops/queues without proving lifecycle mismatch. |
| Processed events | `<state>/processed-events.json` | `src/channels/message` | Event id -> processing/completed status | Canonical for idempotency | In-memory cache plus full-file write | TTL 7d; processing stale after 30m | Candidate for `json-storage`; idempotency is sensitive to lost updates across listeners/processes. |
| Channel results | `<state>/channel-results.json` | `src/channels/results` | API event result records plus surface reply index | Canonical for API channel result polling and two-way replies | `json-storage` bounded lock for mutations; fresh unlocked reads | Result retention 6h; expired grace 1h; progress capped | Current reference implementation for multi-process JSON mutation. |
| Pairing requests | `<state>/pairing/<channel>-pairing.json` | `src/channels/pairing` | Pending pairing code requests | Canonical for pairing flow | `proper-lockfile` bounded lock plus temp rename | Pending TTL 1h; max 20 pending | Existing safe pattern. Migrate to `json-storage` when touching pairing storage to reduce duplicate primitives. |
| Pairing allowlist | `<state>/pairing/<channel>-allowFrom.json` | `src/channels/pairing` | Approved sender ids | Canonical for pairing bypass | Mutations use `proper-lockfile`; reads are unlocked | Operator controlled | Same migration note as pairing requests. Keep separate only while pairing store owns its own file layout. |
| Surface directory | `<state>/surface-directory.json` | `src/channels/surface` | Sender/surface display metadata by provider identity | Projection / diagnostic helper | In-process path lock plus full-file write | No explicit TTL currently, though records carry optional `expiresAt` | Candidate for `json-storage`; useful metadata but should not become canonical routing truth. |
| Activity store | `<state>/activity.json` | `src/control/runtime` | Last activity by agent and channel | Diagnostic | Read-modify-write without file lock | Last value wins | Low-risk candidate for `json-storage`; acceptable to lose occasional diagnostic update, but do not build canonical behavior on it. |
| Runtime health store | `<state>/runtime-health.json` | `src/control/runtime` | Channel health records plus reload status | Diagnostic/operator truth | Read-modify-write without file lock | Last status wins | Candidate for `json-storage` if multiple runtime/supervisor paths mutate it concurrently. |
| Runtime monitor state | `<state>/clisbot-monitor.json` | `src/control/runtime` | Monitor pid, worker pid, backoff/restart state | Canonical for monitor coordination | Single monitor invariant; direct full-file write | Rewritten by monitor lifecycle | Keep the single-writer invariant explicit. If other processes start mutating it, move to `json-storage` or owner-process command path. |
| Runner exit records | `<state>/runner-exits/<session>.json` | `src/control/runner` | One runner subprocess exit diagnostic | Diagnostic | Single subprocess writes its own session record; runtime reads and clears | Cleared on runner startup/recovery | Do not merge into session store; records are subprocess boundary artifacts and intentionally isolated. |

## Consolidation Guidance

Use this table when deciding whether a new store is justified:

| If the new data is... | Prefer... | Avoid... |
| --- | --- | --- |
| Agent/session continuity, loops, queues, or recent conversation | `sessions.json` through `SessionStore` | Per-feature JSON files under `state/` with the same session lifecycle |
| Channel idempotency | `processed-events.json` or an owner-specific extension if the TTL differs | Embedding dedupe flags into channel config |
| API event outputs, result polling, or API reply target metadata | `channel-results.json` | A separate per-connector result file |
| Operator health, reload, or channel startup diagnostics | `runtime-health.json` | Adding one status file per channel |
| Pairing approval state | Pairing stores | Duplicating allowlists in channel-specific state files |
| Display-name enrichment only | `surface-directory.json` | Treating display metadata as canonical routing state |
| Secrets or auth sessions | Credential/session files with `0o600` | Putting raw secrets in app config or general runtime state |

## Required Test Shape

When a store can be touched by more than one process or independent instance,
tests should include at least one of:

- two independent store instances mutating the same file
- concurrent read/write overlap that proves readers see only complete snapshots
- a runtime + one-shot CLI or listener-style integration path
- a stale-cache regression where one instance observes another instance's write

Same-instance unit tests are not enough for file-backed runtime state.

## Known Follow-Ups

- Migrate `ProcessedEventsStore` to `json-storage` before expanding channel
  dedupe semantics.
- Migrate `SessionStore` carefully; it is high value but has broad blast
  radius because loops, queues, runtime state, and session continuity share it.
- Consider replacing pairing's local lock helpers with `json-storage` to reduce
  duplicate locking code.
- Decide whether activity and runtime-health lost updates matter enough to
  prioritize migration; they are diagnostic today, not canonical workflow state.
