# OpenClaw Channel Standardization Vs clisbot Gaps

## Summary

This note answers one question:

- does OpenClaw truly abstract and standardize channel behavior, or is it mostly provider-specific code with a shared CLI facade?

Short answer:

- yes, OpenClaw has a real channel standardization layer
- no, it does not make channels fully uniform
- it standardizes the seams, contracts, and shared operator or agent surfaces
- it still leaves inbound runtime, provider API mapping, media semantics, and many routing details inside each provider plugin

For `clisbot`, the main gap is not that Slack and Telegram have some provider-specific code. That is expected.

The real gap is that `clisbot` currently has only a partially shared interaction core, while the rest of the channel system is still shaped as two hand-built implementations rather than one explicit channel contract.

That means adding the next channel will currently require copying and adapting more structure than the architecture should allow.

## Scope

This note compares:

- OpenClaw channel architecture from source
- current `clisbot` Slack and Telegram channel architecture
- the implications for future channel integrations

This note focuses on architecture seams, not on reproducing every OpenClaw command.

## Conclusion

OpenClaw does standardize channel behavior, but at the right boundary:

- shared plugin contract
- shared channel capability model
- shared setup, config, status, security, routing, message-action, outbound, and threading seams
- shared message tool discovery and dispatch
- shared helpers for chat-style channels

OpenClaw does not standardize away provider differences:

- Slack and Telegram still own their own event monitors
- provider API calls remain provider-specific
- media upload logic remains provider-specific
- reply threading and session conversation parsing are plugin-owned where needed
- command menus, approvals, formatting, and live transport remain plugin-owned

This is the correct shape for a multi-channel system.

`clisbot` is not there yet.

`clisbot` already has one important shared seam:

- `src/channels/message/interaction-processing.ts`

But it does not yet have a first-class channel plugin contract or adapter stack comparable to OpenClaw’s channel architecture.

## What OpenClaw Standardizes

### 1. A first-class channel plugin contract

OpenClaw defines a broad `ChannelPlugin` contract with named adapter surfaces for:

- config
- setup
- pairing
- security
- groups
- mentions
- outbound
- status
- gateway lifecycle
- commands
- bindings
- conversation bindings
- threading
- messaging
- agent prompt
- directory lookup
- resolver
- message actions
- heartbeat

Source evidence:

- `src/channels/plugins/types.plugin.ts`
- `src/channels/plugins/types.adapters.ts`
- `src/channels/plugins/types.core.ts`

Meaning:

- a new channel is expected to dock into an explicit system contract
- shared systems know where to ask for routing, delivery, action handling, setup, and status behavior
- future channels do not need to invent their own top-level architecture

### 2. Shared chat-channel composition helpers

OpenClaw provides helper constructors for chat channels:

- `createChannelPluginBase(...)`
- `createChatChannelPlugin(...)`

Source evidence:

- `src/plugin-sdk/core.ts`

Meaning:

- common chat-channel defaults are assembled once
- plugins override only the surfaces they need
- Slack and Telegram still differ, but they differ inside the same shape

### 3. Shared message action discovery and dispatch

OpenClaw standardizes the shared `message` tool across channels.

It has:

- a canonical global action-name list
- discovery of supported actions per plugin
- discovery of supported capabilities per plugin
- plugin-owned schema contributions for tool arguments
- one shared dispatch path into plugin actions

Source evidence:

- `src/channels/plugins/message-action-names.ts`
- `src/channels/plugins/message-action-discovery.ts`
- `src/channels/plugins/message-action-dispatch.ts`
- `src/channels/plugins/types.core.ts`

Meaning:

- the system has one logical message-action model
- providers advertise what they support
- providers still own execution

This is stronger than just having two `message-actions.ts` files with similar function names.

### 4. Shared messaging and threading seams

OpenClaw has explicit plugin-owned adapters for:

- target normalization
- explicit target parsing
- inbound conversation resolution
- delivery target resolution
- session conversation parsing
- parent conversation candidates
- outbound session route resolution
- reply transport resolution
- focused binding context

Source evidence:

- `src/channels/plugins/types.core.ts`
- `src/channels/plugins/session-conversation.ts`

Meaning:

- the core system knows that conversation identity is a first-class cross-channel concern
- providers can inject their special grammar without breaking core session semantics
- future channels get a place to define conversation identity formally

This is especially important for:

- Slack threads
- Telegram topics
- future Discord thread or forum semantics

### 5. Shared registry and plugin loading

OpenClaw has a registry-based model for loaded channel plugins.

Source evidence:

- `src/channels/plugins/registry.ts`
- `extensions/slack/index.ts`
- `extensions/telegram/index.ts`

