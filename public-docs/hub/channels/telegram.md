---
title: Telegram channel
description: Run an agent in Telegram DMs, groups, and forum topics over Bot API polling or a webhook.
nav: Telegram
order: 83
category: Hub
---

# Telegram

Telegram needs no public address, no app review, and no workspace admin. A BotFather token is the whole credential, which makes it the fastest channel to get running.

## What you need

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token it gives you.
2. Decide whether the bot reads every group message or only the ones addressed to it. BotFather's `/setprivacy` controls this. With privacy mode **on** (Telegram's default) a group message reaches the bot only when it mentions the bot or replies to it. Turn it **off** if you want a Route that answers everything in a group.
3. Add the bot to the group or forum you want it in. In a forum, add it to the topics it should watch.

Write the token to a file — it never goes in a command line:

```sh
umask 077 && printf '%s' '123456:ABC-…' > /tmp/telegram-token
```

The file may also be JSON with a `botToken` key.

## Add it to Hub

```sh
paseo channels add telegram --account main --secret-file /tmp/telegram-token
rm /tmp/telegram-token
```

Hub probes the token with `getMe` before storing it, encrypts it into a Connection, and starts the account. `paseo channels ls` shows the transport state.

In the app: **Channels → Accounts → Add Channel account**, choose Telegram, paste the token into the credential form, then add Routes.

Polling is the default and needs nothing else. The webhook transport needs a public HTTPS URL and a secret token, and Hub refuses to compile it until you supply both.

## Conversations it handles

Direct messages, basic groups, supergroups, and forum topics. A forum topic is addressed by its thread id, and a Route can target one topic without touching the rest of the forum. A reply lands in the same topic it came from.

Inbound covers messages, `/commands` (including `/command@yourbot` in a group), button and select callbacks, message edits, reactions, poll answers, member joins and leaves, topic events, and media groups. Photos, documents, voice, video, video notes, and location arrive as attachments within the account's size cap.

## What the agent can do

Message tool actions: `send`, `poll`, `react`, `edit`, `delete`, `sticker`, `sticker-search`, `topic-create`, `topic-edit`.

Replies are written in markdown and rendered before they are posted. By default the account posts native rich blocks: headings stay headings, lists and blockquotes stay lists and blockquotes, fenced code keeps its language, and a markdown table becomes a real Telegram table. Charts have no Telegram primitive and always degrade to text. Long answers split into ordered chunks.

A `send` can also carry a structured `presentation` — tables, charts, buttons and selects in the portable block vocabulary. On the default account a table posts as a native Telegram table block and the buttons become an inline keyboard; a chart posts as text. Set `richMessages: false` and the table degrades to text with the rest of the message.

Set `richMessages: false` on the account to post Bot API HTML instead: bold, italic, links, blockquotes, inline code and fenced code become Telegram entities, bullet lists become `•` lines, and a markdown table becomes a column-aligned code block. Headings flatten to plain text — Telegram HTML has no heading tag.

Buttons and select menus are inline keyboards; an approval prompt is an inline keyboard whose press comes back as a callback.

## Limits

- No group DMs — Telegram has no such conversation.
- Inside a forum topic the agent can only `edit`, `react` to or `delete` a message the bot itself observed there: the message it is answering, a message it received in that topic, or one it sent there. A message id it did not observe is refused, and the refusal says so.
- Sticker vision is unavailable: the agent is told a sticker arrived, not what it depicts.
- The webhook transport is wired but has never run against a public URL.
- Bot API rate limits apply per chat; sends are throttled rather than dropped.

## Verified live

| Capability                                      | Evidence                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mention → agent reply                           | Verified 2026-09-07.                                                                                                                          |
| Long formatted reply in a forum topic           | Verified 2026-09-07 — seven chunks, all in the right topic.                                                                                   |
| Inbound files                                   | Verified 2026-09-07 — agent read the document body back.                                                                                      |
| Outbound files                                  | Verified 2026-09-07 — document and photo.                                                                                                     |
| Message tool actions                            | Verified 2026-09-07 for `send`, `edit`, and `poll`; `send` and `poll` re-verified 2026-09-08 in a forum topic.                                |
| `edit` and `react` inside a forum topic         | Verified 2026-09-08 — the bot edited its own reply in a topic and reacted to the message it was answering, read back off the platform.        |
| Structured `presentation` (tables)              | Verified 2026-09-08 — a 3x3 table asked for through the message tool posted as a native `table` block, read back off the platform.            |
| Markdown rendering                              | Verified 2026-09-07 — headings, bold, italic, link, list, blockquote, inline and fenced code, and a native table, read back off the platform. |
| Native rich blocks (`richMessages`)             | Verified 2026-09-07 — the default; heading, paragraph, list, blockquote, `pre` and `table` blocks accepted by the Bot API.                    |
| `/new` and `/stop`                              | Verified 2026-09-07.                                                                                                                          |
| `/help`                                         | Not delivered on the 2026-09-07 run.                                                                                                          |
| Streaming, restart durability, approval prompts | Not verified.                                                                                                                                 |

The running record with message ids is `docs/tests/channels/p0-live-scenarios.md` in the repository.

## Troubleshooting

**The bot ignores group messages.** Privacy mode is on and the message did not address it. Either mention the bot or turn privacy off with `/setprivacy`.

**A reply lands in the wrong place in a forum.** A basic group silently drops the topic id — the Bot API answers `ok: true` and posts at the group root. Check that the group really is a forum before blaming the Route.

**`Unauthorized` in the account detail.** The token was revoked or regenerated in BotFather. Add the account again with the new token.

**A quiet chat goes silent for minutes.** Older builds escalated the poll backoff after an idle long-poll timeout. Check `paseo channels status`; a healthy account reports `started` and the poll loop resets on every completed poll, empty batches included.
