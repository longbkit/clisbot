# DM-First Pairing Onboarding

## Summary

Reduce time to first successful routed conversation by onboarding new Slack and Telegram users through direct messages first, where they can receive the pairing approval command immediately and then move to their intended shared surface with less confusion.

## Why

- shared-channel first contact currently risks a slower or less obvious pairing path
- direct message onboarding can expose the approval command earlier
- faster first success should reduce setup friction for both Slack and Telegram users

## Scope

- define the desired DM-first onboarding flow for Slack and Telegram
- identify where first-contact copy should instruct users to start in direct message
- ensure the pairing approval command is surfaced clearly in that onboarding flow
- document how this should shorten time to first successful conversation

## Open Questions

- should group or channel pairing rejections explicitly redirect users to DM with the bot
- should `start`, help, or unrouted replies render different onboarding copy for Slack versus Telegram
- should the pairing flow remember that DM onboarding already succeeded and guide users back to the original shared surface

## Related Docs

- [Channels](../../../features/channels/README.md)
- [Configuration](../../../features/configuration/README.md)
- [slack telegram message actions and bot routing](2026-04-09-slack-telegram-message-actions-and-channel-accounts.md)
