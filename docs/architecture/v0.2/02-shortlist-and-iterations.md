# Shortlist And Iterations

Source of truth for this document:

- `docs/overview/human-requirements.md`

This file compares the five candidates, keeps only the best three, and iterates them by borrowing strengths from the discarded options.

## Decision Factors

| Factor | Why it matters |
| --- | --- |
| Mental-model clarity | The human should be able to explain the design without implementation detail. |
| Owner truthfulness | Each important decision should have one obvious owner. |
| Session-first fit | The requirements define session as a primary concept. |
| Surface separation | Slack thread / Telegram topic should not collapse into session identity. |
| Runner extensibility | tmux CLI now, API/SDK/ACP later. |
| Queue / steer / loop fit | These are first-class concepts, not optional add-ons. |
| Backlog / fresh-session support | Global work outside one session must fit naturally. |
| KISS | Do not introduce heavy machinery unless clearly justified. |
| Capacity control | Runner pool or similar cap must have a clean home. |

## Shortlist

The best three are:

1. **Candidate D. Layered Control Plane + Runner Adapters**
2. **Candidate A. Session-Centric Core**
3. **Candidate C. Workflow-Centric Core**

## Why Candidate B Was Removed

- It overweights chat surface.
- It weakens the session concept too early.
- It is worse for future API surfaces where no Slack or Telegram route exists.

## Why Candidate E Was Removed

- It has strong isolation, but too much structural weight.
- The owner model is good, but the actor packaging is too expensive for now.

## Iteration Round 1

### Upgrade D with the best parts of A and C

Add from A:

- session remains a named first-class aggregate, not a generic middle layer blob
- session-scoped queue and session-scoped loops are explicit

Add from C:

- backlog and global loop concepts are modeled as workflow objects, not hidden special cases

Result:

- D becomes the strongest balanced candidate
- risk remains: too many sub-objects if naming is not kept strict

### Upgrade A with the best parts of D and E

Add from D:

- separate `RunControl` from `Session`
- separate `RunnerAdapter` from `RunControl`

Add from E:

- owner rule: `Session` must not directly mutate runner internals

Result:

- A becomes much cleaner
- but once `RunControl` is separated, A starts converging toward D

### Upgrade C with the best parts of A and D

Add from A:

- session stays first-class, not just an execution container

Add from D:

- workflow logic should not own runner adapter details

Result:

- C becomes more usable
- but it still feels secondary to a session-first architecture

## Iteration Round 2

After iteration, the shortlist becomes:

1. **D+**
   Layered architecture with explicit `Session`, `RunControl`, `Runner`, `Backlog`, and `Workload`.
2. **A+**
   Session-centric model with `RunControl` extracted out.
3. **C+**
   Workflow-centric model with stronger session identity.

## Re-selection

### Winner: D+

D+ wins because:

- it preserves session as first-class
- it keeps surface separate from session
- it keeps run lifecycle separate from session workflow
- it keeps raw executor details separate from run control
- it gives a clean home to queue, steer, loops, backlog, and pool
- it is the easiest to turn into a “where should this belong?” FAQ

### Why A+ Lost

- once cleaned up, it mostly becomes a less explicit version of D+
- it still pulls too much gravity toward `Session`

### Why C+ Lost

- great for workflow sophistication
- weaker for the primary conversation mental model

## Final Upgrade Pass For D+

Borrow the last strong parts from the discarded options:

From A+:

- use simple names and keep `Session` primary inside the session layer

From C+:

- recognize that queue, backlog, and loops are workflow concepts and should not leak into runner logic

From E:

- add a strict owner rule: each layer may decide only its own kind of truth

From B:

- keep `ChatSurface` explicit so threads/topics are not collapsed into session identity

## Final Validation Before Writing The Final Doc

| Requirement | Final D+ result |
| --- | --- |
| R1 | Covered by `Session` in session layer |
| R2 | Covered by explicit surface layer |
| R3 | Covered by runner layer |
| R4 | Covered by “manager only when multiplicity needs policy” rule |
| R5 | Covered by run control state machine |
| R6 | Covered by session queue in session layer |
| R7 | Covered by steering path in run control layer |
| R8 | Covered by backlog object outside any one session |
| R9 | Covered by session-bound loops and global loops |
| R10 | Covered by workload layer / runner pool |

No uncovered human requirement remains in this v0.2 pass.
