# Zalo Bot Channel MVP

## Purpose

Validate the repo-local `zalo-bot` dev flow under `~/.clisbot-dev`.

This spec is for:

- manual smoke tests
- launch-readiness checks
- future automation

## Preconditions

- repo code includes the `zalo-bot` channel implementation
- `bun run restart` has been run successfully
- `~/.clisbot-dev/clisbot.json` contains an enabled `bots.zaloBot.default`
- `~/.clisbot-dev/credentials/zalo-bot/default/bot-token` exists
- `bun run status` shows:
  - `zalo-bot enabled=yes connection=active`
  - `Zalo Bot polling connected for 1 bot(s).`

## DM Pairing

1. DM the Zalo bot from a test account.
2. Expect a pairing reply containing a code.
3. Approve the code:

```bash
clisbot-dev pairing approve zalo-bot <code>
```

4. DM the bot again with a simple prompt such as `hi`.

Expected:

- the second DM is admitted
- the agent replies in the same DM
- `bun run status` still shows `zalo-bot enabled=yes connection=active`

## Inbound Media

1. Send an image into the same admitted DM, with or without a caption.

Expected:

- the message is admitted even when the image has no caption
- the routed workspace gets a new file under `.attachments/`
- the prompt handed to the agent includes the attachment path mention
- the agent can respond based on the image

## Operator Send

1. Send a direct operator message:

```bash
clisbot-dev message send --channel zalo-bot --target <chatId> --message "hello"
```

Expected:

- message is accepted
- target receives the text

Guard checks:

- `--thread-id` must fail for `zalo-bot`
- `--topic-id` must fail for `zalo-bot`

## Group Route

1. Add a route:

```bash
clisbot-dev routes add --channel zalo-bot group:<chatId> --bot default
```

2. Mention the bot in that group.

Expected:

- the group message is admitted under the configured route
- the agent reply lands back in the same group

## Media Send

1. Send a message with a remote image URL:

```bash
clisbot-dev message send --channel zalo-bot --target <chatId> --message "hello" --file https://example.com/image.jpg
```

Expected:

- transport accepts the request
- image send succeeds

Constraint:

- local file upload is not the MVP path yet
- non-HTTP/HTTPS image sources should fail clearly

## Failure Checks

If the channel does not come up:

1. Run `bun run status`
2. Run `bun run logs`
3. Verify:
   - `credentialType=tokenFile`
   - `mode=polling`
   - token file is non-empty
   - bot is enabled at both provider-default and bot record level
