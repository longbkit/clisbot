# Session Key And Runner Session Id Audit

## Status

Historical audit with a shipped follow-up.

Read this file as:

- a large evidence snapshot captured before the 2026-05-02 continuity cleanup
- plus a short current-status layer near the top
- not as a claim that every detailed failure path below still reflects current
  shipped behavior line-for-line

Current release-ready truth after `0.1.50-beta.12`:

- `SessionMapping` is now the session-owned continuity seam
- ambiguous resume-startup and `/new` capture failures preserve the stored
  mapping instead of clearing it eagerly
- delayed workspace trust prompts are now accepted again before the first
  routed prompt and later steering input
- `clisbot runner list` no longer captures every live pane just to infer
  session ids
- a dedicated memory-first live-session-id registry is not being tracked as a
  release blocker for `0.1.50`; reopen only if real operator evidence shows
  persisted-first diagnostics are hiding already-known live truth

## Quick Reader Guide

If someone knows little about the `clisbot` codebase and only needs the task
handoff, the shortest truthful summary is this:

### 1. Where unstable `sessionId` is most likely coming from

Look here first:

| Area | Primary Files / Functions | Why This Is High Risk |
| --- | --- | --- |
| Startup capture | `src/agents/runtime/runner-service.ts`:`ensureSessionReady()`, `finalizeSessionStartup()`, `retryMissingStoredSessionIdAfterStartup()` | Fresh startup can succeed while capture or persistence still misses or persists the wrong id. |
| Reuse existing tmux | `src/agents/runtime/runner-service.ts`:`syncStoredSessionIdForResolvedTarget()` | Existing stored id can be trusted too early, or cooldown can refresh metadata without fixing identity. |
| Generic write seam | `src/agents/session/session-state.ts`:`touchSessionEntry()`, `clearSessionIdEntry()`, `upsertSessionEntry()` | Mapping writes still go through broad generic helpers, so bind vs clear vs refresh is hard to see. |
| Diagnostics read surfaces | `src/agents/runtime/agent-service.ts`:`getSessionDiagnostics()`, `src/control/runner/runner-cli.ts` | Current shipped behavior now shows `sessionId` plus persistence annotation without probing every live pane, but it still does not maintain a separate always-live memory registry outside active-run context. |
| Cleanup / sunset | `src/agents/runtime/runner-service.ts`:`runSessionCleanup()` | Cleanup freshness uses broad metadata recency and can race startup or capture flows. |

Non-primary suspects:

- channel routing is not the main unstable-`sessionId` problem
- `sessions.json` as one file is not the first thing to replace
- the main bug class is semantic ambiguity and race windows above the raw file
  layer

### 2. Which names are causing overload

These names currently hide too much:

| Current Name | Why It Overloads Too Much | Canonical Direction |
| --- | --- | --- |
| `touchSessionEntry(sessionId=...)` | Can mean bind, refresh, or "do nothing but touch". | Remove as a public identity seam. |
| `clearSessionIdEntry()` | Sounds generic, but it clears the active stored mapping for a conversation. | `sessionMapping.clear(...)` |
| `persistStoredSessionId()` | Sounds important, but only does one stored-mapping write branch. | fold into `sessionMapping.setActive(...)` or inline caller flow |
| `syncStoredSessionIdForResolvedTarget()` | Mixes read, capture, cooldown, and write in one vague verb. | Split into explicit caller flow. |
| `createSessionId()` / `extractSessionId()` | They belong to two different seams. One is a session-owned explicit-id helper; the other parses runner output. | keep `createSessionId()` under session ownership; move parse semantics toward `runnerSessionId.parse()` |

Short rule:

- continuity read or write or clear should live under one `sessionMapping` group
- runner-native session-id mechanics should live under one `runnerSessionId` group
- generic metadata can keep `SessionEntry`

### 3. What the canonical fix path is

Do this, in this order:

1. Keep public ownership stable:
   - channel owns `sessionKey`
   - `SessionService` owns active `sessionKey -> sessionId -> workspacePath`
     mapping
   - runner owns backend-specific pass-through or capture or resume mechanics
2. Add one small grouped continuity API instead of a long list of public verbs:
   - `sessionMapping.get(sessionKey)`
   - `sessionMapping.setActive(sessionRef, { sessionId, reason })`
   - `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`
   - `runnerSessionId.capture()`
   - `runnerSessionId.parse()`
   - session-side explicit-id helper only if needed, for example
     `createSessionId()`
3. Keep `/new` and explicit resume as caller flows, not separate public wrapper names yet.
4. Move current `RunnerService` mapping mutations onto that grouped API.
5. Remove broad identity writes through `touchSessionEntry(...)`.
6. Keep `sessions.json` for phase 1. Do not overkill storage redesign first.

### 4. Reading order for this doc

If reading fast:

1. this `Quick Reader Guide`
2. `Critical Failure Lens: Unstable sessionId`
3. `Pass 2 Breadth Review: Unstable sessionId By Path`
4. `Naming Convention Overlay`
5. `Detailed Proposed Change`

## Decision

This audit no longer recommends moving canonical `sessionKey -> sessionId`
continuity ownership into runners.

Stable architecture decision:

- [Session Key And Session Id Continuity Decision](../../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)

Current conclusion:

- the stable public mental model is already closer to the right direction than
  this audit's first draft implied
- docs needed clarification first, but the implementation still has real
  follow-up work
- session continuity remains agent-owned, concretely through
  `SessionService`
- runners provide backend-specific `sessionId` pass-through or capture or
  resume mechanics that the session owner uses

Use one name for one concept in this doc:

- `session mapping`
  - active `sessionKey -> sessionId -> workspacePath` continuity for one
    conversation at one moment in time

Keep the default chat flow simple:

- channels work with `sessionKey`
- `sessionId` is optional in ordinary flow
- exact `sessionId` use is explicit and privileged
- queue or loop or follow-up state stays attached to `sessionKey`

Implementation status after the 2026-05-02 follow-up:

- the code now has a clearer agents-layer continuity seam through
  `SessionMapping`
- `createSessionId()` stays session-owned and is no longer called directly from
  `RunnerService`
- `RunnerService` no longer clears stored `sessionId` mappings automatically on
  ambiguous resume-startup or `/new` capture failures
- `/whoami`, `/status`, `runner list`, and `runner watch` now show `sessionId`
  plus persistence annotation instead of presenting persisted
  `storedSessionId` as the only visible truth
- explicit session rebinding still remains a planned control surface, but the
  main mixed-owner continuity leak described by this audit is now materially
  reduced in shipped code

## Scope

In scope:

- how chat surfaces produce `sessionKey`
- how runners use or capture or resume `sessionId`
- who should own continuity versus backend-specific mechanics
- how exact `sessionId` use and workspace switch should work later

Out of scope:

- queue behavior outside session targeting
- full transcript persistence
- non-session runner startup hardening

## Task-Ready Conclusion

This audit already fed the main implementation task.

The main continuity cleanup is shipped. Remaining ideas should not try to
change the public mental model again.

It instead improved the code so the implementation matches that stable mental
model more directly:

- keep continuity and mapping session-layer owned
- keep backend-specific pass-through or capture or resume mechanics runner-owned
- narrow or replace generic helper paths that currently mutate `sessionId`
  too broadly
- design and ship an explicit rebind surface later instead of hiding it inside
  ordinary chat flow
- keep semantic cleanup first; do not let file-move cleanup distract from the
  real owner boundary work
- treat the unreduced detailed sections below as audit history unless a section
  is explicitly refreshed

This doc was missing one important thing in the first pass:

- a code-truth scan detailed enough to turn the follow-up directly into an
  implementation task

The sections below add that missing layer.

## Current State

| File | What It Does Today | Owner |
| --- | --- | --- |
| `src/channels/slack/session-routing.ts` | Builds `sessionKey` for Slack DM or group or channel or thread. | Channels |
| `src/channels/telegram/session-routing.ts` | Builds `sessionKey` for Telegram DM or group or topic. | Channels |
| `src/channels/message/interaction-processing.ts` | Sends `agentId` and `sessionKey` into execution. | Channels |
| `src/agents/runtime/runner-service.ts` | Creates explicit ids, captures runner-created ids, chooses resume commands, and still mutates continuity state directly. | Hybrid today; should narrow toward backend execution only |
| `src/runners/tmux/session-handshake.ts` | tmux-specific capture logic. | Runner code |
| `src/agents/session/session-state.ts` | Still writes and clears `sessionId` through generic session-entry helpers. | Mixed today |
| `src/agents/session/session-store.ts` | Writes `sessions.json` with atomic temp-file rename. | Shared storage layer |
| `src/control/runner/runner-cli.ts`, `/whoami`, `/status` | Read stored `sessionId` for diagnostics. | Control and chat read surfaces |

