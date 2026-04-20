# Agent Progress Replies

## Purpose

Use this page when you want to test the chatbot flow where Codex or Claude sends short progress updates back to Slack or Telegram while it is still working.

## What clisbot Does

Current local developer flow has three parts:

1. `clisbot` creates a stable local wrapper at `~/.clisbot/bin/clisbot`
2. runner-launched agent sessions get that wrapper path exported during startup
3. Slack and Telegram prepend a short hidden system block to the agent-bound prompt with the exact reply command for the current conversation

That means the agent can be running inside another workspace and still send progress updates with a machine-local command that does not depend on its current working directory.

## Fastest Test Flow

Start clisbot normally:

```bash
bun run start --cli codex --bot-type team
```

Then:

1. send a real human message in the configured Slack or Telegram test surface
2. let clisbot route that message to the configured agent
3. the agent prompt now includes the exact local reply command for that conversation
4. the agent can send progress updates and the final reply through `clisbot message send ...`

Preferred reply pattern for multi-line or quote-heavy content:

```bash
~/.clisbot/bin/clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --input md \
  --render native \
  --message "$(cat <<\__CLISBOT_MESSAGE__
working on it

step 1 complete
__CLISBOT_MESSAGE__
)"
```

Why this exact form:

- keep the delimiter unquoted as `<<\__CLISBOT_MESSAGE__` so the rendered prompt carries fewer nested quotes and is less likely to break when another tool wraps it inside JSON or shell strings
- keep `__CLISBOT_MESSAGE__` alone on its own line when closing the heredoc
- this pattern is now regression-tested against multi-line text, mixed quotes, shell-like text, steering-style blocks, and markdown code fences
- `--input md --render native` is the shipped default, so the flags are optional; they are shown here because they make the reply contract explicit and easier to review
- when attaching something generic, prefer `--file` in agent-facing prompts; `--media` still works as a compatibility alias
- keep the prompt guidance short by channel:
  - Telegram reply prompts currently use `--render native`, so raw Markdown should stay comfortably below `4096` after HTML-safe rendering
  - Slack reply prompts currently use `--render blocks`, so guidance should focus on the content that actually risks overflowing: keep each paragraph, list, or code block comfortably below the `section` limit instead of warning about headings that are already short by default

Common render choices:

- default markdown to native channel rendering:

```bash
~/.clisbot/bin/clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --input md \
  --render native \
  --message "## Status\n\n- step 1 done"
```

- Telegram content already prepared as safe HTML:

```bash
~/.clisbot/bin/clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --input html \
  --render none \
  --message "<b>Status</b>\n\nstep 1 done"
```

- Slack content already prepared as raw `mrkdwn`:

```bash
~/.clisbot/bin/clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --input mrkdwn \
  --render none \
  --message "*Status*\n• step 1 done"
```

For advanced operator workflows, `message send` also supports `--body-file <path>` for large payloads such as raw Slack Block Kit JSON, with `--message-file` kept as a compatibility alias. That path is intentionally not the promoted bot-facing default; injected agent reply guidance should keep using `--message` with normal inline text or heredoc bodies.

For the full `--input` and `--render` contract, see [Message Command Formatting And Render Modes](../features/channels/message-command-formatting-and-render-modes.md).

## Important Rules

- send a real human message to trigger the flow
- do not try to simulate the inbound user turn with `clisbot message send ...`
- the wrapper path is stable on the local machine: `~/.clisbot/bin/clisbot`
- use normal ASCII spaces when copying shell examples
- the injected prompt tells the agent to keep progress updates short
- current prompt policy defaults are:
  - at most `3` progress messages
  - exactly `1` final response

## Why The Wrapper Exists

Agent sessions do not run in the `clisbot` repo root.

So repo-local commands such as:

```bash
bun run src/main.ts message send ...
```

are poor runtime instructions for the agent.

The local wrapper fixes that by always pointing back to the active local `clisbot` checkout.

## Config

Slack and Telegram now expose a small prompt policy block:

```json
"agentPrompt": {
  "enabled": true,
  "maxProgressMessages": 3,
  "requireFinalResponse": true
}
```

If you disable `agentPrompt.enabled`, clisbot stops injecting the reply instruction block into agent-bound prompts for that provider.

User-visible reply delivery is configured beside `streaming` and `response`:

```json
"streaming": "off",
"response": "final",
"responseMode": "message-tool",
"additionalMessageMode": "steer",
"surfaceNotifications": {
  "queueStart": "brief",
  "loopStart": "brief"
}
```

