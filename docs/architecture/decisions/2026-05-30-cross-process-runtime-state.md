# Cross-Process Runtime State

## Status

Accepted

## Date

2026-05-30

## Context

clisbot is not a single-process application in normal operation. A long-lived
runtime may own channel listeners and active agent runs, while one-shot CLI
commands, monitor processes, detached runtimes, and tests can start separate OS
processes against the same `CLISBOT_HOME`.

The API bot result flow exposed the risk directly: an HTTP listener held a
`ChannelResultStore` instance in memory while `clisbot message send --channel
api` ran as another process and wrote the final result to the same results
file. Same-process tests passed, but the listener served stale cached state
until the store learned to reload when the file version changed.

## Decision

Runtime-facing state must be designed with process boundaries in mind.

When more than one process may read or mutate the same state, the feature must
choose one explicit coordination model:

- a durable store that reloads or validates its cached view before reads
- an IPC or runtime command path that asks the owner process to mutate or read
  state
- a single-process invariant documented and enforced by the entrypoint

In-memory state is valid only inside the process that owns it. It is not shared
truth for CLI commands, HTTP listeners, monitors, or detached runtimes unless an
explicit synchronization path exists.

Tests for runtime/control features should include a cross-process or
independent-store-view regression when the feature is accessed by both a
long-lived runtime and a one-shot CLI command.

## Consequences

Good:

- operator CLI behavior can stay truthful while the runtime is already running
- local e2e tests catch stale cache issues that unit tests miss
- future channel result/state features can reuse a clear rule instead of
  rediscovering the boundary

Tradeoff:

- file-backed stores need version checks, reloads, or owner-process routing
  even when the same-process implementation looks simpler

## Links

- [Runtime Architecture](../runtime-architecture.md)
- [Persistence Store Inventory](../persistence-stores.md)
- [Generic API Channel Events And Actions](2026-05-25-generic-webhook-channel-connectors.md)