Meaning:

- the core can iterate channels
- message capabilities can be discovered
- setup and status can be generalized
- new channels can be added through the same registration shape

### 6. Shared account-aware configuration shape

OpenClaw’s channel plugin system is designed around account-aware config adapters.

Source evidence:

- `src/channels/plugins/types.adapters.ts`
- `extensions/telegram/src/shared.ts`

Meaning:

- account listing
- default account resolution
- account enablement
- account inspection
- account-level status

all have one explicit home in the plugin contract.

## What OpenClaw Does Not Standardize

OpenClaw does not force all channels into identical runtime code.

That is intentional.

### 1. Inbound monitoring remains provider-owned

Slack and Telegram own their own inbound runtime stacks.

Examples:

- Slack provider monitor and event handling live under `extensions/slack/src/monitor*`
- Telegram polling, webhook, bot handlers, and message dispatch live under `extensions/telegram/src/bot*`, `monitor*`, and related files

Meaning:

- event source mechanics stay provider-specific
- reconnect logic stays provider-specific
- webhook or polling behavior stays provider-specific

### 2. Message-action execution remains provider-owned

The action surface is standardized, but execution is provider-specific.

Examples:

- Slack action discovery and dispatch: `extensions/slack/src/channel-actions.ts`
- Telegram action discovery and dispatch: `extensions/telegram/src/channel-actions.ts`

Meaning:

- canonical action names are shared
- mapping those names to provider APIs is not shared

This is the correct split.

### 3. Media semantics remain provider-owned

OpenClaw does not pretend Slack media and Telegram media are the same.

Meaning:

- upload methods differ
- remote-url support differs
- reply and thread semantics differ
- compression and media-kind mapping differ

Again, this is correct.

### 4. Channel policy interpretation remains partly provider-owned

Mention gating, allowlists, group policy, and directory lookup all share seams, but the rules are still plugin-defined.

Meaning:

- there is standardization of where this logic lives
- there is not forced sameness of policy rules

## Current clisbot Architecture

`clisbot` has a smaller shared channel layer today.

What is already shared:

- common interaction settlement and command handling in `src/channels/message/interaction-processing.ts`
- common pairing store and pairing helpers in `src/channels/pairing/*`
- common rendering in `src/channels/message/rendering.ts`
- common response-mode and additional-message-mode config writers in `src/channels/config/response-mode-config.ts` and `src/channels/config/additional-message-mode-config.ts`

What is still mostly per-channel:

- service lifecycle
- inbound event loop
- mention and follow-up entry behavior
- route resolution shape
- session-routing shape
- transport and post or reconcile behavior
- provider-specific message-action surfaces
- attachment extraction
- startup registration and runtime wiring

Source evidence:

- Slack: `src/channels/slack/service.ts`, `route-config.ts`, `session-routing.ts`, `transport.ts`, `message-actions.ts`
- Telegram: `src/channels/telegram/service.ts`, `route-config.ts`, `session-routing.ts`, `transport.ts`, `message-actions.ts`

## The Main clisbot Gaps

### Gap 1. No first-class `ChannelPlugin` or adapter contract

`clisbot` has shared helpers, but no explicit top-level channel contract that says:

- every channel must provide route resolution
- every channel must provide transport hooks
- every channel must provide startup or shutdown lifecycle
- every channel must provide message-action capabilities
- every channel may provide account-aware configuration behavior

Effect:

- Slack and Telegram are parallel implementations, not implementations of one explicit channel interface
- architecture is harder to enforce for the next channel

### Gap 2. Route resolution is duplicated by provider instead of modeled as one contract

Slack and Telegram each define their own route type and route builder:

- `src/channels/slack/route-config.ts`
- `src/channels/telegram/route-config.ts`

They are structurally very similar:

- `agentId`
- `requireMention`
- `allowBots`
- `privilegeCommands`
- `commandPrefixes`
- `streaming`
- `response`
- `responseMode`
- `additionalMessageMode`
- `followUp`

Effect:

- this is a refactoring signal
- the architecture currently duplicates route-policy composition even though most of it is channel-agnostic

What should stay provider-specific:

- how a platform resolves conversation kind from native event data
- how route overrides are located in config

What should become shared:

- the normalized route contract
- the merge rules for provider defaults, agent overrides, and route overrides

### Gap 3. No shared inbound conversation contract

OpenClaw has explicit messaging and session-conversation seams.

`clisbot` currently has:

- `src/channels/slack/session-routing.ts`
- `src/channels/telegram/session-routing.ts`

but no shared cross-channel contract for:

