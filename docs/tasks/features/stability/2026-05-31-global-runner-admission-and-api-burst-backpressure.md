# Global Runner Admission And API Burst Backpressure

## Status

Planned.

## Problem

The API channel can receive many external events at once. Today, clisbot has a
session-scoped queue, but no global runner/session admission cap. A burst across
many API conversations can start many runner sessions concurrently.

## Current Behavior

- Work for the same `sessionKey` is serialized by `AgentJobQueue`.
- Durable pending queue items are capped per session by
  `control.queue.maxPendingItemsPerSession`, default `20`.
- Different API conversations can map to different `sessionKey` values and can
  trigger independent runner startup concurrently.
- There is no global runner pool, `maxActiveRuns`, or
  `maxConcurrentRunnerStarts` gate yet.

## Goal

Add bounded admission/backpressure for fresh runner work without weakening the
existing session queue model.

## Scope

- Add a clear global capacity policy for runner startup or active runs.
- Decide whether overflow should wait in a bounded app/bot queue or fail fast
  with an explicit result status such as API `429` or failed result metadata.
- Keep same-session ordering owned by the session queue.
- Add per-bot and/or per-conversation API caps if needed to prevent webhook
  storms from exhausting the runtime.
- Surface truthful status in API result records and operator diagnostics.

## Non-Goals

- Do not merge API result storage into the session store.
- Do not replace the existing per-session queue.
- Do not introduce a broad Workload/RunnerPool architecture rewrite unless the
  small limiter proves insufficient.

## Related Docs

- [Runtime Architecture](../../../architecture/runtime-architecture.md)
- [API Channel](../../../user-guide/api-channel.md)
- [Agent Progress Replies](../../../user-guide/agent-progress-replies.md)
- [v0.2 Component Flows](../../../architecture/v0.2/03-component-flows-and-validation-loops.md)
