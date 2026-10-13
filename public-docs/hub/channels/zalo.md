---
title: Zalo Official Bot channel
description: Run an agent in Zalo direct chats and groups through an Official Account bot.
nav: Zalo Official Bot
order: 87
category: Hub
---

# Zalo Official Bot

The Zalo Bot API is small: send text, send an image by URL, receive text and images. There are no threads, no reactions, no edits, and no upload endpoint. Most of what this page calls a limit is a platform limit, not a gap in the port.

This is the **Official Account bot**. [Zalo Personal](/docs/hub/channels/zalouser) is a different channel that drives a human's own account.

## What you need

1. Create or use a **Zalo Official Account** at [oa.zalo.me](https://oa.zalo.me).
2. In **Zalo Bot Creator** (`bot.zaloplatforms.com`), create a bot for that OA and copy its token. That token is the whole credential — no app id, no OAuth, no signing key.
3. Follow the bot from a personal Zalo account, and add it to a group if you want the group cases.

Use **Bot API polling**; it needs no public URL. Hub does not support the webhook transport.

## Add it to Hub

```sh
clisbot channels add zalo --account main --secret-file <token-file>
```

Save the raw token or JSON with `botToken` in a private file using an editor (`chmod 600 <token-file>`). Keep it outside the repository and shell history. Hub probes it with `getMe` before storing it. Webhook configurations are refused even when a URL and secret are supplied.

## Conversations it handles

Direct chats and groups. A DM always counts as addressed to the bot; a group message counts when it names the bot, matched against the bot's account name and any aliases the account lists.

Inbound covers text messages, a leading `/verb` as a command, and images. An image is downloaded into the account's media directory and folded into the turn as an attachment; a failed or oversized download still tells the agent an image arrived. Stickers and unsupported message types are logged and start no turn.

Use [Channel slash commands](/docs/hub/channels/commands#channel-invocation) for session controls, Project/Workspace selection and this channel's invocation forms.

## What the agent can do

One message tool action: `send`. It posts text, or an image by public HTTPS URL with the text as its caption.

## Limits

Almost everything here is the Bot API's own shape:

- **No file upload.** The API has no upload endpoint, so a local file is refused with a visible notice rather than dropped.
- **No edit, delete, reactions, pins, polls, buttons, native commands, or threads.** No endpoint exists. The agent gets `unsupported_action`.
- **No read-back or history.** Delivery is confirmed by the returned message id and nothing else — which also means a live test's read-back has to be a human looking at their own client.
- **No typing indicator.**

Polling has no cursor to hold back: the API returns at most one update and never re-serves it. The loop stores the update durably before asking for the next one, retries a failed store in place, and gives up loudly rather than quietly.

## Verified live

No live message loop is recorded. Polling validation needs a bot token and a human Zalo sender; webhook transport is unsupported.

## Troubleshooting

**Group messages are ignored.** The message did not name the bot. Add the name the group actually uses to the account's mention aliases.

**An image the agent sent never arrived.** The URL must be public HTTPS and must pass the outbound host guard. A local path cannot work — see the upload limit.

**Webhook configuration is refused.** Hub supports polling only; a webhook secret does not enable the transport.

**The agent says an action is unsupported.** It probably is. Check the limits above before treating it as a bug.
