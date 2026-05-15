# Zalo-Bot Target Normalization And Reply-Target Truthfulness

## Summary

Add one explicit target normalization seam for `zalo-bot` operator send and reply-target paths so target parsing is truthful, shared, and no longer inferred from brittle string heuristics.

## Status

Done

## Why

Current `zalo-bot` operator paths do not share one canonical target parser the way other channels do.

The result is inconsistent behavior between:

- `message send`
- reply-target resolution after `message send`
- loop-style or route-style target conventions

Current code shows two concrete risks:

- message send currently forwards the raw `target` string directly as `chat_id`
- reply-target resolution currently guesses DM versus group from string shape instead of a shared parser

That means valid operator targets can drift between surfaces, and reply recording can become untruthful.

## Scope

- define one explicit target parser or normalizer for `zalo-bot`
- reuse it for operator send paths and reply-target resolution
- align CLI semantics with the intended DM/group target model
- add coverage for both DM and group targets
- avoid broad unrelated refactors in the same slice

## Non-Goals

- redesigning all message CLI targeting
- forcing other channels to change target syntax in the same batch
- changing route policy semantics

## Current Risks

Examples of current drift:

- `loops` already teaches canonical `dm:<user-id>` and `group:<chat-id>` semantics
- `message send` docs currently show raw `<chatId>`
- reply-target resolution infers group-vs-DM from target string shape instead of a shared normalized target model

This is both a logic risk and a product mental-model risk.

## Suggested Implementation Order

### 1. Freeze one target model

- decide which operator forms are canonical for `zalo-bot`
- decide which compatibility inputs, if any, should remain accepted

### 2. Share the parser

- use it in operator send path
- use it in reply-target resolution
- use it anywhere else that currently re-derives DM/group from string shape

### 3. Add regression coverage

- DM send target
- group send target
- reply-target session recording for both kinds

## Validation Notes

Implemented validation covers:

- `message send --channel zalo-bot --target dm:<user-id>` strips the operator prefix before provider send and records the DM reply target.
- `routes add --channel zalo-bot group:<chat-id>`, `message send --channel zalo-bot --target group:<chat-id>`, `queues create --channel zalo-bot --target group:<chat-id>`, and `loops create --channel zalo-bot --target group:<chat-id>` are rejected because current Zalo Bot is DM-only.
- docs and smoke tests use explicit `dm:` forms for current Zalo Bot operator flows.

## Exit Criteria

- `zalo-bot` has one explicit target normalization seam
- operator send, reply-target resolution, and docs no longer disagree about target shape
- no string-prefix guesswork remains for DM versus group classification

## Related Docs

- [Channel Duplication And Reuse Audit For New Integration Slices](2026-05-09-channel-duplication-and-reuse-audit-for-new-integration-slices.md)
- [Official Zalo Bot Platform Channel MVP](2026-04-18-zalo-bot-platform-channel-mvp.md)
