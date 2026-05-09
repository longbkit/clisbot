# Channel Integration Playbook

## Summary

Use this playbook when adding a new channel or provider family to `clisbot`.

Its job is simple: stop the next integration from rediscovering the same seams, misses, and duplication traps.

This doc does own:

- the pre-coding truth inventory
- the integration and review checklist
- the repeat traps worth carrying into the next provider

This doc does not own:

- the `channels` feature definition
- one provider's rollout plan
- provider API research or validation evidence

Use it in this order:

1. freeze provider truth
2. walk the delivery workflow
3. use the integration checklist while coding and reviewing
4. close with the validation and done criteria

Use `docs/architecture/surface-architecture.md` and `docs/architecture/runtime-architecture.md` for stable architecture rules, `docs/features/channels/README.md` for feature shape, task docs for one concrete rollout, and research docs for provider evidence or quirks.

## Provider Truth Inventory

Before writing code, freeze the provider truth.

At minimum, answer these questions:

- what are the real one-person and many-people surface kinds
- whether the provider supports first-class sub-surfaces such as topics, threads, or replies
- which trigger shapes are truthful: DM, mention, reply-to-bot, slash command, webhook event, socket event, polling update
- whether outbound rendering is plain text only or supports native formatting
- whether outbound media accepts local upload, remote URL only, or both
- whether inbound attachments need download support, what metadata is exposed, and whether URLs are durable enough for later download
- what truthful onboarding help should appear when a surface is unrouted, unpaired, or blocked
- what failure shape appears when attachment URLs are empty, expired, or zero-byte
- whether typing or processing indicators exist and how long they stay truthful
- whether the provider is polling-first, webhook-first, socket-first, or supports a mixed transport model
- what the real rate limits, message length limits, and retry hints are
- what the canonical sender principal should be for auth and pairing
- whether the provider exposes a truthful sender display name and enough recent-message metadata for prompt context or replay
- what the canonical operator target syntax should be for DM and shared surfaces

Do not copy another channel's behavior until each copied rule still matches the new provider truth.

## Delivery Workflow

Use this order unless the provider forces a different dependency:

### 1. Freeze the product model

- pick one canonical provider id
- pick one canonical principal prefix
- pick one canonical operator target model
- decide which compatibility aliases are justified and which should not be added

### 2. Land the config and identity layer

- schema, defaults, templates, and credential source reporting
- bot resolution and default bot selection
- runtime loading and channel registration
- channel identity, surface prompt context, and sender-directory mapping

### 3. Land inbound runtime truth

- provider service, event parsing, dedupe, and startup validation
- route resolution, admission, follow-up, and session routing
- attachment intake, workspace file staging, and recent-message context
- provider-owned trigger rules such as mention or reply gates

### 4. Land outbound and operator surfaces

- message send path
- reply-target recording
- rendering or content shaping
- typing or processing indicators
- routed and unrouted command behavior such as `/start`, `/status`, `/whoami`, and `/transcript`
- loop, queue, and route-facing target behavior
- owner alerts and surface notifications
- status, startup, and health summaries

### 5. Land docs and tests together

- user-guide setup doc
- feature/test docs for ground-truth validation
- targeted automated coverage for the touched contracts

Do not mark the channel done from startup success alone.

## Required Integration Surfaces

Every new channel should be checked against these surfaces.

Review these hotspots first when a new provider looks "similar enough" to an existing one:

- route config and session routing
- pairing access and principal normalization
- target syntax across `message`, `routes`, `loops`, and `queues`
- processing indicator behavior
- shared help, startup summary, and operator command truth
- routed and unrouted command UX

Those are the places where copy-paste tends to look safe while still creating the next regression.

### Config and credentials

Review:

- `src/config/schema.ts`
- `src/config/channel-bots.ts`
- `src/config/channel-credentials.ts`
- `src/config/channel-credentials-shared.ts`
- `src/config/channel-runtime-credentials.ts`
- `src/config/config-migration.ts`
- `src/config/config-upgrade.ts`
- `src/config/config-file.ts`
- `src/config/direct-message-routes.ts`
- `src/config/group-routes.ts`
- `src/config/route-contract.ts`
- `src/config/template.ts`
- `src/config/load-config.ts`

