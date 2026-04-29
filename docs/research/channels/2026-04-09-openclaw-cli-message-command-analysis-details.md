# OpenClaw CLI Message Command Analysis Details

## Historical Note

This companion note is OpenClaw research support material.

It is not the current `clisbot` command or route contract.

For current `clisbot`, use:

- `docs/user-guide/cli-commands.md`
- `docs/user-guide/channels.md`
- `docs/features/channels/README.md`

Compatibility note:

- route examples such as Slack `channel:<id>` and `user:<id>` in this doc are OpenClaw-oriented research examples
- current `clisbot` prefers `group:<id>` for multi-user Slack surfaces and `dm:<id>` for direct-message operator ids
- Slack `channel:<id>` remains accepted only as compatibility input in current `clisbot`

This companion note holds the deeper source-backed analysis that supports the compact command reference in:

- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](./2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)

## Key Source Files

CLI and docs:

- `docs/tools/slash-commands.md`
- `docs/cli/message.md`
- `docs/cli/channels.md`
- `docs/cli/agents.md`
- `src/cli/program/register.message.ts`
- `src/cli/program/message/register.send.ts`
- `src/cli/program/message/register.poll.ts`
- `src/commands/message.ts`
- `src/cli/channels-cli.ts`
- `src/cli/program/register.agent.ts`
- `src/commands/agents.commands.add.ts`
- `src/commands/agents.bindings.ts`

Shared outbound plumbing:

- `src/agents/tools/message-tool.ts`
- `src/infra/outbound/message-action-runner.ts`
- `src/infra/outbound/deliver.ts`

Slack send path:

- `extensions/slack/src/send.ts`
- `extensions/slack/src/monitor/slash.ts`
- `docs/channels/slack.md`

Telegram send path:

- `extensions/telegram/src/outbound-adapter.ts`
- `extensions/telegram/src/send.ts`
- `extensions/telegram/src/bot/helpers.ts`
- `extensions/telegram/src/voice.ts`
- `extensions/telegram/src/bot-native-command-menu.ts`
- `src/plugin-sdk/telegram-command-config.ts`
- `docs/channels/telegram.md`

## First Distinction: CLI Commands Versus Chat Slash Commands

OpenClaw has two separate command surfaces.

### 1. Shell CLI commands

These are terminal commands such as:

```bash
openclaw message send --channel telegram --target 123456789 --message "hi"
openclaw channels status --probe
openclaw agents bind --agent work --bind telegram:ops
```

These are registered through the CLI program and routed into command handlers in `src/cli/program/*` and `src/commands/*`.

### 2. Chat slash commands

These are in-chat messages such as:

```text
/status
/model gpt-5
/reasoning stream
```

OpenClaw’s slash-command docs explicitly say these are gateway-handled chat commands, usually sent as standalone messages beginning with `/`. They are not the same system as terminal CLI commands. The same doc also separates slash commands from inline directives and inline shortcuts.

Practical implication for `clisbot`:

- if the goal is operator shell compatibility, inspect `openclaw ...`
- if the goal is user-facing in-channel command compatibility, inspect `/...`
- these should not be conflated into one parser model

## OpenClaw CLI Families Relevant To Channel Work

From the source and CLI docs, the command families most relevant to `clisbot` are:

- `openclaw message`
- `openclaw channels`
- `openclaw agents`
- `openclaw agent`

### `openclaw message`

This is the main outbound and message-action CLI.

The source registers the following grouped subcommands under `message`:

- `send`
- `broadcast`
- `poll`
- reactions, read, edit, delete, pins
- permissions, search
- thread commands
- emoji and sticker commands
- Discord admin message actions

This is the command family that matters most for sending messages to Slack and Telegram.

### `openclaw channels`

This is the channel account and runtime-health CLI.

Key subcommands:

- `list`
- `status`
- `capabilities`
- `resolve`
- `logs`
- `add`
- `remove`
- `login`
- `logout`

For `clisbot`, the most relevant ones are:

- `channels add` for account provisioning
- `channels status --probe` for runtime validation
- `channels resolve` for converting names into provider ids usable by `message send`

### `openclaw agents`

This is the isolated-agent and routing CLI.

Key subcommands:

- `list`
- `bindings`
- `bind`
- `unbind`
- `add`
- `set-identity`
- `delete`

For `clisbot`, the routing-relevant commands are:

- `agents add`
- `agents bindings`
- `agents bind`
- `agents unbind`

### `openclaw agent`

This is a one-off agent-turn CLI and can optionally deliver a reply back to a channel, but it is not the main generic send CLI. For transport-level parity, `openclaw message` is the primary reference.

## Source-Backed CLI Syntax

## `openclaw message send`

Important source-backed rules:

