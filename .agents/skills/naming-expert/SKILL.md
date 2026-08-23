---
name: naming-expert
description: Plan, choose, or review names in Clisbot PaseoClaw Fusion using repository evidence. Use for domain terms, wire contracts, RPC methods, events, settings, files, types, functions, UI concepts, naming audits, broad renames, ambiguous terminology, aliases, or naming drift across the Paseo foundation and Clisbot-specific boundaries.
user-invocable: true
---

# Naming expert

Treat naming as architecture. Make each name expose its concept, owner, role,
scope, and lifecycle with as little reader inference as possible.

## Select one mode

State the mode and scope before acting.

- Use `review` for questions, audits, or diff reviews. Keep it read-only unless
  the user asks for fixes. Default to this mode.
- Use `plan` for naming proposals, migrations, or broad renames. Do not change
  product code or claim the proposal is canonical.
- Use `decide` when the user asks to choose or ratify a canonical name. Update
  the smallest canonical document; implement a rename only when requested.

## Ground the language

Read only the owner chain required by the task, in this order:

1. `AGENTS.md` (symlink to `CLAUDE.md`) and the dirty-tree boundary.
2. `docs/glossary.md` — authoritative terminology; the UI label wins, and no
   synonyms are invented.
3. `docs/architecture.md` and `docs/agent-lifecycle.md` for current ownership
   and dependency boundaries.
4. `docs/overview/product-vision.md` for the Fusion target language.
5. Relevant wire schemas, implementation, tests, UI copy, config, and Git
   history.

Treat executable code and tests as proof of current behavior. Treat the product
vision as target direction, not proof that a capability already exists. Label
important conclusions `CURRENT`, `TARGET`, `GAP`, or `HISTORICAL`.

## Build an inventory

Use `rg` over the smallest complete owner chain. Include:

- exact uses and close variants;
- sibling names with the same role;
- wire contracts, RPC methods, events, settings, persisted fields, provider
  adapters, errors, tests, docs, and UI copy;
- aliases, compatibility paths, and terms inherited from upstream Paseo.

For each material concept, write a one-sentence concept card:

```text
<name> is a <role> owned by <owner> that <job> during <lifecycle>;
it is not <nearest confusing alternative>.
```

## Choose the name

Use the first semantically correct option:

1. Reuse the canonical Paseo term unchanged (check `docs/glossary.md` first).
2. Reuse an established same-role naming family.
3. Add one owner- or role-revealing qualifier.
4. Introduce a Clisbot-specific term only for a genuinely new concept.

Prefer boring, searchable names. One concept should have one name and one name
should represent one concept. Avoid names biased toward the first provider,
channel, screen, prompt, or implementation technique when the concept is
shared.

New RPCs use dotted namespaces with direction suffixes —
`domain.provider.operation.request` pairs with
`domain.provider.operation.response` (see `docs/rpc-namespacing.md`). Do not
add new flat RPC names. New wire fields stay optional and schema-pure per
`docs/protocol-compatibility.md`; any back-compat shim is tagged
`COMPAT(name)` so the cleanup is tracked.

Do not rename or move upstream-owned concepts merely for local taste. Such
renames create recurring merge conflicts against `upstream/main`. Prefer an
additive Clisbot-owned adapter or boundary when the meanings differ.

## Protect upstream mergeability

For any requested implementation, obey the product vision's Upstream-Friendly
Evolution principle: keep the change minimal and isolated, and place it behind a
feature toggle. If a rename cannot satisfy that constraint, stop at a plan or
ask the user to change the rule explicitly.

Check every affected public boundary: wire contracts, daemon, client library,
mobile, web, desktop, CLI, providers, config, persistence, docs, tests, and
compatibility. Do not leave two permanent names for one concept unless a
bounded migration requires an alias and defines its removal gate.

## Finish

Report the mode, scope, evidence, recommendation or decision, canonical source
(usually `docs/glossary.md`), migration impact, upstream impact, verification,
and unresolved questions.
