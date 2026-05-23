# Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy

## Summary

Define the `clisbot` channel strategy for three distinct Zalo families:

- `zalo-bot`: the new official Zalo Bot Platform
- `zalo-oa`: Zalo Official Account
- `zalo-personal`: unofficial personal-account automation

The main product recommendation is:

1. ship `zalo-bot` first
2. add `zalo-oa` second
3. keep `zalo-personal` optional and explicitly risky

## Status

Ready

## Why

The current Vietnam-channel framing is no longer specific enough.

The new official Zalo Bot Platform changes the product picture:

- it is official
- it is self-serve for individuals
- it looks much closer to Telegram than to personal-account automation

If `clisbot` keeps talking about “Zalo” as one thing, we will blur three materially different providers:

- auth and onboarding
- inbound delivery model
- outbound limits
- compliance and abuse risk
- operator expectations

That would make code, config, docs, and backlog review harder than necessary.

## Scope

- define the canonical three-path Zalo product model
- recommend provider naming for CLI, config, docs, and runtime summaries
- define the recommended delivery order
- define the concrete MVP slice for `zalo-bot`
- define the follow-up slice for `zalo-oa`
- define the optional alpha slice for `zalo-personal`
- define DoD and validation contracts clear enough for lead review and implementation pickup

## Non-Goals

- implementing all three Zalo providers in one batch
- forcing one fake-common config shape across OA, Bot Platform, and Personal before the contracts are proven
- turning this into a full OA research document

## Research

- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)
- [Vietnam Channel Launch Package](2026-04-13-vietnam-channel-launch-package.md)

## Product Decision

## Canonical provider ids

Use these canonical ids:

- `zalo-bot`
- `zalo-oa`
- `zalo-personal`

Do **not** make plain `zalo` the canonical provider id.

Reason:

- `zalo` is ambiguous
- the three paths have different product and technical contracts
- explicit ids will keep `clisbot message`, `bots add`, `routes add`, status,
  docs, and future health output easier to audit

## Provider roles

### `zalo-bot`

This is the primary official small-scale and developer-friendly Zalo path.

Use it for:

- personal bots
- small-team bots
- fast official launch into Vietnam-focused users

### `zalo-oa`

This is the official business/enterprise path.

Use it for:

- business messaging
- larger-scale org distribution
- use cases where Zalo product rules, brand surface, or enterprise workflows matter more than Telegram-like bot ergonomics

### `zalo-personal`

This is the unofficial power-user path.

Use it only when:

- the user explicitly accepts unofficial automation risk
- the official surfaces do not satisfy the required workflow

## Recommended Delivery Order

1. `zalo-bot`
2. `zalo-oa`
3. `zalo-personal`

Rationale:

- `zalo-bot` is the cleanest fit with current `clisbot` channel architecture
- `zalo-bot` is official and likely fastest to validate end to end
- `zalo-oa` should remain separate because its business and policy surface is meaningfully different
- `zalo-personal` should not block official-path delivery

## Detailed Solution

## 1. Shared architecture rule

All three Zalo families should reuse the same `clisbot` channel architecture principles already used for Slack and Telegram:

- provider-owned transport and event parsing
- shared channel-plugin seam
- shared route admission and policy model where it truly fits
- provider-owned capability flags
- truthful runtime, status, and operator help

Do **not** build a Zalo-only architecture fork.

## 2. `zalo-bot` should reuse Telegram patterns where sensible

Implementation stance:

- treat `zalo-bot` as a Telegram-shaped provider
- copy the **architectural pattern**
- do not copy Telegram behavior assumptions where the provider differs

Concrete reuse targets:

- long-polling-first bootstrap
- optional webhook mode
- DM and group chat routing
- capability-driven chunking and streaming decisions
- provider plugin registration and operator message tooling

Concrete differences to preserve:

- `2000`-character text limit
- no threads/topics
- group interaction rules depend on mention/reply semantics
- webhook verification and payload shape are Zalo-specific

## 3. `zalo-bot` MVP contract

### In scope

- one official provider: `zalo-bot`
- token-based account setup
- long polling default
- webhook optional
- direct messages
- group messages, but only under explicit group policy and mention/reply gating
- outbound text
- outbound photo
- message chunking at provider limit
- streaming blocked by default unless later validation proves a better contract
- truthful status and health summaries

### Operator surface expectation

- `clisbot bots add --channel zalo-bot ...`
- `clisbot message send --channel zalo-bot ...`
- `clisbot status`
- provider-aware startup help
- provider-aware route and health summaries

### Default safety posture

- DM policy should follow the same secure default used elsewhere in `clisbot`
- groups should fail closed by default
- mention or reply gating should be explicit in docs and config

## 4. `zalo-oa` follow-up contract

`zalo-oa` should be designed as a **separate official provider family**, not as a mode toggle on top of `zalo-bot`.

Why:

- OA onboarding and business semantics differ
- event, send, and policy rules are likely different enough to deserve their own provider seam
- operator mental model stays clearer when the official paths are still named separately

