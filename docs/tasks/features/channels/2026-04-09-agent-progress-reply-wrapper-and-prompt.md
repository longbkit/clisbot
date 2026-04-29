# Agent Progress Reply Wrapper And Prompt

## Summary

Give agent sessions a stable local `clisbot` command and a channel-owned prompt envelope so Codex or Claude can send progress updates and final replies back to the current Slack or Telegram conversation while running in another workspace.

## Status

Done

## Outcome

The channel-owned prompt envelope is implemented and now includes the compact `Message context` contract from [Prompt Context Sender And Surface Contract](2026-04-27-prompt-context-sender-surface-contract.md). The wrapper still provides the exact `clisbot message send` command for Slack and Telegram, while sender/surface context and permission guidance are rendered through the shared prompt path.

## Why

Current agent sessions run inside agent workspaces, not in the `clisbot` repo root.

That makes repo-local commands such as `bun run src/main.ts message send ...` poor developer experience for live chatbot testing, especially when `clisbot` is already running in dev mode and the agent needs to post progress updates back to the same chat thread.

## Scope

- create a stable local `~/.clisbot/bin/clisbot` wrapper automatically
- make runner-launched agent sessions able to call that wrapper reliably
- inject a short channel prompt envelope with the exact reply command for the current surface
- add `responseMode` so normal pane-settlement replies can be suppressed when the agent is expected to answer through `clisbot message send`
- support operator control of `responseMode` and `additionalMessageMode` at agent level and surface level
- add explicit `/queue <message>` so one extra message can still be serialized even when the surface default is steering
- keep control commands and privilege commands unchanged
- document the dev flow so another developer can test it quickly on a different machine

## Research

- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](../../../research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)

## Subtasks

- [x] add feature doc and backlog entry
- [x] add stable local wrapper generation
- [x] export wrapper availability into runner launches
- [x] add channel prompt-envelope config and prompt builder
- [x] inject prompt envelope only into agent-bound prompts
- [x] add `responseMode` so channel auto-settlement can be disabled without disabling runner observation
- [x] rename the shipped surface to `responseMode` across config, status, CLI, slash help, and docs
- [x] add agent-level `responseMode` overrides with surface > agent > provider precedence
- [x] add `clisbot channels response-mode status|set ...` with message-style `--channel` and `--target` addressing
- [x] add `clisbot agents response-mode status|set|clear ...`
- [x] add `additionalMessageMode` with the same provider > agent > surface precedence
- [x] add `clisbot channels additional-message-mode status|set ...`
- [x] add `clisbot agents additional-message-mode status|set|clear ...`
- [x] add `/additionalmessagemode ...` plus explicit `/queue <message>`
- [x] add explicit steer and queue shortcuts plus queue inspection and clear commands
- [x] document the local test flow in the user guide
- [x] add unit tests for wrapper creation, prompt building, and runner launch behavior
- [x] test the local wrapper path against the configured Slack test channel

## Validation Notes

- automated coverage now verifies:
  - wrapper creation and rewrite behavior
  - runner launch command export of wrapper-related env and PATH
  - Slack and Telegram agent prompt envelope rendering
  - the documented heredoc reply pattern survives tricky message bodies such as mixed quotes, shell-looking text, steering-style blocks, and markdown fences
  - agent-bound prompt injection path inside `processChannelInteraction`
  - responseMode delivery suppresses normal channel settlement but still falls back on runtime error
  - agent-level and surface-level responseMode precedence
  - agent-level and surface-level additionalMessageMode precedence
  - steering active-run follow-up versus explicit queued follow-up
  - explicit `\q` and `\s` shortcuts plus queued-message inspection and clear controls
  - response-mode operator CLI updates for Slack and Telegram targets
- live Slack validation now verifies the generated local wrapper at `~/.clisbot/bin/clisbot` can:
  - send to `SLACK_TEST_CHANNEL`
  - delete the created test message cleanly
- this task did not force a full human-inbound to agent-outbound progress-update loop because agent behavior depends on live model decisions, not just clisbot transport correctness

## Exit Criteria

- a developer can run `bun start`, send a real Slack or Telegram message, and have the agent use the local wrapper to post progress updates back to that same conversation
- the prompt envelope contains the exact reply command for the current surface
- the stable wrapper exists without requiring a global package install
- tests cover wrapper creation, prompt injection, and runner launch behavior
