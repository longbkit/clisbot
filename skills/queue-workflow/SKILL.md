---
name: queue-workflow
description: Queue-first implementation workflow for clisbot queues. Use when work should keep going past the first pass and needs protection against early stopping, shallow review, naming drift, DRY/KISS regressions, missing docs/tests, or bad fallback behavior.
version: 1.1.0
lastUpdate: 2026-05-03T11:22:07Z
---

# Queue Workflow

Use this skill when one implementation pass is not enough.

AI coding still tends to stop early. One extra `continue` often finds more to fix. This skill turns that into the default workflow by queueing the next passes instead of waiting for the human to remember.

## Navigation

Read only the next file you need:

- stay in `SKILL.md` for trigger, workflow, queue-depth selection, and reporting
- read [references/queue-recipes.md](references/queue-recipes.md) for queue plans, prompt-writing rules, and real `clisbot queues` command templates
- read [references/content-architecture.md](references/content-architecture.md) when improving this skill or any similar skill for context-saving, file split, link structure, or anti-ambiguity

## When To Use

Use queue-first when the task is any of:

- medium or large code changes
- risky changes across multiple files, layers, or contracts
- fixes that may have wider regressions than the first patch reveals
- work that should end with tests, docs, release notes, or backlog updates in sync
- repo cleanup where naming, glossary, DRY, and KISS matter as much as the raw feature

Skip queue-first only when the task is clearly tiny, low-risk, and fully verifiable in one short pass.

## First Principles

- Early stopping is normal. Design the workflow to continue on purpose.
- A strong main pass should already solve most of the work when the prompt is good; queue-first exists to protect follow-through, not to excuse a weak first pass.
- Queued items are external future execution for later turns, not an internal checklist for the current turn.
- Save context. Keep the top-level file short and move denser details into a few linked reference files.
- Split enough small, but not too small. Each file should solve one coherent problem.
- Keep related content near each other. Prefer one file per decision surface over many tiny files.
- Make every loaded file immediately usable. Avoid long meta explanation before the operational guidance.
- Write for both AI and humans. Do not rely on unstated assumptions, repo folklore, or ambiguous shorthand.
- Prefer scoped, concrete queued prompts over generic motivational text.

## Core Rule

Do not treat the first green patch as done when queue support exists and the task deserves follow-through.

Instead:

1. Read repo instructions and inspect the current implementation first.
2. Decide queue depth: small, medium, or large.
3. If `clisbot queues` is available, queue the follow-up passes early.
4. Do the main implementation pass.
5. Let queued passes drive breadth review, simplification, code review, and docs sync.
6. Only report done after the queue plan is exhausted or intentionally trimmed with a reason.

If you can and should finish the follow-up work in the current turn, do not queue it. If you do queue it, do not silently consume that future work yourself in the same turn and then clear the queue as if it had been executed.

## Queue Depth

- Small: one narrow area, few files, one obvious contract, low regression risk, plus 2-3 queued passes.
- Medium: several files or one meaningful contract surface, likely tests/docs follow-up, plus 4-6 queued passes.
- Large: multiple layers, cross-cutting contracts, release-facing or architecture-sensitive work, plus the full multi-pass sweep.

Prefer shorter batches when the first pass may change scope heavily.
Prefer the full batch when the task is important, cross-cutting, or likely to hide follow-up work.
For large or unstable tasks, queue the first wave only and queue the second wave after the code settles.

## clisbot Queue Rules

When operating inside `clisbot` and the task is queue-worthy:

- use `clisbot queues create`, not ad hoc reminders in prose
- queue against the exact routed surface
- include the real `--sender <principal>`
- respect the pending queue cap
- tell the user what queue depth you chose and why
- prefer prompts tailored to the current task over blindly replaying a generic sequence
- keep each queued prompt focused on one review lens

Addressing reminders:

- Telegram topic example:
  `clisbot queues create --channel telegram --target group:<chat_id> --topic-id <topic_id> --sender telegram:<user_id> "<prompt>"`
- Slack thread example:
  `clisbot queues create --channel slack --target group:<channel_id> --thread-id <thread_ts> --sender slack:<user_id> "<prompt>"`
  Keep `--thread-id` when the current Slack message is in a thread so queue start/final notifications stay in that thread.

## Follow-Up Pass Goals

The queue should systematically attack common AI coding failure modes:

- early stopping
- narrow local fixes with no breadth review
- overthinking or bad fallback behavior
- naming drift or duplicated logic
- tests and docs lagging behind the code

## Pass Ordering

Use this order unless the repo or task strongly suggests another order:

1. main implementation
2. continue pass
3. breadth review pass
4. simplify and naming/DRY/KISS pass
5. code review and fix pass
6. docs and release/help review pass
7. final continue pass

Do not force every task through every pass if a pass is genuinely not relevant. Trim intentionally and say why.

## Fallback When Queue Is Unavailable

If `clisbot queues` is unavailable, emulate the same workflow locally:

- make the queue plan explicit in your notes
- keep working through the same passes in the current turn
- do not pretend the absence of a queue means the work is done

## Reporting

When you use this skill:

- say that you are using a queue-first workflow
- state the chosen queue depth
- state which follow-up passes were queued or intentionally skipped
- keep the queued prompts concrete and operational
- prefer boring reuse over fresh abstraction unless the repo truly needs the new abstraction
- point to the exact reference file when a deeper rule set is relevant:
  - [references/queue-recipes.md](references/queue-recipes.md) for queue plans and command templates
  - [references/content-architecture.md](references/content-architecture.md) for context-saving structure and anti-ambiguity rules