- `--target` is required
- `--message` is required unless `--media` is set
- `--media` accepts local paths or URLs
- `--thread-id` is provider-specific:
  - Telegram forum topic id
  - Slack thread timestamp
- `--reply-to` is supported as a message-id style reply target
- `--force-document` is Telegram-specific for image and GIF sends
- `--silent` is supported for Telegram and Discord, not as a Slack-specific behavior

## `openclaw message poll`

This is separate from `send` and uses `--poll-question` plus repeated `--poll-option`. Telegram-specific poll flags include `--poll-duration-seconds`, `--poll-anonymous`, `--poll-public`, `--thread-id`, and `--silent`.

## `openclaw channels add`

Non-interactive setup syntax is provider-dependent, but the shared shell surface is `openclaw channels add --channel <name> [provider flags]`.

Relevant Slack and Telegram provisioning flags:

- Telegram:
  - `--token`
  - `--token-file`
- Slack:
  - `--bot-token`
  - `--app-token`

Important behavior:

- interactive `channels add` may optionally create bindings
- non-interactive `channels add` does not auto-create bindings

## `openclaw agents bind`

Binding syntax is `openclaw agents bind --agent <id> --bind <channel[:accountId]>`.

Important behavior from source and docs:

- missing `accountId` means default account, not all accounts
- explicit account binding can upgrade a previous channel-only binding in place

## Generic Outbound Message Tool Contract

OpenClaw’s generic message tool schema is broader than the human-facing CLI flags, and it is useful because it shows the normalized send contract after CLI parsing.

Relevant fields include:

- `message`
- `media`
- `filename`
- `buffer`
- `contentType`
- `caption`
- `path`
- `filePath`
- `replyTo`
- `threadId`
- `asVoice`
- `silent`
- `quoteText`
- `bestEffort`
- `gifPlayback`
- `forceDocument`
- `asDocument`
- `interactive`

The message action runner then:

- merges `media`, `mediaUrl`, `path`, `filePath`, and `fileUrl`
- promotes `caption` into `message` when no message body exists
- parses media and reply directives from the message text
- normalizes `threadId`
- passes one normalized outbound request into the channel adapter layer

For `clisbot`, this is the most useful abstraction boundary to copy, because it avoids writing Slack-only and Telegram-only CLI parsers too early.

## Slack CLI Send Behavior

## Slack CLI command shape

For Slack, the CLI still uses the generic `message send` surface.

Slack target formats from docs:

- `channel:<id>`
- `user:<id>`
- raw channel id is accepted

These target examples describe the researched OpenClaw CLI, not the current `clisbot` preferred operator naming.

## Slack text send path

Slack text sends use `chat.postMessage`.

Behavior:

- target user ids are resolved to DM channel ids through `conversations.open`
- `threadId` maps to `thread_ts`
- long text is chunked before send
- custom identity fields are retried without `chat:write.customize` if scope is missing

## Slack media send path

Slack media sends are file uploads, not type-specialized transport methods.

OpenClaw does not branch into separate image, audio, or file APIs for Slack. Instead it:

1. loads the media from local path or URL
2. resolves MIME type and file name
3. uses Slack external upload flow:
   - `files.getUploadURLExternal`
   - HTTP `POST` to the presigned upload URL
   - `files.completeUploadExternal`
4. attaches:
   - `initial_comment` from the first text chunk
   - `thread_ts` when a thread id is provided

This means Slack outbound media behavior is effectively:

- image: upload file
- audio: upload file
- generic file: upload file
- threaded media reply: upload file with `thread_ts`

## Slack scenario breakdown

### Scenario summary

- text only: one or more `chat.postMessage` calls depending on chunking
- image with caption: uploaded as file, first text chunk becomes `initial_comment`
- audio file: uploaded as file, with no Slack voice-note-specialized path
- generic document: uploaded as file
- thread reply with media: uploaded into the thread using `thread_ts`
- multiple media: sent sequentially, with caption only on the first item

## Telegram CLI Send Behavior

## Telegram CLI command shape

Telegram also uses the generic `message send` surface.

Telegram-specific send options:

- `--thread-id` for forum topics
- `--force-document`
- `--silent`

The internal adapter always resolves Telegram send context with:

- `textMode: "html"`
- parsed `messageThreadId`
- parsed `replyToMessageId`

## Telegram text send path

Telegram outbound text is rendered as HTML by default.

Behavior:

- Markdown-ish text is converted into Telegram-safe HTML
- if Telegram rejects the HTML, OpenClaw retries as plain text
- replies can carry `replyToMessageId`
- topic sends can carry `message_thread_id`

## Telegram media send path

Telegram is media-type aware. OpenClaw detects media kind and selects the Bot API method accordingly.

### Images

