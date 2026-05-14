# Zalo Official Account Channel Contract And MVP

## Summary

Define and then implement `zalo-oa` as a separate official business provider family.

This task is intentionally split into:

1. contract lock
2. implementation

Because current evidence is strong for `zalo-bot`, but not yet strong enough to truthfully code `zalo-oa` without a fresh OA-specific research pass.

## Status

Planned

## Why

`zalo-oa` matters for the Vietnam package, but it should not be blurred together with `zalo-bot`.

OA is likely different in:

- onboarding
- auth/app registration
- allowed outbound behavior
- compliance and business rules
- webhook/event model

## Scope

- create an OA-specific contract note
- lock the product model for `zalo-oa`
- implement a first official OA provider only after that lock
- keep `zalo-oa` separate from `zalo-bot`

## Non-Goals

- guessing OA behavior from `zalo-bot`
- shipping OA in the same batch as `zalo-bot`
- forcing a shared fake-common transport stack across the two official Zalo families

## Delivery Stages

## Stage A: Contract lock

Before coding, this task must answer:

- what is the official OA app creation flow today
- what credentials are needed
- what inbound delivery modes exist
- whether polling exists or webhook is mandatory
- what outbound send restrictions exist
- what conversation surfaces OA supports
- whether group/community semantics differ from `zalo-bot`
- what rate limits and approval gates apply

Required artifact:

- `docs/research/channels/<date>-zalo-oa-current-platform-contract.md`

## Stage B: MVP implementation

Only starts after Stage A is reviewed.

## Target product contract

- canonical provider id: `zalo-oa`
- separate config root under `bots.zaloOa`
- separate operator help and setup guide
- separate runtime health summaries
- no reuse of `zalo-bot` naming in operator-facing surfaces

## File Plan

## Cross-cutting files

- `src/config/core/schema.ts`
  - add `bots.zaloOa.defaults`
  - add `ZaloOaConfig` schema after contract lock
- `src/config/channels/channel-bots.ts`
  - add `ResolvedZaloOaConfig`
  - add `ZaloOaCredentialConfig`
  - add:
    - `listZaloOaBots(...)`
    - `resolveZaloOaBotId(...)`
    - `getZaloOaRecord(...)`
    - `resolveZaloOaConfig(...)`
- `src/config/core/template.ts`
  - add commented `bots.zaloOa` section
- `src/config/core/load-config.ts`
  - extend runtime loading for `zalo-oa`
- `src/channels/catalog/registry.ts`
  - register `zaloOaChannelPlugin`
- `src/control/runtime/runtime-health-store.ts`
  - add `zalo-oa` channel key
  - add `markZaloOaFailure(...)`
- `src/control/commands/message-cli.ts`
  - allow `--channel zalo-oa`
- `src/control/commands/bots-cli.ts`
  - allow `--channel zalo-oa`

## Provider files

These files are implementation targets, but some function signatures are provisional until Stage A is done.

- `src/channels/zalo-oa/plugin.ts`
  - `zaloOaChannelPlugin`
  - `resolveZaloOaReplyTarget(...)`
- `src/channels/zalo-oa/api.ts`
  - `callZaloOaApi(...)`
  - OA-specific auth and send helpers
- `src/channels/zalo-oa/message.ts`
  - OA event parsing helpers
  - OA skip-reason helpers
- `src/channels/zalo-oa/route-config.ts`
  - `resolveZaloOaConversationRoute(...)`
- `src/channels/zalo-oa/session-routing.ts`
  - `resolveZaloOaConversationTarget(...)`
- `src/channels/zalo-oa/content.ts`
  - `resolveZaloOaMessageContent(...)`
- `src/channels/zalo-oa/transport.ts`
  - `postZaloOaText(...)`
  - `postZaloOaMedia(...)`
  - `reconcileZaloOaText(...)` if edits are supported
- `src/channels/zalo-oa/service.ts`
  - `ZaloOaService`
  - startup/bootstrap lifecycle
  - webhook/event receive loop
- `src/channels/zalo-oa/webhook.ts`
  - OA signature verification
  - inbound callback handler

## Test and doc files

- `test/zalo-oa-plugin.test.ts`
- `test/zalo-oa-route-config.test.ts`
- `test/zalo-oa-session-routing.test.ts`
- `test/zalo-oa-service.test.ts`
- `docs/user-guide/zalo-oa-setup.md`
- `docs/tests/features/channels/zalo-oa-channel-mvp.md`

## Code Flow

## Stage-A research flow

1. lock official OA docs and current operator onboarding flow
2. capture example inbound payloads
3. capture example outbound request bodies
4. decide whether OA is webhook-only or dual-mode
5. map OA conversation identity into `clisbot` route/session architecture
6. freeze the MVP contract before implementation

## Stage-B runtime flow

1. `loadConfig()` loads `bots.zaloOa`
2. plugin is registered in `registry.ts`
3. service starts with OA credentials
4. inbound callbacks are verified and parsed
5. route config resolves DM/group/business surface rules
6. `session-routing.ts` produces `AgentSessionTarget`
7. `processChannelInteraction(...)` handles the run
8. transport sends final reply through OA send APIs

## Definition Of Done

This task is done only when both are true:

1. Stage A has a reviewed OA contract note
2. Stage B ships one truthful MVP against that contract

Stage B done criteria:

- OA setup guide is current and operator-usable
- inbound delivery works on one real OA integration
- outbound reply works on one real OA integration
- config, help, health, and tests are updated

## Test Contract

Stage A must produce:

- source links
- current auth flow
- current event model
- current send restrictions
- open questions list

Stage B automated tests:

- config schema
- provider registration
- payload parsing
- auth/signature verification
- route/session mapping
- outbound request shaping
- runtime startup and failure reporting

Stage B live validation:

- prove one real OA receive path
- prove one real OA reply path
- prove operator status and startup error truth

## Risks

- OA may require more compliance or approval steps than `zalo-bot`
- OA may be webhook-first, which changes bootstrap and local-dev ergonomics
- if OA semantics differ heavily, trying to over-share code with `zalo-bot` could create wrong abstractions

## Related Docs

- [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)
