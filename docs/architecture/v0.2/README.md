# Architecture v0.2

This folder is a clean-slate architecture exercise driven only by:

- `docs/overview/human-requirements.md`

It intentionally does **not** use the rest of the repository docs as design input.

The goal is to re-synthesize the architecture from human requirements first, then converge on a simpler and more truthful model.

## Files

- `01-five-candidates.md`
  Five distinct architecture candidates built from the human requirements only.
- `02-shortlist-and-iterations.md`
  Decision factors, shortlist, iteration notes, and convergence logic.
- `03-component-flows-and-validation-loops.md`
  Communication flows between layers, raw-requirement validation, and iterative refinement rounds.
- `04-layer-function-contracts.md`
  Canonical glossary, naming rules, and layer-by-layer function contracts aligned to the final architecture.
- `05-architecture-notes-and-faq.md`
  Companion notes for implicit decisions, notices, raw-requirement interpretation, and review FAQ.
- `06-state-machines.md`
  Canonical split between queue state, session runtime state, and active run state.
- `final-layered-architecture.md`
  The final 1-2 page design: layers, owners, placement rules, and FAQ.

## Read Order

- Read `01` and `02` for exploration history.
- Read `final-layered-architecture.md`, `03`, and `04` for the converged model.
- Read `05` when you need the reasoning behind the model, not just the model itself.
- Read `06` when reviewing lifecycle naming, transitions, and state ownership.

## Validation Rule For This v0.2 Pass

This pass validates ideas against the requirements in `human-requirements.md`, not against older docs.

That means:

- requirement coverage matters
- mental-model clarity matters
- owner-boundary clarity matters
- later code/doc reconciliation is a separate step
