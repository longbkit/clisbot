# Architecture artifact format

Use plain language before internal terms. A plan audit records investigation and
recommendation; an ADR records one accepted decision; canonical contracts state
the current or explicitly labeled target rule. None substitutes for the others.

## Plan audit

Name the file:

```text
docs/audit/YYYY-MM-DDThhmm+TZ-<scope>-architecture-plan.md
```

Required header:

```md
# <timestamp> architecture plan — <scope>

- Mode: plan | decide | auto
- Status: proposed | accepted | implemented | superseded
- Scope: <complete owner chain and exclusions>
- Baseline: <commit plus dirty-tree note>
- User outcome: <observable job>
- Canonical sources: <contracts and accepted ADRs>
- Current proof: <code paths, tests, commands>
- Decision: pending | [ADR-NNN](../adr/ADR-NNN-....md)
```

Required sections:

1. Executive answer.
2. Concrete current user flow.
3. Current capability proof from code and tests.
4. Owner map: identity, State/Data/Command, lifecycle, persistence, authority.
5. Contract-versus-code ledger with `CURRENT`, `TARGET`, `GAP`, or `HISTORICAL`.
6. Consumer pressure tests.
7. Options and trade-offs.
8. Recommendation and non-goals.
9. Open-decision ledger.
10. Wire/code/package impact and migration order.
11. Verification and Definition of Done.
12. Status history.

Decision ledger:

| Decision | Status | Recommendation or accepted outcome | Owner | ADR | Proof |
|---|---|---|---|---|---|

Use `open`, `accepted`, `rejected`, or `superseded`. Never mark a row accepted
before an ADR or an already-existing canonical decision owns it.

## ADR

Allocate the next number only after listing current `docs/adr/ADR-*.md` files.
Recheck immediately before writing to avoid a collision.

```md
# ADR-NNN — <decision title>

**Status:** Accepted
**Date:** YYYY-MM-DD
**Plan audit:** [<label>](../audit/<file>.md)
**Scope:** <owner chain>

## Context

<Current behavior, user need, and exact gap.>

## Decision

<Numbered decisions with identity, owner, lifecycle, authority, persistence,
wire compatibility, and migration policy.>

## Consequences

<Positive consequences, costs, and operational implications.>

## Rejected alternatives

<Alternative plus evidence-based rejection reason.>

## Implementation and proof

<Order, tests, gates, rollout, rollback, and completion condition.>
```

An ADR says `Accepted`, not `Implemented`. The plan audit carries implementation
status. If an accepted decision is replaced, create a new ADR, mark the old ADR
`Superseded by ADR-NNN`, and update both links.

## Status transitions

```text
plan created             -> audit: proposed, decision: pending
decision accepted        -> audit: accepted, ADR: Accepted, links both ways
implementation started   -> audit remains accepted; record work item/status
all proof passes         -> audit: implemented; record verification
decision replaced        -> audit: superseded; old ADR points to replacement
```

Do not rewrite history to make a proposal look accepted earlier than it was.