Current file:

- `~/.clisbot/state/sessions.json`
  - stores `sessionId`, `workspacePath`, queue state, loop state, follow-up
    state, runtime projection, and recent conversation under one session entry

The problem is not the file itself.

The real ambiguity is the story told across layers:

- code already lets runner logic decide most backend-specific `sessionId`
  behavior
- continuity state such as queue or loop or follow-up still hangs off
  `sessionKey`
- the first draft of this audit pushed too far toward "runner owns mapping"
  instead of keeping the mental model centered on session continuity

## Boundary

| Layer | Owns Today | Should Own |
| --- | --- | --- |
| Channel | Turn a Slack or Telegram surface into `agentId` and `sessionKey`. Pass normal messages forward without choosing a `sessionId`. | Same |
| Session layer | Owns continuity under `sessionKey`, including queue or loop or follow-up state, runtime projection, and the active mapping persisted for that conversation. | Same, with clearer API boundaries. |
| Runner | Pass through or capture or resume `sessionId`. Decide whether an external `sessionId` is supported by the backend. | Same backend-specific role, but stop owning explicit-id minting and continuity mutation semantics. |
| Session store | Physically persist `sessions.json`, keyed by `sessionKey`, by rewriting whole entries. It is a storage layer, not a policy layer. | Same physical role |

The public ownership model should stay stable.

The real remaining work is implementation cleanup and explicit control-surface
design, not storage technology changes or another ownership inversion.

## Code Truth Scan

### Current Read And Write Paths

Current code truth is more specific than the earlier narrative-only version of
this audit.

`sessionId` continuity is currently touched by these real paths:

- `src/agents/runtime/runner-service.ts`
  - `ensureSessionReady()`
    - decides whether startup uses an existing stored `sessionId`
    - generates an explicit `sessionId` when a backend supports caller-supplied
      ids
    - launches a runner in resume or fresh mode
  - `finalizeSessionStartup()`
    - persists either the pre-known `sessionId` or a captured runner-created
      one
  - `syncStoredSessionIdForResolvedTarget()`
    - backfills or refreshes stored `sessionId` from runner output
  - `retryFreshStartAfterStoredResumeFailure()`
    - clears stored `sessionId` after a failed resume startup for runner-owned
      ids
  - `restartRunnerWithFreshSessionId()`
    - clears stored `sessionId` on intentional fresh restart
  - `triggerNewSessionInLiveRunner()`
    - sends `/new` or `/clear`, captures the rotated id, and overwrites the
      active mapping for the same `sessionKey`

- `src/agents/session/session-state.ts`
  - `touchSessionEntry()`
    - generic write path that may also carry `sessionId`
  - `clearSessionIdEntry()`
    - generic clear path that also resets runtime to idle
  - `upsertSessionEntry()`
    - shared full-entry rewrite path used by follow-up, queue, loop, runtime,
      and recent-conversation updates as well as `sessionId` mutation

- `src/agents/session/session-store.ts`
  - persists one JSON object keyed by `sessionKey`
  - has no semantic mapping API; it only stores the rewritten session entry

Current truth:

- this is why `RunnerService` still feels half-runner and half-session-side
- the architecture should not be weakened to fit that temporary code shape
- the code should be cleaned up to match the architecture instead

### Concrete Gap To Remove

The follow-up cleanup should remove these responsibilities from
`RunnerService`:

- mint explicit `sessionId` values for explicit-id launch paths
- decide continuity mutation semantics such as bind or clear or rotate
- call broad generic session-entry mutation helpers directly for mapping work

And should keep these responsibilities in runner code:

- build backend launch args from already-chosen inputs
- launch or resume the backend
- capture a tool-created `sessionId`
- surface truthful backend failure when a requested resume or explicit-id path
  is not supported

- `src/channels/message/interaction-processing.ts`
  - normal chat path sends `agentId` + `sessionKey`
  - `/new` is the only user-visible explicit mapping mutation today
  - `/whoami` and `/status` expose stored `sessionId` diagnostically

- `src/agents/commands/commands.ts`
  - documents `/new`
  - does not yet expose `/sessions list`, `/sessions status`, or
    `/sessions resume <id>`

- `src/control/runner/runner-cli.ts`
  - reads stored `sessionId` for diagnostics only
  - does not provide mapping-specific operator actions

### What The Code Already Gets Right

- normal routed chat is still `sessionKey`-first
- runner-specific launch or capture or resume behavior is already centralized
  mostly inside `RunnerService`
- queue, loop, follow-up, runtime projection, and recent conversation all stay
  anchored on `sessionKey`
- `/new` already expresses the correct high-level public mental model:
  same routed conversation, new active runner conversation id

### Where The Code Is Still Ambiguous

#### 1. Mapping mutation is still spread across generic session-entry helpers

The biggest ambiguity is not storage location. It is semantic ownership.

Today:

- `RunnerService` decides when mapping should change
- but `AgentSessionState.touchSessionEntry()` and
  `AgentSessionState.clearSessionIdEntry()` are still broad generic entry
  mutation helpers
- those helpers sit next to unrelated queue, loop, follow-up, runtime, and
  recent-conversation mutation helpers

That means the code still lacks one explicit continuity API surface such as:

- read active mapping
- bind mapping to a `sessionId`
- clear active mapping
- rotate mapping after `/new`
- rebind mapping to an explicit earlier `sessionId`

#### 2. `workspacePath` still rides along broad full-entry rewrites

`AgentSessionState.upsertSessionEntry()` always rewrites:

- `agentId`
- `sessionKey`
- `workspacePath`
- `runnerCommand`
- `sessionId`
- queue or loop or runtime state

This is convenient, but it means the continuity tuple:

- `sessionKey -> sessionId -> workspacePath`

is not protected by a dedicated semantic path.

That is the real source of drift risk when future explicit rebind or workspace
switch features arrive.

#### 3. The only explicit mapping mutation shipped to users is `/new`

Current public control surface:

- `/new`

Missing explicit surfaces:

- `/sessions list`
- `/sessions status`
- `/sessions resume <id>`
- any policy-gated workspace rebind surface

So the stable mental model is now documented, but the user-controlled remap
path is still missing in code.

#### 4. Reverse lookup is not modeled yet

Storage is keyed by `sessionKey`.

That is fine for continuity, but any future explicit resume-by-id flow still
needs one truthful lookup strategy:

- scan current entries by `sessionId`
- or maintain a reverse index
- or limit resume scope to one agent or workspace and still scan

That decision does not need a second store file yet, but it does need one
named API and one testable rule.

#### 5. Runtime recovery and explicit mapping policy still mix in the same owner

This is acceptable today, but the next task should be careful here.

`RunnerService` currently handles both:

- backend mechanics
- several continuity mutation decisions during retry, recovery, and `/new`

That is still better than making channels care about `sessionId`, but it means
the next refactor should narrow the session-layer API first, then make runner
code call into it, instead of moving more policy into runners.

## Concrete Gaps By File

| File | Current Gap | Why It Matters |
| --- | --- | --- |
| `src/agents/session/session-state.ts` | No dedicated mapping API; `sessionId` mutation is mixed with generic full-entry updates. | Makes future `/sessions resume <id>` or workspace rebind harder to implement truthfully. |
| `src/agents/session/session-store.ts` | No mapping-specific read helper or reverse lookup helper. | Future explicit resume will otherwise scan ad hoc in several places. |
| `src/agents/runtime/runner-service.ts` | Runner code both performs backend session-id mechanics and decides several continuity mutations directly. | Boundary is mostly right, but API clarity is still weak. |
| `src/agents/session/session-identity.ts` | the file currently mixes session-owned explicit-id minting and runner-output parsing too closely. | Makes it harder to see which layer owns explicit-id minting versus runner-native parsing. |
| `src/runners/tmux/session-handshake.ts` | tmux-specific capture helper is truthful, but the naming family above it is still inconsistent. | Makes top-level seam versus backend-private helper harder to distinguish quickly. |
| `src/channels/message/interaction-processing.ts` | `/new` exists, but no explicit resume-by-id surface exists. | User-controlled remap is not actually shipped yet. |
| `src/agents/commands/commands.ts` | Help and parser do not model session-management commands beyond `/new`. | Public contract is incomplete versus the intended mental model. |
| `src/control/runner/runner-cli.ts` | Diagnostic only; no mapping-oriented inspect or resume flow. | Operators lack a truthful mapping-focused surface for future debugging or admin intervention. |
| `test/agent-service/agent-service.test.ts` | Strong coverage for `/new`, startup capture, resume retry, and fresh/fallback paths. Missing explicit rebind tests. | The hardest future feature has no test harness yet. |
| `test/interaction-processing/interaction-processing.test.ts` | Covers `/new`, `/status`, `/whoami`. Missing end-to-end user-control tests for session remap. | Public continuity contract is not yet guarded. |

