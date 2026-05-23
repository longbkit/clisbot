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

For channel work that touches shared seams, use a queue-workflow review pass before calling it done. The current pass must still finish the edit and validation; queued passes are for breadth, artifact architecture, and DRY/KISS review, not a substitute for doing the work now.

Use `docs/architecture/surface-architecture.md` and `docs/architecture/runtime-architecture.md` for stable architecture rules, `docs/features/channels/README.md` for feature shape, task docs for one concrete rollout, and research docs for provider evidence or quirks.

## Provider Truth Inventory

Before writing code, freeze the provider truth.

At minimum, answer these questions:

- what are the real one-person and many-people surface kinds
- whether the provider supports first-class sub-surfaces such as topics, threads, or replies
- which trigger shapes are truthful: DM, mention, reply-to-bot, slash command, webhook event, socket event, polling update
- whether outbound rendering is plain text only, Markdown-compatible, or supports a separate native rich-text payload
- whether Markdown can be converted into that native rich-text payload truthfully, including limits, unsupported syntax, and fallback behavior
- whether outbound media accepts local upload, remote URL only, or both, checked separately for generic file, image, video, voice note, and audio
- whether outbound media supports multiple files in one operator send, and if ordering, captions, partial failure, or album/group behavior change by media kind
- whether inbound attachments need download support, what metadata is exposed, and whether URLs are durable enough for later download
- what truthful onboarding help should appear when a surface is unrouted, unpaired, or blocked
- what failure shape appears when attachment URLs are empty, expired, or zero-byte
- whether typing or processing indicators exist and how long they stay truthful
- whether the provider is polling-first, webhook-first, socket-first, or supports a mixed transport model
- what the real rate limits, message length limits, and retry hints are
- what the canonical sender principal should be for auth and pairing
- whether a provider user id can be numeric, long hex, mixed alphanumeric, or handle-like text
- whether DM and group ids have overlapping shapes; if they can overlap, preserve explicit target kind such as `dm:` or `group:` instead of guessing from id prefixes or regexes
- which raw provider user id must be copied into `allowUsers` and `blockUsers`
- whether the provider exposes a first-class handle or username field; if it does not, do not synthesize one from display name, id shape, mention text, profile URL, or any other non-handle field
- whether handles/usernames exist for display only; they must not authorize unless a future explicit identity-linking feature is designed separately
- whether the provider exposes a truthful sender display name and enough recent-message metadata for prompt context or replay
- what the canonical operator target syntax should be for DM and shared surfaces

Do not copy another channel's behavior until each copied rule still matches the new provider truth.

### Outbound render and file capability research

Every channel integration must include a provider-specific research table before
implementation claims parity with Slack, Telegram, or another channel. This is
especially important for AI-authored replies because the default clisbot mental
model is `--input md --render native`: the AI writes Markdown and the channel
adapter produces the best native-looking output that channel can honestly send.

Render capability table:

| Question | Required answer |
| --- | --- |
| Text input accepted by provider | Plain text, HTML, Markdown, Slack-style `mrkdwn`, native rich-text object, or another payload shape. |
| Markdown compatibility | Which Markdown constructs work natively, which require clisbot conversion, and which must degrade to readable text. |
| Native rich-text support | Supported styles such as bold, italic, underline, links, color, lists, mentions, quotes, buttons, or blocks. |
| Markdown-to-native feasibility | Whether clisbot can map Markdown spans to provider-native ranges/blocks without losing offsets, links, Unicode, emoji, or mentions. |
| Limits | Message length, block count, style-range count, entity count, caption limits, and fallback text limits. |
| Fallback contract | What happens when rich rendering fails: plain text retry, degraded plain text, split message, or hard failure. |
| Tests needed | Unit conversion cases, integration payload assertions, and at least one live send for the richest supported path. |

Outbound file capability table:

| Media kind | Local file path | Remote URL | Multiple files | Caption/message behavior | Validation notes |
| --- | --- | --- | --- | --- | --- |
| Generic file | Unknown until researched | Unknown until researched | Unknown until researched | Unknown until researched | Check upload API, size limits, filename preservation, and local-file support. |
| Image | Unknown until researched | Unknown until researched | Unknown until researched | Unknown until researched | Check whether it sends as image preview, document, or link-only. |
| Video | Unknown until researched | Unknown until researched | Unknown until researched | Unknown until researched | Check thumbnail, duration, transcoding, size, and URL-only requirements. |
| Voice note | Unknown until researched | Unknown until researched | Unknown until researched | Unknown until researched | Check whether the provider has a distinct voice-note API or only generic audio. |
| Audio file | Unknown until researched | Unknown until researched | Unknown until researched | Unknown until researched | Check whether it renders as playable audio, document, or unsupported. |

