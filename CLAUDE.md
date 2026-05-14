# AGENTS.md

## Scope
These rules apply to everything inside this repository.

The stable implementation contract lives in:
- `docs/architecture/architecture-overview.md`
- `docs/architecture/surface-architecture.md`
- `docs/architecture/runtime-architecture.md`
- `docs/architecture/domain-language.md`

If implementation conflicts with those docs:
1. stop
2. refactor toward the docs if the fix is clear
3. ask the user before proceeding if the conflict changes behavior, architecture, or scope

Do not silently drift away from the architecture docs.

## First Read Order
Load context in this order unless the task is obviously narrower:
1. `README.md`
2. `docs/overview/README.md`
3. the architecture docs listed above

Then load only the smallest extra context that matches the task:
- feature work: `docs/features/README.md`, the relevant feature doc, then linked task docs
- task execution: `docs/tasks/README.md`, `docs/tasks/backlog.md`, then the relevant task doc
- operator or onboarding or release work: `docs/development/README.md` and the relevant user-guide doc
- research-heavy questions: the relevant file under `docs/research/`

Do not front-load the whole docs tree.

## Documentation Precedence
When documents disagree, use this order:
1. `docs/architecture/`
2. `README.md`, `docs/development/README.md`, and `docs/user-guide/`
3. `docs/features/`
4. `docs/tasks/`
5. `docs/research/` and `docs/lessons/`

`docs/research/` and `docs/lessons/` are supporting context only. They should not silently override architecture or guide docs.

## Repo Map
Use this ownership map before editing:
- `src/channels`: Slack and Telegram surfaces, route handling, rendering, pairing, follow-up behavior
- `src/agents`: durable agent state, sessions, queueing, loops, attachments, run lifecycle
- `src/auth`: roles, permissions, owner claim, authorization resolution
- `src/config`: schema, loading, credentials, templates
- `src/control`: operator CLI, runtime lifecycle, health, status, logs, bootstrap
- `src/runners`: execution backends, currently tmux
- `src/infra`: small host/runtime primitives only, with no product concepts
- `test/`: regression and behavior coverage
- `docs/tests/`: readable validation scenarios when behavior needs explicit ground truth

## Command Baseline
Prefer these repo-standard commands:
- install: `bun install`
- typecheck: `bunx tsc --noEmit`
- targeted tests: `bun test <file>`
- full tests: `bun test`
- full local gate: `bun run check`
- local dev start: `bun run start ...`
- local dev status: `bun run status`
- local dev logs: `bun run logs`
- package build: `bun run build`
- publish: follow `docs/development/README.md`

Do not invent ad hoc verification flows when one of these commands already fits.

## Runtime And Env Precedence
Repo-local convenience scripts use the repo `.env` and default to:
- `CLISBOT_HOME=~/.clisbot-dev`

Treat runtime path resolution in this order:
1. explicit CLI or function parameters
2. explicit `CLISBOT_*` path env vars
3. `CLISBOT_HOME`-derived defaults

If runtime behavior looks wrong, inspect `CLISBOT_HOME`, `CLISBOT_CONFIG_PATH`, `CLISBOT_PID_PATH`, `CLISBOT_LOG_PATH`, and related runtime env vars before assuming the code is wrong.

## Documentation Workflow
Use the repo doc systems consistently:
- `docs/overview/README.md` is the top-level project overview
- `docs/overview/human-requirements.md` is raw human input; do not edit it unless the user explicitly asks
- `docs/tasks/backlog.md` is the source of truth for task status and priority
- `docs/features/feature-tables.md` is the source of truth for feature state
- `docs/research/<feature>/` is for source-driven analysis that is not yet stable contract
- `docs/features/non-functionals/` is for cross-cutting quality work
- `docs/lessons/` is for reusable lessons from repeated feedback, delivery struggles, or durable operator preferences
- keep task docs brief when they mostly track research work; link to `docs/research/` instead of duplicating analysis
- keep task docs in the task workflow and feature docs in the feature workflow

Prefer links over repeated context.

