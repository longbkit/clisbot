# T3 Unified Distribution Boundary

## Status

Proposed

## Date

2026-08-12

## Context

clisbot needs a richer web surface for code-change review, document reading,
conversation sharing, channel configuration, and cross-surface approvals. T3
Code already provides a strong web/provider experience, but clisbot must retain
ownership of channel connections, credentials, routes, provider-specific
rendering, and external surface access.

The product should start with one command and default to a web-enabled mode,
while still supporting a headless deployment. The integration requires changes
to T3 navigation, server wiring, auth/resource ACL, and conversation sharing,
so it also needs an upstream maintenance strategy.

## Problem

Choose a boundary that:

- feels like one product to the user
- does not duplicate channel config or credentials
- keeps T3 provider and clisbot channel failures isolated
- supports bidirectional event and approval flows
- preserves current tmux/ACP paths
- can absorb frequent T3 upstream changes without repeatedly copying the
  whole source tree

## Considered Options

### Loose product linking

Run T3 and clisbot independently and exchange URLs or manual shares. This is a
low-cost prototype but does not provide one control plane or one-command
lifecycle.

### Unified distribution with isolated runtimes

One launcher supervises clisbot and T3. T3 hosts the web experience and its
provider conversations; clisbot hosts channel control and delivery. A typed,
revision-aware local contract joins them.

### Merge T3 into clisbot

Vendor and reshape T3 as clisbot-owned code or one process. This reduces the
visible process count but maximizes coupling, failure blast radius, and
upstream merge cost.

### T3 as visual client only

Render clisbot runs in T3 without using T3 provider orchestration. This fits
current clisbot session ownership but loses substantial T3 behavior and is
better as a compatibility view for existing runner sessions.

### ACP as the only boundary

Use ACP for all interoperation. ACP does not cover channel installation,
surface binding, resource ACL, delivery policy, sharing, or provider-specific
rendering, and T3's Claude provider is not ACP-based.

## Proposed Decision

Adopt a unified distribution with isolated runtimes.

- `clisbot start` defaults to `ui` and supervises clisbot, T3 server/provider
  runtime, and the integrated web app.
- `clisbot start --mode headless` omits the web surface but retains the T3 API
  required by T3-backed conversations.
- clisbot is the canonical owner of channel connections, secrets, bots,
  routes, external principals, policies, surface bindings, and channel
  delivery.
- T3 is the canonical owner of T3 conversations, provider runs, code changes,
  checkpoints, and the web experience.
- for a T3-backed route, clisbot owns the stable binding from `sessionKey` to
  T3 conversation id; T3 owns native run truth. Existing tmux and ACP routes
  keep their current ownership.
- the integration uses resource-oriented, revision-aware contracts and
  idempotent event/approval decisions.

Maintain T3 changes in a writable fork that tracks `pingdotgg/t3code` as
`upstream`. Keep implementation in T3-owned integration folders, keep core hook
changes minimal and feature-gated, and pin one tested fork artifact in the
clisbot compatibility manifest.

Do not use a literal Git mirror as the working change repository. Do not use
subtree as the default source strategy. A submodule may help source developers,
but it is not the end-user distribution mechanism.

This decision remains **Proposed** because T3-backed run ownership extends the
current runtime architecture. It must become Accepted, with corresponding
updates to the stable runtime and domain-language docs, before implementation
claims this as shipped architecture.

## Rationale

The selected boundary gives users one start and one UI while preserving one
truth owner per concern. It limits upstream conflicts to explicit T3 hooks,
lets each runtime use its native framework and release tests, and allows a
single pinned artifact change to update or roll back T3.

A maintained fork supports ordinary branches, reviews, bisects, and upstream
pull requests. Subtree would place T3 history and conflicts inside clisbot;
patch stacks would be brittle for UI/auth changes; external packages would
pretend T3 has stable extension points before it does.

## Consequences

Good:

- one-command product and default web experience
- truthful ownership of config, secrets, provider execution, and rendering
- independent health and restart reporting
- feature-off T3 parity can be tested
- upstream changes remain reviewable in their native repository

Tradeoffs:

- two runtime processes and a compatibility matrix must be supervised
- T3 needs server-side actor and conversation ACL changes
- cross-runtime delivery needs cursors, retries, idempotency, and loop
  prevention
- release gates must cover both repositories and provider compatibility
- current runtime architecture needs an explicit extension for T3-backed runs

## Supersession And Conflict Notes

This proposal does not supersede the current session continuity or
cross-process state decisions. If accepted, it must cross-link and clarify the
T3-backed exception in:

- [Runtime Architecture](../runtime-architecture.md)
- [Domain Language](../domain-language.md)
- [Session Key And Session Id Continuity](2026-05-01-session-key-and-session-id-continuity-decision.md)
- [Cross-Process Runtime State](2026-05-30-cross-process-runtime-state.md)

Until then, those accepted documents remain the stable implementation
contract.

## Links

- [T3 Unified Channel Control Plane](../../features/channels/t3code-unified-channel-control-plane.md)
- [T3 Code And clisbot Unified Product Options](../../research/channels/2026-08-12-t3code-clisbot-unified-product-options.md)
- [Surface Architecture](../surface-architecture.md)
- [Persistence Store Inventory](../persistence-stores.md)
