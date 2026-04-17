# Architecture Notes And FAQ

Source of truth:

- `docs/overview/human-requirements.md`
- `docs/architecture/v0.2/final-layered-architecture.md`
- `docs/architecture/v0.2/03-component-flows-and-validation-loops.md`
- `docs/architecture/v0.2/04-layer-function-contracts.md`

This file explains the implicit decisions behind the final model.

## 1. What This Architecture Is Trying To Protect

The raw requirements mix several concerns:

- chat routing
- conversation continuity
- active execution
- tmux or API integration
- queue, loop, and backlog behavior
- concurrency limits

The final model protects against one common failure:

everything collapsing into one generic runtime or session service.

That is why the design forces five kinds of truth to stay separate:

- `Surface`
- `Session`
- `Run Control`
- `Runner`
- `Workload`

## 2. Important Implicit Decisions

### Session means system conversation, not runner handle

- `Session` is the durable system concept.
- `sessionId` is only the current runner-side conversation handle.
- One `Session` can link multiple `sessionId`s over time.
- Only one linked `sessionId` should be active at a time.

### Compaction is not `/new`

- Compaction stays in the current `Session`.
- Compaction should not rotate to a new `sessionId` by default.
- Explicit `/new` or recovery-driven re-entry is what may rotate to a new `sessionId`.

### Surface is broader than Slack or Telegram

- A Slack channel, Slack thread, Telegram group, Telegram topic, or API endpoint are all `SurfaceRoute`s.
- The architecture deliberately avoids naming layers after one transport.

### Runner is raw execution, not workflow

- tmux is the main current runner
- API-compatible completion backends also fit here
- SDK-based or ACP-like executors also fit here

Queue, steerability, and backlog admission do not belong in `Runner`.

### Backlog is not session queue

- `SessionQueue` is sequential work inside one conversation.
- `Backlog` is work outside one active conversation.
- `GlobalLoop` usually feeds `Backlog`, not `SessionQueue`.

### Queued is not an active run state

- `queued` belongs to `SessionQueue`.
- an active run starts only when `Run Control` claims the next prompt
- `settled` is a category for terminal run states, not a state name to persist by itself

## 3. Notices

### What this design intentionally does cover

- channel or API entry as `Surface`
- session continuity and rotation
- sequential session work
- direct steering of active runs
- tmux now and API/SDK later
- global workload pressure through `RunnerPool`

### What this design intentionally does not solve here

- exact config file shape
- auth or permission model
- exact storage model
- exact tmux command details
- exact API schema shape
- monorepo layout across TypeScript, Go, and Rust

Those can be layered on top later. They should not distort the core ownership model first.

## 4. Raw Requirement Check

| Raw requirement theme | Final decision |
| --- | --- |
| Session vs runner session id | `Session` owns stable identity; runner `sessionId` is linked and may rotate |
| Slack thread vs channel, Telegram group vs topic | all treated as `SurfaceRoute` variants |
| tmux first, API or SDK later | all fit inside `Runner` |
| queue vs steering | queue stays `Session`; steering stays `Run Control` |
| session-bound loop vs global loop | split between `Session` and `Workload` |
| backlog and concurrency cap | both live in `Workload` |
| state machine for updates | `Run Control` owns run state and transitions |

## 5. Practical FAQ

### Why is `Run Control` separate from `Runner`?

Because raw executor facts and workflow decisions are different truths.

`Runner` knows what tmux or an API emitted.
`Run Control` decides what runner facts mean for active run state and terminal outcomes.

### Why is `SessionQueue` not in `Run Control`?

Because queue order belongs to conversation workflow, not to active execution.

`Run Control` should care about what is running now, not about owning all future prompts.

### Why can `Workload` not call `Runner` directly?

Because that would bypass session truth and recreate hidden execution paths.

Even fresh work should re-enter through `Session`, then continue through `Run Control`.

### Why keep `Surface` separate if it just routes and renders?

Because channel, thread, topic, and API response behavior changes often and should not rewrite conversation or run logic.

### When should a new coordination object be introduced?

Only when multiplicity creates real policy:

- queue ordering
- loop scheduling
- concurrency caps
- backlog admission

Not just to hide helpers behind another name.

## 6. Review Checklist

When reviewing code against this architecture, ask:

1. Is this function deciding more than one kind of truth?
2. Is this layer speaking a lower-layer protocol directly?
3. Is a session concern being mixed with fresh-work scheduling?
4. Is transport-specific logic leaking above `Runner`?
5. Is route-specific logic leaking below `Surface`?

If the answer is yes, the code is drifting away from the architecture.
