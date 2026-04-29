# Slack Sender Identity In Prompt Context

## Summary

Fix Slack routed prompt assembly so injected prompt context includes a truthful human sender name, not only a Slack user id, and reduce avoidable misaddressing such as calling the user `anh` or `chị` incorrectly.

## Status

Done

## Outcome

Slack routed prompt assembly now opportunistically resolves sender and surface display metadata through Slack API lookups:

- `users.info` fills `senderName` and `senderHandle` for the current sender when available.
- `conversations.info` fills `channelName` for the current surface when available.
- The Slack manifest now includes `users:read` for `users.info` plus `channels:read`, `groups:read`, `im:read`, and `mpim:read` for `conversations.info` across public channels, private channels, DMs, and MPIMs.
- Prompt rendering prefers grounded display names over raw ids, while falling back to stable ids if lookup fails or scopes are unavailable.
- Slack recent-conversation replay now stores sender display/handle when lookup succeeds.
- Regression coverage exercises the accepted `SlackSocketService.handleInboundMessage` path, not only the prompt renderer.

## Why

When Slack prompt injection only carries `senderId`, the agent loses the most natural identity hint for how to address the human in follow-up turns.

That has two concrete effects:

- the model cannot call the user by name even when Slack already knows it
- the model is more likely to guess honorifics or pronouns incorrectly because it has less grounded identity context

This is a prompt-truthfulness issue at the Slack channel surface, not just a style preference.

## Scope

- audit Slack routed identity construction and recent-conversation replay storage
- carry a truthful Slack sender display name into the injected agent prompt when Slack provides one
- keep fallback behavior safe when Slack does not provide a stable name
- cover routed Slack DM, channel, and thread prompt paths through the shared identity construction
- add regression coverage for Slack prompt context and recent-message replay sender labels

## Resolved Truth

- Telegram already passes `senderName` into routed identity and recent-conversation replay state.
- Slack routed identity now passes `senderId`, `senderName`, and `senderHandle` when Slack lookup provides them.
- Slack recent-conversation replay now stores `senderId`, `senderName`, and `senderHandle` when available.
- Agent prompt rendering and recent replay both prefer `senderName` when it exists.

## Non-Goals

- inferring gender, age, or honorific from weak heuristics
- introducing a broad profile or directory system in this slice
- changing Telegram identity behavior unless a matching bug is found there

## Subtasks

- [x] trace which Slack event fields can provide a safe sender display name for routed prompts
- [x] add `senderName` through Slack identity construction and recent replay append paths
- [x] make sure prompt injection prefers grounded sender names over raw ids when both exist
- [x] add regression tests for Slack accepted prompt path and prompt identity summaries
- [x] review user-facing wording to keep neutral address when no grounded name exists

## Exit Criteria

- Slack prompt injection includes a truthful sender name when Slack provides one
- recent replay lines for Slack can show a readable sender label instead of only `U123...`
- the bot no longer has to rely on weak guesswork just to address the user naturally
- regression tests cover the fixed Slack identity path

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Agent Progress Reply Wrapper And Prompt](2026-04-09-agent-progress-reply-wrapper-and-prompt.md)
- [Slack Channel MVP Validation And Hardening](2026-04-04-slack-channel-mvp-validation-and-hardening.md)
