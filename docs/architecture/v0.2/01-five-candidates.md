# Five Architecture Candidates

Source of truth for this document:

- `docs/overview/human-requirements.md`

No other repository docs were used as architecture input for this pass.

## Requirement Digest Used For Validation

These are the decisive requirements extracted from the human brief:

| ID | Requirement |
| --- | --- |
| R1 | Session is a conversation context with one stable `sessionKey`, mapped over time to one active runner-side `sessionId`, but capable of linking to multiple historical `sessionId`s. |
| R2 | Chat surface is not the same thing as session. A channel, thread, group, or topic can host the conversation. |
| R3 | Runner is an executor abstraction. Today tmux CLI is primary, later API/SDK/ACP variants may exist. |
| R4 | Multiple objects of the same kind may need managers or pools, but only when justified. |
| R5 | Runner needs a state machine to update its caller. |
| R6 | Session queue is sequential workflow, different from direct CLI prompt queue. |
| R7 | Steering is the direct injection path into a running turn. |
| R8 | Global backlog may exist outside any one session and may spawn fresh sessions. |
| R9 | Loops can be session-bound or global, and can inject by queue mode or steer mode. |
| R10 | Runner pool may cap concurrent execution. |

## Candidate A. Session-Centric Core

### Core idea

Make `Session` the main aggregate. Almost everything hangs off it.

### Main objects

- `ChatSurface`
- `Session`
- `SessionQueue`
- `SessionLoopList`
- `RunnerBinding`
- `Runner`
- `RunnerStateMachine`
- `Backlog`
- `RunnerPool`

### Owner rules

- `ChatSurface` only maps inbound messages to a `Session`.
- `Session` owns:
  - current linked `sessionId`
  - queue of pending prompts
  - session-bound loops
  - steering admission
  - relationship to active runner execution
- `Runner` only executes.
- `Backlog` owns work that may create fresh sessions.

### Why it is attractive

- Closest to the human mental model: “a conversation has a session”.
- Queue and loops naturally belong to the session.
- Easy to explain to operators.

### Main weakness

- Risk of overloading `Session` with too many responsibilities:
  - workflow
  - execution state
  - queueing
  - steering
  - sessionId mapping

### Validation

| Requirement | Result | Note |
| --- | --- | --- |
| R1 | Pass | Session naturally owns `sessionKey -> sessionId` mapping. |
| R2 | Pass | Chat surface is clearly outside session. |
| R3 | Pass | Runner remains abstract. |
| R4 | Partial | Still needs discipline to avoid too many managers. |
| R5 | Pass | Runner state machine exists. |
| R6 | Pass | Session queue fits very well. |
| R7 | Pass | Steering can be a session-owned action. |
| R8 | Pass | Backlog stays outside session. |
| R9 | Pass | Session loops fit; global loops still need separate list. |
| R10 | Pass | Runner pool can stay external. |

## Candidate B. Surface-Centric Routing Core

### Core idea

Make `ChatSurface` the central aggregate. A thread/topic/channel route is the first-class object; session is mostly an attached execution context.

### Main objects

- `ChatSurface`
- `SurfaceRoute`
- `SurfaceConversation`
- `SessionRef`
- `Runner`
- `RunnerStateMachine`
- `SurfaceQueue`
- `SurfaceLoopList`
- `Backlog`

### Owner rules

- `ChatSurface` owns routing, queueing, loops, and current conversation attachment.
- `Session` becomes a lower-level execution context under the surface.

### Why it is attractive

- Very natural for Slack thread / Telegram topic UX.
- Surface behavior is explicit.

### Main weakness

- The human requirements define session as a stronger concept than surface.
- Risk of making session identity secondary when it should be first-class.
- Harder to support APIs where no human chat surface exists.

### Validation

| Requirement | Result | Note |
| --- | --- | --- |
| R1 | Partial | Session becomes too subordinate. |
| R2 | Pass | Surface is explicit. |
| R3 | Partial | Works, but API-like runner paths fit less cleanly. |
| R4 | Pass | Still simple. |
| R5 | Pass | Runner state machine still possible. |
| R6 | Partial | Queue becomes surface-owned rather than session-owned. |
| R7 | Pass | Steering can still exist. |
| R8 | Partial | Backlog feels bolted on. |
| R9 | Partial | Global loops fit awkwardly. |
| R10 | Pass | Pool still possible. |

## Candidate C. Workflow-Centric Core

### Core idea

Make `Task` or `WorkflowItem` the primary object. Session is mostly an execution container for sequential work.

### Main objects