## Naming Convention Overlay

The earlier `2026-04-30-session-id-capture-persist-audit-1.md` note was right
about one thing that still matters now:

- the repo currently overloads names too much around `sessionId`
- that naming drift makes critical persistence bugs much harder to see

This section keeps the architecture direction from this newer audit, while
bringing forward the useful naming discipline from the older note.

### Why Naming Matters Here

The current critical user-facing failure looks like this:

- a chat turn clearly reached the runner
- but `/whoami` and `clisbot runner list` still show no stored `sessionId`
- people then cannot tell quickly whether the problem was:
  - runner-side capture failure
  - persistence write failure
  - stale read surface
  - cooldown or retry suppression
  - or simply the wrong helper path

Today the code makes that diagnosis harder than it should because public and
semi-public helpers mix names such as:

- `createSessionId`
- `extractSessionId`
- `persistStoredSessionId`
- `syncStoredSessionIdForResolvedTarget`
- `touchSessionEntry`
- `clearSessionIdEntry`

Those names blur three different layers:

1. runner-native id work
2. continuity mapping decisions
3. generic session-entry persistence

That is exactly the kind of overload that violates the repo DRY/KISS and
one-name-one-concept rules.

### Required Naming Rules

Keep these rules for the next implementation task:

1. one public concept family per layer
2. top-level continuity APIs must name the continuity concept, not the low-level helper side effect
3. runner-side id helpers must live under one `runnerSessionId` group
4. generic session-entry helpers must not be used as the primary public naming surface for identity mutation
5. verbs should reveal the semantic outcome:
   - prefer `get`, `setActive`, `clear`, `capture`, `parse`
   - avoid vague public seams such as `touch`, `sync`, `persist`, or overly abstract `bind`
6. top-level seam names and lower-level helper names must be visually separable on first read

### Recommended Naming Strata

The simplest stable naming model is:

#### 1. Continuity seam

This is the top-level public seam for logical conversation continuity.

Use one grouped `sessionMapping` seam.

Examples:

- `sessionMapping.get`
- `sessionMapping.setActive`
- `sessionMapping.clear`

Why:

- the real public concept is not "a random session id write"
- it is the active continuity tuple:
  - `sessionKey -> sessionId -> workspacePath`

#### 2. Runner seam

This is the backend-facing seam for live tool-native ids.

Use one grouped `runnerSessionId` seam.

Examples:

- `runnerSessionId.parse`
- `runnerSessionId.capture`
- `createSessionId` if `SessionService` still needs a tiny helper

Why:

- it keeps runner-native work clearly separate from persisted continuity
- it makes backend-private helpers easier to nest under the right top-level seam

### Seam Hierarchy

This is the final hierarchy the implementation should optimize for:

| Layer | Role | Naming Family | Example |
| --- | --- | --- | --- |
| Top-level continuity seam | Canonical logical conversation mapping owner. This is what most code should read first. | `sessionMapping` | `sessionMapping.setActive` |
| Mid-level runner seam | Backend-facing live tool id seam. This is where capture or parse or resume-facing semantics belong. | `runnerSessionId` | `runnerSessionId.capture` |
| Backend-private seam | Tool- or transport-specific implementation helper hidden below the public runner seam. | backend-private helper, preferably still ending in `RunnerSessionId` if exposed at all | `captureTmuxRunnerSessionId` or keep private `captureTmuxSessionIdentity` under `runnerSessionId.capture` |
| Generic entry seam | Full session-entry mutation and read helpers for queues, loops, runtime, follow-up, recent conversation, and broad metadata. | `SessionEntry` or existing generic store/state names | `upsertSessionEntry` |

The rule is:

- most call chains should start from `SessionMapping`
- only that seam should decide logical mapping mutation
- lower seams should not accidentally look like alternative top-level owners

### Naming Families To Keep

Keep these families because they still fit the accepted architecture:

- `sessionMapping`
  - top-level continuity owner
- `runnerSessionId`
  - runner-native parse or capture work
- `createSessionId`
  - session-side helper only when a backend accepts caller-supplied ids
- `SessionEntry`
  - generic persistence shape and helper family for non-mapping metadata

### Naming Families To Rename

These should be renamed because they currently blur layer boundaries:

| Current Family | Why It Is Wrong | Target Family |
| --- | --- | --- |
| generic `SessionId` helpers with no qualifier | hides whether the helper mints an explicit id, parses runner text, or mutates continuity | keep `createSessionId()` for the session-owned minting helper, and use `runnerSessionId` or `sessionMapping` for the other layers |
| `persistStoredSessionId` | sounds like a top-level semantic owner, but really performs one write path among others | remove as a public seam; either inline it or route through `sessionMapping.setActive(...)` |
| `syncStoredSessionId...` | hides a mixed read/capture/cooldown/write branch behind one vague verb | split into explicit caller flow using `sessionMapping.get(...)`, `runnerSessionId.capture(...)`, and `sessionMapping.setActive(...)` |
| `clearSessionIdEntry` | mixes identity mutation with generic session-entry framing | `sessionMapping.clear(...)` |
| `createSessionId` / `extractSessionId` | they belong to different layers even if the session-side helper keeps its current name | keep `createSessionId()` under session ownership and move parse semantics toward `runnerSessionId.parse()` |

### Naming Families To Delete

Delete these as public mental-model families, even if temporary wrappers remain
briefly during migration:

- `touch...` for identity mutation
- `sync...` for mixed capture or write orchestration
- generic unqualified `SessionId` helper families
- special-case helper names whose only real semantic is:
  - capture with one retry policy
  - clear with one reason
  - write through a generic entry helper

If a name exists only to hide a small branch variation, it should usually be
deleted and expressed as a caller-owned flow instead.

### Names That Should Disappear From The Public Mental Model

These names are especially risky because they hide the real decision:

- `touchSessionEntry(...)` for identity mutation
- `syncStoredSessionId...` for mixed read/capture/write/cooldown behavior
- `persistStoredSessionId(...)` as a cross-layer semantic owner
- the current mixed `createSessionId()` plus `extractSessionId()` helper family
  with no ownership split

They may remain internally during an incremental refactor, but they should not
stay as the final public seam that future contributors must reason about.

### Concrete Keep Or Rename Or Delete Decisions

This is the strict review output for the current code path names that matter
most:

| Current Name | Keep / Rename / Delete | Final Direction |
| --- | --- | --- |
| `createSessionId` | Keep name, move ownership | session-owned helper used by `SessionService` or a small session helper |
| `extractSessionId` | Rename | `runnerSessionId.parse` |
| `captureSessionIdFromRunner` | Rename | `runnerSessionId.capture` |
| `captureTmuxSessionIdentity` | Keep private, optionally rename later | backend-private helper below `runnerSessionId.capture`; rename only if exposing the family more publicly helps clarity |
| `persistStoredSessionId` | Delete as a public seam | inline it or route the caller through `sessionMapping.setActive(...)` |
| `syncStoredSessionIdForResolvedTarget` | Delete | replace with explicit caller flow |
| `retryMissingStoredSessionIdAfterStartup` | Delete | inline startup retry policy around `runnerSessionId.capture(...)` |
| `captureNewSessionIdentityAfterTrigger` | Delete | `runnerSessionId.capture({ requireChangeFrom })` |
| `clearSessionIdAfterNewSessionFailure` | Delete | explicit failure branch using `sessionMapping.clear(...)` |
| `touchSessionEntry(sessionId=...)` | Delete for identity writes | generic helper may stay for non-identity metadata only |
| `clearSessionIdEntry` | Rename | `sessionMapping.clear(...)` |
| `upsertSessionEntry` | Keep private | generic entry seam, not an identity seam |
| `SessionStore.update` | Keep | low-level store mutation seam |

### Simplest Rule For Reviewers

If a reader cannot answer these three questions from the function name alone,
the name is still too weak:

1. Is this the continuity seam, the runner seam, the storage seam, or a
   backend-private helper?
2. Is this helper reading, setting active, clearing, parsing, or capturing?
3. Does this function own the decision, or only implement one lower-level step?

## Critical Failure Lens: Unstable `sessionId`

