---
name: queue-workflow
description: Queue-first continuation and review workflow for clisbot queues. Use when work needs deliberate follow-up against early stopping, shallow passes, prompt echoing, history leaking, duplicate files/functions/sections, naming drift, DRY/KISS regressions, missing docs/tests, or bad fallback behavior.
---

# Queue Workflow

Use this skill when a task needs more than one serious pass, or when the user explicitly asks for queue workflow.

## Problem

AI can fail in two opposite ways:

- stop early, act lazy, or treat a green first pass as done
- keep "improving" by adding duplicate sections, files, functions, fallbacks, names, or explanations

Queue workflow protects against both. It also catches prompt echoing, history leaking, topic drift away from exact `continue`, shallow queued micro-tasks, and review overload for the human.

The goal is not to split work into tiny tasks. Each pass, including the current pass and every later queue-runner invocation, must inspect context, do the work, validate, simplify, and report clearly.

## When To Use

Use queue-first when:

- the user explicitly asks for queue workflow, even for small work
- the task is medium or large
- code, docs, skill, runbook, or architecture changes may sprawl
- regressions, missing tests/docs, naming drift, or duplicate structure are plausible
- the user needs a final version, not draft-history explanation inside the artifact

Skip it only when the user did not ask for queue workflow and the task is clearly tiny, low-risk, and fully verifiable in one short pass.

Read [references/content-architecture.md](references/content-architecture.md) as the structural foundation for both the current pass and queued passes.

## Core Workflow

Principles:

- Durable queues are an external clisbot queue-runner flow; the current agent must not drain pending queue items locally.
- Queuing follow-up work never lowers the quality bar for the current pass.
- Run the current pass deeply and thoroughly before reporting: inspect state, edit, validate, simplify, and name what is done now.
- When the queue runner invokes a queued prompt later, that invocation must also run as a full-quality session, not a small visible micro-task.
- Preserve the current thread with exact `continue` before switching to a new lens.
- At queue creation time, do not depend on knowing whether a future pass will finish cleanly; add the control prompts up front after important milestones.
- Keep final artifacts clean: do not echo user wording or leak draft-history notes unless the user needs a changelog.

Process:

1. Inspect repo instructions, current state, existing owners, and similar files/sections/functions before adding anything.
2. Choose depth: small, medium, or large.
3. If async follow-up is useful, queue the next pass or batch with `clisbot queues create`; this is for later runner invocations, not for the current turn to consume.
4. Complete the current pass as deeply as the task deserves.
5. Report what is done now, what was validated, and which queued follow-ups remain pending.
6. Claim final completion only after the queue plan is exhausted or intentionally trimmed with a reason.

## Queue Plan

Choose depth:

- Small: narrow area, few files, low risk, or explicit user request for queue workflow on a small task.
- Medium: meaningful contract/doc/skill surface, several related files, or likely validation/docs follow-up.
- Large: multiple layers, cross-cutting behavior, migration/release-facing work, or architecture-sensitive cleanup.

Continuation and unknowns budget:

- Important milestones are the main/current pass, breadth or expansion review, and simplify/DRY-KISS/grouping review.
- Small: after each important milestone, queue 1 exact `continue`, then 1 exact `anything else`.
- Medium: after each important milestone, queue 2 exact `continue`, then 1 exact `anything else`.
- Large: after each important milestone, queue 3 exact `continue`, then 1 exact `anything else`.
- Queue these control prompts up front because the queue creator cannot know whether a future runner pass will find more work.
- A runner pass may still stop its own local work when no material change remains, but it should not rewrite the queued control prompt.

Prompt rules:

- Keep queued prompts in the user's original human language.
- Use exact `continue` and exact `anything else` for control prompts; do not add words to them.
- Lens prompts should be objective review instructions, not prompt echoing or draft-history explanation.
- Each queued review prompt is an independent runner invocation: inspect current state, work deeply, validate, simplify, and report.

Review lenses:

1. breadth, side effects, and regression bugs
2. artifact architecture for code, docs, or skills
3. simplify, naming, DRY/KISS, and grouping
4. review/fix and validation
5. docs, release notes, changelog, or help text
6. alignment with AGENTS.md, architecture docs, or recent lessons learned
7. reasoning checks: critical thinking, 5 whys, fishbone, or MECE states

Artifact prompts:

- Code: review fundamentals, SOLID, naming, folders, regression bugs, side effects, tests, DRY/KISS, and near-duplicate files/functions/fallbacks.
- Docs: review doc mode, one reader journey, target 5 H2s, max 7 H2s, on-page structure, no keyword stuffing, and final-version cleanliness.
- Skills: review trigger/workflow/navigation/reporting ownership, progressive disclosure, line/heading budgets, frontmatter, examples, links, and command truthfulness.

Batch skeletons:

- Small: main/current pass -> `continue` -> `anything else` -> one useful review lens -> `continue` -> `anything else`
- Medium: main/current pass -> `continue` -> `continue` -> `anything else` -> breadth/regression review -> `continue` -> `continue` -> `anything else` -> simplify/DRY-KISS -> `continue` -> `continue` -> `anything else` -> review/fix
- Large wave 1: main/current pass -> `continue` -> `continue` -> `continue` -> `anything else` -> breadth/regression review -> `continue` -> `continue` -> `continue` -> `anything else` -> artifact architecture if relevant
- Large wave 2: simplify/DRY-KISS -> `continue` -> `continue` -> `continue` -> `anything else` -> review/fix -> docs/release/alignment if relevant -> `continue`

## Queue Operation

When operating inside `clisbot`:

- use `clisbot queues create`, not prose reminders
- run `clisbot queues create --help` if command syntax is uncertain
- queue against the exact routed surface and respect the pending queue cap
- do not read pending queue items and execute them locally in the same turn
- prefer one focused review lens per queued prompt

Slack thread:

```bash
clisbot queues create --channel slack --target group:<channel_id> --thread-id <thread_ts> --sender slack:<user_id> "<prompt>"
```

Telegram topic:

```bash
clisbot queues create --channel telegram --target group:<chat_id> --topic-id <topic_id> --sender telegram:<user_id> "<prompt>"
```

Syntax check:

```bash
clisbot queues create --help
```

Report the chosen depth, artifact recipe if any, validation done in the current pass, follow-up passes queued or skipped, and pending queue work without pretending it is done.

If `clisbot queues` is unavailable, emulate the same passes locally and say queueing was unavailable.
