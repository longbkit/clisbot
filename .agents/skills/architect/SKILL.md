---
name: architect
description: Answer, plan, ratify, or autonomously implement clisbot architecture work from repository evidence. Use when a request may change channel, agent, session, runner, auth, configuration, control, persistence, process, API, UI, integration, ownership, lifecycle, or contract boundaries; when the user asks how clisbot currently works or should work; or when an architectural proposal must be planned, accepted, or implemented. Supports ask, plan, decide, and auto modes.
---

# Architect

Treat architecture as the traceable assignment of identity, behavior, authority,
persistence, lifecycle, and process ownership to clisbot's existing systems.
Start from one concrete user flow, prove what the repository executes, and add
the smallest coherent extension only when the current owner chain cannot express
the job.

## Select one mode

State the selected mode and scope before acting. Do not blend modes silently.

- Use `ask` for architecture questions, feature exploration, or “how should this
  work?”. Answer from evidence without editing product code or creating a
  persistent planning artifact. Default to `ask` when no stronger signal exists.
- Use `plan` when the user asks for a plan, proposal, roadmap, design audit, or
  migration approach. Create or update the appropriate research, feature, audit,
  or task artifact; do not create an accepted decision or edit product code.
- Use `decide` when the user accepts a proposal, asks to ratify a decision, or
  requests implementation of an architecture-affecting change. Record each
  material decision in its repository-level or feature-level decision owner and
  update canonical architecture when meaning changes. Implement only when the
  user requests implementation.
- Use `auto` when the user delegates the outcome and asks Codex to decide and
  build without architecture checkpoints. Internally run plan -> decide ->
  implement for each material decision, then verify and update artifacts
  truthfully. Ask only for unresolved scope, authority, destructive action, or an
  external blocker.

If current contracts and decisions already settle the matter, reuse them. Do not
create another decision record merely to restate an existing rule. If no material
architecture decision exists, use the normal implementation loop without
artifact inflation and say why.

## Load only the evidence the task needs

- Always read [architecture-routing.md](references/architecture-routing.md).
- For runtime, session, runner, persistence, credentials, lifecycle, detached
  process, monitor, HTTP listener, or CLI work, also read
  [runtime-persistence-routing.md](references/runtime-persistence-routing.md).
- Before creating or updating a plan, decision, feature, or task artifact, read
  [artifact-format.md](references/artifact-format.md).
- Read the selected canonical documents and executable owners completely enough
  to establish the owner chain. Use `rg` to locate moved owners rather than
  trusting cached paths.

## Ground the current architecture

1. Read repository instructions and establish the dirty-tree boundary. Preserve
   unrelated user work.
2. Start from the visible user job. Describe the shortest end-to-end flow from
   inbound surface or operator action to routing, session ownership, runner
   execution, persistence, and visible result.
3. Use architecture documents as the stable implementation contract. Guides
   describe operator behavior; feature docs describe stable feature intent;
   research, audits, and tasks are supporting evidence unless promoted.
4. Trace executable code and focused tests across the smallest complete owner
   chain. Never infer implemented flexibility from prose, a type, a parseable
   config shape, or a registry entry alone.
5. Label conclusions `CURRENT`, `TARGET`, `GAP`, or `HISTORICAL`.
6. For every material value or payload, identify source, canonical owner,
   identity, scope, lifetime, persistence, authority, consumers, failure, and
   cleanup behavior.
7. Treat foreground runtime, monitor, HTTP listener, detached worker, runner
   subprocess, and one-shot CLI as separate processes unless code proves
   otherwise.
8. Search existing decisions, feature contracts, tests, gates, and sibling
   mechanisms before proposing a new owner or store.

## Build the architecture map

Produce the smallest map that lets a reader answer:

- What does the user do and what visible outcome changes?
- Which system owns durable identity and configuration?
- Which system owns live run truth, queueing, session continuity, and cleanup?
- How do channel-native identities map into canonical surfaces and sessions?
- Which runner capability or backend quirk determines behavior?
- Which values are config, secrets, canonical state, projections, diagnostics,
  or transient runtime state?
- Which OS process reads or mutates each value, and how are writes coordinated?
- What happens on retry, cancellation, restart, duplicate delivery, and partial
  channel failure?
- What is already reusable, what is a bounded gap, and what must not be
  generalized from the first consumer?

Use a diagram or table only when it materially clarifies multiple mappings or a
stateful sequence. Explain the concrete flow before naming abstractions.

## Choose the smallest correct change

Apply this reuse order:

1. Reuse the current canonical owner and contract unchanged.
2. Connect an existing contract, registry, capability, service, or lifecycle
   seam that is present but not wired to this consumer.
3. Extend the nearest owner with one typed capability while preserving identity,
   lifecycle, process, and persistence boundaries.
4. Add a new concept only when current owners have a different meaning, scope,
   lifecycle, authority, retention, or reason to change.

Reject duplicated config mutation paths, parallel session or queue owners,
runner-specific behavior in agents, channel UX in runner code, product concepts
in `src/infra`, transient runtime state in durable contracts, and one-off JSON
stores without the persistence-store gate. Backend-facing resources stay
resource-oriented and revision-aware.

Create or extend a shared abstraction when the product direction identifies a
definite future consumer and the shared contract is already clear. Do not
generalize around speculative consumers or syntax alone.

## Ask mode

1. Lead with the architectural conclusion.
2. Walk the current user flow and exact owner chain.
3. Explain current flexibility and hard boundaries from code and tests.
4. Separate proposed extension from current behavior.
5. Pressure-test the primary case plus one materially different consumer when
   recommending a shared abstraction.
6. End with the smallest recommendation, gaps, and implementation implications.

## Plan mode

Create one routed artifact using the artifact reference. Include:

- concrete current flow and executable proof;
- owner, identity, lifecycle, authority, process, and persistence map;
- contract-versus-code gap ledger;
- consumer pressure tests for shared mechanisms;
- options, trade-offs, recommendation, non-goals, and open decisions;
- exact contracts, code owners, stores, migration, tests, rollout, and rollback;
- implementation order and measurable Definition of Done.

Keep every open decision explicit. A plan is proposed, not accepted or shipped.

## Decide mode

1. Locate the supporting plan or reconstruct the focused evidence when no
   persistent plan is warranted.
2. Resolve every decision required for the accepted scope without inferring
   consent for a broader outcome.
3. Reuse an existing decision when it already owns the issue. Otherwise create
   one dated repository-level or feature-level decision record.
4. Update the smallest canonical architecture or feature owner when meaning
   changes, preserving and cross-linking superseded history.
5. Keep acceptance and implementation status distinct.
6. If implementation was requested, follow the repository task and verification
   workflow. Claim implementation only after code, migration, tests, docs, and
   operator surfaces prove it.

## Auto mode

1. Reconstruct the user outcome and current architecture.
2. Reuse current accepted decisions where possible.
3. Plan and ratify each new material decision before depending on it in code.
4. Implement one owner chain at a time.
5. Verify proportionally and inspect the resulting user or operator flow rather
   than accepting compilation alone.
6. Update feature, task, decision, and architecture status to match reality.

Auto mode removes routine checkpoints, not safety, authority, or evidence.

## Finish every mode

Report the mode, scope, current proof, owner chain, current versus target result,
artifacts changed, verification, open decisions, and remaining gaps. A run
succeeds when another reader can reproduce why the owner is correct and
distinguish what works now from what is accepted or merely planned.
