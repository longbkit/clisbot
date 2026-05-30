---
title: Large-Scale Doc Migrations Need Inventory And Repeatable Gates
date: 2026-05-30
area: process, docs, architecture, review
summary: When a decision renames concepts or changes a contract across many docs, do not patch one visible file at a time. Build an inventory, classify each hit, fix by source-of-truth order, then rerun gates until remaining hits are intentionally accepted.
related:
  - docs/lessons/2026-04-16-cross-cutting-refactors-need-explicit-scope-control-validation-tracking-and-surface-lockstep.md
  - docs/lessons/2026-04-10-product-rename-must-cover-runtime-paths-commands-and-remote-metadata-together.md
  - docs/lessons/2026-05-01-audits-can-drive-work-but-feature-docs-still-own-the-product-contract.md
  - docs/tasks/features/channels/2026-05-27-generic-webhook-channel-mvp.md
  - docs/architecture/decisions/2026-05-25-generic-webhook-channel-connectors.md
---

## Context

During the API channel design pass, the first visible request was to update a
single grill doc from `webhook` channel language to `api` channel language. The
first fix improved that doc, but later review found related task, ADR, backlog,
feature README, and playbook text still pointed implementers at the old
`webhook` channel, `/webhook/bots`, `bots.webhook`, and top-level `outbound`
model.

The failure mode was not lack of effort. It was using a local edit loop for a
global terminology and contract migration.

## Lesson

For any large doc or contract migration, use an inventory-and-gate loop instead
of fixing the first file that looks wrong.

Required loop:

1. Define the final contract in a short decision snapshot.
2. Build a search inventory for old names, old endpoints, old config paths, old
   command examples, and old model fields.
3. Classify each hit as one of:
   - source-of-truth contract
   - implementation task
   - rationale or superseded history
   - user guide / operator surface
   - unrelated historical note
4. Fix in source-of-truth order: architecture, task, feature guide, research,
   backlog/index.
5. Rerun the same search gates.
6. Keep fixing until remaining hits are only accepted historical/rejected-path
   references.
7. Record those accepted residual hits in the final note so review can tell
   they are intentional.

Do not rely on memory or visual scanning for this. Large text migrations need
mechanical gates.

## Gate Design

Each migration should define a small gate bundle before editing.

For naming and endpoint migrations, include:

```bash
rg -n 'oldName|Old Name|old_endpoint|old.config.path|--old-flag' docs src test
```

For JSON/config contract migrations, include:

```bash
rg -n '"oldField"\\s*:|old\\.path|new\\.path|deprecatedAlias' docs src test
```

For command examples, include:

```bash
rg -n '--channel old|/old/path|old command phrase' docs src test
```

For status/model migrations, include:

```bash
rg -n 'oldStatus|oldModel|removedField|replacementField' docs src test
```

For docs formatting:

```bash
git diff --check
```

If new files are untracked, also check them directly:

```bash
git diff --no-index --check /dev/null path/to/new-file.md
```

## Residual-Hit Rule

A migration is not done when `rg` still finds old terms and nobody has explained
why.

Allowed residual hits:

- explicit `Considered And Superseded` sections
- rejected alternatives
- questions that compare old and new paths
- guardrails saying not to add an old alias
- historical notes that cannot be rewritten without falsifying history

Disallowed residual hits:

- implementation scope telling agents to build the old thing
- config examples using the old path
- operator commands using the old flag or channel
- backlog or README text pointing to the old mental model
- validation checklists asserting the old contract

Final reports should say which residual hits remain and why they are accepted.

## Practical Rule

When the human says "continue, review if anything else remains", switch from
local editing to systematic audit mode:

1. list candidate files and docs by source-of-truth order
2. run broad `rg` gates
3. edit all contract-bearing drift
4. rerun gates
5. inspect residual hits
6. repeat until only intentional residual hits remain
7. report the gate bundle and the residual-hit classification

This prevents repeated small fixes and makes review confidence visible.
