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
- no second pairing code is issued for the same sender id
- the approved `allowUsers` entry is the raw provider user id shown in the pairing reply, not `@<id>`, display name, or another handle-like rewrite
- `@...` entries are not Zalo Bot access aliases
- `bun run status` still shows `zalo-bot enabled=yes connection=active`

Regression check:

1. Use a sender id that is not purely numeric, for example a long hex-like provider id or an id containing `-`.
2. Approve pairing.
3. Verify the config stores that exact raw id under `bots.zaloBot.<botId>.directMessages["*"].allowUsers`.
4. DM again and verify the message is admitted without another pairing prompt.

## DM Exact Route Admission

1. Keep wildcard DM policy as `pairing`.
2. Add an exact DM route for one Zalo user id and allow that same raw id.
3. DM the bot from that user.

Expected:

- the exact DM route is admitted
- wildcard `pairing` does not override the exact route
- no pairing code is sent for the already allowed exact-route sender

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
clisbot-dev message send --channel zalo-bot --target dm:<user-id> --message "hello"
```

Expected:

- message is accepted
- target receives the text

Guard checks:

- `--thread-id` must fail for `zalo-bot`
- `--topic-id` must fail for `zalo-bot`

## Media Send

1. Send a message with a remote image URL:

```bash
clisbot-dev message send --channel zalo-bot --target dm:<user-id> --message "hello" --file https://example.com/image.jpg
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

Regression guard:

- While a Zalo Bot DM run is still active, send `/queue <message>` in the same DM. The command must be accepted by the shared queue path before the first run finishes, and it must be ordered behind the earlier DM message even if both updates arrive in one polling batch. The polling loop must not block on the active run, and concurrent handlers must not overtake each other before enqueue.