- `WorkflowItem`
- `WorkflowQueue`
- `Session`
- `Runner`
- `RunnerStateMachine`
- `SteeringChannel`
- `LoopScheduler`
- `Backlog`
- `RunnerPool`

### Owner rules

- `WorkflowQueue` owns sequential prompt processing.
- `Session` is the context container that items may reuse.
- `Runner` executes the current item.

### Why it is attractive

- Strong fit for “do coding, then review, then test”.
- Makes backlog and global loops very natural.

### Main weakness

- The human requirements start with conversation and session, not workflow item.
- This design is powerful but may be too abstract for MVP and operator clarity.

### Validation

| Requirement | Result | Note |
| --- | --- | --- |
| R1 | Partial | Session exists but no longer feels primary. |
| R2 | Pass | Surface still separate. |
| R3 | Pass | Runner abstraction preserved. |
| R4 | Partial | More objects and managers appear quickly. |
| R5 | Pass | Runner state machine fits. |
| R6 | Pass | Strongest model for sequential queue. |
| R7 | Pass | Steering can bypass queue. |
| R8 | Pass | Excellent fit for backlog. |
| R9 | Pass | Loop scheduler fits naturally. |
| R10 | Pass | Pool fits naturally. |

## Candidate D. Layered Control Plane + Runner Adapters

### Core idea

Split by layer, not by one dominant aggregate:

1. Surface layer
2. Conversation layer
3. Run control layer
4. Runner adapter layer
5. Capacity layer

### Main objects

- `ChatSurface`
- `Session`
- `Run`
- `PromptQueue`
- `SteeringInput`
- `Loop`
- `Backlog`
- `RunnerAdapter`
- `RunnerPool`

### Owner rules

- Surface layer: receives and renders.
- Conversation layer: session identity and session-scoped workflow.
- Run control layer: active run, state machine, steering, dispatch.
- Runner adapter layer: tmux/API/SDK raw execution.
- Capacity layer: concurrency and admission caps.

### Why it is attractive

- Cleanest owner boundaries.
- Best fit for “tmux now, API later”.
- Easier to decide where something belongs.
- Strong fit for final FAQ and layer criteria.

### Main weakness

- Can become too abstract if layer boundaries are not kept minimal.
- Needs discipline to avoid accidental extra managers.

### Validation

| Requirement | Result | Note |
| --- | --- | --- |
| R1 | Pass | Session belongs cleanly to conversation layer. |
| R2 | Pass | Surface stays separate. |
| R3 | Pass | Runner adapter abstraction is first-class. |
| R4 | Pass | Managers become optional, not default. |
| R5 | Pass | Run control layer owns state machine. |
| R6 | Pass | Session queue belongs to conversation layer. |
| R7 | Pass | Steering belongs to run control layer. |
| R8 | Pass | Backlog can live beside or above conversation layer. |
| R9 | Pass | Session loops and global loops can be distinguished cleanly. |
| R10 | Pass | Capacity layer handles pool. |

## Candidate E. Actor / Owner-Boundary Model

### Core idea

Represent major runtime objects as owner-isolated actors:

- `SurfaceActor`
- `SessionActor`
- `RunActor`
- `RunnerActor`
- `BacklogActor`
- `LoopActor`
- `PoolActor`

### Main objects

- actors above plus message protocols between them

### Owner rules

- each actor owns its state exclusively
- coordination happens through explicit messages

### Why it is attractive

- Strongest state isolation
- Strongest resilience shape in the long run
- Makes ownership truth very explicit

### Main weakness

- Likely too heavy for the current product stage
- Can turn KISS into over-engineering
- Makes docs and onboarding heavier

### Validation

| Requirement | Result | Note |
| --- | --- | --- |
| R1 | Pass | Ownership is explicit. |
| R2 | Pass | Surface and session split is clean. |
| R3 | Pass | Runner actor can wrap any executor. |
| R4 | Partial | Too many manager-like actors may appear. |
| R5 | Pass | Run actor naturally owns state machine. |
| R6 | Pass | Session actor can own queue. |
| R7 | Pass | Steering can be explicit message type. |
| R8 | Pass | Backlog actor fits. |
| R9 | Pass | Loop actor fits. |
| R10 | Pass | Pool actor fits. |

## Initial Ranking

1. **Candidate D**
   Strongest balance of clarity, extensibility, and KISS.
2. **Candidate A**
   Best intuitive model, but risks stuffing too much into `Session`.
3. **Candidate C**
   Strong workflow semantics, but too far from conversation-first mental model.
4. **Candidate E**
   Architecturally strong, but too heavy for now.
5. **Candidate B**
   Good for surface UX, but weakest match to the stated session concept.
