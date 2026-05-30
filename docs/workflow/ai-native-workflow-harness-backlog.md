# AI-Native Workflow Harness Backlog

## Status

Working backlog.

## Why This Exists

`clisbot` should behave like a real harness for AI-assisted repo work.

The target experience is that users do not need to know the repository layout, documentation rules, testing standards, or task lifecycle. They should be able to use a short phrase, keyword, or slash command, and the agent should follow the predefined workflow standard.

## North Star

For common repo work, support three equivalent entry levels:

- plain language: "finish this task", "make this production-ready", "write the docs"
- keyword: `implement`, `plan`, `doc`, `test`, `test full`, `finalize task`, `lesson learn`
- slash command: `/implement`, `/plan`, `/doc`, `/test`, `/test full`, `/finalize`, `/learn`

All entry levels should resolve to one canonical workflow definition so behavior does not drift.

## Backlog

### 1. Workflow intent registry

Define canonical workflow intents, aliases, examples, required permissions, expected artifacts, and reporting shape.

Initial intents:

- `implement`: inspect, change code, update docs/help if behavior changed, run targeted tests, summarize diff and verification
- `plan`: produce scope, non-goals, risks, decisions needed, and next actions before code changes
- `doc`: update the right documentation surface without forcing the user to know doc placement rules
- `test`: run the smallest truthful targeted verification and report exact commands/results
- `test full`: run the repo full gate and report failures with next actions
- `finalize`: decide and execute the remaining done bundle after work appears complete
- `lesson learn`: capture durable reusable feedback in the right lesson, workflow, instruction, or skill surface

### 2. Finalize workflow

Define the "I don't know what should happen next" workflow.

`finalize` should inspect the current work and decide whether the missing bundle is:

- user-guide docs
- feature docs
- task or backlog status
- release or migration notes
- tests
- validation evidence
- lessons learned
- links between docs
- residual-risk note

### 3. Low-friction command surface

Design how plain language, short keywords, and slash commands map to the same workflow without colliding with native Codex, Claude, or Gemini slash commands.

Start docs-first before runtime parser changes.

### 4. Workflow storage shape

Decide whether workflow definitions live as:

- markdown docs in `docs/workflow/`
- reusable skills
- prompt templates
- config entries
- a small runtime command registry

Prefer the smallest shape that is reviewable and easy for future agents to discover.

### 5. Harness proof path

Pick one repo workflow and prove the harness behavior end to end.

Recommended first proof: `finalize`, because it bundles the most repeated hidden knowledge: docs, tests, backlog, release notes, lessons, and final reporting.

### 6. Harness quality measurement

Define how to measure whether the harness and queue workflow are actually improving work quality.

Track signals such as:

- number of defects found after the workflow says the task is done
- number of follow-up prompts needed before the result becomes acceptable
- amount of human supervision needed during or after execution
- missing test-case groups discovered only after a second review prompt
- code-review findings grouped by severity and whether they are real defects
- issues in standardization, reuse, naming, SOLID boundaries, and duplicated decision paths

Example evidence:

- after the API bot channel task, extra questioning exposed that generated test coverage was incomplete
- a good harness should make the agent ask about missing test groups before finalizing, not only after the human notices

The goal is not vanity scoring. The goal is a repeatable feedback loop that shows whether workflow definitions reduce defects, reduce review rounds, and reduce required babysitting.

## Open Questions

1. Which workflows should execute directly and which should only generate a plan first?
2. Which workflow intents are safe for all routed users?
3. Which workflow intents require permissions such as `shellExecute` or protected-resource access?
4. Should workflow commands be available in chat only, CLI only, or both?
5. How should the agent report which workflow standard it followed?
6. Which quality metrics should be tracked manually first before adding runtime instrumentation?

## Related Workflow Docs

- [Workflow Principles Draft](workflow-principles-draft.md)
- [Working Prompts](working-prompts.md)
- [Agent Rules Review Draft](agent-rules-review-draft.md)
- [Decision And Struggle Patterns](decision-and-struggle-patterns.md)
