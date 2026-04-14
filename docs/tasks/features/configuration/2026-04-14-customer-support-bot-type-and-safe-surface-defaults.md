# Customer-Support Bot Type And Safe Surface Defaults

## Summary

Add a first-run `customer-support` bot type that seeds safer public-surface defaults than the current `personal` and `team` options.

## Status

Planned

## Why

Customer-support deployments care more about controlled visibility and lower accidental disclosure than internal team bots.

That makes them a poor fit for inheriting the same defaults as internal assistant setups.

## Desired Direction

- add `--bot-type customer-support`
- map it to a dedicated bootstrap template instead of overloading `team`
- seed safer channel defaults, starting with `verbose: "off"` on public-facing routes unless the operator opts in
- review whether other defaults should change too, such as follow-up posture, prompt guidance, and transcript visibility messaging

## Non-Goals

- shipping the new bot type inside the current transcript-visibility patch
- renaming existing internal bootstrap modes before the customer-support shape is settled

## Exit Criteria

- a dedicated bootstrap path exists for customer-support setups
- public docs explain when to choose it
- its default route policies are intentionally safer than `personal` and `team`
