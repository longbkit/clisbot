---
title: Discord channel
description: Run an agent in Discord guild channels, threads, and DMs over the gateway.
nav: Discord
order: 84
category: Hub
---

# Discord

Discord connects over the gateway, so it needs no public address. Inbound is limited to new messages today: slash commands, interaction callbacks, and inbound reactions are not routed yet.

Hub also uses Discord as an [event trigger provider](/docs/hub/triggers/discord). That is a different resource. A Discord **Channel account** carries its own bot token, and the two appear side by side in the Connections list under the same provider name, told apart by id.

## What you need

1. Create an application at <https://discord.com/developers/applications>, add a Bot user, and copy its token. The application id is decoded from the token.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**. Without it Discord delivers empty content for guild messages that do not mention the bot, so only mention-addressed traffic works. Leave **Server Members** and **Presence** off.
3. Under **OAuth2 → URL generator**, pick the scopes `bot` and `applications.commands`, then these bot permissions:
   - View Channels, Send Messages, Send Messages in Threads
   - Create Public Threads, Manage Threads
   - Embed Links, Attach Files, Read Message History
   - Add Reactions, Manage Messages — needed for pin, unpin, and delete
   - Use External Emojis — only for emoji discovery across guilds
4. Invite the bot to the guild with the generated URL.

## Add it to Hub

```sh
umask 077 && printf '%s' '<bot token>' > /tmp/discord-token
paseo channels add discord --account main --secret-file /tmp/discord-token
rm /tmp/discord-token
```

Hub probes the token against `GET /users/@me` before storing it. In the app, use **Channels → Accounts → Add Channel account**.

## Conversations it handles

Direct messages, guild text channels, and threads. A Discord thread is itself a channel id, so a Route targets it the same way it targets a channel.

Mention detection accepts an explicit `<@id>` mention or a reply to one of the bot's own messages. Own-message and bot-authored traffic is filtered. Admission is keyed on the Discord message id, so a gateway `RESUME` redelivery is dropped rather than replayed.

## What the agent can do

Message tool actions, default-on set: `send`, `react`, `reactions`, `read`, `edit`, `delete`, `pin`, `unpin`, `list-pins`, `upload-file`, `emoji-list`, `member-info`, `thread-create`, `thread-list`, `thread-reply`, `search`. Most of Discord's vocabulary is gated on per-account toggles, so an account's real set can be narrower or wider than this.

Text with Discord markdown, chunking, and mention rewriting; files of any type, one message per file; message edit and delete; pin, unpin, and list pins; reactions; thread create and thread reply; polls; stickers; emoji upload and listing; webhook sends; embeds and message components including buttons and selects; the typing indicator; and guild, channel, member, and role reads.

## Limits

- **Slash commands and interaction callbacks are not routed.** The code to register and dispatch them is present but nothing wires it, so a button click does not reach Hub.
- **Inbound reactions, edits, deletes, and attachments are not routed.** The gateway transport normalizes new messages only, and inbound media is not downloaded.
- **No voice.** Voice messages and voice channels are omitted; asking `send` for a voice message fails loudly.
- **No Activities.** They need a public endpoint Hub does not expose.
- A configured gateway proxy is refused rather than silently ignored.

## Verified live

Nothing. The vertical is tested against a simulated platform only. A live run needs a bot token, a test guild with a text channel and a thread, a DM target, and a second bot to play the external sender — a direct send from the bot under test proves outbound connectivity and nothing else.

## Troubleshooting

**Guild messages arrive with no text.** Message Content Intent is off. Enable it under **Bot → Privileged Gateway Intents** and restart the account.

**Pin or delete fails.** The bot is missing Manage Messages in that channel.

**The account starts but sees no DMs.** The DM partner must share a guild with the bot.

**A connection with the same name already exists.** The Connections list shows the Hub's Discord trigger application and the channel bot under one provider name. Match on the connection id, not the label.