Questions:

- can the provider be modeled under the existing bot-family pattern
- are credential source, persistence, and startup diagnostics truthful
- do bootstrap or migration paths mention the provider only when enabled or relevant

### Registry and runtime wiring

Review:

- `src/channels/registry.ts`
- `src/channels/channel-plugin.ts`
- `src/channels/channel-identity.ts`
- `src/control/runtime-health-store.ts`
- `src/control/runtime-summary.ts`
- `src/control/runtime-summary-rendering.ts`
- `src/control/startup-bootstrap.ts`
- `src/control/channel-bootstrap-flags.ts`
- `src/control/owner-alerts.ts`
- `src/agents/surface-runtime.ts`

Questions:

- did the new provider stay inside the `ChannelPlugin` seam where possible
- did shared operator summaries stay truthful for older channels
- did new provider guidance leak into generic Slack or Telegram paths too early
- do alerts and status notifications still have a truthful delivery path

### Provider-owned channel package

Review the provider folder under `src/channels/<provider>/`.

Common owners:

- `plugin.ts`
- `service.ts`
- `message.ts`
- `route-config.ts`
- `session-routing.ts`
- `content.ts`
- `transport.ts`
- `typing.ts`
- `attachments.ts`
- `message-actions.ts`
- `feedback.ts`
- `webhook.ts`

Questions:

- which files are truly provider-owned
- which files are a signal that a shared seam is still missing
- are DM and shared surfaces resolved from one truthful target model
- do attachment and transport failures degrade without poisoning the routed conversation

### Auth, pairing, and sender control

Review:

- `src/auth/resolve.ts`
- `src/channels/pairing/access.ts`
- `src/channels/pairing/store.ts`
- `src/channels/pairing/cli.ts`
- `src/channels/follow-up-mode-config.ts`
- `src/channels/unrouted-guidance-policy.ts`

Questions:

- is the auth principal canonical and scoped to the provider family
- are pairing aliases intentionally supported, or accidentally inherited
- do unrouted or unpaired shared surfaces still produce truthful setup guidance such as `/start` or `/whoami`
- did the integration force copy-paste matcher logic that should instead become a follow-up seam

### Shared operator and prompt surfaces

This is a review set, not a required edit list.

These files appear here because, in the current architecture, a new channel often changes operator-facing truth around:

- bot and route management
- target syntax
- loop and queue addressing
- prompt-context and transcript shaping
- rendered help and command expectations

In a thinner provider slice, some of these stay review-only.

Review:

- `src/control/message-cli.ts`
- `src/control/routes-cli.ts`
- `src/control/bots-cli.ts`
- `src/control/loop-cli-addressing.ts`
- `src/control/loop-cli-context.ts`
- `src/control/queues-cli.ts`
- `src/control/loops-cli-rendering.ts`
- `src/control/routes-cli-help.ts`
- `src/channels/agent-prompt.ts`
- `src/channels/message-command.ts`
- `src/channels/route-policy.ts`
- `src/channels/rendering.ts`
- `src/channels/surface-prompt-context.ts`
- `src/channels/surface-directory.ts`
- `src/shared/recent-message-context.ts`
- `src/shared/transcript-normalization.ts`
- `src/agents/attachments/download.ts`

Review if the provider changes these shared contracts:

- `src/channels/interaction-processing.ts`
- `src/channels/message-format.ts`
- `src/channels/mode-config-shared.ts`
- `src/channels/surface-notifications.ts`
- `src/agents/attachments/storage.ts`

Questions:

- did help text over-promise commands the provider does not actually support
- did reply-style hints stay truthful for the provider render capabilities
- did target syntax stay aligned across `message`, `routes`, `loops`, and `queues`
- did routed and unrouted command UX such as `/start`, `/status`, `/whoami`, and `/transcript` still tell the truth for this provider
- did prompt context, sender labeling, replay, and transcript shaping stay truthful for the provider

## Validation and Doc Bundle