Do not collapse this to a single "supports files" checkbox. A provider can
support image URLs but not local uploads, generic files but not voice notes, or
one file per message but not multi-file albums. Document each difference before
exposing shared `message send --file` behavior or prompting agents to use it.

## Delivery Workflow

Use this order unless the provider forces a different dependency:

### 1. Freeze the product model

- pick one canonical provider id
- pick one canonical principal prefix
- pick one canonical operator target model
- keep the target kind as data when parsing operator targets; do not strip `dm:`, `group:`, `topic:`, or thread selectors before route/session resolution if the provider id alone cannot prove the surface kind
- decide which compatibility aliases are justified and which should not be added

### 2. Land the config and identity layer

- schema, defaults, templates, and credential source reporting
- bot resolution and default bot selection
- runtime loading and channel registration
- channel identity, surface prompt context, and sender-directory mapping
- principal, provider id, display name, and handle capture, with provider id as the only access-control identity
- handle capture must be field-truthful: store it only from a provider-owned handle/username field, otherwise leave it empty

### 3. Land inbound runtime truth

- provider service, event parsing, dedupe, and startup validation
- route resolution, admission, follow-up, and session routing
- DM admission with the effective sender-specific route, not only wildcard admission
- attachment intake, workspace file staging, and recent-message context
- provider-owned trigger rules such as mention or reply gates, while agent command prefix detection stays on the shared `hasAgentCommandPrefix` seam unless the provider intentionally owns a different command grammar

### 4. Land outbound and operator surfaces

- message send path
- reply-target recording
- rendering or content shaping
- `--input md --render native` behavior, including whether Markdown is parsed
  by the provider or compiled by clisbot into a native rich-text payload
- explicit render fallback behavior for unsupported Markdown or rich-text
  failures
- outbound file behavior for generic files, images, videos, voice notes, audio,
  remote URLs, local file paths, and multiple files
- live reply update capability: channels that cannot edit/delete or otherwise update a live reply must not implement shared streaming reconcile by posting duplicate progress messages
- typing or processing indicators
- routed and unrouted command behavior such as `/start`, `/status`, `/whoami`, and `/transcript`
- loop, queue, and route-facing target behavior
- queue-start notifications as standalone lifecycle messages, not editable streaming drafts
- shared settlement behavior: a fresh `message-tool` final reply wins; without one, the normal pane-derived settlement path is the fallback
- explicit support flags for `dm`, `group`, and `topic` route families
- owner alerts and surface notifications
- status, startup, and health summaries

### 5. Land docs and tests together

- user-guide setup doc
- feature/test docs for ground-truth validation
- targeted automated coverage for the touched contracts
- channel-integration playbook or lessons updates when a new seam, trap, or regression is found

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

Current shared seam snapshot:

The built-in channel model is a static integration seam, not a dynamic plugin loader.

Each built-in channel should expose:

- `src/channels/<provider>/plugin.ts` for runtime behavior and operator inventory
- `src/channels/<provider>/installation.ts` for install-time contracts
- one inventory entry through `src/channels/integration/channel-installation-inventory.ts`
- a surface contract with `normalizeUserId`
- a pairing access contract with both `normalizeAllowEntry` and `normalizeApprovedPairingId`
- config target, credential, bot, route, schema, template, and legacy-migration contracts when the provider participates in those systems

Shared code should consume these seams instead of branching on provider names in config, control, auth, or agent runtime code. A provider-specific branch in shared code is a design smell unless the architecture doc already names it as an exception.

### Config and credentials

Review:

- `src/config/core/schema.ts`
- `src/config/channels/channel-bots.ts`
- `src/config/channels/channel-credentials.ts`
- `src/config/channels/channel-credential-input.ts`
- `src/config/channels/channel-runtime-credentials.ts`
- `src/config/core/config-migration.ts`
- `src/config/core/config-upgrade.ts`
- `src/config/core/config-file.ts`
- `src/config/channels/direct-message-routes.ts`
- `src/config/channels/group-routes.ts`
- `src/config/channels/channel-route-contract.ts`
- `src/config/core/template.ts`
- `src/config/core/load-config.ts`

