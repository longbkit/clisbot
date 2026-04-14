# Telegram Bot Setup

## Purpose

Use this guide when you want to:

- create a Telegram bot with BotFather
- start `clisbot` with that bot token
- test the bot in direct messages
- add the bot to a Telegram group
- route one Telegram forum topic separately
- troubleshoot the most common Telegram setup failures

This guide assumes `clisbot` is already installed and you can run `clisbot start`.

## What You Will Have At The End

After this guide, you should be able to:

1. message the bot in Telegram DM
2. approve DM pairing
3. add the bot to a Telegram group
4. route that group into `clisbot`
5. create one Telegram topic and route only that topic if you want isolation

## Quick Path

If you want the shortest path first:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

Then:

1. DM the bot in Telegram
2. approve the pairing code with `clisbot pairing approve telegram <CODE>`
3. add the bot to your group
4. send `/whoami` in that group or topic
5. run `clisbot channels add telegram-group <chatId> [--topic <topicId>]`

The rest of this page explains each step in detail.

## Step 1: Create The Bot In BotFather

Open Telegram and chat with `@BotFather`.

Run:

```text
/newbot
```

Then follow BotFather's prompts:

1. choose a display name
2. choose a unique username that ends with `bot`
3. copy the token BotFather gives you

That token is the value you pass to `--telegram-bot-token`.

Useful BotFather commands:

- `/mybots`: inspect or reopen a bot you already created
- `/setjoingroups`: allow or deny adding the bot to groups
- `/setprivacy`: control how much the bot can see in groups

## Step 2: Start `clisbot` With The Telegram Token

For a fresh first run, use:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

What this does:

- creates the default `clisbot` config if it does not exist yet
- creates the first default agent if needed
- enables Telegram
- stores the token in the canonical credential file because you used `--persist`

