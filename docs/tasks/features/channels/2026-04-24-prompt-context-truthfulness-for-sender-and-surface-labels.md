# Prompt Context Truthfulness For Sender And Surface Labels

## Summary

Make routed prompt injection carry the short but high-value identity and surface labels that AI needs to reason naturally and accurately:

- sender name
- Slack channel or group name when available
- Telegram group title when available
- Telegram topic title when available

## Status

Done

## Outcome

Routed prompt context now carries compact truthful sender and surface labels when the platform can provide them:

- Slack prompts use `users.info` for sender display/handle and `conversations.info` for channel display names.
- Slack setup now documents the needed lookup scopes: `users:read` for sender display and `channels:read`, `groups:read`, `im:read`, or `mpim:read` for surface display depending on conversation type.
- Telegram prompts use inbound sender display/handle and group title from the message payload.
- Telegram topic prompts use available topic-creation metadata and cached surface-directory records when the current message payload does not carry a topic title.
- Slack and Telegram fall back to stable ids when display lookup is unavailable.
- Queue, loop, and steering prompt paths reuse the same sender/surface context contract instead of dropping labels.

## Why

Before this work, the injected prompt context already carried route identity, but it still appeared to miss or inconsistently expose some of the most useful human-facing labels.

That makes the model weaker in ways that are avoidable:

- it cannot call people by name even when the platform already knows the name
- it loses immediate grounding about which Slack channel or Telegram group the message came from
- it cannot use the topic title as a concise clue about the thread's real purpose
- it is more likely to guess tone, addressee, or local context from weaker hints

These fields are short and cheap, but they matter disproportionately to reply quality.

## Scope

- audit prompt-envelope assembly for routed Slack and Telegram messages
- audit recent-message replay state so stored context does not drop readable sender or surface labels
- add truthful sender display names where the channel provides them safely
- add truthful surface labels such as Slack channel name, Slack group label, Telegram group title, and Telegram topic title when the platform provides them
- keep fallback behavior safe when only ids are available
- keep loop, queue, and steer prompt paths on the same sender/surface context contract when they reuse the same conversation context
- add regression coverage for prompt injection and recent-context replay rendering

## Resolved Truth

- the narrower Slack sender-name task is complete
- the broader cross-platform surface-label layer is implemented through `SurfacePromptContext`
- Telegram sender, group, and available topic-title truth has been audited and covered by tests

## Validation

- `test/agent-prompt.test.ts` covers Slack and Telegram prompt rendering.
- `test/slack-service.test.ts` covers the accepted Slack service path with sender/channel enrichment.
- `test/surface-directory.test.ts` covers directory storage and enrichment of missing display names.
- `test/telegram-message.test.ts` covers topic-title extraction from topic creation metadata.

## Non-Goals

- inferring honorifics, gender, or social relationship from weak heuristics
- building a broad profile directory or contact system
- stuffing long metadata blocks into every prompt

## Exit Criteria

- routed prompt context includes truthful sender names when available
- routed prompt context includes concise readable surface labels when available
- recent-context replay preserves those labels instead of regressing back to raw ids only
- Slack and Telegram tests cover the fixed prompt-context path

## Related Docs

- [Slack Sender Identity In Prompt Context](2026-04-21-slack-sender-identity-in-prompt-context.md)
- [Agent Progress Reply Wrapper And Prompt](2026-04-09-agent-progress-reply-wrapper-and-prompt.md)
