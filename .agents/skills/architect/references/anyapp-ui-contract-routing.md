# AnyApp UI contract routing

Use this reference for every AnyApp UI architecture question. It is a routing procedure, not a cached copy of the architecture.

## Start at the live router

Read `docs/contracts/ui/README.md` first. Use its current owner map and “read what when” section to select the smallest normative contract set. If a path below moved, follow that router rather than preserving this reference as an alias.

| Question | Start with | Then prove in |
|---|---|---|
| Persisted `UIDocument`, `UINode`, refs, schemas, `PatchOp` | `docs/contracts/ui/ui-contracts.md` | `packages/core/ui-contracts` |
| Compile, State, Data binding, operation, freshness, disposal | `docs/contracts/ui/ui-engine-runtime.md`, then `docs/contracts/ui/ui-engine.md` | `packages/core/ui-engine` tests and source |
| React subscription around `DocumentRuntime` | `docs/contracts/ui/ui-engine-react.md` | `packages/core/ui-engine-react` |
| Web UINode rendering and generic blocks | `docs/contracts/ui/ui-engine-react-web.md` | `packages/core/ui-engine-react-web` |
| Registry, route composition, public/private render boundary | `docs/contracts/ui/web-rendering.md` | web host composition and focused tests |
| UI primitives, tokens, styling, adapter ownership | `docs/contracts/ui/design-system-usage.md`, `docs/contracts/ui/ui-kit-react-web.md` | UI Kit contract/tests; read `docs/dev-guides/ui/component-composition-quick-guide.md` before assembly |
| Persisted UI artifacts, revisions and releases | `docs/contracts/ui/authoring/content-ui.md` | owning Resource/storage path |
| Saved views and allowed personalization | `docs/contracts/ui/authoring/views.md` | `ui_view` resolve/write path and consumers |
| Page Builder interaction and settings flow | `docs/contracts/ui/authoring/page-builder-ux.md` | page-builder plugin editor and authoring tests |
| Reusable composition and upgrades | `docs/contracts/ui/reusable-components.md` | materializer, migration and pinning tests |
| Package or plugin placement | `docs/contracts/platform/packages-and-structure.md` plus the UI router | imports, manifests and dependency doors |
| Frontfacing authoring/runtime | `docs/contracts/ui/authoring/frontfacing-ui.md` | selected registry, adapter and delivery path |

Do not begin from an audit, feature note, old ADR, demo, or nearby implementation when a current contract owns the meaning.

## Classify the concern before proposing a change

Answer these in order:

1. Is this a persisted wire shape, runtime semantic, authored artifact, renderer,
   UI primitive, product feature, plugin contribution, or host composition?
2. Who owns durable identity and revision?
3. Who owns the live value, request, action, authority, and disposal?
4. Is the value fixed authored config, mount Input, mutable State, Data result,
   action input, operation output, or page-view personalization?
5. Does the request change meaning/ownership, or only connect an existing seam?

Use this boundary map to reject common wrong placements:

```text
wire shape          -> ui-contracts
runtime meaning     -> ui-engine
React subscription  -> ui-engine-react
web rendering       -> ui-engine-react-web
visual primitive    -> ui-kit / ui-kit-react-web
product workbench   -> owning plugin
deployment wiring   -> thin host
```

## Keep operation types distinct

Never use the word “action” or “patch” without resolving which owner it means:

| User job | Mechanism | Owner or durable outcome |
|---|---|---|
| Author changes document structure/config | `PatchOp` | new `ui_document` revision |
| End user changes interaction intent | State transition | mounted `DocumentRuntime` instance; optional URL/session hydration |
| End user triggers authored behavior | `EventBinding` -> registered Action | action registry and its handler lifecycle |
| Behavior performs a durable Record mutation | Resource operation | Resource API authority, idempotency and Record revision |
| End user saves allowed presentation personalization | page-view edit/save/reset | scoped, revisioned `ui_view` |

A UI control may combine a read member and a write member in one Builder recipe,
but that recipe does not create another runtime executor or State store.

## Test extensibility at the right layer

Do not generalize from a friendly Builder label such as Data collection or
capability. Resolve it to the actual declarations, refs, ports, actions and
artifacts underneath.

Before adding a registry, namespace, State kind, Data source, command source or
component contract:

1. Prove the existing kind/provider/registry cannot express the lifecycle.
2. Prove the extension is accepted by wire parsing, compile/write validation,
   runtime injection, renderer consumption, persistence/restore and plugin
   disable/removal—not merely by one interface.
3. Pressure-test a second materially different consumer and multiple mounted
   instances.
4. Prefer a new kind/member/provider inside the current owner over a new top-level
   namespace or parallel executor.

## Contract-to-code completion test

A UI architecture claim is complete only when the applicable chain is proven:

```text
contract meaning
-> persisted or registered shape
-> validation/compile
-> runtime owner and exact instance
-> renderer/editor consumer
-> write/persistence/authority path
-> failure, plugin removal and disposal
-> focused tests and lasting doors
```

Mark an omitted or unproven link as `GAP`; do not describe the capability as
implemented end to end.