This audit should now speak directly to the critical bug class the user still
cares about:

- runner visibly received the chat
- but stored continuity still shows `sessionId: not stored`

This is not one bug. It is a short list of failure buckets.

### Failure Bucket 1: Capture succeeded in the pane, but not in the capture seam

Current code does not parse the whole pane as canonical truth.

It captures from derived candidate slices:

- `extractScrolledAppend(...)`
- `deriveInteractionText(...)`
- `deriveInteractionDiffText(...)`

That is good for avoiding false positives, but it creates one real risk:

- the pane may later visibly contain the id
- while the startup capture candidate never actually contained a parsable id

So "I saw the id in transcript later" does not prove "capture should have
stored it earlier."

### Failure Bucket 2: Null capture is easy to mistake for healthy continuity

Current null-capture path still performs a broad session-entry touch:

- retry cooldown is set
- `runnerCommand` may refresh
- `updatedAt` changes
- but `sessionId` remains missing

That means:

- the continuity record can look recently touched
- while the critical fact remains unchanged:
  - no stored `sessionId`

This is exactly the kind of misleading behavior that makes the bug feel
"unstable" or "random" during review.

### Failure Bucket 3: Diagnostics read stored truth only

Current diagnostics are truthful, but limited:

- `/whoami`
- `/status`
- `runner list`

They read stored continuity only.

That means they answer:

- "what did persistence save?"

They do not answer:

- "does the live pane currently show a native tool session id?"

That is the correct product behavior, but the audit should say explicitly that
this difference increases debugging confusion when capture is flaky.

### Failure Bucket 4: Generic helpers hide where the write decision actually happened

When the final persistence write is reached through:

- `touchSessionEntry(sessionId=...)`
- `clearSessionIdEntry(...)`
- broad `upsertSessionEntry(...)`

it becomes too hard to see:

- which branch decided the new mapping
- whether the branch was startup capture, live reuse, `/new`, or recovery clear
- whether write failure or non-write was intentional

That is naming debt plus architecture debt together.

### Failure Bucket 5: Read-only and stateful flows have historically drifted together

The recent `/transcript` cleanup is a good example:

- transcript was meant to be a pane-view command
- but it still touched session state until we removed that side effect

That shows a broader risk pattern:

- read-only inspection and continuity mutation have not always been separated
  cleanly

The follow-up task should assume more drift like this may still exist.

## Code Review And Fix Frame For The Critical Bug

Use this exact bug statement when reviewing the code:

> chat clearly reached the runner, but `/whoami` and `runner list` still show
> `storedSessionId: not stored`

The task is not done until the code can explain that bug truthfully and make
it hard to recur.

### Root-Cause Buckets

When reviewing or patching, force every finding into one of these buckets:

1. capture never produced a usable runner id
   - startup or `/new` capture returned `null`
   - candidate-slice parsing missed the id even though humans later see it in
     the pane
2. capture succeeded, but continuity never bound it
   - code saw the id but failed to commit the mapping through one canonical
     seam
3. stale or wrong state was re-trusted
   - existing stored id was refreshed without revalidating live truth
   - an older branch overwrote a newer mapping
4. read surfaces are correct but incomplete
   - `/whoami` and `runner list` reported only stored truth, while the live
     pane told a different story
5. cleanup or side effects destabilized continuity
   - sunset, retry, read-side touches, or metadata refresh changed the timing
     enough to hide the real failure

If a proposed patch does not clearly reduce one of these buckets, it is
probably not fixing the real bug.

### Observable Symptoms

The task doc should make these symptoms easy to map back to the buckets:

| Symptom | Likely Buckets |
| --- | --- |
| chat roundtrip works, but `/whoami` shows `(not stored yet)` | 1, 2 |
| `runner list` shows recent activity but still `not stored` | 1, 2, 5 |
| `/whoami` and `runner list` show a stored id, but runner seems attached to a different conversation | 3 |
| transcript later shows an id that never appeared in store | 1, 4 |
| bug happens more often around restart, reuse, `/new`, or stale cleanup windows | 3, 5 |

That symptom table matters because "session id not stable" is otherwise too
vague and leads to random local fixes.

### Instrumentation That Must Exist Before Calling The Fix Done

Without this instrumentation, the team will keep guessing.

Minimum required:

1. capture attempt log
   - `sessionKey`
   - `sessionName`
   - cause:
     - startup
     - reuse-missing-stored-id
     - new-session-rotation
     - recovery
   - outcome:
     - captured
     - null
     - skipped-by-cooldown
     - failed
2. continuity write log
   - previous stored id
   - next stored id
   - semantic action:
     - bind
     - clear
     - rotate
     - rebind
3. race-oriented test hooks
   - force null capture
   - force delayed capture
   - force stale overwrite attempt
   - force duplicate-startup path

This is the minimum needed so future reviewers can answer:

- did capture fail?
- did binding fail?
- did stale state overwrite newer truth?
- did diagnostics only expose the symptom later?

### Patch Order To Fix It For Real

Do not patch this bug opportunistically branch by branch.

Use this order:

1. make one canonical continuity seam
   - `sessionMapping.get/setActive/clear`
2. delete duplicate orchestration wrappers
   - especially `sync...`, `persist...`, and broad identity writes through
     `touchSessionEntry(...)`
3. add instrumentation before broad behavior tweaks
   - so the next failing case becomes attributable
4. harden startup and reuse paths
   - duplicate-startup race
   - cooldown false-refresh
   - stale re-trust path
5. harden cleanup interaction last
   - cleanup should stop destabilizing continuity-critical flows

Why this order:

- if instrumentation comes too late, the next miss is still guesswork
- if startup and reuse are patched before the seam is cleaned up, the same
  ambiguity survives in new names
- if cleanup is patched first, the main bind/capture ambiguity remains and the
  bug can still recur under normal startup flow

### Done Definition For This Bug Class

Do not call the issue fixed just because one reproduction stopped failing.

The bug class is only materially addressed when:

- every mapping mutation goes through one canonical continuity seam
- capture miss vs bind miss vs stale overwrite are separately observable
- `/whoami` and `runner list` remain read-only but are no longer the only
  source of truth during debugging
- startup, reuse, `/new`, and cleanup all have explicit tests around the
  `not stored` failure mode

## Pass 2 Breadth Review: Unstable `sessionId` By Path

This pass widens the review beyond naming and mental model.

The goal is to show exactly where `sessionId` instability can still come from
in current code, with file or function and one concrete failure mode per path.

### 1. Startup Capture Path

Primary code:

- `src/agents/runtime/runner-service.ts`
  - `ensureSessionReady()`
  - `finalizeSessionStartup()`
  - `retryMissingStoredSessionIdAfterStartup()`
- `src/runners/tmux/session-handshake.ts`
  - `captureTmuxSessionIdentity()`

#### Confirmed hole: duplicate-startup race can persist the wrong id

Code path:

- `ensureSessionReady()` precomputes `storedOrExplicitSessionId`
- `tmux.newSession(...)` may throw duplicate-session
- duplicate is swallowed if the session now exists
- `finalizeSessionStartup()` later persists the precomputed id without proving
  that this call actually created the live runner

Exact locations:

- `src/agents/runtime/runner-service.ts:525-549`
- `src/agents/runtime/runner-service.ts:619-639`

Failure mode:

- startup A generates explicit id `A`
- concurrent startup B wins and creates the tmux session with explicit id `B`
  or runner-owned id `B`
- startup A sees duplicate tmux session, treats it as acceptable, then
  persists `A`
- store now claims the conversation is on `A` while the live runner is
  actually on `B`

This is a real race window, not just naming confusion.

#### Confirmed hole: startup retry can end with missing id and weak evidence

Code path:

- `finalizeSessionStartup()` falls back to
  `retryMissingStoredSessionIdAfterStartup()`
- retry loop exits quietly on repeated null capture or a non-retryable capture
  error

Exact locations:

- `src/agents/runtime/runner-service.ts:642-649`
- `src/agents/runtime/runner-service.ts:652-677`

Failure mode:

- runner is up and serving chat
- startup capture misses the id in the candidate slices
- retry loop exhausts or returns early on a non-retryable error
- no `sessionId` is stored, and later diagnostics only show absence

The bug then looks random because the live runner succeeded while persistence
never explains why the mapping stayed empty.

#### Confirmed limitation: capture is candidate-slice based, not full-pane based

Code path:

- `captureTmuxSessionIdentity()`
- `deriveSessionIdCaptureCandidates()`

Exact locations:

- `src/runners/tmux/session-handshake.ts:145-217`
- `src/runners/tmux/session-handshake.ts:220-229`

