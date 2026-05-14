# Slack App Setup

## Purpose

Use this guide when you want to:

- create a Slack app for `clisbot`
- import a manifest template instead of building scopes by hand
- enable Socket Mode
- get the Slack app token and bot token
- start `clisbot`
- test the bot in Slack DM
- add the bot to a public channel or private channel
- troubleshoot the most common Slack setup failures

This guide assumes `clisbot` is already installed and you can run `clisbot start`.

## What You Will Have At The End

After this guide, you should be able to:

1. DM the Slack bot
2. claim the first owner in a fresh install, or approve DM pairing when an
   owner already exists
3. invite the bot into a Slack channel
4. route that channel into `clisbot`
5. test mention flow and thread follow-up

## Manifest Template

For the fastest path, use the shipped manifest template in this repo:

- [Slack app manifest template](../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../templates/slack/default/app-manifest-guide.md)

Practical recommendation:

1. open the manifest file
2. copy its JSON
3. create a Slack app from manifest
4. after import, create the app-level Socket Mode token manually

The manifest covers the bot-facing scopes and event subscriptions, including `users:read` plus the `*:read` conversation scopes that let prompt context show readable sender and channel names.
The app-level Socket Mode token is still a separate Slack step.

## Quick Path

If you want the shortest route first:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

Then:

1. DM the bot in Slack
2. if this is a fresh install with no owner, confirm the first-owner claim reply
3. if an owner already exists and the DM user is not an owner/admin, approve the
   pairing code with `clisbot pairing approve slack <CODE>`
4. invite the bot to a Slack channel
5. add that route with `clisbot routes add --channel slack group:<channelId> --bot default`
6. only if that channel should use a different agent than the one currently assigned to that bot by default, override it with `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
7. test `@clisbot hello`

The rest of this page explains each step in detail.

## Step 1: Create The Slack App

Open:

<https://api.slack.com/apps>

Create a new app.

The easiest path is:

1. choose `Create New App`
2. choose `From an app manifest`
3. choose the target workspace
4. paste the contents of [the manifest template](../../templates/slack/default/app-manifest.json)
5. create the app

If you change scopes or event subscriptions later:

1. save the app changes
2. reinstall the app to the workspace

That reinstall step matters. Slack will not grant the new permissions until you do it.

## Step 2: Enable Socket Mode And Create The App Token

`clisbot` currently uses Slack Socket Mode.

After the app exists:

1. open the app settings
2. enable `Socket Mode`
3. create an app-level token
4. give that token `connections:write`
5. copy the token

That token starts with:

```text
xapp-
```

This is the value for `--slack-app-token`.

Important distinction:

- `xapp-...` is the app-level Socket Mode token
- `xoxb-...` is the bot user OAuth token

You need both.

## Step 3: Install The App And Copy The Bot Token

Install the app to your Slack workspace.

After install, copy the bot token.

That token starts with:

```text
xoxb-
```

This is the value for `--slack-bot-token`.

## Step 4: Start `clisbot`

For a fresh first run, use:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

Why `team` is a good default for Slack:

- Slack is often channel-first
- one shared assistant per channel or team is the common setup

If you want to test first without persisting tokens:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token>
```

Useful checks:

```bash
clisbot status
```

```bash
clisbot logs
```

What you want to see in `clisbot status`:

- `Slack bot default: ...`
- `slack enabled=yes`
- `connection=active`

## Step 5: Test Slack DM

Open the bot's DM or App Home messages surface in Slack.

By default, Slack DMs use pairing mode.

Expected flow:

1. you send a DM
2. if no owner is configured yet and you are inside the owner claim window, the
   bot replies that first-owner claim is complete
3. otherwise, if you are not already an owner/admin, the bot replies with a
   pairing code
4. you approve that code locally

Approve the DM:

```bash
clisbot pairing approve slack <CODE>
```

Then send a normal test message such as:

```text
hello
```

Good first tests:

- `hello`
- `/status`
- `/whoami`

Slack-specific loop help:

- `clisbot loops --help --channel slack`
- `clisbot loops create --help --channel slack`
- Slack loop-only child-surface provisioning uses `--new-thread`, for example:
  - `clisbot loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI`
  - `clisbot loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox`

After the route is bound, `/whoami` is also a quick session check because it
shows `sessionId` plus whether that value is already persisted for that
conversation.

## Step 6: Add The Bot To A Public Channel

Invite the bot into the target Slack channel.

Then find the channel ID.

Practical ways:

1. open the channel in Slack
2. copy the channel link
3. take the `C...` id from the URL

Then add the route:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

Example:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
```

That route uses whichever agent is currently assigned to that bot by default.

If you want to make mention optional:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes set-require-mention --channel slack group:C1234567890 --bot default --value false
```

Only if you want that channel to use a different agent than the one currently assigned to that bot by default:

