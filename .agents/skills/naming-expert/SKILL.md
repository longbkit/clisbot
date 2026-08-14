---
name: naming-expert
description: Plan, decide, or review names in clisbot with repository evidence for domain terms, APIs, CLI commands, folders, files, functions, variables, classes, types, events, config keys, persisted fields, channel concepts, runner capabilities, UI concepts, and abstractions. Use when the user invokes naming-expert, asks to propose or choose a name, requests a naming audit or implementation review, reports inconsistent or ambiguous terminology, or needs to detect naming drift, duplicate concepts, aliases, prefix/suffix inconsistency, or prompt-biased names. Supports plan, decide, and review modes.
---

# Naming expert

Treat naming as architecture. Make each name reveal the concept, owner, role,
scope, and expected behavior with the least reader inference. Replace model
memory with a repeatable loop: observe, inventory, compare, decide, ratify, and
enforce.

## Select one mode

State the selected mode and scope before acting. Do not blend modes silently.

- Use `plan` for a naming proposal, roadmap, migration design, or broad rename.
  Create a dated supporting artifact in the repository location selected by
  [audit-format.md](references/audit-format.md). Do not edit product code or
  claim a canonical decision.
- Use `decide` when the user asks to choose, accept, ratify, or establish the
  canonical name. Record the accepted definition in the smallest canonical
  language or convention owner and create or update the appropriate decision
  record when the choice is material. Perform a code-wide rename only when the
  user also asks to implement it.
- Use `review` for a naming audit, code review, diff review, or consistency
  check. Review is read-only unless the user separately asks to fix findings.
- If no signal is clear, default to `review`.

Read [audit-format.md](references/audit-format.md) before creating or updating a
persistent naming artifact.

## Ground the current language

1. Read the nearest repository instructions and establish the dirty-tree
   boundary.
2. Start with `docs/architecture/domain-language.md` for canonical concepts and
   ownership, then `docs/architecture/naming-conventions.md` for repository
   representations.
3. Read the relevant architecture owner, feature front door, public CLI/help,
   config schema, persistence contract, or runner/channel contract for the
   requested scope.
4. Treat architecture and accepted decisions as normative. Treat feature docs,
   guides, audits, research, tasks, and Git history according to repository
   precedence; do not let historical wording override current contracts.
5. Preserve unrelated user changes and check existing tests or machine gates
   before inventing another naming rule.

## Build a machine-assisted inventory

Run the bundled inventory on the smallest complete owner chain, then use `rg`
for exact causal traces:

```sh
node .agents/skills/naming-expert/scripts/naming-inventory.mjs \
  --query '<current-or-candidate-term>' <scope...>
```

Use `--json` when another tool consumes the result. Use `--limit <n>` only to
control display; never treat truncated output as a complete census.

Inventory every relevant naming location, not only exported symbols:

- domain and product wording;
- folder and file names;
- functions, variables, classes, types, interfaces, constants, props, and
  registry keys;
- CLI commands and flags, config keys, persisted fields, API resources/actions,
  events, errors, tests, docs, and help text;
- nearby same-owner names, imports and call paths, and files with similar symbol
  signatures.

For a candidate, collect four evidence sets:

1. exact existing uses;
2. same-role sibling names and their prefix, suffix, plurality, and case;
3. similar behavior, ownership, or lifecycle elsewhere;
4. collisions, aliases, near-synonyms, and retired historical names.

The script is a scout, not a judge. Confirm similarity by reading the owner and
runtime path. Similar text does not prove shared semantics.

## Classify the concept before naming it

Write a one-sentence concept card:

```text
<name> is a <artifact role> owned by <owner> that <job> during <lifecycle>;
it is not <nearest confusing alternative>.
```

Answer before comparing words:

1. What would the operator, channel user, or code reader call the thing or job?
2. Is it domain identity, config, secret, canonical state, projection, runtime
   state, command, event, capability, adapter, contract, UI copy, or proof?
