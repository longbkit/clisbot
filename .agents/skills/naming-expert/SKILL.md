---
name: naming-expert
description: Plan, decide, or review names with repository evidence for domain terms, APIs, folders, files, packages, functions, variables, classes, types, enums, events, config keys, UI concepts, and abstractions. Use when the user invokes naming-expert, asks to plan or choose a name, requests a naming audit/review, reports inconsistent or ambiguous wording, wants common reader-friendly terminology, or needs to detect naming drift, duplicate concepts, parallel abstractions, aliases, prefix/suffix inconsistency, or prompt-biased names.
---

# Naming expert

Treat naming as architecture. Make each name reveal the concept, owner, role, and
expected behavior with the least reader inference. Replace model memory with a
repeatable loop: observe, inventory, compare, decide, ratify, and enforce.

## Select one mode

State the selected mode and scope before acting.

- Use `plan` for `plan`, `proposal`, `roadmap`, `đề xuất`, `lập kế hoạch`, or a
  migration design. Create a dated audit under `docs/audit/`; do not edit product
  code.
- Use `decide` for `decide`, `choose`, `accept`, `chốt`, `quyết định`, or when the
  user asks for the canonical name. Record the accepted decision in a dated audit
  and update its canonical language/convention owner. Do not perform a code-wide
  rename unless the user also asks to implement it.
- Use `review` for `review`, `audit`, `check`, `rà soát`, existing code, or a change
  just completed. Review is read-only unless the user separately asks for fixes.
- If no signal is clear, default to `review`. Do not blend modes silently.

Read [audit-format.md](references/audit-format.md) before creating or updating an
audit.

## Ground the current language

1. Read the nearest repository instructions and runbook.
2. Find the canonical domain glossary, naming convention, package/ownership map,
   and relevant artifact contract. In AnyApp, begin with
   `docs/contracts/domain/language.md` and
   `docs/contracts/domain/naming-convention.md`.
3. Treat current contracts as normative. Treat ADRs, audits, task transcripts, and
   Git history as evidence of past problems or rationale, not as current authority
   when they conflict.
4. Establish the requested scope and dirty-tree boundary. Preserve unrelated user
   changes.
5. Check existing naming gates before inventing another one. In AnyApp, relevant
   starting points include:

```sh
node docs/impl/term-inventory.mjs
node docs/impl/naming-alias-ratchet.mjs
node docs/impl/naming-lexicon.mjs
```

## Build a machine-assisted inventory

Run the bundled inventory on the smallest complete owner chain, then use `rg` for
exact causal traces:

```sh
node .agents/skills/naming-expert/scripts/naming-inventory.mjs \
  --query '<current-or-candidate-term>' <scope...>
```

Use `--json` when the result will feed another tool. Use `--limit <n>` only to
control display; never treat a truncated display as a complete census.

Inventory all relevant naming locations, not only exported symbols:

- domain and product wording;
- folder and file names;
- package and public subpath names;
- functions, variables, classes, types, interfaces, enums, constants, props, and
  registry keys;
- API resources/actions, wire fields, events, errors, config keys, tests, and docs;
- nearby names in the same owner, imports/call paths, and files with similar symbol
  signatures.

For a candidate, collect four evidence sets:

1. exact existing uses;
2. same-role sibling names and their prefix/suffix/case pattern;
3. similar behavior or lifecycle implemented elsewhere;
4. collisions, aliases, near-synonyms, and historical retired names.

The script is a scout, not a judge. Confirm similarity by reading the owner and
runtime path. Similar text does not prove shared semantics.

## Classify the concept before naming it

Write a one-sentence concept card:

```text
<name> is a <artifact role> owned by <owner> that <job> during <lifecycle>;
it is not <nearest confusing alternative>.
```

Answer these questions before comparing words:

1. What would the product actor call the thing or job?
2. Is it durable domain data, metadata, configuration, runtime state, operation,
   event, UI copy, source module, package, Port, Adapter, or proof?
