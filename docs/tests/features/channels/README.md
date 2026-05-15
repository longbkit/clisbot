# Channel Tests

## Purpose

These test cases define the ground truth for user-facing conversation surfaces.

They should be used for ad hoc validation and later automation across Slack first, then API and other channels.

## Environment

- `.env` contains valid `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and `SLACK_TEST_CHANNEL`
- `~/.clisbot/clisbot.json` routes `SLACK_TEST_CHANNEL` to agent `default`
- mention-path validation works with `app_mention`
- implicit no-mention follow-up validation requires the Slack app to subscribe to the routed `message.*` event family, not only `app_mention`
- for channel threads, `message.channels` is the critical Slack subscription
- for Slack, natural no-mention continuation means the bot has already replied in that thread; it does not require the bot to have authored the thread root
- the channel configuration enables default chat-first rendering and any transcript request command used by the test
- `bun run dev` is running

## Suites

- [Slack Routing And Follow-Up Tests](slack-routing-and-follow-up.md)
- [Rendering And Command Tests](rendering-and-command-tests.md)
- [Zalo Bot Channel MVP](zalo-bot-channel-mvp.md)

## Cross-Channel Regression Checks

Run these checks whenever adding a channel, refactoring pairing, or changing route resolution:

- Pairing approval writes the provider-originated user id into the requesting bot's wildcard DM `allowUsers` without reinterpreting it as a handle.
- `allowUsers` and `blockUsers` authorize raw provider user ids only; handle-style aliases, usernames, display names, and mention syntax must not authorize.
- After `pairing approve <channel> <code>`, the same DM sender is admitted on the next message and does not receive a second pairing code.
- If wildcard DM policy is `pairing` and an exact DM route explicitly allows a sender, the exact route wins and the sender is admitted without another pairing prompt.
- Slack, Telegram, and the new provider all keep their principal examples truthful in `/whoami`, `auth get-permissions`, loop `--sender`, queue `--sender`, and pairing guidance.
- Route, queue, and loop CLI targeting preserves explicit surface kind. For providers whose DM and group ids can look alike, supported `group:<id>` forms must address the group route/session, and supported `dm:<id>` forms must address the DM route/session. If the provider slice is DM-only, `group:<id>` must fail before config or session persistence. No provider should guess surface kind from a brittle id prefix when the operator supplied the kind.
