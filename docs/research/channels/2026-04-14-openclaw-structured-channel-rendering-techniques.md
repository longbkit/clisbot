# OpenClaw Structured Channel Rendering Techniques For Slack And Telegram

## Summary

OpenClaw does not treat Slack and Telegram as plain-text output pipes.

It keeps a shared conversation core, but uses channel-specific rendering and interaction primitives so replies feel native on each surface.

The main patterns worth borrowing into `clisbot` are:

- Slack Block Kit and interaction-aware delivery
- Telegram-safe HTML rendering with plain-text fallback
- draft streaming by editing one in-flight message instead of spamming new messages
- native reply-target controls per channel
- channel-specific buttons, menus, reactions, and processing-state feedback

## Why This Matters For `clisbot`

`clisbot` already has channel routing, account-aware delivery, prompt templates, and agent reply wrappers.

The next gap is output quality.

If Slack and Telegram replies stay mostly text-only, the product misses capabilities the channels already provide:

- clearer status feedback
- lower message noise during streaming
- better structured command UX
- more native interaction patterns for follow-up actions

## Slack Techniques In OpenClaw

### 1. Block Kit is a first-class output path

Relevant sources:

- `openclaw-private/src/slack/send.ts`
- `openclaw-private/src/slack/blocks-input.ts`
- `openclaw-private/src/slack/blocks-fallback.ts`

What OpenClaw does:

- validates block payloads before send
- generates fallback text when blocks are present
- keeps structured Slack rendering separate from generic markdown text

Why it matters:

- Slack can show richer replies than plain text
- fallback text still keeps notifications, accessibility, and degraded clients understandable

### 2. Native command menus adapt to Slack limits

Relevant source:

- `openclaw-private/docs/channels/slack.md`

What OpenClaw does:

- small option sets use buttons
- medium sets use static select
- large sets use external select
- oversized payloads can require confirm before dispatch

Why it matters:

- Slack interaction UX should adapt to the surface instead of forcing one generic menu model

### 3. Draft streaming edits one message

Relevant source:

- `openclaw-private/src/slack/draft-stream.ts`

What OpenClaw does:

- sends one preview reply
- updates it with `chat.update`
- stops preview when size or transport rules make it unsafe

Why it matters:

- much less thread spam
- better perceived responsiveness
- easier to attach final settlement to the same visible reply

### 4. Slack-specific processing signals stay native

Relevant source:

- `openclaw-private/docs/channels/slack.md`

What OpenClaw does:

- supports ack reactions
- supports assistant thread status
- keeps reply threading explicit
- handles block actions and modal submissions as structured events

Why it matters:

- Slack users already understand these interaction patterns
- processing feedback becomes clearer without adding extra text noise

## Telegram Techniques In OpenClaw

### 1. Telegram uses a safe HTML rendering pipeline

Relevant sources:

- `openclaw-private/src/telegram/format.ts`
- `openclaw-private/docs/channels/telegram.md`

What OpenClaw does:

- converts markdown-ish output into Telegram-safe HTML
- escapes raw HTML to reduce parse errors
- retries as plain text if Telegram rejects parsed HTML

Why it matters:

- Telegram formatting is stricter than Slack
- fallback behavior is part of correctness, not polish

### 2. Draft streaming also edits one preview message

Relevant source:

- `openclaw-private/src/telegram/draft-stream.ts`

What OpenClaw does:

- sends one temporary message
- edits that same message while text arrives
- keeps final text-only settlement in place when possible

Why it matters:

- avoids noisy multi-message streaming
- fits Telegram push-notification behavior better

### 3. Inline keyboards are a first-class capability

Relevant sources:

- `openclaw-private/src/telegram/inline-buttons.ts`
- `openclaw-private/src/telegram/model-buttons.ts`
- `openclaw-private/docs/channels/telegram.md`

What OpenClaw does:

- treats inline keyboards as a capability that can be enabled or scoped
- supports paged button layouts where Telegram callback limits matter
- uses buttons for model or option selection

Why it matters:

- Telegram interaction design is button-first more often than Slack
- callback-data size and keyboard layout must be designed explicitly

### 4. Telegram native command menu is part of the UX

Relevant sources:

- `openclaw-private/docs/channels/telegram.md`
- `openclaw-private/src/telegram/bot-native-command-menu.ts`

What OpenClaw does:

- registers commands with `setMyCommands`
- separates menu registration from command implementation

Why it matters:

- Telegram supports discoverability through the native command menu
- commands feel much more native than relying only on typed slash text

### 5. Reply tags and topic-aware routing are explicit

Relevant sources:

- `openclaw-private/docs/channels/telegram.md`
- `openclaw-private/src/telegram/send.ts`

What OpenClaw does:

- supports `[[reply_to_current]]`
- supports `[[reply_to:<id>]]`
- keeps topic or thread metadata in delivery behavior

Why it matters:

- Telegram reply behavior is not the same as Slack threading
- explicit reply targeting should be channel-owned

### 6. Reaction and status feedback are channel-specific

Relevant source:

- `openclaw-private/src/telegram/status-reaction-variants.ts`

What OpenClaw does:

- maps requested reaction states to Telegram-supported emoji variants
- treats reaction compatibility as a per-channel concern

Why it matters:

- even simple feedback like reactions needs a platform-aware compatibility layer

## Cross-Channel Lessons

### 1. Do not force one universal render model

Shared conversation intent is good.

Shared final payload shape for every channel is not.

The better shape is:

- shared semantic intent
- channel-owned renderers and fallbacks

### 2. Fallback behavior is part of the feature

OpenClaw repeatedly treats fallback as core behavior:

- Slack blocks still need fallback text
- Telegram HTML still needs plain-text retry
- streaming previews stop or degrade when platform limits are hit

`clisbot` should do the same.

### 3. Status and interaction UX belong with rendering

The user-visible output layer is not just text formatting.

It also includes:

- processing signals
- reply-target behavior
- interaction affordances such as buttons or menus
- clear degraded behavior when a capability is unsupported

### 4. Channel capability flags are worth modeling explicitly

OpenClaw treats some behavior as capabilities, not assumptions.

That is a better direction than hiding channel differences behind ad hoc conditionals.

## Borrow-First Recommendations For `clisbot`

Recommended first batch:

1. add a channel render contract that resolves reply mode, preview-edit mode, reply-target mode, and structured-surface capability flags
2. add Slack structured reply support with Block Kit plus fallback text
3. add Telegram safe HTML formatting plus plain-text retry
4. add one-message draft streaming for both Slack and Telegram
5. add channel-native buttons and menus where the platform supports them
6. make reply-target behavior explicit per channel instead of treating it as generic message metadata

Recommended defer list:

- complex Slack modal workflows
- broad Telegram media-native rendering beyond the current text-first need
- a fake universal block schema that erases platform differences

## Recommended `clisbot` Doc Split

- this research note should stay source-driven
- product direction should live in a `clisbot` feature doc
- delivery slices should live in a task-ready doc

## Related `clisbot` Docs

- [Structured Channel Rendering And Native Surface Capabilities](../../features/channels/structured-channel-rendering-and-native-surface-capabilities.md)
- [Structured Channel Rendering And Native Surface Capabilities Task](../../tasks/features/channels/2026-04-14-structured-channel-rendering-and-native-surface-capabilities.md)
- [Message Actions And Bot Routing](../../features/channels/message-actions-and-channel-accounts.md)
- [Agent Progress Reply Wrapper And Prompt](../../features/channels/agent-progress-reply-wrapper-and-prompt.md)
