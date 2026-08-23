---
name: architect
description: Answer, plan, decide, or implement architecture work in Clisbot PaseoClaw Fusion from repository evidence. Use when work may change clients, the daemon, providers, wire contracts, pairing or authorization, channel synchronization, automation, persistence, agent lifecycle, or ownership boundaries, especially when the design must remain easy to merge with upstream Paseo (upstream/main).
user-invocable: true
---

# Architect

Treat architecture as the traceable assignment of identity, behavior,
authority, persistence, lifecycle, and process ownership. Preserve the Paseo
foundation and add the smallest isolated Clisbot extension that can express the
requested user outcome.

## Select one mode

State the mode and scope before acting.

- Use `ask` for architecture questions or exploration. Read and explain; do not
  edit. Default to this mode.
- Use `plan` for proposals, roadmaps, audits, or migration approaches. Keep
  proposed and current behavior distinct; do not edit product code.
- Use `decide` when the user asks to ratify a material choice. Update the
  smallest canonical document and implement only when requested.
- Use `auto` when the user explicitly delegates both architecture decisions and
  implementation. Internally run plan, decide, implement, and verify.

Do not create a decision artifact merely to restate an existing rule.

## Load the smallest evidence set

Always start with:

1. `AGENTS.md` (symlink to `CLAUDE.md`) and the dirty-tree boundary.
2. `docs/overview/product-vision.md` for the Fusion target and upstream
   strategy.
3. `docs/architecture.md` for current Paseo system design, package layering,
   and data flow.
4. `docs/glossary.md` for canonical terminology.
5. The relevant focused docs, wire schemas, implementation, tests, and history.

Use these additional routers only when relevant:

- agent states and lifecycle: `docs/agent-lifecycle.md`;
- providers and adapters: `docs/providers.md`;
- wire contracts and RPC naming: `docs/rpc-namespacing.md` and
  `docs/protocol-compatibility.md`;
- inbound validation: `docs/protocol-validation.md`;
- timeline sync correctness: `docs/timeline-sync.md`;
- persistence: `docs/data-model.md`;
- pairing, relay, and agent auth: `SECURITY.md`;
- plugin and workspace-config extension points: `docs/plugins.md`.

Treat docs as contracts and code plus focused tests as implementation proof.
Label findings `CURRENT`, `TARGET`, `GAP`, or `HISTORICAL`.

## Trace the owner chain

Start from one visible user action and trace the smallest complete flow:

```text
mobile, web, desktop, or CLI client
  -> @getpaseo/client (PaseoClient / daemon client)
  -> typed WebSocket RPC (dotted namespace, .request/.response)
  -> daemon session / agent-manager handler
  -> agent lifecycle state machine and timeline events
  -> file-based JSON persistence (atomic writes)
  -> provider CLI subprocess side effects
  -> timeline projections back to all subscribers
```

For every material value, identify its source, canonical owner, scope,
lifetime, persistence, authority, consumers, failure behavior, and cleanup.
Do not infer implemented flexibility from a type, config field, document, or
registry entry without tracing its executable path.

## Choose the smallest upstream-friendly change

Use this order:

1. Reuse the current upstream owner and contract unchanged.
2. Connect an existing seam such as a plugin, `paseo.json` workspace
   configuration, MCP tooling, provider adapter, or client-runtime module.
3. Add an isolated Clisbot-owned adapter or module behind a feature toggle.
4. Extend a shared wire contract only when all consumers require the new
   meaning — and then obey `docs/protocol-compatibility.md`: new fields are
   optional, wire schemas stay pure, capability is gated on
   `server_info.features.*`, and every shim is tagged `COMPAT(name)`.
5. Make a cross-cutting upstream modification only when no isolated boundary
   can express the behavior.

Every implemented code change must remain minimal and isolated as required by
the product vision's Upstream-Friendly Evolution principle. Define the toggle
owner, default, enabled and disabled behavior, and verification for both
states. If the design cannot meet this rule, stop and ask for an explicit rule
change.

Avoid renaming, moving, or reformatting upstream-owned files. Keep Clisbot
code in clear extension boundaries and avoid duplicating upstream agent
lifecycle, timeline, session, connection, or persistence ownership.

## Pressure-test the design

Check only applicable dimensions, but state the decision for each:

- iOS, Android, web, and Electron desktop clients;
- Claude Code, Codex, GitHub Copilot, OpenCode, and Pi providers;
- local, relay/tunnel, and multi-host operation;
- wire contracts, pairing and E2EE scopes, authorization, and reverse
  actions;
- restart, retry, interruption, duplication, partial failure, and cleanup;
- agent lifecycle, archive, and worktree-based workspace behavior;
- user docs, contributor docs, focused tests, and rollout/rollback.

Keep the daemon authoritative, put side effects in the agent manager or
provider adapters, keep non-visual client concerns out of platform UI code,
and keep UI platform-specific only where the behavior actually differs.

## Finish

Report the mode, scope, current owner chain, current versus target behavior,
decision or smallest recommendation, feature-toggle boundary, changed
artifacts, verification, upstream merge risk against `upstream/main`, open
decisions, and remaining gaps.