- `capture-pane`: existing clisbot behavior. The channel posts progress or final settlement from normalized runner output.
- `message-tool`: clisbot still captures and observes the runner pane for state, but canonical progress and final replies are expected to happen through `clisbot message send ...` from the agent prompt flow.
- `streaming` now affects both response modes. In `message-tool`, enabled streaming means clisbot may keep one disposable live draft preview visible while the run is active.
- `steer`: when a session is already active, later human messages are sent straight into that live session as steering input.
- `queue`: when a session is already active, later human messages wait behind the current run and clisbot settles them one by one.
- `surfaceNotifications.queueStart`: controls whether a queued turn announces when it actually starts running.
- `surfaceNotifications.loopStart`: controls whether a scheduled loop tick announces when it actually starts running.
- notification modes are `none`, `brief`, or `full`, with `brief` as the shipped default.
- `surfaceNotifications` is independent of `streaming`. `streaming` controls previews or placeholders; `surfaceNotifications` controls explicit start announcements.

Use `message-tool` when you want to avoid duplicate replies or raw pane-derived final settlement while still keeping tmux observation available for status, attach, watch, and internal runtime logic.

When `message-tool` and streaming are both enabled, the user-visible rules are:

- clisbot keeps at most one active live draft preview message
- if a tool-owned reply lands in the thread, that draft freezes
- if later preview-worthy output appears, clisbot opens one new draft below that boundary
- once a tool final is seen, the draft stops updating
- on successful completion with `response: "final"`, the disposable draft is removed
- if the tool path never sends a final reply, clisbot does not auto-settle from pane output; the tool path remains the only canonical reply source

Use `additionalMessageMode: "steer"` when you want natural chatbot follow-ups to influence the current active run immediately.

Use `additionalMessageMode: "queue"` when you want each later human message to become its own queued turn instead.

If the route keeps `streaming: "off"`, queued turns still settle through clisbot without queued placeholders or running previews. You may still see one explicit `Queued message is now running...` notification if `surfaceNotifications.queueStart` is enabled, because that is a separate start-announcement policy and does not depend on `streaming`.

Current runtime note:

- `streaming: "latest"` and `streaming: "all"` are both accepted and persisted today
- the current live preview behavior is still the same for both values until a later preview-shaping slice differentiates them
- `/streaming on` is shorthand that persists as `all`
- when pane output grows normally, clisbot keeps accumulating the live running preview
- when pane output rewrites hard and overlap is no longer trustworthy, clisbot replaces the preview with only the latest changed lines
- large rewrites are intentionally bounded with a short `...[N more changed lines]` marker so chat stays readable instead of replaying a huge pane dump

## Debug Reply Delay

When you need to measure where reply latency is happening, start clisbot with:

```bash
CLISBOT_DEBUG_LATENCY=1 clisbot start
```

Then reproduce the routed message and inspect the log:

```bash
clisbot logs | rg 'clisbot latency'
```

Latency stages currently include:

- `slack-event-accepted` or `telegram-event-accepted`
- `channel-enqueue-start`
- `ensure-session-ready-*`
- `runner-session-ready`
- `tmux-submit-start`
- `tmux-submit-complete`
- `tmux-first-meaningful-delta`

Read them as a handoff timeline:

- large gap before `channel-enqueue-start`: inbound surface handling or event duplication gating
- large gap inside `ensure-session-ready-*`: tmux startup, resume, or trust-prompt path
- large gap between `tmux-submit-complete` and `tmux-first-meaningful-delta`: the runner accepted input slowly or the pane did not visibly change yet

## Response Mode Precedence

Resolved `responseMode` now follows one order:

1. surface override
2. agent override
3. provider default
4. built-in default `message-tool`

That means clisbot still captures the pane in every case, but decides whether user-visible delivery comes from pane settlement or from `clisbot message send ...` using the first configured match above.

Top-level Slack example:

```json
"bots": {
  "slack": {
    "defaults": {
      "agentPrompt": {
        "enabled": true,
        "maxProgressMessages": 3,
        "requireFinalResponse": true
      },
      "streaming": "off",
      "response": "final",
      "responseMode": "message-tool",
      "additionalMessageMode": "steer"
    }
  }
}
```

Slack channel override example:

```json
"bots": {
  "slack": {
    "default": {
      "groups": {
        "channel:C1234567890": {
          "requireMention": true,
          "responseMode": "capture-pane",
          "additionalMessageMode": "queue"
        }
      }
    }
  }
}
```

Telegram group and topic override example:

