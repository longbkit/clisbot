# Audience-Scoped Access And Delegated Specialist Bots

## Historical Note

This task doc captures the phase-1 direction discussed on 2026-04-21.

For the current stable surface-policy contract, use:

- [Configuration](../../../features/configuration/README.md)
- [Auth](../../../features/auth/README.md)
- [Channels](../../../features/channels/README.md)

Important compatibility note:

- current canonical stored keys under a bot use raw ids:
  - `directMessages["*"]`
  - `directMessages["<id>"]`
  - `groups["*"]`
  - `groups["<id>"]`
- operator-facing route ids still use:
  - `dm:*`
  - `group:*`
  - `topic:<chatId>:<topicId>`
- legacy aliases such as `channel:<id>`, `group:<id>`, `dm:*`, and `groups:*` are compatibility inputs, not the canonical stored JSON shape

## Why This Exists

User use-case signal from 2026-04-21:

- local personal `clisbot` setup already feels convenient when used through Slack
- the next high-value step is simple control over who may message which bot in group versus DM
- instead of one over-scoped assistant, operators want multiple bots with bounded information domains
- specialist bots should be able to ask other specialist bots when needed
- the answer path should respect both who is asking and what information is allowed to be shared back

Example direction from the same request:

- a public-facing assistant should hold only public-facing knowledge
- a Vexere public-facing assistant should know who may ask it, what it may disclose, and when it should defer to another bot
- the overall goal is to reduce unnecessary information leakage by asking the right bot instead of giving one bot broad access

## Problem

Current auth work covers operator ownership, route permissions, protected prompt mutation limits, and basic agent access.

That is not yet the same as a clean product contract for:

- DM versus group or topic audience control
- bot-to-bot delegation
- information-domain boundaries
- auditable "who may ask whom for what" behavior

If this is implemented only as prompt wording, the product still leaks trust through one oversized bot context and one oversized human expectation.

## Desired Contract

### 1. Audience-scoped bot access

Operators should be able to declare, in config and CLI-visible status, who may message a bot on:

- DM surfaces
- shared channels or groups
- topic or thread routes

Likely policy subjects:

- humans
- bots
- owner or admin roles
- named allowlists or deny lists
- route-scoped audience classes

### 2. Delegated specialist bot graph

A bot should be able to ask another bot only through explicit product policy.

Minimum delegation contract:

- caller bot identity is known
- callee bot identity is known
- delegation permission is explicit
- only the minimum necessary request context is forwarded
- the callee can refuse
- the reply returned to the original asker is bounded and auditable

### 3. Information-domain boundaries

Bots or agents should be able to carry an explicit information boundary, not only a persona.

Examples:

- `public`
- `internal`
- `finance`
- `hr`
- `vexere-public`

The long-term rule should answer:

- who may ask
- which bot may answer
- what kind of information may be returned
- who may receive the returned answer on that surface

### 4. Truthful operator UX

The operator surface should make the real boundary obvious.

That likely means:

- config is reviewable without prompt archaeology
- status or inspect surfaces show effective access and delegation policy
- transcripts or audit views show when delegation happened
- refusal or redaction behavior is explicit instead of silent

## Suggested Delivery Phases

### Phase 1

Add straightforward bot access policy for DM, group, and topic audiences.

Current implementation slice:

- DM admission defaults now store canonically on `directMessages["*"]`, while exact DM routes may carry per-user admission and behavior overrides when needed
- shared-route handling is now split into two gates:
  - admission for normal users: a concrete shared route such as `group:<id>` or `topic:<chatId>:<topicId>` must exist
  - sender policy inside that admitted shared surface: the effective route merges stored `groups["*"]` plus any route-local `allowUsers` and `blockUsers`
- shared-route sender policy is now enforced on:
  - Slack group surfaces addressed by operator ids such as `group:<id>` and compatibility aliases such as `channel:<id>`
  - Telegram `group:<chatId>` and `topic:<chatId>:<topicId>`
- shared wildcard `groups["*"]` is now the canonical stored bot-level default fine-grain sender rule
- specific shared routes now inherit that shared default rule and add narrower per-route allow or block entries when needed
- app `owner` and app `admin` principals do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they may bypass sender allowlist checks, but shared `blockUsers` still applies
- CLI route id `group:*` is canonical, and legacy aliases such as `*` or `groups:*` still map to that stored route so operators can mutate the shared default without editing config by hand

### Phase 2

Add explicit bot-to-bot delegation allowlists and visible delegation reporting.

### Phase 3

Add information-domain policy so returned answers respect both caller audience and shareability rules.

## Open Questions

- Should the primary contract live under `bots`, `routes`, `auth`, or a dedicated policy object?
- Should inter-bot calls behave like route handoff, internal RPC, or an agent-callable tool mediated by `clisbot`?
- What is the smallest safe answer format for delegated replies?
- Should `public-facing` become a first-class bot type with safer defaults?
- How should refusal, redaction, and audit trails appear in user-facing channels versus operator-only surfaces?

## Done When

- operators can declare who may message which bot on DM and shared surfaces without prompt hacking
- a public-facing bot cannot reach or disclose broader internal context unless policy explicitly allows it
- delegated answers are bounded, attributable, and inspectable
- docs and operator help make the trust model obvious

## Current Notes

- current runtime already separates:
  - route resolution
  - channel ingress
  - runtime supervision
- that means per-channel sender admission can be enforced at the channel ingress boundary without turning route resolution into an auth owner or forcing full runtime restart
- current phase-1 verification now includes:
  - route-resolution tests for Slack shared routes and Telegram topic inheritance
  - ingress enforcement tests for Slack and Telegram shared routes
  - e2e tests covering `routes CLI -> config -> effective route resolution -> ingress blocking`
- remaining work for this task is no longer basic shared-route sender admission
- the next meaningful slice is command-level auth for sensitive actions on shared routes, then later delegated bot calls and information-domain policy

## Related Docs

- [App And Agent Authorization And Owner Claim](../../../features/auth/app-and-agent-authorization-and-owner-claim.md)
- [Group Bot Abuse And Feedback-Loop Containment](../security/2026-04-17-group-bot-abuse-and-feedback-loop-containment.md)
- [Customer-Support Bot Type And Safe Surface Defaults](../configuration/2026-04-14-customer-support-bot-type-and-safe-surface-defaults.md)
