# Layer Function Contracts

Source of truth:

- `docs/overview/human-requirements.md`
- `docs/architecture/v0.2/final-layered-architecture.md`
- `docs/architecture/v0.2/03-component-flows-and-validation-loops.md`

This file freezes the implementation-facing contract surface.

Goal:

- one glossary
- one naming style
- one owner per function

## 1. Canonical Glossary

| Term | Meaning |
| --- | --- |
| `Surface` | where input arrives and replies render |
| `SurfaceRoute` | concrete address on a surface |
| `Session` | one conversation owned by the system |
| `sessionKey` | stable system-side conversation identity |
| `sessionId` | current runner-side conversation identity |
| `Run` | one active execution for one session |
| `SteeringInput` | direct input into a running run |
| `Runner` | raw executor boundary |
| `SessionLoop` | repeated prompt bound to one session |
| `BacklogItem` | work item outside one active session |
| `GlobalLoop` | repeated prompt not bound to one session |
| `RunnerPool` | concurrency cap for runner usage |

## 2. Naming Rules

### Prefixes

| Layer | Prefix |
| --- | --- |
| `Surface` | `surface` |
| `Session` | `session` |
| `Run Control` | `run` |
| `Runner` | `runner` |
| `Workload` | `backlog`, `globalLoop`, `runnerPool` |

### Suffixes

| Suffix | Meaning |
| --- | --- |
| `Ref` | stable internal reference |
| `Input` | caller-provided payload |
| `Spec` | declarative rule or config |
| `State` | owned lifecycle state |
| `Event` | emitted fact |
| `Result` | stable returned outcome |

### Verb set

Prefer:

- `resolve`
- `rotate`
- `append`
- `pull`
- `start`
- `steer`
- `apply`
- `read`
- `open`
- `submit`
- `close`
- `add`
- `tick`
- `acquire`
- `release`

Avoid:

- `manage`
- `handle`
- `process`
- `monitor`
- `execute`

## 3. Shared Types

| Type | Meaning |
| --- | --- |
| `SessionQueueState` | queue ownership state before a prompt becomes an active run |
| `SessionRuntimeState` | session projection state: `idle`, `running`, or `detached` |
| `RunState` | active-run state owned by `Run Control` |
| `SurfaceRouteRef` | resolved route on a surface |
| `SessionRef` | stable internal session reference |
| `SessionCreateInput` | request to start a fresh session |
| `SessionPromptInput` | prompt destined for one session |
| `RunRef` | stable active-run reference |
| `RunEvent` | normalized run fact for upper layers |
| `RunnerSessionRef` | raw runner-side session handle |
| `RunnerPromptInput` | normalized prompt payload for runner submission |
| `RunnerEvent` | raw fact emitted by the runner boundary |
| `SessionLoopSpec` | rule for a session-bound loop |
| `BacklogItemSpec` | fresh-session work description |
| `GlobalLoopSpec` | rule for a global loop |
| `RunnerPoolLease` | granted runner capacity slot |

## 4. Layer Contracts

### Surface

| Function | Input | Output | Description |
| --- | --- | --- | --- |
| `surfaceResolveRoute` | `SurfaceInput` | `SurfaceRouteRef` | Normalize the incoming address into one route reference. |
| `surfaceRenderReply` | `SurfaceRouteRef`, `SurfaceReplyInput` | `SurfaceRenderResult` | Render a normal reply to the route. |
| `surfaceRenderRunEvent` | `SurfaceRouteRef`, `RunEvent` | `SurfaceRenderResult` | Render progress or settlement already decided below. |

Do not place session or run decisions here.

### Session

| Function | Input | Output | Description |
| --- | --- | --- | --- |
| `sessionCreate` | `SessionCreateInput` | `SessionRef` | Create a fresh session for new work. |
| `sessionResolve` | `SurfaceRouteRef` | `SessionRef` | Resolve the current conversation for one route. |
| `sessionRotate` | `SessionRef`, `SessionRotateInput` | `SessionRef` | Keep the same `sessionKey` but move to a new active `sessionId`. |
| `sessionAppendPrompt` | `SessionRef`, `SessionPromptInput` | `SessionQueueResult` | Append a prompt to the session queue. |
| `sessionPullPrompt` | `SessionRef` | `SessionPromptInput \| null` | Return the next prompt eligible to run. |
| `sessionAddLoop` | `SessionRef`, `SessionLoopSpec` | `SessionLoopRef` | Register a loop bound to one session. |
| `sessionTickLoop` | `SessionLoopRef` | `SessionPromptInput` | Emit the next prompt from a session-bound loop. |