3. What owns its identity, lifecycle, persistence, and behavior?
4. Which nearby concept must remain distinct?
5. Is the context already supplied by the folder/type, making a prefix redundant?

Generic does not mean vague. Generalize to the broadest stable concept that keeps
the owner and role visible. Do not encode the current prompt, screen, product
example, implementation technique, or first consumer into a reusable name.

## Choose through the reuse ladder

Use the first level that remains semantically correct:

1. Reuse the exact canonical name and existing owner.
2. Reuse the established family with only the required grammatical or artifact-role
   form.
3. Extend the canonical name with one role-revealing qualifier.
4. Create a new term only when existing terms denote a different concept.

Share an abstraction or exact name only when meaning, owner, lifecycle, invariants,
and reasons to change align. If only syntax looks similar, keep explicit local code.
If several prefixed siblings reconstruct one concept, prefer a concept folder with
contextual filenames. If one broad name hides multiple reasons to change, split by
owner role.

Score candidates with evidence, not intuition:

- familiar to the intended reader;
- precise in this domain;
- consistent with same-role siblings;
- traceable across layers;
- neutral to prompt, product, UI placement, vendor, and implementation;
- short after surrounding context is considered;
- distinct in search results and speech;
- safe for persistence, compatibility, and migration.

When repository evidence cannot establish familiar industry wording, consult
primary specifications or official documentation for the relevant ecosystem.
Record the sources and trade-off; popularity never overrides an explicit domain
meaning.

## Plan mode

Create one audit using the reference format. Include:

- current-state cross-layer map;
- inventory commands and candidate evidence;
- concept cards and nearest alternatives;
- candidate matrix and recommendation;
- exact reuse/merge/split/rename opportunities;
- migration, compatibility, tests, docs, and narrow enforcement plan;
- ordered open decisions, clearly separated from accepted current language.

Do not make a speculative rename plan from filenames alone. Trace at least one
representative call or data path for each material concept family.

## Decide mode

Use an existing plan audit when available; otherwise create a focused decision
audit. Record the accepted name, definition, owner, scope, rejected alternatives,
compatibility policy, and evidence.

Update the smallest canonical owner in the same change:

- domain/public word or meaning -> domain language;
- cross-layer case, suffix, prefix, or artifact rule -> naming convention;
- local owner term -> the relevant contract or ownership document;
- durable or externally visible identity -> migration/fail-fast policy and old-to-new
  map.

Prefer atomic cutover with no alias. Keep a compatibility name only when an external
or persisted contract requires a bounded migration, and record its removal gate.
Add a narrow checker only for a lasting, machine-detectable invariant that an
existing gate cannot express.

## Review mode

Review the requested code or diff, then search beyond it far enough to detect sibling
drift. Actively look for:

- two names for one concept or one name for multiple concepts;
- local names that duplicate an existing canonical owner;
- prompt-, screen-, product-, vendor-, or implementation-biased names in shared code;
- vague containers such as `helper`, `util`, `manager`, `service`, `common`, or
  `shared` without a revealed role;
- suffix, prefix, plurality, case, and artifact-role drift;
- prefix-based pseudo-grouping and redundant folder echoes;
- public aliases, compatibility exports, parallel paths, and retired terms;
- names whose code role disagrees with their actual lifecycle or behavior;
- docs, tests, config, OpenAPI, or UI copy that teach a different language.

Report findings in severity order with exact paths, the reader cost, current owner,
recommended canonical name, migration impact, and proof. State explicitly when no
material naming issue is found. Do not invent findings to justify the skill.

## Finish every mode

Summarize the selected mode, scope, evidence gathered, decisions made, canonical docs
changed, unresolved questions, and verification. A naming run succeeds when a new
reader can find and explain the owner with fewer concepts and when the decision is
stored in repository artifacts rather than only in the conversation.
