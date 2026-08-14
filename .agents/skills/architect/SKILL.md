---
name: architect
description: Answer, plan, ratify, or autonomously implement architecture work from repository evidence. Use when a user asks to add or change a feature, asks how the architecture currently works, requests the correct design, accepts an architectural proposal, asks to implement it, or delegates coding that may change ownership, contracts, persistence, lifecycle, plugin seams, package boundaries, or AnyApp UI architecture including Page Builder, UI Document, DocumentRuntime, State, Data, Command, Action, and ui_view. Supports ask, plan, decide, and auto modes.
---

# Architect

Treat architecture as the traceable assignment of identity, State, behavior,
authority, persistence, and lifecycle to existing owners. Start from one concrete
user flow, prove what the repository executes, and add the smallest coherent
extension only when the current owner chain cannot express the job.

## Select one mode

State the selected mode and scope before acting. Do not blend modes silently.

- Use `ask` for ordinary questions, feature exploration, architecture questions,
  “how should this work?”, or requests for the correct solution. Answer from
  evidence without editing product code or creating an audit. Default to `ask`
  when no stronger signal exists.
- Use `plan` when the user asks for a plan, proposal, roadmap, design audit, or
  migration approach. Create or update one dated audit under `docs/audit/`; do
  not create an ADR or edit product code.
- Use `decide` when the user accepts a proposal, asks to ratify/chốt a decision,
  or requests implementation of an architecture-affecting change. Link the plan
  audit to the accepted ADR, link the ADR back to the audit, and update the audit
  status. Implement only when the user requested implementation.
- Use `auto` when the user delegates the outcome and asks Codex to decide and
  build without architecture checkpoints. Internally run plan -> decide ->
  implement for every material architecture decision, then verify and update the
  artifacts truthfully. Ask only when a real unresolved decision, authority
  expansion, destructive action, or external blocker prevents safe progress.

If current contracts and ADRs already decide the matter, reuse and cite them. Do
not mint another ADR merely to restate an existing decision. If no material
architecture decision exists, use the normal implementation loop without artifact
inflation and say why.

## Load only the evidence the task needs

- Before writing or updating an audit or ADR, read
  [artifact-format.md](references/artifact-format.md).
- For any AnyApp UI architecture task, read
  [anyapp-ui-contract-routing.md](references/anyapp-ui-contract-routing.md). It
  routes through the live `docs/contracts/ui/README.md`; never substitute cached
  package knowledge for that router.
- For Page Builder, UI Document, UDM, DocumentRuntime, State, Data, Command,
  Action, `ui_view`, reusable-component runtime, or plugin-runtime work, also read
  [anyapp-document-runtime.md](references/anyapp-document-runtime.md).
- Read selected contract and source files completely enough to establish the
  owner chain. Use `rg` to locate moved owners rather than trusting cached paths.

## Ground the current architecture

1. Read repository instructions and the runbook. Establish the requested scope
   and dirty-tree boundary; preserve unrelated work.
2. Start from the visible user job. Write the shortest end-to-end flow that names
   authored artifacts, runtime values, actions, persistence, and visible result.
3. Use the normative contract router to identify the owner. Contracts govern
   intended meaning; ADRs explain accepted rationale; audits/history are evidence,
   not current authority when they conflict.
4. Default durable application data to `Object → Properties/Relations → Records → Resource API → UI Document Query/Data`; extend this path before adding a parallel owner.
5. Trace executable code and focused tests across the smallest complete owner
   chain. Never infer implemented flexibility from prose, a type, a parseable wire
   shape, or an extension seam alone.
6. For every material value or payload, identify source, owner, identity, scope,
   lifetime, persistence, authority, consumers, failure, and disposal behavior.
7. Label conclusions `CURRENT`, `TARGET`, `GAP`, or `HISTORICAL`. Search existing
   decisions, tests, gates, and sibling mechanisms before proposing a new owner.

When documentation hides operational detail, code and tests are mandatory proof.
Explain the actual instance and lifecycle boundaries and identify every consumer
migration or catalog wiring still required.

## Build the architecture map

Produce the smallest map that lets a reader answer:

- What does the user do and what visible outcome changes?
- Which artifact owns durable identity and configuration?
- Which runtime owns live State, reads, commands, authority, and disposal?
- How do references cross nodes, packages, processes, or mounted documents?
- Which values are persisted configuration, mounted Input, hydrated State, Data
  results, action inputs, invocation snapshots, or operation outputs?
