# Runtime Process Identity Fencing

## Status

Accepted

## Date

2026-08-04

## Context

Detached runtime coordination persists `clisbot.pid` and
`clisbot-monitor.json` under `CLISBOT_HOME`. Those files may survive a host or
container restart even though the monitor and runtime worker do not.

Operating systems reuse numeric process ids. A later unrelated process can
therefore receive the same pid recorded for an old clisbot monitor or worker.
Checking only whether that pid is alive can produce two unsafe outcomes:

- `start` reports an unrelated process as an already-running monitor and never
  launches clisbot
- `stop` or orphan cleanup sends a signal to an unrelated process

In a health-gated container, the first outcome can become a permanent restart
loop because every new container repeats the same deterministic pid collision.

## Problem

A pid is a locator, not process identity. Runtime lifecycle commands need a
shared rule that distinguishes the process originally recorded by clisbot from
a later process that merely reused the same number.

## Considered Options

### Continue using pid liveness only

Rejected. It preserves the restart-loop and wrong-process signal risks.

### Make pid and monitor files ephemeral in every deployment

Useful defense in depth, especially for containers, but insufficient as the
product contract. Host restarts and custom persistent runtime paths can still
leave stale files, and clisbot should remain safe without deployment-specific
cleanup scripts.

### Add a monitor control socket

A live IPC handshake would provide strong ownership proof, but it adds a new
control protocol and migration surface. Keep it as a future option if lifecycle
commands need richer monitor coordination.

### Fence pid references with OS process metadata

Selected. A recorded monitor or worker is considered live only when:

- the pid is alive
- the process command contains the expected clisbot role (`serve-monitor` or
  `serve-foreground`)
- the OS-reported process start time matches the corresponding persisted
  monitor-state timestamp within a small startup tolerance

When monitor state is temporarily absent, a pid-file-only monitor may be used
only if its command still identifies it as `serve-monitor`.

## Decision

All detached lifecycle paths must share process identity fencing:

- `start` ignores stale/reused pids and launches a fresh monitor
- `status` reports `running` only for a verified monitor
- `stop` and orphan cleanup signal only verified monitor or worker processes

The monitor state remains the coordination record. Its existing `startedAt`
timestamp identifies the monitor start, and the active state's `updatedAt`
timestamp identifies the worker spawn. Numeric pids alone are never sufficient
proof when persisted state is available.

Container deployments should still avoid persisting transient process files
when practical, but that is defense in depth rather than the correctness
boundary.

## Consequences

Good:

- persisted state can survive process or container restarts without trapping
  startup in an `already running` false positive
- lifecycle commands no longer signal arbitrary processes after pid reuse
- start, status, and stop use one process-truth rule

Tradeoffs:

- lifecycle inspection invokes `ps` for low-frequency operator commands
- platforms must expose process start time and command metadata; Linux and
  macOS are the supported host platforms
- a pid-file-only monitor can be recognized by role, but full start-time
  fencing requires monitor state

## Links

- [Cross-Process Runtime State](2026-05-30-cross-process-runtime-state.md)
- [Runtime Architecture](../runtime-architecture.md)
- [Persistence Store Inventory](../persistence-stores.md)