Questions:

- can the provider be modeled under the existing bot-family pattern
- are credential source, persistence, and startup diagnostics truthful
- do bootstrap or migration paths mention the provider only when enabled or relevant

### Registry and runtime wiring

Review:

- `src/channels/catalog/registry.ts`
- `src/channels/config/surface-config-target.ts`
- `src/channels/integration/channel-plugin.ts`
- `src/channels/surface/channel-identity.ts`
- `src/control/runtime/runtime-health-store.ts`
- `src/control/runtime/runtime-summary.ts`
- `src/control/runtime/runtime-summary-rendering.ts`
- `src/control/commands/startup-bootstrap.ts`
- `src/control/commands/channel-bootstrap-flags.ts`
- `src/control/runtime/owner-alerts.ts`
- `src/agents/runtime/surface-runtime.ts`

Questions:

- did the new provider stay inside the `ChannelPlugin` seam where possible
- did shared provider-facing seams belong under `src/channels/integration`
  rather than leaking into config, control, or a provider folder
- did the provider expose its runtime behavior through `plugin.ts` without
  leaking provider-specific behavior into shared code
- did the provider expose install-time contracts through `installation.ts` and
  one inventory entry in
  `src/channels/integration/channel-installation-inventory.ts`
- did shared operator summaries stay truthful for older channels
- did new provider guidance leak into generic Slack or Telegram paths too early
- do alerts and status notifications still have a truthful delivery path

### Provider-owned channel package

Review the provider folder under `src/channels/<provider>/`.

Common owners:

- `plugin.ts`
- `config-target.ts`
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
- `src/channels/pairing/access-contract.ts`
- `src/channels/pairing/store.ts`
- `src/channels/pairing/cli.ts`
- `src/channels/<provider>/pairing-access.ts`
- `src/channels/config/follow-up-mode-config.ts`
- `src/channels/message/unrouted-guidance-policy.ts`

Questions:

- is the auth principal canonical and scoped to the provider family
- are pairing and access checks based only on raw provider user ids, with no handle or username alias matching
- is `normalizeApprovedPairingId` explicitly defined from provider-originated pending pairing ids
- is `normalizeAllowEntry` explicitly defined for operator-entered raw provider ids in allowlist and blocklist text
- are handle, mention, display name, and compatibility alias inputs rejected or ignored for authorization
- are display-derived handles impossible, both in access checks and in prompt/recent-message metadata
- does service-level DM pairing enforcement read the sender-specific effective DM route, not a wildcard-only admission helper meant for status or setup summaries
- after `pairing approve`, does the next DM from the same sender avoid a second pairing prompt
- if wildcard DM is `pairing`, does an exact DM route for a raw sender id still admit that sender
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

- `src/control/commands/message-cli.ts`
- `src/control/commands/routes-cli.ts`
- `src/control/commands/bots-cli.ts`
- `src/control/commands/loop-cli-addressing.ts`
- `src/control/commands/loop-cli-context.ts`
- `src/control/commands/queues-cli.ts`
- `src/control/commands/loops-cli-rendering.ts`
- `src/control/commands/routes-cli-help.ts`
- `src/channels/message/agent-prompt.ts`
- `src/channels/message/message-command.ts`
- `src/channels/config/route-policy.ts`
- `src/channels/message/rendering.ts`
- `src/channels/surface/surface-prompt-context.ts`
- `src/channels/surface/surface-directory.ts`
- `src/agents/routing/recent-message-context.ts`
- `src/runners/transcript/transcript-normalization.ts`
- `src/agents/attachments/download.ts`

Review if the provider changes these surface contracts:

- `src/channels/message/interaction-processing.ts`
- `src/channels/message/message-format.ts`
- `src/channels/config/surface-mode-config.ts`
- `src/channels/config/surface-notifications.ts`
- `src/agents/attachments/storage.ts`

Questions:

- did help text over-promise commands the provider does not actually support
- did reply-style hints stay truthful for the provider render capabilities
- did `--render native` document the channel's best native output path, its
  Markdown compatibility, and its plain-text or degraded fallback
- did outbound `--file` docs distinguish local file upload from URL-only sends
  for generic file, image, video, voice note, and audio
- did any repeated `--file` or multi-file claim have live validation for
  ordering, captions, grouping/albums, limits, and partial failure