Failure mode:

- the pane later visibly contains the tool-native id
- none of the derived candidate slices contained a parsable id at the capture
  moment
- startup capture correctly returns `null` under current algorithm, even
  though transcript inspection later looks convincing to a human

That means transcript truth and startup-capture truth are not equivalent
debugging surfaces.

### 2. Reuse Existing tmux Session Path

Primary code:

- `src/agents/runtime/runner-service.ts`
  - `ensureSessionReady()`
  - `syncStoredSessionIdForResolvedTarget()`

#### Confirmed hole: stored id is trusted without revalidating live runner truth

Code path:

- existing tmux session is found
- `syncStoredSessionIdForResolvedTarget()` returns early when a stored id
  already exists
- the code re-persists that same stored id instead of recapturing live truth

Exact locations:

- `src/agents/runtime/runner-service.ts:192-199`
- `src/agents/runtime/runner-service.ts:504-518`

Failure mode:

- clisbot previously stored `sessionId=A`
- the live tool conversation rotates to `B` outside the normal clisbot path
  or during an untracked race
- later reuse path sees stored `A`, skips capture, and refreshes `A`
- `/whoami` and `runner list` look healthy but report the wrong session

This is one of the strongest code-truth explanations for "stable-looking but
wrong" continuity.

#### Confirmed hole: cooldown skip refreshes metadata without fixing identity

Code path:

- no stored id exists
- capture cooldown is active
- code calls `touchSessionEntry(...)` anyway

Exact locations:

- `src/agents/runtime/runner-service.ts:202-206`
- `src/agents/session/session-state.ts:55-72`

Failure mode:

- live tmux session exists
- previous capture miss set cooldown
- reuse path skips capture but still refreshes `updatedAt` and
  `runnerCommand`
- store now looks recently maintained while `sessionId` is still absent

This is not a file-write race. It is a semantic false-positive refresh.

#### Confirmed race: read-capture-write has no compare-and-set guard

Code path:

- `syncStoredSessionIdForResolvedTarget()` reads current entry
- capture happens outside the store lock
- `touchSessionEntry()` later writes by last-write-wins

Exact locations:

- `src/agents/runtime/runner-service.ts:193-226`
- `src/agents/session/session-state.ts:556-576`
- `src/agents/session/session-store.ts:58-72`

Failure mode:

- path 1 reads "no stored id"
- path 2 rotates or clears the mapping
- path 1 later captures an older or now-stale id and writes it back

Current code has no revision check to prove that the mapping was unchanged
between read and write.

### 3. Diagnostics Read Surfaces

Primary code:

- `src/agents/runtime/agent-service.ts`
  - `getSessionDiagnostics()`
- `src/control/runner/runner-debug-state.ts`
  - `buildRunnerSessionMetadata()`
  - `listRunnerSessions()`
- `src/control/runner/runner-cli.ts`

#### Confirmed limitation: diagnostics report stored truth only

Exact locations:

- `src/agents/runtime/agent-service.ts:254-262`
- `src/control/runner/runner-debug-state.ts:18-42`
- `src/control/runner/runner-cli.ts`

Failure mode:

- live pane already has a valid native tool `sessionId`
- store still has no id, or the wrong id
- `/whoami`, `/status`, and `runner list` can only report the stored state

This is correct as a product truth surface, but it creates a debugging blind
spot unless the code also logs live-capture attempts and outcomes.

#### Confirmed limitation: operator ordering can be biased by non-identity writes

Code path:

- `runner list` ordering prefers `lastAdmittedPromptAt`, then `updatedAt`
- generic touch paths can update `updatedAt` even when identity health did not
  improve

Exact locations:

- `src/control/runner/runner-debug-state.ts:28-42`
- `src/agents/session/session-state.ts:55-72`
- `src/agents/session/session-state.ts:556-576`

Failure mode:

- null-capture or metadata-only touch refreshes an entry
- `runner list` floats that session higher
- operator reads recency as a sign of good continuity health when it may only
  mean the generic entry was touched

This is a diagnosis trap more than a core persistence bug, but it matters.

### 4. Persistence Write Seam

Primary code:

- `src/agents/session/session-state.ts`
  - `touchSessionEntry()`
  - `clearSessionIdEntry()`
  - `upsertSessionEntry()`
- `src/agents/session/session-store.ts`
  - `update()`
  - `touch()`

#### Confirmed hole: `touchSessionEntry()` is too permissive for identity writes

Exact locations:

- `src/agents/session/session-state.ts:55-72`

Failure mode:

- callers use a generic "touch" verb for bind-like behavior
- `sessionId: null` does not mean clear; it preserves the existing id
- successful bind, skipped capture, and metadata refresh all look too similar
  at the call site

This is why naming cleanup here is not cosmetic.

#### Confirmed hole: every generic entry rewrite also rewrites `workspacePath`

Exact locations:

- `src/agents/session/session-state.ts:560-576`

Failure mode:

- a non-mapping mutation such as runtime or queue or follow-up update rewrites
  the whole entry
- `workspacePath` is replaced from the current resolved target every time
- continuity tuple drift can happen without a dedicated mapping decision

That is dangerous for future rebind and workspace-switch features, and it also
makes current mapping writes harder to audit.

#### Confirmed race: store locking is in-process only

Exact locations:

- `src/agents/session/session-store.ts:30-31`
- `src/agents/session/session-store.ts:104-120`

Failure mode:

- two runtime processes point at the same `sessions.json`
- each process has its own in-memory path-lock map
- cross-process writes can still race and last-write-wins at the file level

This is not the first fix to make, but it is a real hole if multi-process
operation is possible.

#### Confirmed cleanup item: `SessionStore.touch()` was a duplicate seam

Exact locations:

- `src/agents/session/session-store.ts` before this cleanup

Failure mode:

- even unused duplicate write helpers keep the old vague mental model alive
- future contributors can reintroduce identity writes through a second generic
  path

This helper should not exist. It has now been removed to reduce seam sprawl.

### 5. Cleanup And Sunset Path

Primary code:

- `src/agents/runtime/runner-service.ts`
  - `runSessionCleanup()`

#### Confirmed hole: cleanup uses broad `updatedAt`, not identity-aware freshness

Exact locations:

- `src/agents/runtime/runner-service.ts:437-474`
- `src/agents/session/session-state.ts:55-72`
- `src/agents/session/session-state.ts:556-576`

Failure mode:

- metadata-only touches keep bumping `updatedAt`
- cleanup keeps an idle or unhealthy runner alive longer than intended

The reverse problem also exists:

- a live runner may still be useful outside recent clisbot writes
- `updatedAt` stays old
- cleanup kills the session even though the tool conversation is still active

So cleanup freshness and continuity freshness are currently conflated.

#### Confirmed race: cleanup is not coordinated with startup or capture

Exact locations:

- `src/agents/runtime/runner-service.ts:437-474`
- `src/agents/runtime/runner-service.ts:480-649`
- `src/agents/runtime/runner-service.ts:807-827`

Failure mode:

- cleanup lists sessions and decides one is stale
- concurrent startup reuse or `/new` capture begins on the same tmux session
- cleanup kills the session between liveness check and capture or submit
- startup path now looks flaky and may fall into retry or missing-id branches

There is no per-session coordination between cleanup and mapping-critical
flows today.

#### Confirmed follow-on risk: cleanup kills tmux but leaves stored id in place

Exact locations:

- `src/agents/runtime/runner-service.ts:470-473`

Failure mode:

- sunset kills the tmux process
- stored `sessionId` remains mapped to the `sessionKey`
- next startup attempts resume first, even if the backend-side conversation is
  no longer safely recoverable

This may still be acceptable policy, but it should be called out explicitly
because it shifts instability into the next startup rather than resolving it at
cleanup time.

## Persistence And Race Discipline

The next code task should improve persistence stability, but stop before
over-engineering.

### What Is Already Good Enough

- `SessionStore` already uses one in-process path lock per store path
- writes use temp-file plus rename
- one shared `sessions.json` file is still acceptable for phase 1

This means the storage backend itself is not the first thing to replace.

### What Is Still Weak

The higher-level write discipline is still too loose.

Examples:

- one semantic decision may span:
  - read entry
  - maybe capture
  - maybe retry
  - maybe cooldown
  - generic touch
- unsuccessful capture may still look like successful continuity refresh
- several branches still express similar write decisions through different
  wrappers

The result is not a low-level file race first.

It is a semantic race and ambiguity problem first.

### Minimum Persistence Rules For The Follow-Up

