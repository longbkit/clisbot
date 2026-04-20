# Message Command Formatting And Render Modes

## Summary

`clisbot message send` and `clisbot message edit` now expose an explicit content contract:

- `--message` or `--body-file` chooses where the body comes from
- `--input` declares what format that body is already in
- `--render` declares how `clisbot` should deliver it to the destination channel

The goal is to keep the operator and agent surface short, predictable, and reviewable.

## Why It Exists

Before this slice, `message send` was effectively plain-text oriented.

That was not enough once `clisbot` needed to support:

- Telegram-safe HTML delivery with plain-text retry
- Slack `mrkdwn`
- raw Slack Block Kit
- channel-native fallback rendering from Markdown input

Without explicit format and render options:

- prompts become ambiguous
- agents have to guess which output contract the channel wants
- operators cannot tell whether the content is raw native payload or renderer-owned fallback
- Slack and Telegram end up sharing a fake lowest-common-denominator text path

## Scope

- `clisbot message send`
- `clisbot message edit`
- `--body-file`
- `--input`
- `--render`
- channel-specific render ownership for Slack and Telegram

## Non-Goals

- every advanced Slack block type in phase 1
- a universal rich-text schema across all channels
- hiding invalid format combinations behind silent conversion

## Current Defaults

- `--input md`
- `--render native`

This means the default mental model is:

- caller writes normal Markdown-like content
- channel adapter chooses the best currently supported native rendering path

## Body Source Options

- `--message <text>`: inline body
- `--body-file <path>`: read the body from a file
- `--message-file <path>`: compatibility alias for `--body-file`
- `--file <path-or-url>`: preferred attachment flag for files or remote URLs
- `--media <path-or-url>`: compatibility alias for `--file`

Current product stance:

- operator-facing workflows may use `--body-file` for large payloads
- agent-facing prompt guidance should prefer `--file` over `--media` so the attachment intent stays generic instead of sounding image-only
- bot-facing and injected reply guidance should continue to prefer `--message` with inline text or heredoc bodies

## Input Formats

- `plain`: unformatted text
- `md`: Markdown-like text intended for channel-owned rendering
- `html`: HTML input
- `mrkdwn`: Slack-native `mrkdwn`
- `blocks`: raw Slack Block Kit JSON array

## Render Modes

- `native`: channel-owned default rendering
- `none`: do not transform; treat input as already destination-native
- `html`: explicit HTML wire output where supported
- `mrkdwn`: explicit Slack `mrkdwn` output
- `blocks`: explicit Slack Block Kit output

## Channel Contract Matrix

### Telegram

- preferred default path:
  - `--input md --render native`
  - resolves Markdown-like input into Telegram-safe HTML
- direct native path:
  - `--input html --render none`
- explicit native-render path:
  - `--input md --render html`
- invalid paths:
  - Telegram rejects Slack-specific `mrkdwn`
  - Telegram does not support raw `blocks`

### Slack

- preferred default path:
  - `--input md --render native`
  - resolves Markdown-like input into Slack `mrkdwn`
- direct native text path:
  - `--input mrkdwn --render none`
- direct native structured path:
  - `--input blocks --render none`
- explicit fallback-structured path:
  - `--input md --render blocks`
- invalid paths:
  - Slack does not accept HTML rendering

## Current Renderer Behavior

### Telegram

- Markdown input is converted into Telegram-safe HTML
- common inline formatting, headings, lists, blockquotes, and fenced code blocks are supported
- unsafe links or unsupported constructs degrade into readable escaped text
- if Telegram rejects the HTML payload, transport retries with plain text instead of silently failing

### Slack

- Markdown input with `native` resolves to readable Slack `mrkdwn`
- Markdown input with `blocks` resolves to an MVP Block Kit layout:
  - leading paragraph before the first heading becomes a small `context` block
  - `H1` and `H2` become `header` blocks
  - later major sections get a `divider`
  - `H3` becomes a bold `section`
  - `H4+` flatten into paragraph flow as bold lines
  - lists and fenced code blocks stay readable
- raw Block Kit passes through as-is when `--input blocks --render none`
- Block Kit sends use minimal API fallback text so Slack accessibility requirements are met without duplicating the visible body

## Rules That Must Stay Truthful

- invalid channel and render combinations should fail fast
- `--message` and `--body-file` are mutually exclusive
- `--message-file` remains a compatibility alias, not the preferred name
- docs, help text, and runtime behavior must stay aligned
- `native` must remain short to explain and stable to use

## Examples

Default Telegram send:

```bash
clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --message "## Status\n\n- step 1 done"
```

Telegram pre-rendered HTML:

```bash
clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --input html \
  --render none \
  --message "<b>Status</b>\n\nstep 1 done"
```

Slack default native rendering:

```bash
clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --message "## Status\n\n- step 1 done"
```

Slack raw Block Kit:

```bash
clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --input blocks \
  --render none \
  --body-file ./reply-blocks.json
```

## Related Docs

- [Channels](README.md)
- [Message Actions And Bot Routing](message-actions-and-channel-accounts.md)
- [Structured Channel Rendering And Native Surface Capabilities](structured-channel-rendering-and-native-surface-capabilities.md)
- [CLI Commands](../../user-guide/cli-commands.md)
- [Agent Progress Replies](../../user-guide/agent-progress-replies.md)