The minimum bundle for a new channel is:

- one feature-level setup or behavior doc under `docs/user-guide/`
- one provider task doc under `docs/tasks/features/channels/`
- one provider test doc under `docs/tests/features/channels/`
- updates to `docs/tasks/backlog.md` and `docs/features/feature-tables.md` when the slice changes tracked status, readiness, or current feature state
- updates to shared operator docs such as `docs/user-guide/cli-commands.md` or `docs/user-guide/bots-and-credentials.md` when setup or CLI behavior changed
- updates to shared feature docs when the integration changes a cross-channel contract such as rendering, transcript visibility, or reply prompt semantics
- updates to shared channel test docs when the integration changes common behavior such as follow-up, rendering, typing, replay, or command truth
- targeted automated tests for:
  - config and credential resolution
  - route resolution and session routing
  - message send or message action behavior
  - runtime summary or startup truth when a shared operator surface changed

When a provider exposes product uncertainty or API quirks, add one research note under `docs/research/channels/` instead of stuffing those notes into the playbook.

## Zalo-Bot Lessons

Recent `zalo-bot` work exposed a few misses worth preserving here.

### 1. Prefer truthful constraints over fake parity

For `zalo-bot`, the low-blast-radius move for rendering was a short prompt hint for readable plain text, not a broad Markdown-stripping layer.

Carry this forward:

- prefer truthful prompt or renderer constraints over fake cross-channel parity
- keep older-channel help and summaries truthful when a new provider is added

### 2. Split media and attachment contracts early

`zalo-bot` outbound media currently needs an absolute HTTP or HTTPS URL. That is a different contract from inbound attachment intake and local staging.

Carry this forward:

- write inbound attachment handling and outbound media delivery as separate contracts
- do not say "media support" unless both sides are explicitly covered

### 3. Freeze principal and target models before shared-surface work

`zalo-bot` surfaced misses where pairing aliases, operator send, and reply-target behavior were not all using one canonical provider-scoped model.

Carry this forward:

- freeze one principal model and one DM/shared target model early
- reuse them in pairing, send, reply-target recording, loops, and route-facing docs

### 4. Treat duplication as an output, not as cleanup debt

The slice surfaced repeat work in route config, pairing access matching, target binding, processing indicators, and shared dispatch branches.

Carry this forward:

- document duplication hotspots as soon as they appear
- split standardization into small follow-up tasks instead of silently growing copy-paste

### 5. Shared-surface truth needs its own validation pass

The most visible regressions were not in provider runtime code. They were in help text, startup summaries, operator command truth, and manual expectations for existing channels.

Carry this forward:

- re-read shared feature and test docs whenever a provider touches common seams
- do not trust provider-local automated coverage alone

## Done Criteria

Do not call a new channel integration done until all of these are true:

- provider truth, target model, and principal model are explicit
- startup, status, and health output are truthful
- message send and reply-target behavior match the documented target syntax
- shared operator help does not over-promise unsupported behavior
- shared onboarding, prompt context, replay, and transcript surfaces are still truthful
- DM and shared-surface routing rules are covered by tests
- user-guide, task doc, test doc, and automated coverage were updated together
- any intentional duplication or deferred standardization gap is written down as a follow-up task

## Related Docs

- [Channels](README.md)
- [Surface Architecture](../../architecture/surface-architecture.md)
- [Message Actions And Bot Routing](message-actions-and-channel-accounts.md)
- [Message Command Formatting And Render Modes](message-command-formatting-and-render-modes.md)
- [Structured Channel Rendering And Native Surface Capabilities](structured-channel-rendering-and-native-surface-capabilities.md)
- [Agent Commands](../agents/commands.md)
- [Official Zalo Bot Platform Channel MVP](../../tasks/features/channels/2026-04-18-zalo-bot-platform-channel-mvp.md)
- [Channel Duplication And Reuse Audit For New Integration Slices](../../tasks/features/channels/2026-05-09-channel-duplication-and-reuse-audit-for-new-integration-slices.md)
- [Channel Tests](../../tests/features/channels/README.md)
