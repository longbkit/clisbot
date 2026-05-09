# Workflow Principles Draft

## Status

Working draft.

This page captures workflow principles that are directionally strong but not yet locked as stable repo contract.

Related lesson:

- [Channel Planning And Review Should Use One Owner Per Decision And One Reason To Change](../lessons/2026-05-09-channel-planning-and-review-should-use-one-owner-per-decision-and-one-reason-to-change.md)

## 1. Shortest-Review-First North Star

Always push AI toward generating the shortest, easiest-to-review context first.

The closer an artifact is to the user, the easier it should be to review.

If it is hard to review, the product or workflow is probably still too hard to use.

Examples that should be reviewable early, not only after implementation spreads:

- `clisbot.json`
- CLI command shape and help text
- naming conventions
- front-door workflow surfaces
- architecture summaries before architecture detail explodes

One north-star metric:

- every AI-produced artifact should be extremely easy to understand
- if a developer or user cannot understand it quickly, there is still a product or workflow problem

## 2. Review The Most User-Near Surfaces First

The review order should usually bias toward:

1. config and naming
2. CLI surfaces
3. user-facing workflow and chat behavior
4. architecture summary and boundary model
5. implementation details

Rationale:

- config that only "works eventually" but is hard to review is already bad product design
- CLI surfaces that look acceptable only after explanation are already carrying too much friction
- architecture that leaks concepts, duplicates concepts, or blurs ownership will later corrupt both docs and code

## 3. Review Loops Should Converge On Clarity

One useful direction is a reusable combo skill, prompt, or checklist that AI walks repeatedly until convergence.

The owner for the concrete review checklist is:

- [AI Review Checklist](ai-review-checklist.md)

For channel-heavy or architecture-sensitive work, that review loop should explicitly use these named lenses:

- `Robert C. Martin lens`: one dominant reason to change per module
- `Martin Fowler lens`: one canonical owner per decision; duplicate decision paths are a stronger smell than duplicate lines

The loop should keep going until the artifact is genuinely clearer, not only "acceptable enough to move on".

For channel work, "clearer" should include:

- easier operator mental model
- thinner provider adapters
- fewer duplicated decision paths
- more obvious owner boundaries

## 4. Task Readiness Before Execution

Another strong direction is to split AI work into at least two flows:

### Task-shaping flow

A smaller set of agents specializes in:

- creating tasks
- clarifying the task
- mapping the solution space
- reviewing the contract
- defining outcome and DoD
- pushing tasks toward true `Ready`

These agents should be judged by:

- clarity
- bounded scope
- reviewability
- correct contract and ownership
- whether cross-channel decisions already have one named owner before coding starts

### Task-execution flow

Once a task is truly `Ready`, a different AI flow should be able to execute it with much less human follow-up.

This flow should assume:

- task contract is already sharp
- outcome is already clear
- DoD is already concrete
- validation expectations are already explicit

## 5. Execution Should Converge, Not Stop At First Local Success

Ready tasks still need execution discipline.

Useful tools for that may include:

- queue-based follow-up work
- loop-based repeated review
- explicit convergence passes
- structured progress or artifact checkpoints

The goal is not more verbosity.

The goal is to reduce the common lazy pattern:

- patch one local slice
- stop too early
- skip adjacent-surface review
- leave task closure to human follow-up

## 6. Possible Future Outputs

This brainstorming could later become:

- one stable workflow principles doc
- one reusable AI review checklist
- one task-readiness checklist
- one execution checklist for autonomous AI work in this repo

## Open Questions

- which checklist items should become hard rules versus guidance
- how much of the review loop should be encoded in prompts versus docs versus skills
- whether readiness should be a named backlog status with stricter admission rules
- how much queue or loop automation should be built into the repo versus left to operator flow
- whether the Robert C. Martin lens and Martin Fowler lens should become a default workflow gate for all channel and workflow-sensitive review passes