Do not place active run or raw runner protocol here.

### Run Control

| Function | Input | Output | Description |
| --- | --- | --- | --- |
| `runStart` | `SessionRef`, `SessionPromptInput` | `RunRef` | Create the active run for the next prompt. |
| `runResolveCurrent` | `SessionRef` | `RunRef \| null` | Return the current active run for a session. |
| `runSteer` | `RunRef`, `SteeringInput` | `RunSteerResult` | Inject direct input into a steerable run. |
| `runApplyRunnerEvent` | `RunRef`, `RunnerEvent` | `RunTransition` | Translate raw runner facts into run-state transitions. |
| `runSettle` | `RunRef`, `RunSettleInput` | `RunResult` | Close the run with a terminal result. |

Do not place route or session continuity decisions here.

### Runner

| Function | Input | Output | Description |
| --- | --- | --- | --- |
| `runnerOpenSession` | `RunnerSessionRequest` | `RunnerSessionRef` | Open, attach, or reuse a runner-side session. |
| `runnerSubmitPrompt` | `RunnerSessionRef`, `RunnerPromptInput` | `RunnerSubmitResult` | Submit a prompt through the native runner protocol. |
| `runnerSubmitSteering` | `RunnerSessionRef`, `SteeringInput` | `RunnerSubmitResult` | Submit steering through the native runner protocol. |
| `runnerReadEvents` | `RunnerSessionRef` | `RunnerEventStream` | Read raw facts from the runner boundary. |
| `runnerCloseSession` | `RunnerSessionRef` | `RunnerCloseResult` | Close or release the runner-side session. |

Do not place queue, loop, or session truth here.

### Workload

| Function | Input | Output | Description |
| --- | --- | --- | --- |
| `backlogAdd` | `BacklogItemSpec` | `BacklogItemRef` | Register work that may run in a fresh session. |
| `backlogPull` | none | `BacklogItemSpec \| null` | Return the next backlog item eligible for admission. |
| `globalLoopAdd` | `GlobalLoopSpec` | `GlobalLoopRef` | Register a loop not bound to one session. |
| `globalLoopTick` | `GlobalLoopRef` | `BacklogItemSpec` | Emit fresh-session work from one global loop tick. |
| `runnerPoolAcquire` | `RunnerPoolRequest` | `RunnerPoolLease \| RunnerPoolDenyResult` | Grant or deny capacity for new work. |
| `runnerPoolRelease` | `RunnerPoolLease` | `RunnerPoolReleaseResult` | Release capacity after work settles. |

Do not bypass `Session` or `Run Control` from here.

## 5. Allowed Hand-Offs

| From | To | Hand-off |
| --- | --- | --- |
| `Surface` | `Session` | `surfaceResolveRoute -> sessionResolve` |
| `Session` | `Run Control` | `sessionPullPrompt -> runStart` |
| `Session` | `Run Control` | `sessionResolve -> runResolveCurrent -> runSteer` |
| `Run Control` | `Runner` | `runnerOpenSession`, `runnerSubmitPrompt`, `runnerSubmitSteering`, `runnerReadEvents` |
| `Runner` | `Run Control` | `RunnerEvent -> runApplyRunnerEvent` |
| `Run Control` | `Surface` | `RunEvent -> surfaceRenderRunEvent` |
| `Workload` | `Session` | backlog or global-loop work re-enters through `sessionCreate` or `sessionResolve` |

Anything outside these paths should be treated as suspicious.

## 6. Placement Test

| If the function mainly decides... | Put it in... |
| --- | --- |
| where a message belongs or where a reply appears | `Surface` |
| whether turns still belong to the same conversation | `Session` |
| whether a prompt is still queued inside one session | `Session` |
| whether an active run is starting, running, detached, or terminal | `Run Control` |
| how to talk to tmux, API, or SDK | `Runner` |
| whether fresh work should wait because of global pressure | `Workload` |

If one function wants to answer two rows, split it.

## 7. Guardrails

- one concept, one noun
- one owner, one prefix
- no synonym if the glossary already has the word
- no different verbs for the same action across layers

## 8. Sanity Test

If a proposed function:

- changes session continuity and run lifecycle at once
- talks about route rendering and raw runner protocol at once
- decides backlog admission and active steering at once

then it is not aligned with this architecture and should be split.