Expected work before implementation:

- current OA docs refresh
- current auth and app-registration flow
- inbound event model
- outbound send restrictions and rate model
- media contract
- business or approval constraints

## 5. `zalo-personal` optional alpha contract

`zalo-personal` should be explicitly marked:

- unofficial
- QR-login based
- possible account-ban risk

Implementation rule:

- isolate it behind its own provider id and docs
- do not let its risk posture leak into the official provider story

Operational recommendation:

- use native `zca-js` as the first implementation path
- do not expose a public backend selector in the first CLI
- keep QR login aligned with the existing bot/channel CLI model: `clisbot start`,
  `clisbot bots add`, and `clisbot bots login` can accept `--qr-path`, but they
  must still print the QR to the console and wait for the user to scan it
- persist the resulting auth/session file through the same credential-file
  architecture used by token-backed channels
- treat the Zalo Personal session file as provider-owned opaque auth/session
  content under the `tokenFile` path contract, not as a fake bot-token literal
  or runtime `credentialType=mem` secret
- treat the `zalo-personal` bot id as the account identity; do not add a
  separate public account-label concept to clisbot
- report missing or expired auth through the existing connection/status surface
  instead of adding a separate auth column
- if the existing token credential contract cannot express auth/session files
  honestly, add a narrow session-file contract instead of weakening Slack,
  Telegram, and Zalo Bot token behavior

## Work Breakdown

- [x] research OpenClaw official Zalo plugin path
- [x] research OpenClaw personal Zalo path
- [x] verify the latest public Zalo Bot Platform docs and public product positioning
- [x] decide the three-path product model
- [x] decide the recommended implementation order
- [x] define canonical provider ids
- [x] define the `zalo-bot` MVP slice
- [x] define the `zalo-oa` follow-up slice
- [x] define the `zalo-personal` optional alpha slice
- [x] create the concrete `zalo-bot` implementation task
- [x] create the concrete `zalo-oa` research/implementation task
- [x] create the concrete `zalo-personal` alpha task

## Delivery Plan

## Phase 1: `zalo-bot`

Deliver first:

- provider plugin skeleton
- config and setup path
- polling monitor
- optional webhook monitor
- DM and group routing
- text and photo send
- docs, help, status, and targeted tests

## Phase 2: `zalo-oa`

Deliver second:

- current OA contract research
- provider plugin plan
- explicit operator onboarding flow
- clear documentation of business constraints

## Phase 3: `zalo-personal`

Deliver last:

- explicit risk warning
- personal login flow
- isolated alpha provider
- safe operator docs and troubleshooting

## Definition Of Done

This strategy task is done when:

- `clisbot` docs describe Zalo as three distinct paths, not one blurred provider
- backlog points to one clear main Zalo strategy task
- launch roadmap text is updated to mention `zalo-bot`, `zalo-oa`, and `zalo-personal`
- the `zalo-bot` path is clearly defined as the first implementation target
- the doc names the follow-up slices for `zalo-oa` and `zalo-personal`
- the validation contract is specific enough that a dev can implement without reopening the product framing debate

## Test Contract

## Phase-1 implementation contract: `zalo-bot`

Required automated coverage:

- config parsing and provider registration
- account resolution and credential-source truth
- polling update ingestion
- webhook setup validation
- polling/webhook mutual exclusion
- DM admission policy
- group policy and mention/reply gating
- outbound text chunking at `2000`
- outbound photo send
- runtime status summary and health truth

Required live validation:

- create one real Zalo bot from the public Bot Platform flow
- prove DM inbound to agent session
- prove DM outbound text
- prove group interaction under the documented trigger rule
- prove at least one photo outbound path
- prove polling mode
- prove webhook mode or explicitly defer it with a documented blocker

## Phase-2 implementation contract: `zalo-oa`

Required before coding:

- an OA-specific research note
- current auth/onboarding flow
- inbound and outbound message contract
- operator setup guide draft
- delta vs `zalo-bot` written explicitly

## Phase-3 implementation contract: `zalo-personal`

Required before shipping beyond alpha:

- explicit risk warning in help and user guide
- login and relogin recovery contract
- operator troubleshooting contract
- `--qr-path` login flow for `clisbot start`, `clisbot bots add`, and
  `clisbot bots login`
- `clisbot bots logout` and `clisbot bots status` with missing or expired auth
  surfaced as connection/status failure reasons

## Related Docs

- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)
- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Vietnam Channel Launch Package](2026-04-13-vietnam-channel-launch-package.md)
- [Official Zalo Bot Platform Channel MVP](2026-04-18-zalo-bot-platform-channel-mvp.md)
- [Zalo Official Account Channel Contract And MVP](2026-04-18-zalo-official-account-channel-contract-and-mvp.md)
- [Zalo Personal Free Local Adapter Alpha](2026-04-18-zalo-personal-free-local-adapter-alpha.md)
