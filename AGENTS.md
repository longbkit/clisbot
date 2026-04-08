# AGENTS.md

## Scope

These rules apply to everything inside this repository.

This repo must follow the decisions in:

- `docs/architecture/architecture-overview.md`
- `docs/architecture/surface-architecture.md`
- `docs/architecture/runtime-architecture.md`
- `docs/architecture/model-taxonomy-and-boundaries.md`

If implementation conflicts with those docs:

1. stop
2. refactor toward the docs if the fix is clear
3. ask the user before proceeding if the conflict changes behavior, architecture, or delivery scope

Do not silently drift away from these documents.

## Documentation Workflow Rules

Use the repo doc workflows consistently.

- Use `docs/overview/README.md` for the human-readable project overview and goal summary.
- Use `docs/overview/human-requirements.md` for raw human-provided requirements and notes.
- Do not modify `docs/overview/human-requirements.md` unless the human explicitly asks for that file to be changed.
- For task planning, execution tracking, and backlog management, follow `docs/tasks/README.md` and update `docs/tasks/backlog.md`.
- For feature-level planning, feature state, and feature navigation, follow `docs/features/README.md` and update `docs/features/feature-tables.md`.
- Use `docs/research/<feature>/` for source-driven analysis, investigations, experiments, and research output that is not yet a stable architecture contract.
- Keep task docs brief when they mostly track research work; link to the detailed research output in `docs/research/<feature>/` instead of duplicating the full analysis in `docs/tasks/`.
- Keep task docs in the task workflow and feature docs in the feature workflow.
- Use `docs/features/non-functionals/` for performance, security, reliability, accessibility, tracing, monitoring, product analytics, and architecture-conformance work that does not belong to one feature alone.
- Maintain `docs/lessons/` as a reusable lessons-learned and developer-guidelines space for issues that receive human feedback, especially repeated feedback, human preferences likely to be reused or referenced later, and problems that required long struggles, research, or multiple iterations to resolve, with the goal of reducing repeated struggle, avoiding misunderstanding, and growing transferable lessons for future projects.
- Prefer links between these systems over copying the same status, scope, or rationale into multiple files.

## Product And Architecture Rules

### Architecture conformance rule

- Treat `docs/architecture/` as the stable implementation contract.
- Document intentional exceptions before implementing them.

### Backend contract rule

- Backend-facing models must stay resource-oriented and revision-aware.
- Do not leak transient runtime state into persistence contracts.
- Prefer standard REST resources and nested ownership-based payloads over page-specific aggregate endpoints.
- Do not introduce aggregate or backend-for-frontend endpoints unless the need is documented and the simpler resource model still exceeds the `10` request threshold after reasonable `include=` support and ordinary caching.

### Model governance rule

- Use `docs/architecture/model-taxonomy-and-boundaries.md` as the default reference for model naming, ownership, lifecycle, invariants, and mapping boundaries.
- Do not introduce new model shapes that mix entity, projection, DTO, persistence, and runtime-state concerns without documenting the tradeoff explicitly.

## Refactoring And Conflict Triggers

Refactor immediately when you see:

- architecture conflicting with the docs above
- duplicated logic
- duplicated file purpose
- duplicated naming for the same concept
- one name used for different concepts
- confusing or ambiguous naming
- inconsistent naming conventions
- repeated wrappers that should be one shared wrapper
- repeated data transformations that should be one shared utility
- repeated mutation or command paths that should share one implementation path

Ask the user before proceeding when:

- refactoring changes visible behavior
- refactoring changes a public interface
- two doc rules conflict and the right direction is not obvious
- exact reuse or backward compatibility appears impossible without a higher-level tradeoff

## Hard Size Limits

These are strict rules, not suggestions.

### File size

- Target: keep files under `500` lines.
- Hard refactor limit: `700` lines.
- If a file crosses `500`, prefer splitting it.
- If a file reaches `700`, refactor before adding more logic unless the user explicitly approves an exception.

### Function size

- Target: keep functions under `30` lines.
- Hard refactor limit: `50` lines.
- If a function crosses `30`, look for extraction opportunities.
- If a function reaches `50`, refactor before adding more logic unless the user explicitly approves an exception.

### Nesting depth

- Maximum `3` levels of nesting.
- If logic wants a fourth level, extract a function, guard clause, or derived helper.

## DRY Rules

Follow DRY strictly across:

- logic
- files
- functions
- state transitions
- concepts
- naming
- wrappers
- data contracts

Do not duplicate:

- the same mutation or command path
- the same serialization logic
- the same component or adapter mapping logic
- the same validation logic
- the same naming for equivalent objects

If you copy something once, treat that as a refactoring signal.

## Naming And Standardization Rules

Use one naming system consistently.

### Required behavior

- Prefer boring, obvious names over clever names.
- One concept should have one name.
- One name should refer to one concept.
- Reuse established product and architecture terms where they already fit.

### Naming conflicts are refactoring signals

Refactor when naming is:

- ambiguous
- duplicated
- inconsistent
- overloaded
- misleading
- too local for a shared concept

Do not invent a new naming convention each time.

## Autonomous Execution Rules

When the user asks to continue, proceed, work autonomously, or otherwise signals autonomous execution:

- do not stop after one clean sub-batch just because it is implemented
- continue into the next highest-value task that is still inside the active scope
- if the user says to continue until backlog items are done, treat backlog completion in the requested scope as the default stop condition
- only stop when:
  - the requested task and its requested backlog scope are actually complete
  - you are blocked by a real missing dependency or decision
  - continuing would risk conflict with architecture or user intent

### Required autonomous verification loop

For product or runtime work, use the available tools end-to-end when relevant:

- run the local server when needed
- use browser testing for real interaction validation
- run unit tests or targeted test suites when relevant
- run build verification when relevant
- check logs when behavior is unclear
- for Slack live validation, always use the channel id from `SLACK_TEST_CHANNEL`; do not switch to ad hoc channels or DMs unless the user explicitly asks for that
- for the shared bot Claude Code CLI route in this repo, `SLACK_TEST_CHANNEL` must point to `C0AQW4DUSDC`
- for Telegram live validation, always use the configured Telegram test surface only:
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_CONTROL_BOT_USERNAME`
- `TELEGRAM_TEST_GROUP_ID`
- `TELEGRAM_TEST_TOPIC_CODEX_ID`
- `TELEGRAM_TEST_TOPIC_CLAUDE_ID`
- do not switch to other Telegram groups, topics, or DMs unless the user explicitly asks for that
- use `TELEGRAM_CONTROL_BOT_TOKEN` only for control-bot-driven testing against the configured Telegram test group
- use `TELEGRAM_BOT_TOKEN` only for the target bot route under test

Do not claim completion based only on static code review when runtime verification is practical.