## Design Defaults
Follow these defaults unless the user explicitly asks for a different tradeoff:
- KISS: prefer the smallest change that keeps architecture, runtime truthfulness, and operator flow clear
- DRY: prefer one shared implementation path over parallel wrappers or duplicated mutations
- backend-facing models must stay resource-oriented and revision-aware
- do not leak transient runtime state into persistence contracts
- use `docs/architecture/domain-language.md` for canonical vocabulary, model naming, ownership, lifecycle, and mapping boundaries
- do not introduce aggregate or backend-for-frontend endpoints unless the simpler resource model is documented as insufficient
- document intentional architecture exceptions before implementing them

## DRY And Naming Rules
Apply DRY across:
- logic
- files
- functions
- state transitions
- concepts
- naming
- wrappers
- data contracts

If you copy something once, treat that as a refactoring signal.

Naming rules:
- prefer boring, obvious names
- one concept should have one name
- one name should refer to one concept
- reuse established product and architecture terms where they already fit
- do not invent a new naming convention when the repo already has one

Refactor when you see:
- duplicated logic or duplicated file purpose
- duplicated mutation or command paths
- repeated wrappers or transformations that should be shared
- ambiguous, overloaded, misleading, or inconsistent names
- one concept using multiple names
- one name referring to multiple concepts

Ask the user before proceeding when refactoring changes visible behavior, changes a public interface, or requires a real tradeoff about compatibility or doc direction.

## Hard Limits
These are strict rules, not suggestions:
- file target: under `500` lines; hard limit: `700`
- function target: under `30` lines; hard limit: `50`
- nesting depth: maximum `3`

If you cross the target, treat that as a refactoring trigger.

## Autonomous Execution
When the user asks to continue or work autonomously:
- continue until the requested scope is actually complete
- do not stop after one clean sub-batch if the next in-scope step is clear
- stop only when the task is complete, a real dependency is missing, or continuing would risk conflict with architecture or user intent

## Verification Baseline
For product, runtime, or operator work:
- run targeted tests when the change is scoped
- run `bun run check` before claiming completion for broad or risky changes
- run build verification when packaging or startup behavior changed
- check logs when runtime behavior is unclear
- do not claim completion from static inspection alone when runtime validation is practical

## Live Validation Guardrails
Use only the configured shared test surfaces unless the user explicitly asks for another target.

Slack:
- use `SLACK_TEST_CHANNEL` for channel validation
- keep `.env` authoritative for the shared Slack channel route; do not hardcode channel ids in instruction files
- the only allowed DM validation surface is `SLACK_TEST_DM_CHANNEL`

Telegram:
- use only `TELEGRAM_DEV_BOT_USERNAME`
- use only `TELEGRAM_CONTROL_BOT_USERNAME`
- use only `TELEGRAM_TEST_GROUP_ID`
- use only `TELEGRAM_TEST_TOPIC_CODEX_ID`
- use only `TELEGRAM_TEST_TOPIC_CLAUDE_ID`
- use `TELEGRAM_CONTROL_BOT_TOKEN` only for control-bot-driven validation against the configured test group
- use `TELEGRAM_DEV_BOT_TOKEN` only for the target bot route under test in this repo

Never switch to ad hoc Slack channels, Slack DMs, Telegram groups, Telegram topics, or Telegram DMs unless the user explicitly asks.

## Done Criteria
Do not call work done until the matching bundle is complete:
- code change: implementation + targeted tests + updated docs or help when behavior or contract changed
- runtime or control change: implementation + truthful status or logs or CLI surfaces + regression coverage
- doc change: docs are consistent with current code and examples are truthful
- release change: version is correct, checks passed, publish flow verified, and live version confirmed when publishing was requested

## High-Blast-Radius Actions
Treat these as high-risk and report them truthfully:
- Slack or Telegram live sends
- pairing or auth changes against real surfaces
- runtime start or stop or reload against shared environments
- npm publish and any other external release step

Prefer attached sessions, concrete logs, and exact operator-facing next steps for these flows.
