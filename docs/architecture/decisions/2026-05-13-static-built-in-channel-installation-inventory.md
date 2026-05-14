---
title: Static Built-In Channel Installation Inventory
status: accepted
date: 2026-05-13
supersedes:
  - 2026-05-12-generated-channel-registry-and-plugin-installation
---

# Context

`clisbot` still ships all current channels as built-in code inside one package and one bundled app entrypoint.

The generated channel registry pass improved owner boundaries compared with scattered manual imports, but it still carried avoidable complexity for the current product shape:

- a generator script had to keep source files in sync
- build, typecheck, and test had to run that generator first
- source-mode validation added another installation-specific seam
- the codebase looked partially dynamic even though the built-in channels were still static product code

That was the wrong tradeoff while `clisbot` remains a single package with built-in channels and no runtime plugin installation flow yet.

# Decision

Replace generated built-in channel inventories with one static installation seam:

- each built-in channel owns `installation.ts`
- each `installation.ts` exports one installation object that the inventory checks against `ChannelInstallation`
- `src/channels/integration/channel-installation-inventory.ts` is the only central installation inventory seam
- shared channel, config, and pairing surfaces read from that static inventory
- `src/channels/catalog/registry.ts` is the separate runtime plugin seam
- generated installation scripts and generated source validation are removed

The `integration` folder is the channel integration seam: shared systems read
provider capabilities and contracts there, while provider implementation stays
inside each provider folder.

The `ChannelInstallation` contract is intentionally future-dynamic-friendly. It groups:

- `surfaceContract`
- `configTarget`
- `pairingAccess`
- `credentialContract`
- `botContract`
- `routeContract`
- `schemaContract`
- `templateContract`

# Why

This keeps the current architecture truthful:

- current channels are built-in product code, not installed runtime plugins
- current packaging stays simple
- there is one real manual installation seam instead of generated pseudo-dynamic wiring
- every shared surface reads from the same inventory shape

It also preserves a clean path toward future runtime plugins:

- per-channel `installation.ts` can later become package entrypoints
- `channel-installation-inventory.ts` acts as a temporary static integration loader
- `src/channels/catalog/registry.ts` acts as the temporary static runtime
  plugin loader
- a future dynamic loader can replace that static loader without rewriting the surface contracts again

# Consequences

Good:

- build, typecheck, and test no longer depend on a channel-registry generator
- no generated import blocks remain in source files
- built-in channel wiring is now obvious and localized
- shared/config imports no longer pull the runtime plugin graph transitively
- import-time side effects stay limited to plain module evaluation of channel installation metadata instead of generator validation logic
- future dynamic loading only needs a loader swap if the `ChannelInstallation` contract stays stable

Tradeoff:

- adding a new built-in channel still requires one central inventory edit in `src/channels/integration/channel-installation-inventory.ts`
- this is intentional while channels remain built-in and packaging stays single-package
