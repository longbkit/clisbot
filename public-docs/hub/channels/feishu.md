---
title: Feishu / Lark channel
description: Run an agent in Feishu or Lark chats over a long connection, with the Feishu document, wiki, drive, and Bitable tools.
nav: Feishu / Lark
order: 86
category: Hub
---

# Feishu / Lark

Feishu is the channel with the largest tool surface. Beyond messaging, the agent gets fourteen `feishu_*` tools for documents, wikis, Drive, permissions, and Bitable.

The long-connection transport needs no public address, which makes it the mode to start with.

## What you need

1. Create a **custom app** in the Feishu or Lark developer console and add a bot to it.
2. Copy the **App ID** (`cli_…`) and **App Secret**.
3. Under **Event subscription**, choose **Use long connection**. The webhook alternative needs a public HTTPS request URL plus the verification token and encrypt key from the same page.
4. Grant the app scopes. Messaging needs `im:message`, `im:message.group_at_msg`, `im:message:send_as_bot`, `im:chat:readonly`, and `im:resource`. Each tool family needs its own: `docx:document`, `drive:drive`, `wiki:wiki`, `bitable:app`.
5. Add the bot to the chats it should answer in.

Feishu and Lark are the same product on different hosts. `domain: feishu` uses `open.feishu.cn`; `domain: lark` uses `open.larksuite.com`.

## Add it to Hub

The secret file is JSON:

```json
{
  "appId": "cli_...",
  "appSecret": "...",
  "domain": "feishu"
}
```

Add `verificationToken` and `encryptKey` when you intend to use the webhook transport.

```sh
paseo channels add feishu --account main --secret-file ./feishu-app.json
```

Hub exchanges the pair for a tenant access token before storing it, so a wrong secret fails at setup rather than at the first message.

## Conversations it handles

Group chats, DMs, and group DMs, with message threads. Inbound covers messages, card clicks as callbacks, and member events.

## What the agent can do

Message tool actions: `send`, `thread-reply`, `read`, `edit`, `pin`, `unpin`, `list-pins`, `member-info`, `channel-info`, plus `react` and `reactions` when the account enables reactions.

Channel tools, registered on the agent's MCP server and authorized per call:

| Tool                                                                                                                                          | What it reaches                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `feishu_doc`                                                                                                                                  | Docx documents                         |
| `feishu_chat`                                                                                                                                 | Chat metadata and membership           |
| `feishu_wiki`                                                                                                                                 | Wiki spaces and nodes                  |
| `feishu_drive`                                                                                                                                | Drive files and folders                |
| `feishu_perm`                                                                                                                                 | Permissions. **Off by default.**       |
| `feishu_app_scopes`                                                                                                                           | What the app is actually allowed to do |
| `feishu_bitable_create_app`, `_create_field`, `_create_record`, `_get_meta`, `_get_record`, `_list_fields`, `_list_records`, `_update_record` | Bitable                                |

`feishu_app_scopes` is the tool to reach for first when something returns a permission error: it reports the app's granted scopes rather than guessing.

## Limits

- **No media in or out.** Inbound attachments are not downloaded and there is no upload path.
- **No delete, no sticker, no streaming card.** Card clicks arrive inbound, but Hub renders no Lark card of its own, so approval prompts are not native.
- **The webhook transport has never run in production.** It is unit-tested against a real local HTTP listener and nothing else.

## Verified live

Nothing. The tool factories and the send path are driven against a faked Lark SDK client, so the code paths are real but the platform is not. A live run needs Lark app credentials, a group chat the bot belongs to, and a DM target.

## Troubleshooting

**Every call returns a permission error.** Ask the agent to call `feishu_app_scopes`. A scope granted in the console still needs the app version published.

**The long connection will not open.** Event subscription is not set to **Use long connection** in the app console.

**Webhook requests are rejected.** The encrypt key signs every inbound request; a missing or wrong `encryptKey` makes every delivery unverifiable, and an unverifiable request is refused rather than trusted.

**A `feishu_perm` call says the tool does not exist.** It is off by default. Enable it on the account.