1. one continuity-owned semantic write seam for mapping decisions
2. one continuity-owned semantic clear seam
3. one continuity-owned semantic rotate or rebind seam
4. read-only control or transcript surfaces must not materialize or refresh mapping state
5. unsuccessful capture must not look like a successful mapping write
6. one session-key mapping decision should commit through one semantic path only
7. keep the file-level lock and atomic rename, but do not add a second store or cross-process lock layer yet

### Recommended Write Discipline

Fresh startup with explicit id:

- ready runner
- bind mapping once

Fresh startup with runner-created id:

- ready runner
- attempt bounded capture
- if capture succeeds, bind once
- if capture still fails, leave mapping absent and record truthful debug evidence without fake-success refresh

Existing live tmux session with missing stored id:

- bounded capture attempt under cooldown policy
- if capture succeeds, bind once
- if capture fails, do not pretend the mapping became healthier

`/new` rotation:

- trigger new runner conversation
- capture changed id
- rotate mapping once on success
- clear or preserve according to explicit command semantics on failure, but do not leave an ambiguous mixed state

Diagnostics or transcript:

- pure read only

### Non-Goals For This Fix

Do not overkill phase 1 with:

- second persistence file
- append-only event log
- distributed lock layer
- reverse index file
- full per-branch capture audit history in storage

The first goal is:

- make the single current continuity path obvious
- make failure modes diagnosable
- make stored `sessionId` behavior stable enough to trust again

### Minimal Debug Evidence Worth Adding

The next fix should also add enough debug evidence to stop future guesswork,
without turning this into a full observability project.

Recommended minimum:

- one structured log or debug event when capture is attempted:
  - `sessionKey`
  - `sessionName`
  - reason:
    - fresh startup
    - live reuse with missing stored id
    - `/new` rotation
    - recovery
  - result:
    - captured
    - null
    - skipped by cooldown
    - failed by runner error
- one structured log or debug event when continuity writes:
  - previous stored id
  - next stored id
  - semantic action:
    - bind
    - clear
    - rotate
    - rebind
- one test-only way to force:
  - capture miss
  - delayed capture
  - capture success after retry

That is enough to answer the main user complaint:

- "runner clearly received the chat, so why is `sessionId` still not stored?"

without adding a new storage model or event stream first.

## Detailed Proposed Change

### DRY/KISS Verdict For The Continuity Plan

The continuity fix should be stricter than the current draft on two points:

- do not introduce both a rich `sessionMapping` seam and a second public
  `storedSessionId` orchestration seam
- do not introduce one long list of public verb names when three grouped
  methods already explain the same model more simply

That would recreate the same ambiguity in nicer names.

The minimal public continuity API should be one grouped seam:

- `sessionMapping.get(sessionKey)`
- `sessionMapping.setActive(sessionRef, { sessionId, reason })`
- `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`

Use one separate grouped runner seam:

- `runnerSessionId.capture()`
- `runnerSessionId.parse()`

If code still needs a helper to mint an explicit id before launch, keep that
outside the runner seam as `createSessionId()`.

That is enough.

Why this is the smallest truthful set:

- `sessionMapping.get(...)` covers stored continuity read
- `sessionMapping.setActive(...)` covers first write, backfill, `/new` success,
  and explicit resume success
- `sessionMapping.clear(...)` covers explicit fresh start and failed resume or
  failed `/new` recovery
- `runnerSessionId.*` covers backend observation mechanics only

Do not add public `rotate...` or `rebind...` wrappers unless those flows later
grow materially different persistence behavior that a reader cannot infer from
the caller flow.

Today they are better expressed as:

- `/new`
  - trigger runner command
  - `runnerSessionId.capture(...)`
  - `sessionMapping.setActive(..., { reason: \"after-new\" })`
- explicit resume-by-id
  - start or attach runner
  - `sessionMapping.setActive(..., { reason: \"resume\" })`

Do not add a separate public `writeStoredSessionId()` if
`sessionMapping.setActive()` already exists.

Do not add a separate public `readStoredSessionId()` if
`sessionMapping.get()` already exists.

Do not add a separate public `clearStoredSessionId()` if
`sessionMapping.clear()` already exists.

Those scalar helpers may exist only as private implementation details if a
very narrow storage helper is still useful.

### What Each Method Actually Does

This is the part the current doc was underserving.

Readers should not have to guess whether a method talks to tmux, only mutates
runtime state, or writes `sessions.json`.

| Method | What It Does | What It Does Not Do |
| --- | --- | --- |
| `sessionMapping.get(sessionKey)` | Reads the stored continuity record for that `sessionKey` from `sessions.json`. | Does not inspect live tmux state. |
| `sessionMapping.setActive(sessionRef, { sessionId, reason })` | Writes the active stored mapping for that conversation: `sessionId`, `workspacePath`, `runnerCommand`, and `updatedAt`. This is the durable write seam. | Does not start a runner, capture a session id, or send `/new`. |
| `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })` | Clears the stored active `sessionId` for that conversation and usually resets persisted runtime projection to `idle`. This is also a durable write seam. | Does not kill tmux by itself. The caller may kill tmux before or after if that flow requires it. |
| `createSessionId()` | Produces an explicit session id in `SessionService` before launch when a backend accepts caller-supplied ids. | Does not persist anything by itself. |
| `runnerSessionId.capture()` | Reads runner output and extracts the live tool session id. | Does not persist anything by itself. |
| `runnerSessionId.parse()` | Parses candidate runner text for a session id. | Does not read or write storage. |

### `resolved` Is The Wrong Public Parameter

The previous proposal leaked `resolved` into public method signatures:

- `bindActiveSessionMapping(resolved, ...)`
- `clearActiveSessionMapping(resolved, ...)`

That is still too implementation-shaped.

`ResolvedAgentTarget` is an internal expanded runtime object. It currently
contains much more than continuity needs:

- `agentId`
- `sessionKey`
- `workspacePath`
- `sessionName`
- runner config
- stream config
- session config

That is useful inside `RunnerService`, but it is the wrong public seam for a
mapping API.

The continuity API should accept a much smaller value:

- `sessionKey` for reads
- `sessionRef` for writes

Recommended shape:

- reuse existing `AgentSessionTarget` for the caller's logical conversation id
- add a small `SessionRef` only where the write really needs persisted fields
  such as `workspacePath` and `runnerCommand`
- do not require callers to pass full runner or stream config just to write one
  stored mapping row

### Minimal Helper Split Below That API

Below the top-level continuity seam, keep only two narrow helper seams:

1. runner seam
   - `runnerSessionId.parse()`
   - `runnerSessionId.capture()`
2. session-side explicit-id helper seam when needed
   - `createSessionId()`
3. generic entry/store seam
   - `upsertSessionEntry()` as private generic entry mutation
   - `SessionStore.update()` as low-level persistence primitive

Everything else should usually be caller flow, not another orchestration
wrapper.

### Wrappers To Delete

These wrappers should be deleted because they mostly restate a multi-step
orchestration that the caller can express more clearly once the minimal API
exists:

| Current Wrapper | Delete Why |
| --- | --- |
| `persistStoredSessionId()` | duplicate of `sessionMapping.setActive(...)`; adds no boundary clarity |
| `syncStoredSessionIdForResolvedTarget()` | mixes read, cooldown, capture, and write into one opaque verb |
| `retryMissingStoredSessionIdAfterStartup()` | tiny retry policy wrapper; clearer inline near startup flow |
| `captureNewSessionIdentityAfterTrigger()` | special-case wrapper for one capture variation; better expressed as `runnerSessionId.capture({ requireChangeFrom })` |
| `clearSessionIdAfterNewSessionFailure()` | thin failure branch that only clears then throws |
| `SessionStore.touch()` | duplicate storage seam that encourages vague identity writes |

Delete rule:

- if the wrapper does not create a new boundary
- and it only hides a small branch or call order
- delete it and keep the flow explicit at the caller

### Wrappers To Keep

These wrappers should stay because they do mark a real boundary:

| Wrapper / Seam | Keep Why |
| --- | --- |
| `sessionMapping.get()` | canonical continuity read seam |
| `sessionMapping.setActive()` | canonical continuity durable write seam |
| `sessionMapping.clear()` | canonical continuity clear seam |
| `runnerSessionId.parse()` | runner-native parse seam, not storage policy |
| `runnerSessionId.capture()` | runner-native live capture seam, hides tmux-specific mechanics truthfully |
| `createSessionId()` | small session-side helper for explicit-id launch paths only |
| `captureTmuxSessionIdentity()` | backend-private transport helper below the public runner seam |
| `upsertSessionEntry()` | private generic entry mutation seam for queues, loops, runtime, follow-up, and recent conversation |
| `SessionStore.update()` | one low-level persistence primitive is simpler than many specialized store writers |

