# Naming audit format

Use plain language before code terms. Mark every statement as current evidence,
proposal, accepted decision, or historical context. Never let an old audit silently
override a current contract.

## Required header

```md
# <timestamp> naming <plan|decision|review> — <scope>

- Mode: plan | decide | review
- Scope: <paths and concept family>
- Baseline: <commit and dirty-tree note>
- User outcome: <reader/change cost to reduce>
- Canonical sources: <domain, naming, owner contracts>
- Evidence: <inventory commands, call paths, tests, tasks/history>
```

## Executive answer

In five to ten lines state:

- the actual naming problem;
- what is already canonical and must stay;
- the recommended or accepted concept map;
- what remains open or is explicitly out of scope.

## Concept cards

```md
### C1 — <candidate concept>

`<name>` is a <artifact role> owned by <owner> that <job> during <lifecycle>;
it is not <nearest confusing alternative>.
```

Include identity, lifecycle, positive examples, negative examples, and the reason
the concept exists separately.

## Inventory

Record exact commands and summarize complete counts before samples.

| Evidence set | Current names | Locations/roles | What it proves |
|---|---|---|---|
| Exact uses | ... | ... | ... |
| Same-role siblings | ... | ... | ... |
| Similar logic/lifecycle | ... | ... | ... |
| Collisions/aliases/history | ... | ... | ... |

## Candidate matrix

| Candidate | Existing precedent | Familiarity | Semantic fit | Family consistency | Bias/collision | Migration cost | Verdict |
|---|---|---|---|---|---|---|---|

Do not use unsupported numeric scores. Prefer `strong`, `mixed`, or `weak` with a
short reason.

## Findings or rename map

Use stable ids and one action: `KEEP`, `REUSE`, `MERGE`, `SPLIT`, `MOVE`, `RENAME`,
`RATIFY`, or `REJECT`.

```md
### N1 — <reader-visible issue> — <ACTION>

- Current: <name, role, owner, paths>
- Reader cost: <ambiguity, extra search, duplicate concepts>
- Evidence: <inventory and causal trace>
- Recommendation: <smallest coherent change>
- Cross-layer impact: <DB/wire/code/files/UI/docs/tests>
- Compatibility: <atomic cutover, migration, or bounded alias removal>
- Proof: <checks and observable acceptance>
- Status: proposed | accepted | rejected | reviewed-no-change
```

## Decision ledger

Required in `decide` mode and retained when a plan later becomes accepted.

| Decision | Status | Canonical name | Definition/owner | Rejected alternatives | Docs updated | Enforcement/removal gate |
|---|---|---|---|---|---|---|

## Implementation order

For a rename, order work by source of truth and dependency:

1. ratify meaning and convention;
2. migrate persisted/external identity if any;
3. rename the canonical owner and consumers atomically;
4. remove old aliases and paths;
5. update tests, docs, fixtures, generated output, and evidence;
6. run focused behavior proof plus naming/architecture gates.

## End state

- Accepted language and its canonical owner.
- Open decisions in dependency order.
- Before/after concept and owner count.
- Compatibility debt and removal date/gate, if any.
- Exact verification result.
