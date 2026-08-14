# AnyApp Document architecture proof

Read this after `anyapp-ui-contract-routing.md` for Page Builder, UI Document/UDM, DocumentRuntime,
State, Data, Command, Action, reusable-component runtime, or plugin-runtime questions. It is a proof
checklist, not cached architectural truth: open current contracts, files and focused tests every run.

## Required owner trace

Inspect the smallest complete chain relevant to the question:

| Concern | Starting evidence |
|---|---|
| Persisted UI Document, nodes, Runtime refs, State specs | `packages/core/ui-contracts/src/model.ts`, `runtime-graph.ts`, schemas and validation |
| Graph compilation and diagnostics | `packages/core/ui-engine/src/runtime-graph/compiler*.ts`, `compiler-*.ts` |
| State kinds, values, transitions and codecs | `packages/core/ui-engine/src/runtime-graph/state/`, `state.ts`, `state-kinds.ts` |
| Runtime identity and instance scope | `runtime-graph/capability-instance/address.ts`, task-session files |
| Document mount, lifecycle, reads and operations | `runtime-graph/document-runtime.ts`, `runtime-graph/document/` |
| Typed State/Data ports and node fan-out | `runtime-graph/document/runtime-contract.ts`, `packages/core/ui-engine-react/src/document-runtime-provider.tsx` |
| Renderer consumption and node mount gates | `packages/core/ui-engine-react/src/runtime-node.tsx`, focused renderer consumers |
| Reusable-component State/Data materialization | `packages/core/ui-engine/src/document/reusable-components/`, its tests |
| Web hydration or persistence integration | `packages/core/ui-engine-react-web/src/runtime-graph/`, focused URL/session/view owners |
| Commands and event execution | `packages/core/ui-engine/src/runtime/actions.ts`, events, operation and freshness paths |
| Page Builder authoring and repair | `packages/plugins/page-builder/client/editor/`, authoring contracts and tests |
| Plugin catalogs and effective runtime wiring | plugin contracts, host composition, compiler/runtime injection, parity tests |

Use `rg` to locate renamed owners rather than assuming these paths remain exact.

## Resolve declarations and operations before reasoning

Start every explanation from one persisted connection and one user interaction:

```text
ComponentSpec.input.<socket>          declares what a component type accepts
UINode.input.<socket>                 connects one node to a RuntimeRef
UIDocument.input/state/data           declares named runtime values
DocumentInstanceSpec.input            supplies mount values
DocumentRuntime                       owns live State/Data instances and lifetime
projected Input/State/Data port        is what a renderer consumes
```

Keep these write paths separate:

```text
Page Builder edit        -> PatchOp -> ui_document revision
end-user interaction     -> State transition -> mounted State revision
authored event           -> ActionRegistry -> handler result
durable Record mutation  -> ResourceOperationPort -> ChangeSet
allowed personalization  -> page ui_view edit/save/reset -> ui_view revision
```

Builder capabilities and connection recipes may group compatible members for one
author gesture. They remain projections over these owners; they are not another
persisted runtime primitive, callback registry, or executor.

## Current capability inventory

For every architecture answer, report applicable rows with code/test evidence:

| Capability | Questions to prove |
|---|---|
| Declaration | Is the value declared on the UI Document, supplied as Input, loaded as Data, or private to one renderer? |
| Address and scope | Is identity document-wide, per mounted document, per capability instance, per task session, or local to a component? |
| Typed connection | Which `RuntimeRef` and component input socket connect producers and consumers? Can multiple nodes consume the exact address? |
| Read/write semantics | Which State kind validates the value? Which transitions exist? Are updates revision-checked or transactional? |
| Mount independence | Does State exist before the consumer mounts? What happens when a node is hidden, unmounted, or disposed? |
| Dependency/freshness | Which reads depend on the value? How are stale requests aborted and results fenced? |
| Persistence | Is persistence only a declared policy, or is URL/session/user-view hydration and write-back actually wired? Who owns failure and recovery? |
| Reuse/materialization | How are State/Data names rewritten for reusable instances? What survives release or upgrade? |
| Multiple instances | Can task sessions create another instance? How is the exact instance selected by an outside consumer? |
| Cross-document boundary | Can a ref cross mounted documents? If not, is the correct seam Input, a parent-owned command, or durable data? |
| Plugin extension | Can a plugin kind be parsed, compiled, mounted, persisted, and restored through one effective catalog today? |
| Authority | Is this UI availability, runtime validation, or server authorization? Which owner rechecks the operation? |

For a proposed runtime namespace or shared capability, first test whether a new
State kind, Data result/source/provider, existing Action definition, component
member, or Builder recipe fits the same owner and lifecycle. A parseable extension
shape is not proof that server validation, host catalog injection, mount, restore
and plugin removal work end to end.

Do not equate React local state with Document State. A deep component can share a
value with other nodes only when an existing Page declaration/reference path or a
new explicit authoring materialization makes that value part of the mounted
DocumentRuntime. Mounted-child callback registration is not a substitute because
it fails before mount, after hiding, across renderer implementations, and during
document validation.

## Minimum pressure tests

For a generalized State/Command/control proposal, test at least:

1. a Boolean preference whose controlled node becomes hidden;
2. one mutually exclusive mode shared by two controls;
3. a multiple-selection value with concurrent updates;
4. a command enabled by selected Records;
5. a reusable component inserted twice;
6. a task-session or overlay instance;
7. plugin disable/removal and stale references;
8. reload, persistence failure, disposal, and denied authority.

A proposal is not general merely because one Page Actions example works.
