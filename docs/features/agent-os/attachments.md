# Agent Workspace Attachments

## Summary

Agent-OS owns inbound attachment placement inside the agent workspace.

Current contract:

- channels detect inbound files from Slack or Telegram
- channels download those files
- Agent-OS owns where they live in the workspace
- runners receive only local file paths through the prompt text

## State

Active

## Why It Exists

`muxbot` is strongest when Codex or Claude can work with normal local files.

That means inbound channel files should become workspace-local files instead of staying as remote Slack or Telegram objects.

## Ownership Rule

Agent-OS owns:

- the workspace-local attachment directory
- per-session attachment placement
- attachment path shape inside the workspace

Channels own:

- provider-specific file detection
- provider-specific download auth
- provider-specific file download

Runners must not know whether a file came from Slack or Telegram.

## Current Contract

Inbound files are stored under:

- `{workspacePath}/.attachments/{sessionKey}/{messageId}/...`

Current prompt contract is intentionally minimal:

- prepend one `@/absolute/path` token per stored file
- then append the user message text

Example:

```text
@/Users/example/.muxbot/workspace/default/.attachments/agent-default-main/1771/spec.md Please review this file
```

No extra metadata block is required in the current MVP slice.

## Design Constraints

- files must stay inside the agent workspace
- files must not be written into the workspace root directly
- storage must be hidden by default under `.attachments`
- one conversation must not overwrite another conversation's files
- the contract must stay channel-agnostic for runners

## Non-Goals

- outbound file sending
- OCR or document extraction
- media-group assembly
- database-backed attachment indexing
- object-storage offload

## Related Task Docs

- [2026-04-06-agent-workspace-attachments.md](../../tasks/features/agent-os/2026-04-06-agent-workspace-attachments.md)

## Related Dependencies

- [Channels](../channels/README.md)
- [Runners](../runners/README.md)