Keep rule:

- keep wrappers only when they mark a stable boundary
- keep wrappers only when the caller should not care about lower-level
  mechanics
- keep wrappers only when the semantic name is clearer than the inline flow

### Smallest Canonical Call Shape

Under DRY/KISS, the target call shape should look boring:

- startup with explicit id
  - `createSessionId()` if backend supports caller-supplied ids
  - start runner
  - `sessionMapping.setActive(..., { reason: "startup" })`
- startup with runner-created id
  - start runner
  - `runnerSessionId.capture(...)`
  - `sessionMapping.setActive(..., { reason: "startup" })` on success
- failed resume recovery
  - `sessionMapping.clear(..., { reason: "resume-failed" })`
  - retry startup
- `/new`
  - trigger tool command
  - `runnerSessionId.capture(...)`
  - `sessionMapping.setActive(..., { reason: "after-new" })`
- explicit resume-by-id
  - lookup target mapping
  - `sessionMapping.setActive(..., { reason: "resume" })`

If the final implementation needs more top-level continuity wrappers than
that, it is probably growing orchestration duplication again.

### Phase 1: Clarify Continuity API Without Big Ownership Change

Goal:

- make code match the accepted docs
- do not change public mental model again
- do not split persistence files yet

Recommended shape:

1. keep `SessionStore` as the physical JSON persistence owner
2. keep `RunnerService` as the backend session-id mechanics owner
3. add one narrower continuity-owned semantic API in the agents layer

The simplest low-drift way is likely:

- either extend `AgentSessionState` with mapping-specific methods
- or add a small dedicated continuity helper next to it

Minimum semantic methods:

- `sessionMapping.get(sessionKey)`
- `sessionMapping.setActive(sessionRef, { sessionId, reason })`
- `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`

The important point is not the class name.

The important point is:

- queue or loop or follow-up updates should stop looking like mapping updates
- mapping updates should stop looking like generic full-entry rewrites
- reverse lookup by `sessionId` does not need its own public orchestration seam
  yet; one private lookup helper is enough until explicit resume ships

### Phase 2: Move Current Runner Mutations Onto That API

After phase 1 exists, refactor `RunnerService` to call only the semantic
continuity methods for mapping changes.

Expected touch points:

- `finalizeSessionStartup()`
- `syncStoredSessionIdForResolvedTarget()`
- `retryFreshStartAfterStoredResumeFailure()`
- `restartRunnerWithFreshSessionId()`
- `triggerNewSessionInLiveRunner()`
- `clearSessionIdAfterNewSessionFailure()`

This is where the code becomes much easier to reason about:

- runner still decides launch or capture or resume mechanics
- session continuity becomes the only place that says:
  - what active mapping now is
  - when it is cleared
  - what persisted tuple belongs to that `sessionKey`

### Phase 3: Add Explicit User-Controlled Rebind Surface

This is the missing product behavior behind the new docs.

Minimal task shape:

- parser and help in `src/agents/commands/commands.ts`
- command execution in `src/channels/message/interaction-processing.ts`
- auth check before rebinding
- session-layer lookup by `sessionId`
- explicit rebind of current `sessionKey` to that target `sessionId`

Minimum command set:

- `/sessions list`
- `/sessions status`
- `/sessions resume <session-id>`

The critical rule:

- no hidden auto-rebind in normal chat flow
- remap only on explicit user or operator action

### Phase 4: Decide Workspace Rebind Policy Explicitly

Do not hide workspace switching inside `/sessions resume <id>`.

Policy decision needed first:

- must the target workspace equal the current routed workspace
- or may policy allow workspace switch at the same time

Current recommendation:

- phase 1 explicit session rebind should stay same-workspace unless policy says
  otherwise
- workspace rebinding should remain a later separate action or clearly gated
  option

## Proposed Task Breakdown

The next implementation task should be split like this:

1. continuity API cleanup
   - add semantic mapping methods
   - stop using broad generic mutation names for mapping-specific writes

2. runner integration cleanup
   - replace direct `touchSessionEntry()` or `clearSessionIdEntry()` mapping
     writes with the semantic continuity API
   - keep backend mechanics in runner code

3. naming cleanup aligned to the final owner model
   - rename top-level continuity seams around grouped `sessionMapping`
   - rename runner-native helper seams around grouped `runnerSessionId`
   - move explicit-id generation out of the runner seam
   - delete or demote vague public helper names such as `sync...`, `touch...`,
     and generic `createSessionId` or `extractSessionId`

4. explicit session-management commands
   - add parser, help, auth, execution, and user-facing messages

5. reverse lookup contract
   - pick one lookup strategy
   - document it
   - test it

6. persistence stability pass
   - remove misleading refresh-only writes from read-only flows
   - ensure null capture does not look like successful persistence
   - keep in-process locking and atomic rename, but avoid bigger storage design churn

7. follow-up verification
   - tests
   - canonical docs if command surface ships
   - release note if user-visible behavior changes

## Recommended Patch Order For The Critical Bug

If the goal is to stop the unstable "not stored" behavior with the least
confusion, the safest order is:

1. name the seams correctly
   - make top-level continuity, runner capture, and narrow storage helpers easy
     to tell apart
2. remove misleading read-only or refresh-only writes
   - diagnostics and transcript paths must stay pure read
3. tighten the single continuity write discipline
   - make bind or clear or rotate decisions explicit
4. harden startup and reuse capture branches
   - especially null-capture and retry paths
5. only then add explicit `/sessions ...` controls

Why this order:

- if we add more control surface before naming and persistence are cleaned up,
  we will multiply the same ambiguity into more entry points
- if we rename without tightening write discipline, the code will read better
  but still fail in the same confusing way

## Required Tests For The Follow-Up Task

At minimum, the next code task should add or update tests for:

- runner receives a prompt and later transcript shows a native id, but stored
  `sessionId` remains absent:
  - prove which branch owns the miss
  - prove the failure is surfaced truthfully
- explicit rebind of current `sessionKey` to an earlier stored `sessionId`
- `/new` then `/sessions resume <old-id>` on the same routed surface
- two chat surfaces sharing one `sessionKey` and observing the same active
  mapping
- two different `sessionKey` values where one is explicitly rebound to a
  previously used `sessionId`
- unauthorized resume attempt
- resume attempt for unknown `sessionId`
- resume attempt blocked by workspace policy when workspace switching is not
  allowed
- diagnostics remain read-only and do not mutate continuity state
- transcript remains read-only and does not mutate continuity state
- null capture path does not fake a healthy continuity refresh through broad
  generic metadata writes

## Final Audit Position

The accepted public story is now stable.

The code problem is narrower and more actionable than "runner owns mapping":

- continuity ownership is basically in the right architectural layer already
- runner ownership of backend-specific mechanics is also basically correct
- the real implementation gap is now threefold:
  - lack of one explicit continuity API
  - naming drift that hides top-level seams versus helper seams
  - persistence discipline that still lets null or partial capture paths look
    healthier than they are

That is what the next task should fix.

## Standard

### 1. Normal Chat Flow

Default flow:

1. channel resolves `agentId` and `sessionKey`
2. channel sends only that session target
3. session continuity loads the current mapping for that `sessionKey`
4. runner resumes the mapped `sessionId` when supported
5. if no mapping exists, session continuity either:
   - generates one for a backend that supports caller-supplied ids
   - or asks the runner to capture the tool-created id
6. session continuity persists the resulting active mapping

Normal messages should not need to pass `sessionId`.

### 2. External Session Id Input

Required rule:

- runner input requires `sessionKey`
- runner input may also accept `sessionId`
- if a backend supports caller-supplied `sessionId`, session continuity may
  pass one through runner capability
- if a backend does not support that path, runner must either:
  - create or capture its own `sessionId` and return it for persistence
  - or fail truthfully

After a successful mapping exists, later requests should use `sessionKey` only
again unless an explicit privileged action changes the mapping.

### 3. Exact Session Id Targeting

Exact `sessionId` use should exist only as an explicit privileged action.

Short spec:

> By default, each chat continues in its own session. When needed, an
> authorized user can explicitly resume an earlier session by session id. For
> example, this lets someone return to a previous session after `/new`, or
> continue an active coding session from another device by switching to the
> same workspace and resuming that session.

Important nuance:

- by default one routed surface maps to one `sessionKey`
- routing policy may intentionally let multiple chat surfaces continue the same
  `sessionKey`
- if two surfaces already share the same `sessionKey`, they are already using
  the same continuity bucket and do not need a special rebind path
