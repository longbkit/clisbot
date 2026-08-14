# clisbot architecture routing

Use this reference to select the smallest current contract and executable owner
set. It is a router, not a cached replacement for repository documentation.

## Canonical documents

| Question | Read first |
| --- | --- |
| System ownership and dependency direction | `docs/architecture/architecture-overview.md` |
| Sender, surface, channel, and reply boundaries | `docs/architecture/surface-architecture.md` |
| Agent, session, runner, process, and lifecycle ownership | `docs/architecture/runtime-architecture.md` |
| Durable store placement and concurrency | `docs/architecture/persistence-stores.md` |
| Canonical concepts and boundary vocabulary | `docs/architecture/domain-language.md` |
| Code and artifact representation rules | `docs/architecture/naming-conventions.md` |
| Accepted repository-wide rationale | `docs/architecture/decisions/` |
| Stable feature intent and state | `docs/features/README.md`, then the feature front door |
| Active execution and priority | `docs/tasks/README.md`, `docs/tasks/backlog.md` |
| Exploratory evidence | the relevant `docs/research/` or `docs/audits/` file |
| Operator behavior | `docs/development/README.md` and `docs/user-guide/` |

Architecture documents win when lower-precedence material disagrees. A proposed
decision or feature document must not silently override accepted architecture.

## Executable owners

| Concern | Primary owner |
| --- | --- |
| Provider transport, rendering, pairing, surface behavior | `src/channels` |
| Session continuity, queue, loops, run lifecycle | `src/agents` |
| Runner contract and backend-specific execution | `src/runners` |
| Roles, permissions, owner claim | `src/auth` |
| Config schema, credentials, routes, defaults | `src/config` |
| Operator CLI, process lifecycle, health, monitor | `src/control` |
| Host/runtime primitives without product concepts | `src/infra` |

Ownership and consumption are different. A channel may consume runner events;
that does not transfer event normalization or execution ownership to channels.

## Common flow

Start with this flow and remove steps that do not apply:

```text
provider event or operator command
  -> channel/control parsing and authorization
  -> route and agent target resolution
  -> AgentService facade
  -> SessionService continuity, queue, and run supervision
  -> RunnerService and selected RunnerBackend
  -> normalized RunEvent stream
  -> channel/control observer and presentation
  -> durable owner state only where restart continuity requires it
```

For each boundary, prove the concrete function, contract, store, and focused
test. Do not substitute folder names for execution proof.

## Routing checks

- Channel-specific identity and UX remain channel-owned.
- Agents remain backend-agnostic.
- Backend quirks stay inside runner implementations.
- Config is the runtime control plane, not live run truth.
- Persisted runtime projections help recovery but do not override live owner
  state.
- Operator status and logs must report actual process and backend state.
- Cross-process behavior uses a durable store, IPC, or explicit runtime command;
  it never assumes shared memory.
- Shared helpers live with their semantic owner; `src/infra` holds only small
  host primitives.

## Evidence standard

Contracts prove intended meaning. Code plus tests prove implementation. Runtime
logs or a live scenario prove behavior when practical. Label any mismatch as a
gap and update the correct canonical owner before relying on a new rule.