- What happens before a component mounts, after it hides, after it disposes, on
  retries, and under concurrent writes?
- What can plugins contribute, and which effective catalog makes that
  contribution executable end to end?
- What is already reusable, what is a bounded gap, and what must not be
  generalized from the first use case?

Use a diagram or table only when it materially clarifies multiple mappings or a
stateful sequence. Explain the concrete flow before naming abstractions.

For AnyApp UI work, always test whether page-scoped `ui_view` is the durable owner
of allowed personalization such as columns, filters, modes, and node
visibility/order/collapse. `ui_document` owns authored structure and policy;
DocumentRuntime State owns live interaction. When applicable, trace resolve ->
edit -> save/reset with scope and revision. When not applicable, state why.

## Choose the smallest correct change

Apply this reuse order:

1. Reuse the current canonical owner and contract unchanged.
2. Connect an existing declaration, reference, Port, registry, or lifecycle seam
   that is present but not yet wired to this consumer.
3. Extend the nearest owner with one typed capability while preserving its
   identity and lifecycle.
4. Add a new concept only when current owners have a different meaning, scope,
   lifecycle, authority, or reason to change.

Reject parallel State stores, duplicated command executors, copied catalogs,
mounted-child self-registration, raw handlers in persisted data, renderer-owned
business authority, and compatibility aliases without an external migration
need. Presentation availability may restrict an operation but never grants
permission.

## Ask mode

Answer reader-first and read-only:

1. Lead with the architectural conclusion.
2. Walk the current user flow and exact owner chain.
3. Explain current flexibility and its hard boundaries from code/tests.
4. Separate the proposed extension from current behavior.
5. Pressure-test at least the user's primary case plus one materially different
   consumer when recommending a shared abstraction.
6. End with the smallest recommendation, gaps, and implementation implications.

Do not create an audit merely because the answer is architectural.

## Plan mode

Create one dated audit using the artifact reference. Include:

- current user flow and current capability proof;
- owner/identity/lifecycle/authority/persistence map;
- contract-versus-code gap ledger;
- at least two real consumer pressure tests for a shared mechanism;
- options, trade-offs, recommendation, non-goals, and open decisions;
- exact packages/contracts/data shapes affected;
- migration, compatibility, tests, gates, rollout, and rollback plan;
- implementation order and a measurable Definition of Done.

Keep every open decision explicit. `plan` status is `proposed`; it is never an
accepted decision or an implementation claim.

## Decide mode

1. Locate the plan audit. If the task introduces a material decision and no plan
   exists, create a focused plan audit from evidence first. A documentation
   clarification or reuse of an accepted contract needs no synthetic plan/ADR.
2. Resolve every decision required for the accepted scope. Do not infer user
   consent for a materially broader outcome.
3. For a material decision, reuse an existing ADR when it already owns the
   decision. Otherwise allocate the next collision-free `ADR-NNN` and create one
   accepted ADR. If there is no material decision, skip artifact ratification.
4. For a ratified material decision, link audit <-> ADR, change the audit status
   to `accepted`, update its decision ledger, and update the smallest canonical
   contract owner when meaning changes.
5. Keep ratification and implementation status distinct. An accepted ADR is not
   implemented until the relevant code, migration, tests, and gates pass.
6. If implementation was requested, follow the repository runbook and backlog
   workflow. Update the audit to `implemented` only after the stated proof passes;
   otherwise retain `accepted` and record the exact remaining gap.

## Auto mode

Run autonomously while keeping the same evidence and artifact integrity:

1. Reconstruct the user outcome and current architecture.
2. Reuse current accepted decisions where possible.
3. For each new material decision, write/update the plan audit, ratify the ADR,
   and update the canonical contract before depending on it in code.
4. Implement one owner chain at a time under the repository runbook.
5. Verify proportionally, run required gates, and inspect the resulting user
   flow rather than accepting compilation alone.
6. Update audit/ADR/backlog/progress status to match reality. Never mark an
   accepted target as shipped while code or consumer migration remains open.

Auto mode removes routine checkpoints, not safety, permission, or evidence.

## Finish every mode

Report the mode, scope, current proof, owner chain, current versus target result,
artifacts changed, verification, open decisions, and remaining gaps. A run
succeeds when another reader can reproduce why the owner is correct and
distinguish what works now from what is accepted or planned.