- did target syntax stay aligned across `message`, `routes`, `loops`, and `queues`
- did route management reject unsupported surface families before writing config
- did `queues` and `loops` preserve explicit target kind the same way the provider service and message command path do
- did routed and unrouted command UX such as `/start`, `/status`, `/whoami`, and `/transcript` still tell the truth for this provider
- did mention-gated routes still admit messages with shared agent command prefixes such as `/queue`, `\q`, configured slash shortcuts, and bash shortcuts through `hasAgentCommandPrefix` instead of provider-local prefix lists
- did polling transports dispatch inbound updates without waiting for the current agent run to finish, while still preserving per-conversation ingress order until each message reaches the accepted/enqueued boundary
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
  - required integration inventory coverage
  - pairing approval id normalization and allowlist matching
  - route resolution and session routing
  - route, queue, and loop CLI target parsing for every supported surface kind, plus reject-before-persist coverage for unsupported surface kinds
  - service-level mention-gate coverage proving messages with shared agent command prefixes reach `processChannelInteraction` when the route requires mention
  - service-level polling dispatch coverage proving a later `/queue` message is accepted after the earlier DM message has been enqueued, but before that earlier run finishes
  - service-level DM pairing enforcement for each existing channel when exact DM routes are allowed
  - exact DM route admission when wildcard DM policy is `pairing`
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

### 3. Freeze identity and effective DM route models before shared-surface work

`zalo-bot` surfaced misses where pairing aliases, operator send, and reply-target behavior were not all using one canonical provider-scoped model.

Carry this forward:

- freeze one principal model and one DM/shared target model early
- reuse them in pairing, send, reply-target recording, loops, and route-facing docs
- treat pairing approval ids as provider-originated ids, not operator-entered allowlist text
- make `normalizeApprovedPairingId` an explicit channel decision instead of falling back to `normalizeAllowEntry`
- define the raw provider id shape before adding the channel; handles are display metadata only and must not be access aliases
- do not synthesize handles from display names, ids, mention text, URLs, or normalized labels; leave handle empty unless the provider exposes a real handle/username field
- keep principal examples in `/whoami`, `auth get-permissions`, queue or loop `--sender`, and pairing guidance aligned with that model
- preserve explicit `dm:` or other target kind through control, route, queue, loop, and message-send paths; for DM-only providers such as current Zalo Bot, reject `group:<id>` before config/session persistence instead of inferring or creating the wrong route
- resolve the effective direct-message route with the current provider sender id before enforcing `pairing`, `allowlist`, or `disabled`
- keep wildcard-only DM admission helpers limited to operator summaries or setup guidance; channel services should not use them to decide whether a sender must pair
- add a provider service test where wildcard DM policy is `pairing`, an exact DM route allows one sender, and the allowed sender is admitted without receiving another pairing code
- polling providers must not await the full agent run in the polling loop; dispatch update handlers as in-flight tasks and let `processChannelInteraction` own session queueing, otherwise `/queue` sent during a busy DM cannot reach the shared queue path in time
- do not let concurrent polling handlers overtake each other before enqueue: use the shared `OrderedIngressDispatcher` per-conversation boundary that waits only until the previous message is accepted/enqueued, not until its full run settles
- keep shared route tests for Slack, Telegram, and new providers close enough that a provider-specific shortcut cannot silently drift

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
- pairing approval id normalization is explicitly covered by tests
- exact DM route admission is tested against a wildcard `pairing` fallback
- new or refactored channel docs have had a queue-workflow review pass for breadth, artifact architecture, and DRY/KISS risks
- user-guide, task doc, test doc, and automated coverage were updated together
- any intentional duplication or deferred standardization gap is written down as a follow-up task

### Related Docs

- [Channels](README.md)
- [Surface Architecture](../../architecture/surface-architecture.md)
- [Message Actions And Bot Routing](message-actions-and-channel-accounts.md)
- [Message Command Formatting And Render Modes](message-command-formatting-and-render-modes.md)
- [Structured Channel Rendering And Native Surface Capabilities](structured-channel-rendering-and-native-surface-capabilities.md)
- [Agent Commands](../agents/commands.md)
- [Official Zalo Bot Platform Channel MVP](../../tasks/features/channels/2026-04-18-zalo-bot-platform-channel-mvp.md)
- [Channel Duplication And Reuse Audit For New Integration Slices](../../tasks/features/channels/2026-05-09-channel-duplication-and-reuse-audit-for-new-integration-slices.md)
- [Channel Tests](../../tests/features/channels/README.md)
