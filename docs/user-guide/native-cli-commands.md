# Native CLI Commands

## Purpose

Use this page when you want to understand how `clisbot` coexists with native command or skill systems from the underlying coding CLI.

Today this matters most for:

- Codex
- Claude Code
- Gemini CLI

## Core Rule

`clisbot` reserves a small set of chat-surface control commands such as:

- `/start`
- `/help`
- `/status`
- `/whoami`
- `/transcript`
- `/stop`
- `/nudge`
- `/followup ...`
- `/streaming ...`
- `/responsemode ...`
- `/additionalmessagemode ...`
- `/queue ...`
- `/steer ...`
- `/loop ...`
- `/bash ...`

Anything starting with `/` that is **not** one of those reserved `clisbot` commands is forwarded to the underlying agent CLI unchanged.

That means `clisbot` already preserves the native command surface instead of trying to reinterpret everything itself.

## What This Means In Practice

### Claude Code

Claude Code users often invoke native commands or skills directly with `/...`.

Examples:

- `/review`
- `/memory`
- `/agents`
- `/code-review`

In `clisbot` chat surfaces:

- if the command is reserved by `clisbot`, `clisbot` handles it
- otherwise the raw command is forwarded to Claude unchanged

So if your Claude setup already knows a native command or skill such as `/code-review`, you can keep using it through Slack or Telegram with `clisbot`.

Recommended invocation:

- Telegram or any chat surface that lets the message through unchanged:
  - use `/code-review`
- Slack, where a leading `/...` can be intercepted by Slack-native slash-command handling:
  - use a leading space, for example ` /code-review`
- plain-language prompting also works when that matches your Claude habit:
  - `Invoke /code-review`

Example:

```text
/code-review
```

Loop example:

```text
/loop 3 /code-review
```

Current meaning:

- `clisbot` handles `/loop`
- the loop body stays `/code-review`
- each iteration forwards `/code-review` to Claude as native input

Important warning:

- do **not** use `\code-review` or `::code-review` for native Claude commands
- `\` and `::` are `clisbot` shortcut prefixes, not a translation layer from `clisbot` syntax into Claude slash syntax
- unknown inputs such as `\code-review` are forwarded with that same text, so Claude would receive `\code-review`, not `/code-review`

### Codex

Codex users often rely on:

- native slash commands such as `/model` or `/review`
- skill invocation by name in normal prompt text
- short patterns such as `$gog` when their Codex setup treats that as a fast skill summon

In `clisbot` chat surfaces:

- reserved `clisbot` commands are still handled by `clisbot`
- any non-reserved native slash command is forwarded unchanged
- any non-command text is also forwarded unchanged

So if your Codex workflow already uses things like:

- `/review`
- `$gog`
- `$code-review`
- `use gog to check my calendar`

`clisbot` does not strip or rewrite those inputs before sending them to Codex.

Recommended invocation for Codex:

- if your Codex setup already uses a `$...` summon such as `$code-review` or `$gog`, that is usually the cleanest chat-surface form
- this avoids Slack slash-command ambiguity because the message does not start with `/`
- if you use a native Codex slash command such as `/review`, the same Slack leading-space rule still applies there

Important distinction:

- `clisbot` does not implement Codex skill resolution itself
- it simply preserves the input so Codex can resolve native skills or prompts the same way it normally would

### Gemini CLI

The same pass-through rule applies architecturally to Gemini:

- reserved `clisbot` commands are handled by `clisbot`
- other `/...` commands are forwarded unchanged

However:

- Gemini native-command behavior has not yet been validated as deeply in routed Slack or Telegram usage as Codex and Claude

So current operator guidance is:

- treat Gemini native command pass-through as the intended model
- but validate your exact Gemini command or extension flow in your own route before depending on it heavily

## Force A `clisbot` Command

If you want to avoid ambiguity and explicitly call a `clisbot` control command, use the extra control prefixes:

- `::status`
- `\\status`
- `::transcript`
- `\\transcript`

These prefixes belong to `clisbot`, not to the underlying coding CLI.

This is the safest escape hatch when:

- native CLI commands overlap with `clisbot` names
- Slack native slash handling is getting in the way
- you want a guaranteed `clisbot` command even in a heavily customized native CLI environment

Do not use these prefixes for native Claude or Gemini slash commands unless the underlying CLI itself expects that exact syntax.

## Slack Note

Slack itself may intercept slash-style messages before `clisbot` sees them.

If that happens, send a leading space:

```text
 /review
```

or use a `clisbot` shortcut prefix:

```text
::status
```

## Limits

Current behavior is intentionally simple:

- `clisbot` does not autocomplete native CLI commands
- `clisbot` does not scan your native CLI skill folders and render a merged command menu yet
- `clisbot` does not rewrite one vendor's native syntax into another vendor's syntax

It simply preserves native command text when that text is not one of `clisbot`'s own reserved commands.

## Mental Model

Use this rule of thumb:

- if you are asking `clisbot` to control the chat surface or runtime, use a `clisbot` command
- if you are asking Codex, Claude, or Gemini to do agent work with its own native command or skill system, `clisbot` will usually just forward that text unchanged

That is why existing Codex or Claude habits can continue to work naturally in chat surfaces behind `clisbot`.
