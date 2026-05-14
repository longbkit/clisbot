---
title: Generated Channel Registry And Plugin Installation
status: superseded
date: 2026-05-12
supersededBy:
  - 2026-05-13-static-built-in-channel-installation-inventory
---

# Context

`clisbot` had a real `ChannelPlugin` seam, but channel installation still leaked through manual central steps: every new plugin had to be imported and appended by hand inside `src/channels/catalog/registry.ts`, shared config-target dispatch still had to be extended manually for each channel target grammar, and the default config template still had to be edited centrally with per-channel bootstrap and route defaults.

That meant adding a channel was not plugin-contained yet:

- code could compile while the new plugin stayed invisible until someone remembered the central registry edit
- shared control and bootstrap surfaces still depended on one manual owner-crossing step
- repeated cleanup elsewhere still left one structural installation leak behind

# Decision

Keep the shared registry and shared config-target dispatcher owners, but make both inventories generated from the channel package layout instead of hand-maintained.

Concretely:

- each channel plugin module exports its plugin as the default export
- each channel package also owns `config-target.ts` for its config-surface target grammar and fallback order
- each channel package also owns `config-template-contract.ts` for its default config template fragment
- `src/channels/catalog/registry.ts` keeps the runtime API, but its plugin import block is generated
- `src/channels/config/surface-config-target.ts` keeps the shared dispatch API, but its contract import block is generated
- `src/config/channels/channel-template-contract.ts` keeps the shared template inventory API, but its contract import block is generated
- `scripts/generate-channel-registry.ts` is the single writer for those generated installation inventories
- `build`, `typecheck`, and `test` run the generator automatically
- source-mode runtime startup and config-template rendering validate that generated inventories match the channel directories and fail loudly when one is stale

# Why

This keeps the owner boundary truthful:

- channel packages own their plugin module
- channel packages also own their config-surface target contract
- channel packages also own their template fragment contract
- the shared registry, dispatcher, and template inventory still own iteration and lookup semantics
- installation inventory is derived from the channel packages instead of duplicated in separate hand-edited lists

It also avoids a riskier runtime filesystem plugin loader for now. The current package build still emits a single bundled entrypoint, so full runtime directory discovery would require a broader packaging change than this cleanup needed.

# Consequences

Good:

- adding a channel no longer requires manually editing central registry imports
- adding a channel no longer requires manually editing shared config-target dispatch imports
- adding a channel no longer requires manually editing the shared default config template block
- stale installation state now fails safe during source-mode runtime use and in standard verification commands
- shared help, bootstrap, runtime summary, loops, queues, and config-mode surfaces keep reading generated inventories instead of hand-wired channel lists or hand-wired template fragments

Tradeoff:

- plugin installation is generated at development and verification time, not discovered dynamically from arbitrary packaged files at runtime
- if future packaging moves away from the single-file bundle, runtime discovery can be revisited from this cleaner generated-registry baseline