If you want to test first without persisting the token:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token>
```

Useful checks:

```bash
clisbot status
```

```bash
clisbot logs
```

What you want to see in `clisbot status`:

- `Telegram account default: ...`
- `telegram enabled=yes`
- `connection=active`

## Step 3: Test Telegram DM

Open Telegram and send a direct message to your bot.

By default, Telegram DMs use pairing mode.

Expected flow:

1. you send a DM to the bot
2. the bot replies with a pairing code
3. you approve that code from your shell

Approve the DM:

```bash
clisbot pairing approve telegram <CODE>
```

Then send a normal test message such as:

```text
hello
```

Good first tests:

- `hello`
- `/status`
- `/whoami`

If DM pairing is already approved, the bot should answer normally after that.

## Step 4: Add The Bot To A Telegram Group

Add the bot to your target Telegram group or supergroup.

Then send one of these in the group:

- `/start`
- `/status`
- `/whoami`

Why:

- if the group is not routed yet, `clisbot` still gives minimal onboarding help there
- `/whoami` is the easiest way to discover the exact `chatId`
- in a forum topic, `/whoami` also shows the `topicId`

Important Telegram behavior:

- a normal group only needs `chatId`
- a forum topic needs both `chatId` and `topicId`
- the General topic usually uses `topicId: 1`

## Step 5: Route The Group

After you get the `chatId`, add the group route:

```bash
clisbot channels add telegram-group <chatId>
```

Example:

```bash
clisbot channels add telegram-group -1001234567890
```

If you want to bind a specific agent:

```bash
clisbot channels add telegram-group -1001234567890 --agent default
```

If you want the group to work without explicit bot mention:

```bash
clisbot channels add telegram-group -1001234567890 --require-mention false
```

Practical default:

- leave `requireMention` on if you want the bot to stay quiet unless explicitly addressed
- turn it off only when you want the bot to behave more like a continuously active group participant

## Step 6: Create And Route A Telegram Topic

If your group is a forum-style supergroup, you can isolate one topic from the rest.

Create the topic in Telegram first.

Then go into that topic and send:

```text
/whoami
```

Copy the values:

- `chatId`
- `topicId`

Add only that topic:

```bash
clisbot channels add telegram-group <chatId> --topic <topicId>
```

Example:

```bash
clisbot channels add telegram-group -1001234567890 --topic 42
```

If you want a specific agent:

```bash
clisbot channels add telegram-group -1001234567890 --topic 42 --agent default
```

How topic routing works:

- the parent group route lives at `channels.telegram.groups.<chatId>`
- the topic route lives at `channels.telegram.groups.<chatId>.topics.<topicId>`
- a topic can override the parent group behavior

This is the cleanest setup when:

- one topic is for coding
- another topic is for operations
- another topic is for random discussion

## Step 7: Telegram Test Checklist

Use this exact order:

1. run `clisbot status`
2. DM the bot
3. approve pairing with `clisbot pairing approve telegram <CODE>`
4. verify DM reply works
5. add the bot to the target group
6. run `/whoami` in the group
7. add the group route with `clisbot channels add telegram-group <chatId>`
8. send a normal test prompt in the group
9. if using topics, run `/whoami` inside the topic
10. add the topic route with `--topic <topicId>`
11. send a normal test prompt in that topic

Good group and topic test prompts:

- `hello`
- `reply with exactly PONG`
- `/status`
- `/whoami`

## Privacy Mode And Group Visibility

Telegram bots often start with Privacy Mode on.

That matters when you expect the bot to see normal group messages.

Practical rule:

- if your group route keeps `requireMention: true`, Privacy Mode is often acceptable
- if you want the bot to see broader group traffic, disable Privacy Mode in BotFather or give the bot enough group permissions

When you change Privacy Mode:

1. update it in BotFather
2. remove and re-add the bot in the group if Telegram behavior still looks stale

## Useful Commands During Setup

```bash
clisbot status
```

```bash
clisbot logs
```

```bash
clisbot pairing approve telegram <CODE>
```

```bash
clisbot channels add telegram-group <chatId>
```

```bash
clisbot channels add telegram-group <chatId> --topic <topicId>
```

## Troubleshooting

### The bot does not answer in DM

Check:

1. `clisbot status`
2. `clisbot logs`
3. whether you already approved the pairing code

Most common causes:

- Telegram channel is not active yet
- you did not approve the pairing code
- the token is wrong

Fix:

```bash
clisbot pairing approve telegram <CODE>
```

Then test again.

### `clisbot status` looks healthy but the bot is silent in groups

Most common cause:

- you only configured Telegram DM behavior
- the target group was never added to `channels.telegram.groups`

Fix:

1. send `/whoami` in the group
2. copy the `chatId`
3. run:

```bash
clisbot channels add telegram-group <chatId>
```

### The bot is silent in one specific topic

Most common cause:

- the parent group exists
- that topic does not
- the topic route was never added

Fix:

1. send `/whoami` inside the topic
2. copy the `topicId`
3. run:

```bash
clisbot channels add telegram-group <chatId> --topic <topicId>
```

### Telegram says another process is already calling `getUpdates`

This means another Telegram bot runtime is polling the same token.

Fix:

1. stop the other runtime using that same token
2. keep only one active polling process per Telegram bot token
3. restart `clisbot`

Useful check:

```bash
clisbot logs
```

### The bot only responds when explicitly mentioned

That can be correct behavior.

Check the route:

- `requireMention: true` means the bot expects explicit addressing
- Privacy Mode can also limit what the bot sees in groups

If you want broader group handling:

1. re-add the route with `--require-mention false`, or edit config manually
2. review BotFather Privacy Mode

### I changed token or config but behavior did not change

Run:

```bash
clisbot restart
```

Then verify again with:

```bash
clisbot status
```

## Related Pages

- [User Guide README](README.md)
- [Channel Accounts](channel-accounts.md)
- [Channel Operations](channels.md)