- explicit session resume matters when the current surface resolves to a
  different `sessionKey`, or when the same `sessionKey` should point back to an
  older `sessionId`

Rules:

- not a hidden fallback in ordinary channel message handling
- auth checked first
- current chat surface binds to that exact `sessionId` only on explicit request

Primary use cases:

- user starts a new session with `/new`, then decides to return to the earlier
  session by calling `/sessions resume <session-id>`
- user is actively coding in a local CLI session, then later wants to continue
  from a phone by switching the coding agent to the same workspace and calling
  `/sessions resume <session-id>`

This is the shape needed for commands such as:

- `/sessions list`
- `/sessions status`
- `/sessions <id>`

The exact command design can come later.

### 4. Workspace Switching

Workspace switch should also be explicit.

Rules:

- ordinary routed chat does not switch workspace implicitly
- a later privileged action may request a different workspace or project
- that path is allowed only when agent policy explicitly permits it

This is the shape needed for commands such as:

- `/projects list`
- `/projects status`
- `/projects <name|id|workspace>`

Again, this doc sets the rule first, not the full command design.

## Current Truth Vs Target

| Topic | Current Truth | Target Direction |
| --- | --- | --- |
| Normal chat input | Channel code derives `sessionKey` from the current surface and sends that into execution. | Keep this exactly as the default path. |
| `sessionId` creation and capture | Runner code already does this. | Keep this in runner code. |
| `session mapping` write path | Mixed today: runner logic decides values, but generic agent session-state helpers still write them. | Move to one clearer session-layer-owned semantic API that uses runner capability under the hood. This is a real code task, not only doc cleanup. |
| `workspacePath` in the mapping | Stored in the same session entry and often rewritten through generic full-entry updates. | Treat it as part of continuity for that explicit mapping, changed only on privileged actions. |
| Session lookup by `sessionId` | No direct index; current storage is keyed by `sessionKey`, so reverse lookup implies a scan. | Add one explicit lookup strategy and document it. |
| Explicit session resume | Not available as ordinary chat behavior. A chat keeps using its own `sessionKey` unless a user or operator explicitly resumes a previous `sessionId`. | Allow an authorized user to explicitly resume an earlier session by session id, including after `/new` or from another surface or workspace when policy allows. |
| Workspace switch | Not implemented as a general feature. Current workspace comes from agent resolution and stored session entry updates. | Add only as an explicit policy-gated action. |
| Canonical docs | They should keep continuity session-owned while making runner-specific `sessionId` mechanics explicit. | This doc handoff is now done; the remaining work is mainly implementation and control-surface design. |

## Ownership

Keep the split simple:

- channels own surface -> `sessionKey`
- `SessionService` owns continuity under `sessionKey`
- `SessionService` owns the active `sessionKey -> sessionId` mapping
- runner provides backend-specific `sessionId` mechanics
- agents own queue or loop or follow-up or runtime projection tied to
  `sessionKey`
- agents still gate workspace policy and route admission

This does not mean runner owns the whole session record.

Do not move queue or loop or follow-up ownership into runners.
Do prefer one clearer continuity API for `sessionId` mapping instead of broad
generic helpers.

## Persistence

Mandatory:

- one clear continuity-owned write path for the `session mapping`
- one clear continuity-owned read path for the `session mapping`
- one clear continuity-owned clear path for the `session mapping`
- runner capability paths for explicit-id launch or capture or resume
- one active `sessionId` per `sessionKey`
- truthful failure when a backend cannot honor caller-supplied `sessionId`

Mandatory for phase 1:

- keep `sessions.json` as the physical file for now
- do not introduce a second file just to make ownership look cleaner on paper
- change the narrative and API clarity first

This is the smallest migration:

- no file split yet
- no duplicate shadow copy
- no double-write period

Optional later:

- a dedicated runner mapping file if the shared file later proves too coupled
- a reverse index for `sessionId` if scan-based lookup becomes too costly or
  too risky
- richer `/sessions ...` and `/projects ...` control surfaces after the owner
  model is accepted

## Hidden Assumptions

- One `sessionKey` currently also means one queue bucket, one loop bucket, one
  follow-up state, and one runtime projection. Explicitly resuming a session
  onto a different surface needs a clear rule for whether the new surface
  reuses that whole bucket or only reuses the runner conversation.
- `workspacePath` is not just a label. It affects runner cwd, attachment
  storage, `LOOP.md`, and other workspace-local behavior. A workspace switch is
  therefore a behavior change, not just a mapping edit.
- The current store is keyed by `sessionKey`, not `sessionId`. So `/sessions
  <id>` needs either a reverse index or a documented scan path.
- Today there is no dedicated permission surface for "rebind this chat surface
  to another session" or "switch this session to another workspace". That
  policy must be defined explicitly rather than folded into unrelated admin
  powers by accident.
- The doc assumes one active `sessionId` per `sessionKey`. Exact
  `sessionId` targeting should therefore rebind or fail, not quietly create two
  active runner conversations for one logical session.
- The reverse invariant from `sessionId` back to one unique `sessionKey` at the
  same moment is not yet a stable public contract and can stay undecided for
  now.

## Files To Review

| File | Why It Matters | Direction |
| --- | --- | --- |
| `docs/features/agents/sessions.md` | Canonical session model and runner input contract. | Keep aligned with the accepted decision record. |
| `docs/architecture/domain-language.md` | Canonical language and boundary guidance for cross-layer models. | Check that the mapping move still preserves the repo boundary rules. |
| `docs/architecture/runtime-architecture.md` | Runtime owner map between channels, agents, and runners. | Keep broad session continuity in agents and describe runner mechanics as capability, not mapping owner. |
| `docs/architecture/domain-language.md` | Shared meaning of `sessionKey` and `sessionId`. | Keep terms stable. |
| `src/channels/slack/session-routing.ts` | Slack `sessionKey` resolution. | Keep `sessionKey`-only default. |
| `src/channels/telegram/session-routing.ts` | Telegram `sessionKey` resolution. | Keep `sessionKey`-only default. |
| `src/channels/message/interaction-processing.ts` | Channel-to-runner handoff. | Keep exact `sessionId` use out of normal chat flow. |
| `src/agents/runtime/runner-service.ts` | Current launch or capture or resume owner. | Keep it as backend-specific capability owner. |
| `src/agents/session/session-identity.ts` | Current generic explicit-id and parse helpers. | Split naming so explicit-id creation is session-side and parsing is runner-side. |
| `src/agents/session/session-state.ts` | Current mixed session entry mutation layer. | Narrow generic helper use around `sessionId` mapping as part of follow-up code work. |
| `src/agents/session/session-store.ts` | Current physical persistence file writer. | Keep as storage engine in phase 1. |
| `src/runners/tmux/session-handshake.ts` | Current backend-private tmux capture implementation. | Keep backend-private and nest it under a clearer runner seam. |
| `src/control/runner/runner-cli.ts` | Operator session diagnostics. | Later show exact mapping and rebinding truthfully. |

## Rollout

### Phase 1

- finish audit and canonical-doc alignment
- use this audit as direct task input
- do not reopen the public ownership model unless new code evidence requires it

### Phase 2

- implement one clearer continuity-owned `session mapping` API
- implement the naming cleanup that makes the new seam obvious on first read
- remove or reduce broad generic helper drift around `sessionId`
- keep physical storage in `sessions.json` first

### Phase 3

- design and ship explicit control surfaces such as `/sessions ...`
- define auth and failure behavior for exact rebinding and workspace switch

### Phase 4

- add tests for:
  - external `sessionId` accepted on supported backends
  - truthful failure on unsupported backends
  - exact `sessionId` rebinding
  - allowed and denied workspace switch

## Rollout Risks

- doc drift while wording changes are half-applied across architecture,
  features, glossary, and audits
- code drift if a later refactor narrows helper paths incompletely and leaves
  two competing `sessionId` mutation paths
- hidden behavior regressions if `workspacePath` moves under a new semantic API
  without checking attachments, loops, and runner cwd behavior
- operator confusion if `/whoami` or `/status` still speak in
  `storedSessionId` terms while ownership language changes elsewhere
- accidental broad permission if session rebind and workspace switch are
  shipped before their auth boundary is defined separately

## Open Questions

- Should the continuity-owned `session mapping` stay inside `sessions.json`
  long term, or be split only if future churn proves it necessary?
- Which agent policy flag should gate workspace switching for `/projects ...`
  style controls?
- Should `/sessions <id>` be allowed only when the current `sessionKey` is
  idle, or can it interrupt a detached but still recoverable mapping?
