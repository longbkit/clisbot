# Channel Tests

## Purpose

These test cases define the ground truth for user-facing conversation surfaces.

They should be used for ad hoc validation and later automation across Slack,
Telegram, Zalo Bot, API, and other channels.

## Environment

- repo-local dev tests use `CLISBOT_HOME=~/.clisbot-dev` and the generated
  `~/.clisbot-dev/bin/clisbot-dev` wrapper
- `.env` contains the token and test-surface env vars for the channel under test
- `~/.clisbot-dev/clisbot.json` routes the selected test surface to agent
  `default`
- mention-path validation works with `app_mention`
- implicit no-mention follow-up validation requires the Slack app to subscribe to the routed `message.*` event family, not only `app_mention`
- for channel threads, `message.channels` is the critical Slack subscription
- for Slack, natural no-mention continuation means the bot has already replied in that thread; it does not require the bot to have authored the thread root
- the channel configuration enables default chat-first rendering and any transcript request command used by the test
- `bun run restart` has started the dev runtime and `bun run status` reports the
  channel active

## Suites

- [Channel Happy Path Matrix](channel-happy-path-matrix.md)
- [Slack Routing And Follow-Up Tests](slack-routing-and-follow-up.md)
- [Rendering And Command Tests](rendering-and-command-tests.md)
- [Zalo Bot Channel MVP](zalo-bot-channel-mvp.md)
- [Zalo Personal Alpha Tests](zalo-personal-alpha.md)

## Cross-Channel Regression Checks

Run these checks whenever adding a channel, refactoring pairing, or changing route resolution:

- Pairing approval writes the provider-originated user id into the requesting bot's wildcard DM `allowUsers` without reinterpreting it as a handle.
- `allowUsers` and `blockUsers` authorize raw provider user ids only; handle-style aliases, usernames, display names, and mention syntax must not authorize.
- After `pairing approve <channel> <code>`, the same DM sender is admitted on the next message and does not receive a second pairing code.
- If wildcard DM policy is `pairing` and an exact DM route explicitly allows a sender, the exact route wins and the sender is admitted without another pairing prompt.
- Slack, Telegram, and the new provider all keep their principal examples truthful in `/whoami`, `auth get-permissions`, loop `--sender`, queue `--sender`, and pairing guidance.
- Route, queue, and loop CLI targeting preserves explicit surface kind. For providers whose DM and group ids can look alike, supported `group:<id>` forms must address the group route/session, and supported `dm:<id>` forms must address the DM route/session. If the provider slice is DM-only, `group:<id>` must fail before config or session persistence. No provider should guess surface kind from a brittle id prefix when the operator supplied the kind.
- Mention-gated routes still let messages with shared agent command prefixes reach the shared interaction processor. Cover `/queue`, `\q`, configured slash shortcuts, and bash shortcuts through `hasAgentCommandPrefix` instead of provider-local prefix lists.
- Polling channels dispatch later updates without waiting for an earlier agent run to finish, but they must preserve per-conversation ingress order until each message reaches the accepted/enqueued boundary. Cover a DM `hi` that keeps the session busy followed by `/queue <message>`; the queue command must enter behind `hi` before the first run resolves.
- Every supported channel must keep a documented happy-path row for owner
  auto-claim or pairing, unrouted guidance, multi-bot/default-agent routing,
  queues, loops, slash commands, attachments, streaming, final settlement, and
  processing indicators. Use the channel happy-path matrix as the minimum
  checklist before release-facing channel changes are called done.
