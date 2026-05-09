# clisbot Repo Operating Skill From Architecture Docs

## Summary

Create a repo-specific AI skill for working inside `clisbot` by turning the stable architecture and operator docs into a compact, reusable operating guide for Codex or Claude.

## Status

Planned

## Why

`clisbot` already has strong architecture and task docs, but they are still optimized more for humans reading the repo than for repeated AI execution inside the repo.

That creates unnecessary setup cost on repeated sessions:

- agents need to rediscover read order and boundary rules
- architecture docs stay passive instead of becoming an active operating contract
- repo-specific commands, verification norms, and documentation precedence are easy to miss or restate inconsistently
- good prompts can still drift into broad repo exploration instead of the smallest truthful context slice

The goal is to convert the existing architecture and workflow intent into a skill that another AI agent can load and follow with low ambiguity.

## Scope

- define the target skill shape for working in the `clisbot` repo
- use the existing stable docs as the primary source, especially:
  - `docs/architecture/`
  - `docs/tasks/`
  - `docs/features/` and `docs/user-guide/` where they define current truth
- encode repo-specific read order, decision boundaries, and verification defaults into the skill
- make the skill explicitly teach:
  - which docs are contract vs support
  - when to read backlog vs feature docs vs user-guide docs
  - how to keep docs, tests, CLI help, and release notes aligned
  - how to avoid architecture drift while still making pragmatic changes
- decide whether the architecture docs should stay as source docs plus a thin skill wrapper, or whether some guidance should move into skill references for better AI usability
- keep the skill narrow to repo operation; do not mix it with general coding-agent philosophy

## Non-Goals

- replacing the architecture docs as the human-facing source of truth
- duplicating large parts of the docs tree inside the skill
- creating a generic skill for every TypeScript or Bun repo
- rewriting stable architecture just to fit the skill format

## Candidate Deliverables

- one new skill package in the shared skills repo for `clisbot` repo work
- a thin `SKILL.md` that defines trigger conditions, read order, and escalation rules
- small reference files for:
  - repo map and ownership
  - doc precedence and loading strategy
  - verification and rollout rules
- explicit mapping from current architecture docs to skill sections so future doc changes can stay synchronized

## Open Questions

- Should this live as a reusable shared skill or a repo-local skill first?
- Should the skill target only Codex/Codex-style agents, or both Codex and Claude Code equally?
- Which guidance belongs in the skill versus staying solely in `AGENTS.md`?
- How much of `docs/workflow/` is stable enough to promote into the skill now?

## Exit Criteria

- another AI agent can enter the repo and reliably discover the right docs in the right order without broad re-reading
- architecture boundary rules are represented in a form that is easy to apply during real implementation work
- repo-standard commands and validation expectations are discoverable from the skill
- the skill stays DRY with the docs instead of becoming a second architecture source of truth
- there is a clear maintenance rule for keeping the skill aligned with future architecture or workflow doc changes

## Related Docs

- [Architecture Overview](../../../architecture/architecture-overview.md)
- [Surface Architecture](../../../architecture/surface-architecture.md)
- [Runtime Architecture](../../../architecture/runtime-architecture.md)
- [Model Taxonomy And Boundaries](../../../architecture/model-taxonomy-and-boundaries.md)
- [Task Docs](../../README.md)
- [clisbot Backlog](../../backlog.md)
- [Overview](../../../overview/README.md)
- [Agent Rules Review Draft](../../../workflow/agent-rules-review-draft.md)
- [Decision And Struggle Patterns](../../../workflow/decision-and-struggle-patterns.md)
