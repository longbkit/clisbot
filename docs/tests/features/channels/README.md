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
