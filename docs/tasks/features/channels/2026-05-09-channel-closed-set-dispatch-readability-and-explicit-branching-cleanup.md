# Channel Closed-Set Dispatch Readability And Explicit Branching Cleanup

## Summary

Clean up channel dispatch code paths that rely on implicit closed-set reasoning such as early-return plus ternary or generic `else` branches, and replace them with more explicit branching where that materially improves readability and trust.

## Status

Planned

## Why

Some current channel logic is technically correct but harder to review than it needs to be.

Example pattern:

- one channel handled with an early return
- the remaining union members handled with `channel === "x" ? ... : ...`
- an `else` branch that is only safe because the union is currently closed

This style creates avoidable review friction:

- readers may think a channel was forgotten
- readers must re-derive the remaining union members mentally
- code feels more fragile than it actually is

The issue is readability and trust, not necessarily runtime correctness.

## Scope

- identify closed-set channel branches that depend on implicit `else` reasoning
- prefer explicit `if` branches or small dispatch maps where behavior becomes clearer
- keep behavior unchanged in the cleanup pass
- document where exhaustive dispatch should be preferred over clever compact branching

## Non-Goals

- broad feature redesign
- introducing abstraction layers just for style if a simple explicit branch is clearer
- changing runtime semantics in the same pass

## Suggested Targets

- channel-specific normalization helpers
- channel-specific config binding helpers
- small channel dispatch utilities that currently mix early returns with implicit fallback branches

## Validation Notes

When implementation happens later, verify:

- behavior is unchanged
- tests still pass unchanged or need only readability-driven fixture updates
- channel additions become easier to review after the cleanup, not harder

## Exit Criteria

- the main closed-set channel dispatch hotspots are rewritten in explicit, readable form
- reviewers no longer need to infer hidden union-member coverage from `else` branches
- cleanup stays low-blast-radius and behavior-preserving

## Related Docs

- [Channel Behavior Config Target Binding Standardization](2026-05-09-channel-behavior-config-target-binding-standardization.md)
- [Channel Processing Indicator Adapter Standardization](2026-05-09-channel-processing-indicator-adapter-standardization.md)
