# Vietnam Channel Launch Package

## Summary

Define the channel package required for a Vietnam-focused launch.

Target package:

- keep Claude, Codex, and Gemini as the core CLI trio
- add Zalo Official Account
- add Zalo Personal

## Status

Planned

## Why

Slack and Telegram cover the current base, but they do not fully match the Vietnam launch target.

The Vietnam package needs to be explicit instead of implicit in chat discussion.

## Scope

- define the MVP scope for Zalo Official Account support
- define the MVP scope for Zalo Personal support
- document how both Zalo surfaces should map onto the existing channel model
- identify channel-account, routing, pairing, and send-flow differences that must be handled
- keep the Slack and Telegram package compatible with the same launch-trio CLI story

## Non-Goals

- implementing every Zalo-adjacent workflow at once
- treating Vietnam launch as a separate architecture fork

## Exit Criteria

- the Vietnam launch package is explicit in backlog and roadmap docs
- Zalo Official and Zalo Personal each have a defined MVP slice
- the remaining implementation work can be split cleanly into follow-up tasks

## Related Docs

- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Channels Feature](../../../features/channels/README.md)
