# Agent Workspace Attachments

## Status

In Progress

## Priority

P0

## Why

Users need Slack and Telegram file uploads to become usable local files for Codex or Claude.

The current MVP should stay simple:

- save inbound files inside the agent workspace
- mention them as `@/absolute/path`
- append the user message after the file mentions

## Scope

Current slice:

- Slack inbound file download
- Telegram inbound document or photo download
- workspace-local storage under `.attachments`
- prompt shaping as `@filepath1 @filepath2 ... <user message>`

Out of scope for this slice:

- outbound file replies
- OCR or PDF extraction
- cross-session dedupe
- retention policy and cleanup
- advanced media support

## Architecture Notes

- channels own provider-specific download logic
- Agent-OS owns workspace placement
- runners stay provider-agnostic and only receive local file paths

## Planned Checks

- inbound files land under `{workspace}/.attachments/{sessionKey}/{messageId}`
- text-only messages keep current behavior
- file-only messages still produce a usable prompt
- slash commands and bash commands are not broken by attachment prefixing
- failed downloads do not crash normal text handling

## Related Docs

- [Agent Workspace Attachments](../../../features/agent-os/attachments.md)