- normalized conversation identity
- native conversation id
- parent conversation id
- thread or topic id
- session-key composition inputs
- delivery target write-back inputs

Effect:

- Slack thread semantics and Telegram topic semantics are solved separately
- the next channel will likely create a third custom shape

### Gap 4. No shared channel capability model

OpenClaw has:

- canonical message action names
- capability discovery
- plugin-scoped schema contributions

`clisbot` does not currently have one channel capability registry.

Instead it has:

- Slack message actions in `src/channels/slack/message-actions.ts`
- Telegram message actions in `src/channels/telegram/message-actions.ts`

Effect:

- there is no single way to ask what a channel supports
- operator help, docs, and future tool exposure are harder to keep truthful
- future channels will likely copy another provider-specific action file rather than implementing a shared action contract

### Gap 5. No registry-based channel runtime architecture

OpenClaw has channel plugin registration and lookup.

`clisbot` currently wires Slack and Telegram more directly.

Effect:

- startup, status, and future control surfaces do not yet have one channel-runtime abstraction
- adding a new channel will require more bespoke bootstrap code

### Gap 6. Shared interaction core is too late in the pipeline

`src/channels/message/interaction-processing.ts` is good, but it starts after each provider has already:

- parsed inbound platform payloads
- resolved route
- built its own identity object
- chosen transport callbacks

Effect:

- the standardization starts at the middle of the channel pipeline
- the front half and back half are still mostly provider-specific orchestration

### Gap 7. No explicit architecture seam for future channel setup, status, and doctor flows

OpenClaw gives each channel explicit setup, config, status, doctor, and security surfaces.

`clisbot` currently has config and runtime code for Slack and Telegram, but not a generalized channel adapter boundary for:

- startup diagnostics
- account inspection
- capability reporting
- setup hints
- future doctor or audit surfaces

Effect:

- future channel integrations will likely drift in operator UX

## What This Means For Slack And Telegram Today

Slack and Telegram in `clisbot` are not wrong.

They are just not yet normalized into the architecture shape needed for multi-channel growth.

Current state:

- both share one conversation settlement core
- both already share many policy concepts
- both already expose similar message actions

But:

- the sameness is implicit, not contractual
- duplicated shapes already exist
- future channel work will amplify that duplication

## What This Means For The Next Channel

If `clisbot` adds another channel now, the likely outcome is:

- another service file
- another route-config file
- another session-routing file
- another transport file
- another message-actions file
- more duplicated policy merge code
- more duplicated startup wiring

That would move away from the repo architecture rules in `docs/architecture/`.

The next channel should not be implemented on top of the current ad hoc shape.

## Recommended Direction For clisbot

### 1. Introduce a real channel plugin contract

Add a `ChannelPlugin` or `ChannelAdapter` contract for `clisbot`.

Minimum surfaces:

- `id`
- `start` or `stop` lifecycle
- inbound event normalization
- route resolution
- conversation identity resolution
- transport post or reconcile hooks
- message action handlers
- account-aware config hooks

### 2. Define a normalized channel route model

Move the shared route fields out of provider-specific route builders.

Provider code should only answer:

- what native conversation kind is this
- what override record applies
- what target identity fields exist

The merge of policy should be shared.

### 3. Define a normalized conversation identity model

Create one shared model for:

- provider id
- conversation kind
- native conversation id
- parent conversation id
- thread or topic id
- sender id

This should become the input to session-key routing and action delivery.

### 4. Define a shared channel message action contract

`clisbot` should standardize:

- canonical action names
- per-channel capability discovery
- normalized input contract
- provider-owned execution

That would make Slack, Telegram, and future channels all answer one action interface.

### 5. Keep provider runtimes provider-owned

Do not over-abstract:

- Slack socket runtime should stay Slack-specific
- Telegram polling or webhook runtime should stay Telegram-specific
- future Discord gateway runtime should stay Discord-specific

The correct goal is:

- standardize the seams
- not erase provider differences

## Recommended Rollout Order

### First

Refactor `clisbot` to introduce:

- normalized channel route model
- normalized conversation identity model
- channel plugin contract

### Second

Move Slack and Telegram onto that contract without changing behavior.

### Third

Add a shared message action registry and capability surface.

### Fourth

Only then add the next channel.

## Bottom Line

OpenClaw does abstract and standardize channel behavior in a meaningful way.

It does this by standardizing:

- contracts
- registries
- adapter seams
- shared action discovery
- shared chat-channel composition

It does not standardize:

- provider runtimes
- provider APIs
- provider media semantics

`clisbot` currently shares only part of that architecture.

The biggest gap is not missing one helper. The biggest gap is missing an explicit channel contract that Slack, Telegram, and future channels must implement.
