# Workflow

## Purpose

Use `docs/workflow/` for AI-assisted product and engineering workflow design that is broader than one feature, but not yet a stable architecture contract.

This folder should capture:

- workflow north stars
- review-loop design
- task-readiness flow
- AI-agent operating patterns that improve delivery quality in this repo

## Current Files

- [audit-program.md](audit-program.md): operating policy for recurring audits, audit-to-task handoff, and the boundary between `features`, `research`, `audits`, and `tasks`
- [workflow-principles-draft.md](workflow-principles-draft.md): draft workflow north stars for shortest-review-first output, user-near review order, task-readiness shaping, and convergence discipline
- [ai-review-checklist.md](ai-review-checklist.md): short high-leverage checklist for looping AI review until naming, mental model, decision ownership, user flow, and risk issues are cleaned up
- [working-prompts.md](working-prompts.md): reusable prompts that are showing good results in real `clisbot` workflow loops
- [agent-rules-review-draft.md](agent-rules-review-draft.md): review draft of durable AI-agent operating rules learned from real `clisbot` work before selected rules are promoted into `AGENTS.md`
- [decision-and-struggle-patterns.md](decision-and-struggle-patterns.md): review draft of decision patterns and recurring AI struggle patterns to prevent repeated mistakes before selected rules move into `AGENTS.md`

## Current Direction

The current workflow direction is:

- AI should produce the shortest, easiest-to-review artifact first
- review loops should walk the same high-leverage checklist repeatedly until the artifact is truly clear
- tasks should be shaped into `Ready` quality before they are handed to autonomous execution flows
- durable repo-work preferences should be captured in `docs/workflow/` first when they need human review before becoming hard `AGENTS.md` rules
- repeated human corrections should be distilled into decision and struggle patterns, not treated as one-off feedback
- recurring audits should generate evidence in `docs/audits/` and feed follow-up work into `docs/tasks/` without replacing stable feature truth in `docs/features/`

Current owner split:

- `workflow-principles-draft.md` owns workflow direction and shaping heuristics
- `ai-review-checklist.md` owns the reusable review loop
- `agent-rules-review-draft.md` owns candidate durable operating rules before `AGENTS.md`
- `working-prompts.md` owns concrete prompts that are proving useful in practice
- `decision-and-struggle-patterns.md` owns recurring failure modes and decision-style corrections

## Boundaries

Use this folder for workflow thinking such as:

- how AI should stage work
- how review loops should converge
- how readiness should be judged
- how human and AI handoff should become lower-friction over time

Do not use this folder for:

- stable product contracts that already belong in `docs/features/`
- system ownership rules that already belong in `docs/architecture/`
- task-by-task tracking that belongs in `docs/tasks/`
