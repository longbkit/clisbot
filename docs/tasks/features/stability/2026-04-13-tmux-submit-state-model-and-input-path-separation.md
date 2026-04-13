# tmux Submit State Model And Input Path Separation

## Summary

Split tmux input handling into clearer long-term paths instead of letting one submit-confirmation rule silently cover every case.

The immediate submit-truthfulness fix now improves reliability with bounded `Enter` retry plus pane-state confirmation, but it still uses one shared confirmation model for different kinds of input.

This follow-up task separates that long-term refactor from the urgent reliability fix.

## Status

Planned

## Why

The current submit-truthfulness slice is intentionally narrow:

- bracketed paste instead of raw literal key injection
- short pane-state confirmation after `Enter`
- one explicit `Enter` retry only when pane state does not change

That is a good near-term stability improvement, but it is not yet the cleanest long-term model.

Different input categories have different semantics:

- submitting a fresh prompt into an idle session
- steering or injecting text into an already-active run
- slash-style control input used for session identity capture or status checks

Keeping one implicit confirmation rule across those paths risks hidden side effects later, especially if a terminal redraw, prompt UI change, or active runner state makes pane-state movement ambiguous.

## Scope

- define separate input-path semantics for:
  - idle prompt submit
  - active-run steering submit
  - internal status or handshake submits
- decide which confirmation signals belong to each path
- design an explicit submit state model, likely with milestones such as:
  - input delivered
  - enter confirmed
  - first run signal observed
- document which failures should retry, which should fail fast, and which should stay observer-only
- keep the latency budget tight and avoid hidden retries or duplicate prompt delivery

## Non-Goals

- replacing the current narrow submit fix in the same batch
- adding broad compatibility fallback modes
- building a runner-agnostic protocol for all future non-tmux backends in this slice

## Desired Outcome

- `clisbot` has explicit, path-specific submit semantics instead of one shared implicit rule
- idle prompt delivery and active steering delivery can evolve independently without hidden coupling
- operators can reason about submit truthfulness from logs and docs without guessing which fallback rule fired

## Related Docs

- [tmux Submit Truthfulness And Telegram Send Reliability](2026-04-12-tmux-submit-truthfulness-and-telegram-send-reliability.md)
- [Stability](../../../features/non-functionals/stability/README.md)