```json
"bots": {
  "telegram": {
    "default": {
      "groups": {
        "-1001234567890": {
          "requireMention": false,
          "responseMode": "capture-pane",
          "additionalMessageMode": "queue",
          "topics": {
            "42": {
              "responseMode": "message-tool",
              "additionalMessageMode": "steer"
            }
          }
        }
      }
    }
  }
}
```

Interpretation:

- `bots.<provider>.defaults.responseMode` is the provider default
- `bots.<provider>.defaults.additionalMessageMode` is the provider default for busy-session follow-up
- `agents.list[].responseMode` overrides the provider default for that one agent
- `agents.list[].additionalMessageMode` overrides the provider default for that one agent
- a Slack channel route can override it per channel
- a Telegram group can override it per group
- a Telegram topic can override the parent group again for that one topic

Agent override example:

```json
"agents": {
  "list": [
    {
      "id": "default",
      "responseMode": "message-tool",
      "additionalMessageMode": "steer"
    },
    {
      "id": "reviewer",
      "responseMode": "capture-pane",
      "additionalMessageMode": "queue"
    }
  ]
}
```

## Operator Commands

Bot or route response-mode status:

```bash
clisbot bots get --channel slack --bot default
clisbot routes get-response-mode --channel slack channel:C1234567890 --bot default
clisbot routes get-response-mode --channel slack group:G1234567890 --bot default
clisbot routes get-response-mode --channel slack dm:U1234567890 --bot default
clisbot routes get-response-mode --channel telegram group:-1001234567890 --bot default
clisbot routes get-response-mode --channel telegram topic:-1001234567890:42 --bot default
clisbot routes get-response-mode --channel telegram dm:123456789 --bot default
```

Bot or route response-mode updates:

```bash
clisbot routes set-response-mode --channel slack channel:C1234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel slack group:G1234567890 --bot default --mode capture-pane
clisbot routes set-response-mode --channel slack dm:U1234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel telegram group:-1001234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel telegram topic:-1001234567890:42 --bot default --mode capture-pane
clisbot routes set-response-mode --channel telegram dm:123456789 --bot default --mode message-tool
```

Bot or route additional-message-mode status:

```bash
clisbot bots get --channel slack --bot default
clisbot routes get-additional-message-mode --channel slack channel:C1234567890 --bot default
clisbot routes get-additional-message-mode --channel slack group:G1234567890 --bot default
clisbot routes get-additional-message-mode --channel slack dm:U1234567890 --bot default
clisbot routes get-additional-message-mode --channel telegram group:-1001234567890 --bot default
clisbot routes get-additional-message-mode --channel telegram topic:-1001234567890:42 --bot default
clisbot routes get-additional-message-mode --channel telegram dm:123456789 --bot default
```

Bot or route additional-message-mode updates:

```bash
clisbot routes set-additional-message-mode --channel slack channel:C1234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel slack group:G1234567890 --bot default --mode queue
clisbot routes set-additional-message-mode --channel slack dm:U1234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel telegram group:-1001234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel telegram topic:-1001234567890:42 --bot default --mode queue
clisbot routes set-additional-message-mode --channel telegram dm:123456789 --bot default --mode steer
```

Agent response-mode status and updates:

```bash
clisbot agents response-mode status --agent default
clisbot agents response-mode set message-tool --agent default
clisbot agents response-mode clear --agent reviewer
```

Agent additional-message-mode status and updates:

```bash
clisbot agents additional-message-mode status --agent default
clisbot agents additional-message-mode set steer --agent default
clisbot agents additional-message-mode clear --agent reviewer
```

Status surfaces:

- `clisbot status` shows provider-level `responseMode` and `additionalMessageMode` for Slack and Telegram plus any per-agent overrides in the agent summary.
- `/status` shows the active route `responseMode`, `additionalMessageMode`, `surfaceNotifications.queueStart`, and `surfaceNotifications.loopStart` for the current conversation.
- `/streaming status` shows the active route value plus the current persisted surface target value.
- `/responsemode status` shows the active route value plus the current persisted surface target value.
- `/additionalmessagemode status` shows the active route busy-session behavior plus the current persisted surface target value.
- `/streaming off|latest|all` updates the current routed surface target in config.
- `/streaming on` updates the current routed surface target to `all`.
- `/queue <message>` always queues that one extra message, even when the surface default is `steer`.
- `\q <message>` is a shortcut alias for `/queue <message>`.
- `/steer <message>` and `\s <message>` inject a steering message into the active run immediately.
- `/queue list` shows queued messages for the current conversation that have not started yet.
- `/queue clear` clears queued messages for the current conversation that have not started yet.