```bash
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
```

Practical default:

- keep mention required if you want a quieter bot
- turn it off only when you want the bot to behave more like an always-on participant

## Step 7: Add The Bot To A Private Channel

Private Slack channels use the same operator mental model.

Use:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Example:

```bash
clisbot routes add --channel slack group:G1234567890 --bot default
```

That route also uses whichever agent is currently assigned to that bot by default.

Only if you want that private channel to use a different agent than the one currently assigned to that bot by default:

```bash
clisbot routes set-agent --channel slack group:G1234567890 --bot default --agent support
```

Use this when the Slack conversation id starts with `G`.

Practical rule:

- use `group:<id>` for any multi-user Slack surface
- public channels usually use `C...`
- private channels or group-style conversations often use `G...`
- legacy `channel:<id>` input still works, but it is compatibility syntax only

## Step 8: Slack Test Checklist

Use this order:

1. run `clisbot status`
2. DM the bot
3. on a fresh no-owner install, verify the first-owner claim reply; otherwise
   approve pairing with `clisbot pairing approve slack <CODE>`
4. verify DM reply works
5. invite the bot into the target Slack channel
6. add the route with `clisbot routes add --channel slack group:<channelId> --bot default`
7. only if that channel should use a different agent than the one currently assigned to that bot by default, run `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
8. send `@clisbot hello`
9. open the bot reply thread
10. send one plain follow-up reply in that same thread from a real Slack user,
    not from an automation app that posts with a `bot_id`

Good test prompts:

- `@clisbot hello`
- `@clisbot reply with exactly PONG`
- `@clisbot /whoami`
- plain thread follow-up after the first bot reply

In a routed Slack thread, `/whoami` also helps verify session continuity
because it reports `sessionId` plus persistence state for that saved runner
conversation id.

## Why Thread Follow-Up Matters

Slack mention flow and Slack thread follow-up are not the same thing.

Current rule:

- explicit mention uses `app_mention`
- plain thread follow-up needs the right `message.*` event subscription too

That is why the manifest and event subscriptions matter.

If the app only has mention events:

- `@clisbot hello` can still work
- plain thread follow-up may look broken

For public channels, the important event is:

- `message.channels`

For private channels and other conversation kinds, the matching events matter too:

- `message.groups`
- `message.im`
- `message.mpim`

## Useful Commands During Setup

```bash
clisbot status
```

```bash
clisbot logs
```

```bash
clisbot pairing approve slack <CODE>
```

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

```bash
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
```

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

## Troubleshooting

### Slack says the app token is invalid or Socket Mode fails

Most common causes:

- you used the wrong token type
- the app token is not `xapp-...`
- the app token does not have `connections:write`
- Socket Mode is not enabled

Fix:

1. recreate the app-level token
2. verify it is `xapp-...`
3. verify it has `connections:write`
4. restart `clisbot`

Useful check:

```bash
clisbot logs
```

### The bot replies in DM but not in a channel

Most common cause:

- the Slack runtime is healthy
- the bot is installed
- but the channel route was never added

Fix:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

Only if that channel should use a different agent than the one currently assigned to that bot by default:

```bash
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
```

For a private channel:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Only if that private channel should use a different agent than the one currently assigned to that bot by default:

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

### The first mention works but plain thread follow-up does not

Most common cause:

- `app_mention` exists
- `message.channels` or the matching `message.*` event does not

Fix:

1. update the Slack app event subscriptions
2. reinstall the app
3. restart `clisbot`

### Slack reports `missing_scope`

Most common cause:

- the app manifest was changed
- the app was not reinstalled
- or the required scope is still missing

Fix:

1. compare your app with [the manifest template](../../templates/slack/default/app-manifest.json)
2. review [the manifest guide](../../templates/slack/default/app-manifest-guide.md)
3. reinstall the app
4. restart `clisbot`

### The bot is silent in a private channel

Most common causes:

- the bot was never invited to that private channel
- you used `slack-channel` instead of `slack-group`
- the route is missing

Fix:

1. invite the bot into the private channel
2. use the `G...` conversation id
3. run:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Only if that private channel should use a different agent than the one currently assigned to that bot by default:

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

### I changed scopes or events and nothing improved

Slack app changes often need two follow-up actions:

1. reinstall the app in Slack
2. restart `clisbot`

Run:

```bash
clisbot restart
```

Then test again.

### I see duplicate Slack replies

Most likely cause:

- more than one `clisbot` runtime is connected to the same Slack app and workspace

Fix:

1. stop duplicate runtimes
2. keep one active runtime per Slack app token set
3. verify with:

```bash
clisbot status
```

## Related Pages

- [User Guide README](README.md)
- [Bots And Credentials](bots-and-credentials.md)
- [Channel Operations](channels.md)
- [Slack manifest template](../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../templates/slack/default/app-manifest-guide.md)
