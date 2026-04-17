# Final Layered Architecture

Source of truth:

- `docs/overview/human-requirements.md`

Goal:

Keep the model small, but keep ownership sharp enough that route, conversation, active run, runner protocol, and global scheduling never collapse into one blob.

## The 5 Layers

| Layer | Owns | Main concepts | Must not own |
| --- | --- | --- | --- |
| `Surface` | route and rendering truth | `Surface`, `SurfaceRoute` | session continuity, run state, runner protocol |
| `Session` | conversation continuity | `Session`, `SessionQueue`, `SessionLoop` | route rendering, active run lifecycle, runner protocol |
| `Run Control` | active execution truth | `Run`, `RunState`, `SteeringInput` | route truth, session identity, runner transport |
| `Runner` | raw executor truth | `Runner`, `TmuxRunner`, `ApiRunner`, `SdkRunner` | queue policy, steering policy, session truth |
| `Workload` | fresh-work scheduling truth | `Backlog`, `GlobalLoop`, `RunnerPool` | session identity, active run truth, runner protocol |

## Single-Truth Rule

Each layer gets one kind of truth.

If one concept wants to decide two of these at once, split it:

- where replies appear
- whether turns belong to the same conversation
- what is actively running now
- how the system speaks to tmux, API, or SDK
- whether fresh work should wait or start

## Layer Summary

- `Surface`: where the conversation appears
- `Session`: what conversation it belongs to
- `Run Control`: what is executing now
- `Runner`: how execution actually happens
- `Workload`: work outside one active session

## Placement Rules

| If the concept mainly decides... | Put it in... |
| --- | --- |
| where the reply should appear | `Surface` |
| whether two turns are the same conversation | `Session` |
| whether a prompt is still waiting in session order | `Session` |
| whether an active run is starting, running, detached, or terminal | `Run Control` |
| how to talk to tmux, API, or SDK | `Runner` |
| whether fresh work should wait because of concurrency pressure | `Workload` |

## Multiplicity Rule

Only introduce an extra coordination object when multiplicity creates real policy.

Good reasons:

- many session prompts need sequential workflow
- many loops need scheduling
- many runners need a concurrency cap
- many backlog items need admission policy

Bad reasons:

- grouping helpers
- forwarding calls
- hiding ownership behind a generic wrapper

## Fast FAQ

| Question | Answer |
| --- | --- |
| Where does `sessionKey -> sessionId` mapping live? | `Session` |
| Can one `Session` link many runner `sessionId`s over time? | Yes. `Session` owns one active `sessionId` at a time, with optional historical links. |
| Does compaction create a new session by default? | No. Compaction stays inside the current `Session` unless a separate rotate or recovery decision happens. |
| Where does `queued` live? | `Session`, because it is queue order before an active run exists. |
| Where does steering live? | `Run Control` |
| Where does the session queue live? | `Session` |
| Where do session-bound loops live? | `Session` |
| Where do global loops and backlog live? | `Workload` |
| Where does tmux pane or API submission live? | `Runner` |
| Where do active run state and run transitions live? | `Run Control` |
| Where does Slack thread or Telegram topic logic live? | `Surface` |
| Where does an API-compatible completion route fit? | `Surface` on entry, then the same `Session -> Run Control -> Runner` path. |

## Delete-On-Sight List

If found in the wrong layer, remove or move it:

- surface logic deciding execution state
- session logic speaking raw tmux or API protocol
- run-control logic rendering route-specific replies
- runner logic deciding queue, backlog, or loop policy
- workload logic rewriting session identity

## Final Simplicity Test

If a reviewer asks:

- “where does this conversation live?” -> `Session`
- “what is running right now?” -> `Run Control`
- “how does it talk to tmux or API?” -> `Runner`
- “where should replies show up?” -> `Surface`
- “why is this delayed or started fresh?” -> `Workload`

If the answer is not immediate, the architecture is leaking.
