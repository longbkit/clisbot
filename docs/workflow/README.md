# Workflow

## Purpose

Use `docs/workflow/` for AI-assisted product and engineering workflow design that is broader than one feature, but not yet a stable architecture contract.

This folder should capture:

- workflow north stars
- review-loop design
- task-readiness flow
- AI-agent operating patterns that improve delivery quality in this repo

## Current Files

- [brainstorm-and-ideas.md](brainstorm-and-ideas.md): current brainstorming notes for shortest-review-first output, review-loop checklists, and task-readiness specialization
- [code-review-checklist.md](code-review-checklist.md): short high-leverage checklist for looping AI code review until naming, mental model, user flow, and risk issues are cleaned up
- [working-prompts.md](working-prompts.md): reusable prompts that are showing good results in real `clisbot` workflow loops
- [ai-agent-operating-preferences.md](ai-agent-operating-preferences.md): review draft of durable AI-agent operating preferences learned from real `clisbot` work, intended as a staging point before selected rules move into `AGENTS.md`
- [decision-and-struggle-patterns.md](decision-and-struggle-patterns.md): review draft of decision patterns and recurring AI struggle patterns to prevent repeated mistakes before selected rules move into `AGENTS.md`

## Current Direction

The current workflow direction is:

- AI should produce the shortest, easiest-to-review artifact first
- review loops should walk the same high-leverage checklist repeatedly until the artifact is truly clear
- tasks should be shaped into `Ready` quality before they are handed to autonomous execution flows
- durable repo-work preferences should be captured in `docs/workflow/` first when they need human review before becoming hard `AGENTS.md` rules
- repeated human corrections should be distilled into decision and struggle patterns, not treated as one-off feedback

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
