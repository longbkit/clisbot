# Session Key And Session Id Continuity Decision

## Status

Accepted

## Date

2026-05-01

## Purpose

Record the stable architecture decision for how `clisbot` should talk about:

- `sessionKey`
- `sessionId`
- continuity ownership
- runner-specific session-id mechanics

This is the stable decision record for this topic.

## Decision

Keep the public mental model simple:

- channel decides which conversation this chat goes into through `sessionKey`
- `SessionService` owns that conversation and its current mapping
- runner code connects that conversation to the correct native tool session through `sessionId`
- default chat stays simple; mapping normally changes only when the user or operator explicitly triggers it, such as `/new` or a future explicit session resume flow

Answer the common reader questions directly:

- Who owns the active mapping?
  - `SessionService`
- Where does `sessionId` come from?
  - either the native tool creates it, or `SessionService` chooses one
- Who only uses that value?
  - `RunnerService` and the lower-level backend files such as
    `src/runners/tmux/*`

## Rules

### 1. `sessionKey`

- `sessionKey` is the clisbot-side conversation key
- by default one routed surface maps to one `sessionKey`
- routing policy may intentionally let multiple chat surfaces continue the same `sessionKey`

Examples:

- one personal conversation shared across Slack DM and Telegram DM
- a Slack channel and Slack thread intentionally collapsed into one conversation

### 2. `sessionId`

- `sessionId` is the current native tool conversation id attached to that `sessionKey`
- at one moment, one `sessionKey` maps to one active `sessionId`
- over time, that same `sessionKey` may rotate to a different `sessionId`

Examples:

- `/new`
- explicit resume or rebind
- backend reset or expiry

The reverse invariant from `sessionId` back to one unique `sessionKey` is not a stable public contract yet.

### 3. Ownership

- channels own surface identity and route resolution
- `SessionService` owns the active `sessionKey -> sessionId` mapping
- runners own backend-specific `sessionId` pass-through or capture or resume mechanics

This means runners do not own the public continuity model.

They provide the backend-specific operations that the continuity owner uses.

### 4. Persistence

- keep the physical continuity store in `sessions.json` for now
- do not split files just to force a cleaner ownership story on paper
- prefer one clearer continuity-owned mapping API over broad generic helper drift

### 5. User-Facing Simplicity

Users usually should not need to think about `sessionId`.

The normal path is:

- keep chatting
- the current `sessionKey` continues automatically
- the current active `sessionId` is reused when possible

Only explicit actions should normally change the mapping:

- `/new`
- future explicit `/sessions resume <id>` style flows
- future policy-gated cross-surface or workspace rebinding

### 6. Diagnostic Read Surfaces

For operator and chat diagnostics such as:

- `clisbot runner list`
- `clisbot runner watch`
- `/whoami`
- `/status`

the read rule should be:

- prefer the current `sessionId` from runtime memory when one active live run
  already knows it
- also show whether that value is already persisted
  - `(persisted)`
  - `(not persisted yet)`
- if runtime memory and persistence disagree, show the runtime value first
  because it is the fresher truth for the current live session

This keeps the read surfaces honest during the small window between capture and
durable persistence.

### 7. Smart Persistence

When runtime memory knows a newer `sessionId` than persistence:

- try to persist it as early as practical
- do not wait until unrelated later status reads if the write can happen during
  the startup or rotation flow
- do not re-persist the same unchanged `sessionId` on every watch poll, status
  render, or repeated read surface

The goal is:

- persist early enough to avoid losing the id
- avoid noisy repeated writes when nothing changed

## Why

This keeps the system aligned with the actual operator mental model:

- queue, loop, follow-up, and continuity are all anchored on `sessionKey`
- backend quirks still stay in runner code
- public docs do not push users toward backend-native concepts they usually do not need
- later code cleanup can narrow the mapping API without changing the public story

## Consequences

### Immediate

- docs should describe continuity as `SessionService`-owned
- audit docs should stop promoting `runner owns mapping` as the target direction
- runner docs should describe backend-specific mechanics as capability, not public continuity ownership
- public continuity docs should prefer one grouped `sessionMapping` seam over a long list of free-standing verb-prefixed function names
- public continuity docs should not expose `ResolvedAgentTarget` as the parameter type for mapping writes

### Later

- code may still benefit from a clearer mapping API
- explicit session resume and workspace-switch controls still need separate product and auth design
- reverse lookup or reverse uniqueness rules can be decided later if needed

## Known Implementation Gap

The accepted architecture is clearer than the current code shape.

Current code still leaks part of continuity work into
`src/agents/runtime/runner-service.ts`, including:

- minting explicit `sessionId` values for explicit-id launch paths
- reading stored continuity directly before startup or recovery decisions
- writing and clearing stored mapping state through session-state helpers

That is an implementation gap, not a reason to change the architecture.

The follow-up direction is:

- keep `sessionId` source ownership on the native tool or in `SessionService`
- keep continuity mutation semantics in `SessionService`
- keep runner code focused on backend launch or capture or resume mechanics

## API Naming

If code wants one public continuity seam, keep it boring and group it by
mental model:

- `sessionMapping.get(sessionKey)`
- `sessionMapping.setActive(sessionRef, { sessionId, reason })`
- `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`

Keep runner-native mechanics in a separate group:

- `runnerSessionId.capture()`
- `runnerSessionId.parse()`

If code still needs a helper to mint an explicit id before launch, keep that in
`SessionService` or a small session-owned helper. Keeping the existing
`createSessionId()` name is fine; the ownership boundary matters more than a
rename.

Naming note:

- avoid `persistStoredSessionId` as the public mental-model name
- many readers treat `persist` and `write` as almost the same
- use names that answer what changed, such as `setActive` or `clear`

Why this is preferred over names such as
`bindActiveSessionMapping(resolved, ...)`:

- `setActive` answers the reader's first question directly: this writes the
  active stored mapping
- `bind` is too abstract; many readers will still ask "bind what to what, and
  is this durable?"
- if the first follow-up question is "what is `resolved`?" the API is already
  too leaky
- `resolved` leaks a large internal type into a seam that only needs a small
  write reference
- `/new` and explicit resume are caller flows, not separate public wrapper
  names by default

Recommended parameter rule:

- reads take `sessionKey`
- writes take a small `sessionRef`
- `ResolvedAgentTarget` stays internal to runtime code that truly needs full
  expanded runner/session config

## Related Docs

- [Architecture Overview](../architecture-overview.md)
- [Runtime Architecture](../runtime-architecture.md)
- [Domain Language](../domain-language.md)
- [Session Identity](../../features/agents/sessions.md)
- [Session Key And Runner Session Id Audit](../../audits/agents/2026-05-01-session-key-and-runner-session-id-audit.md)
