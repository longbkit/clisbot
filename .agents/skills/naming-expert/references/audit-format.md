# Naming artifact routing and format

Use plain language before code terms. Mark statements as current evidence,
proposal, accepted decision, or historical context. Never let research or an
old audit silently override current architecture.

## Choose the artifact owner

| Need | Location |
| --- | --- |
| Read-only review requested only in conversation | no persistent artifact |
| Source-driven naming proposal | relevant `docs/research/<feature>/` folder |
| Repository conformance snapshot | relevant `docs/audits/` folder |
| Active rename implementation | dated task under `docs/tasks/` |
| Repository-wide accepted naming decision | `docs/architecture/decisions/` |
| Feature-local accepted naming decision | `docs/features/<feature>/decisions/` |
| Canonical term or representation | `domain-language.md` or `naming-conventions.md` |

Use `yyyy-MM-dd-short-slug.md` for new dated artifacts. Link instead of copying
large evidence sections between research, decisions, features, and tasks.

## Required header

```md
# <date> naming <plan|decision|review> — <scope>

- Mode: plan | decide | review
- Status: proposed | accepted | reviewed | superseded
- Scope: <paths and concept family>
- Baseline: <commit and dirty-tree note>
- User outcome: <reader or change cost to reduce>
- Canonical sources: <domain, naming, architecture, feature contracts>
- Evidence: <inventory commands, call paths, tests, history>
```

## Executive answer

State briefly:

- the actual naming problem;
- what is canonical and must stay;
- the recommended or accepted concept map;
- what remains open or out of scope.

## Concept cards

```md
### C1 — <candidate concept>

`<name>` is a <artifact role> owned by <owner> that <job> during <lifecycle>;
it is not <nearest confusing alternative>.
```

Include identity, lifecycle, examples, counterexamples, and why the concept is
separate.

## Inventory

Record exact commands and complete counts before samples.

| Evidence set | Current names | Locations/roles | What it proves |
| --- | --- | --- | --- |
| Exact uses | ... | ... | ... |
| Same-role siblings | ... | ... | ... |
| Similar ownership/lifecycle | ... | ... | ... |
| Collisions/aliases/history | ... | ... | ... |

## Candidate matrix

| Candidate | Existing precedent | Familiarity | Semantic fit | Family consistency | Bias/collision | Migration cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |

Do not use unsupported numeric scores. Prefer `strong`, `mixed`, or `weak` with
a short reason.

## Findings or rename map

Use stable ids and one action: `KEEP`, `REUSE`, `MERGE`, `SPLIT`, `MOVE`,
`RENAME`, `RATIFY`, or `REJECT`.

```md
### N1 — <reader-visible issue> — <ACTION>

- Current: <name, role, owner, paths>
- Reader cost: <ambiguity, search cost, duplicate concepts>
- Evidence: <inventory and causal trace>
- Recommendation: <smallest coherent change>
- Cross-layer impact: <CLI/config/store/API/code/UI/docs/tests>
- Compatibility: <atomic cutover, migration, or bounded alias removal>
- Proof: <checks and observable acceptance>
- Status: proposed | accepted | rejected | reviewed-no-change
```

## Decision ledger

Required in decide mode and retained when a plan becomes accepted.

| Decision | Status | Canonical name | Definition/owner | Rejected alternatives | Docs updated | Enforcement/removal gate |
| --- | --- | --- | --- | --- | --- | --- |

## Implementation order

1. Ratify meaning and convention.
2. Migrate persisted or public identity when required.
3. Rename canonical owner and consumers atomically.
4. Remove obsolete aliases and paths.
5. Update tests, docs, config examples, help, fixtures, and evidence.
6. Run focused behavior proof, naming inventory, and repository gates.

## End state

- Accepted language and canonical owner.
- Open decisions in dependency order.
- Before/after concept and owner count.
- Compatibility debt and removal gate, if any.
- Exact verification result.