3. What owns its identity, lifecycle, persistence, and behavior?
4. Which nearby concept must remain distinct?
5. Does the folder or type already supply context that would make a prefix
   redundant?

Generic does not mean vague. Generalize to the broadest stable concept that
keeps the owner and role visible. Do not encode the current prompt, screen,
provider example, implementation technique, or first consumer into a reusable
name.

## Choose through the reuse ladder

Use the first level that remains semantically correct:

1. Reuse the exact canonical term and existing owner.
2. Reuse the established family with the required artifact-role form.
3. Extend the canonical term with one role-revealing qualifier.
4. Create a new term only when existing terms denote a different concept.

Share an abstraction or exact name only when meaning, owner, lifecycle,
invariants, and reasons to change align. If only syntax looks similar, keep
explicit owner-local code. If prefixed siblings reconstruct one concept, prefer
a concept folder with contextual filenames. If one broad name hides multiple
reasons to change, split by owner role.

Compare candidates using evidence:

- familiar to the intended reader;
- precise in clisbot's domain;
- consistent with same-role siblings;
- traceable across channel, agent, runner, config, control, and persistence
  boundaries;
- neutral to prompt, screen, provider, and implementation where the concept is
  shared;
- short after surrounding context is considered;
- distinct in search results and speech;
- safe for public CLI, configuration, persistence, and migration.

When repository evidence cannot establish familiar ecosystem wording, consult
primary specifications or official documentation. Record the sources and
trade-off; popularity never overrides an explicit clisbot domain meaning.

## Plan mode

Create one supporting artifact using the reference format. Include:

- current cross-layer naming map;
- inventory commands and complete counts;
- concept cards and nearest alternatives;
- candidate matrix and recommendation;
- exact keep, reuse, merge, split, move, or rename opportunities;
- migration and compatibility impact across CLI, config, persistence, APIs,
  code, tests, docs, and evidence;
- narrow enforcement plan and ordered open decisions.

Trace at least one representative call or data path for each material concept
family. A plan remains proposed until accepted in a canonical owner.

## Decide mode

Use an existing plan when available; otherwise reconstruct focused evidence.
Record the accepted name, definition, owner, scope, rejected alternatives,
compatibility policy, and proof.

Update the smallest canonical owner in the same change:

- domain/public concept or meaning -> `domain-language.md`;
- cross-layer case, suffix, prefix, id, or artifact rule ->
  `naming-conventions.md`;
- repository-wide ownership decision -> `docs/architecture/decisions/`;
- feature-local decision -> `docs/features/<feature>/decisions/`;
- local owner term -> the relevant architecture, feature, or contract document;
- durable or externally visible identity -> migration policy and old-to-new map.

Prefer atomic cutover without aliases. Keep a compatibility name only when a
public or persisted contract requires a bounded migration, and record its
removal gate. Add a checker only for a lasting machine-detectable invariant that
existing validation cannot express.

## Review mode

Review the requested code or diff, then search far enough beyond it to detect
sibling drift. Look for:

- two names for one concept or one name for multiple concepts;
- local names duplicating an existing canonical owner;
- prompt-, screen-, provider-, or implementation-biased names in shared code;
- vague containers such as `helper`, `util`, `manager`, `service`, `common`, or
  `shared` without a revealed responsibility;
- suffix, prefix, plurality, case, id, and artifact-role drift;
- redundant folder echoes and prefix-based pseudo-grouping;
- public aliases, compatibility exports, parallel paths, and retired terms;
- names whose declared role disagrees with actual ownership or lifecycle;
- docs, tests, config, CLI help, or UI copy that teach different terminology.

Report findings in severity order with exact paths, reader cost, current owner,
recommended canonical name, migration impact, and proof. State explicitly when
no material issue exists. Do not invent findings to justify the skill.

## Finish every mode

Summarize mode, scope, evidence, recommendation or decision, canonical docs
changed, migration impact, verification, and unresolved questions. A naming run
succeeds when a new reader can find and explain the owner with fewer concepts
and when accepted decisions live in repository artifacts rather than only in
conversation.