- image and not forced to document:
  - `sendPhoto`
- image with `--force-document`:
  - `sendDocument`

### GIF / animation

- GIF-like animation and not forced to document:
  - `sendAnimation`
- forced document:
  - `sendDocument`

### Video

- normal video:
  - `sendVideo`
- video note mode:
  - `sendVideoNote`

### Audio

If `asVoice` is requested and the media is Telegram-voice-compatible:

- `sendVoice`

Otherwise:

- `sendAudio`

### Generic file

- `sendDocument`

## Telegram caption and follow-up behavior

Telegram captions are length-limited, so OpenClaw may split one logical send into:

- media send with caption
- follow-up text send for overflow

Video notes are stricter:

- they do not support captions
- any supplied text is sent separately as follow-up text

## Telegram thread and topic behavior

Telegram thread handling is not the same as Slack.

### Regular groups

- `message_thread_id` is ignored
- reply threads in normal groups are not treated as first-class separate conversation surfaces

### Forum topics

- topic id is carried through `message_thread_id`
- topic session keys are topic-aware

### General topic special case

General forum topic is topic id `1`.

Important behavior:

- normal message sends omit `message_thread_id=1`
- Telegram rejects `sendMessage(...thread_id=1)` and similar media sends
- typing actions still include `message_thread_id=1`

### DM topics

- DM threads preserve `message_thread_id`

## Telegram scenario breakdown

### Audio as voice note

The human-facing CLI docs inspected here do not show a dedicated `--as-voice` flag on `message send`, but the normalized outbound action layer supports `asVoice`. That means:

- the channel/runtime model supports voice-note-style sending
- the current terminal CLI surface does not appear to expose it directly in `register.send.ts`

This is an important distinction for `clisbot`:

- OpenClaw runtime capability is broader than the current shell flag surface

### Video note

The Telegram runtime supports video-note sending through `sendVideoNote`, and docs show `asVideoNote: true` in action payloads, but the inspected shell CLI registration does not expose a direct `message send --as-video-note` flag.

Again, runtime capability is broader than the current shell flag surface.

### Scenario summary

- text only: `sendMessage` with HTML mode by default
- image with caption: `sendPhoto` by default
- image or GIF with `--force-document`: `sendDocument`
- audio file: usually `sendAudio`
- audio with runtime-level `asVoice` and compatible media: `sendVoice`
- generic file: `sendDocument`
- topic reply: send stays in the topic and preserves `message_thread_id`
- video note: runtime supports it, but the inspected shell CLI does not expose a dedicated flag

## Chat Slash Commands: Only For Contrast

Because the original question used the word "commands," it is worth being explicit:

- `openclaw message send ...` is a shell CLI command
- `/status` is a chat slash command

Slack and Telegram native slash or menu behavior differs:

### Slack slash commands

- Slack native command auto mode is off
- if enabled, one slash command must be registered per native command
- `/status` becomes `/agentstatus` because Slack reserves `/status`
- if native commands are disabled, Slack can use one configured slash command surface like `/openclaw`

### Telegram native commands

- Telegram native command auto mode is on
- command menu registration uses `setMyCommands`
- custom commands are normalized to lowercase `a-z0-9_`, max length `32`
- custom command entries are menu items only; they do not implement behavior by themselves

These chat-native command systems are separate from the CLI shell command system.

## Implications For `clisbot`

If `clisbot` wants OpenClaw-compatible operator CLI behavior, the most important compatibility targets are:

1. `message send`
2. `channels add`
3. `channels status --probe`
4. `channels resolve`
5. `agents add`
6. `agents bind`
7. `agents bindings`

For outbound media behavior, the key parity rules are:

- Slack:
  - treat all outbound media as file uploads
  - support `thread_ts`
  - do not invent image-specific or audio-specific transport branches unless `clisbot` intentionally diverges
- Telegram:
  - branch by media type
  - preserve topic and DM-thread semantics
  - omit `message_thread_id=1` for General forum topic sends
  - support document-forced image or GIF delivery

For API and internal design, the best OpenClaw-shaped abstraction is:

- one generic outbound send contract with:
  - `message`
  - `media`
  - `replyTo`
  - `threadId`
  - `caption`
  - `forceDocument`
  - optional voice or video-note style hints
- provider adapters then specialize the transport

## Recommended `clisbot` Interpretation

- keep shell CLI compatibility separate from in-channel slash command compatibility
- copy the `message send` operator ergonomics first
- mirror Slack upload semantics rather than inventing Slack media subtypes
- mirror Telegram media-type branching and topic-thread rules because those are real transport behaviors, not just UX choices
- treat voice-note and video-note behavior as runtime-capability features that may not need first-pass shell flags if the user-facing CLI scope is intentionally smaller
