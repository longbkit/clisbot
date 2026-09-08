---
title: Slack channel
description: Run an agent in Slack channels, threads, and DMs over Socket Mode or the Events API.
nav: Slack
order: 82
category: Hub
---

# Slack

Slack is the most complete channel: rich Block Kit replies, tables and charts, buttons, approval prompts, reactions, pins, files both ways, and slash commands.

## What you need

A Slack app installed in the workspace, saved in Hub as a **Connection**. [Slack for Hub](/docs/hub/self-hosting/slack-app) covers creating it from the manifest Hub generates and pasting the two tokens. The channel reuses that same Connection — there is no second Slack credential.

| Credential     | Looks like | Needed for                                        |
| -------------- | ---------- | ------------------------------------------------- |
| Bot token      | `xoxb-…`   | Everything.                                       |
| App token      | `xapp-…`   | Socket Mode. Needs the `connections:write` scope. |
| Signing secret | —          | The Events API webhook transport only.            |

Socket Mode needs no public address and is the transport to start with. The Events API webhook needs Hub reachable at a public HTTPS URL.

### Scopes

Hub's manifest asks for the scopes it verifies at install: `app_mentions:read`, `channels:history`, `chat:write`, `files:read`, `groups:history`, `reactions:write`, `users:read`, plus the optional `assistant:write` for the thread typing indicator.

Those cover mentions, replies, history reads, and reactions. The other message-tool actions call Slack methods with their own scope requirements, and Slack answers `missing_scope` when one is absent:

| Action                     | Slack method                                                 | Scope                                                  |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `pin` / `unpin`            | `pins.add`, `pins.remove`                                    | `pins:write`                                           |
| `list-pins`                | `pins.list`                                                  | `pins:read`                                            |
| `reactions`                | `reactions.get`                                              | `reactions:read`                                       |
| `upload-file`              | `files.getUploadURLExternal`, `files.completeUploadExternal` | `files:write`                                          |
| Opening a DM               | `conversations.open`                                         | `im:write`, `mpim:write`                               |
| `emoji-list`               | `emoji.list`                                                 | `emoji:read`                                           |
| `read` in a DM or group DM | `conversations.history`, `conversations.replies`             | `im:history`, `mpim:history` beside the channel scopes |

Add the ones you want in the app's **OAuth & Permissions** page and reinstall. Adding a scope you do not use costs nothing; the action fails loudly when it is missing.

Invite the bot to every channel it should watch:

```text
/invite @Paseo
```

## Add it to Hub

Slack installs from an existing Connection, so create the Connection first under **Apps → Slack**, then:

```sh
paseo channels add slack --account main --connection-id <connection-uuid>
```

In the app, open **Channels → Accounts → Add Channel account**, pick Slack and the Connection, then add Routes for the conversations the agent should answer. **Channels → Catalog** shows the same capability matrix per account.

`paseo channels ls` shows every account and its transport state; `paseo channels status` adds the pin, integrity, and load-trace columns.

## Conversations it handles

Public and private channels, threads under them, direct messages, and group DMs. A reply to a channel message opens a thread under that message; a reply inside a thread stays there.

Inbound covers mentions, message edits and deletes, reactions, slash commands, and interactive component clicks (buttons and selects). Files attached to an inbound message are downloaded and handed to the agent as attachments.

## What the agent can do

The message tool exposes these actions on a Slack conversation:

`send`, `react`, `reactions`, `read`, `edit`, `delete`, `pin`, `unpin`, `list-pins`, `member-info`, `emoji-list`, `download-file`, `upload-file`.

A plain markdown reply is rendered to Slack mrkdwn before it is posted: headings become bold lines (mrkdwn has no heading), `*bold*`, `_italic_`, `<url|label>` links, `•` bullets, numbered lists, quotes, inline code and fenced code, and a markdown table as a column-aligned code block.

When the agent attaches a `presentation` to a message, the same content posts as native Block Kit instead: tables become Block Kit tables and charts become native `data_visualization` blocks (no image is uploaded). Buttons and select menus are real Slack components, and an approval prompt is a Block Kit card whose click comes back as an inbound callback. A presentation Slack cannot render natively degrades to the text fallback rather than posting an invalid block, and the message text always carries that fallback so a client that cannot draw the block still reads the data. A table without a caption keeps its data: the caption defaults to the first header column and the tool result says the block was repaired.

Long answers are chunked and posted in order. Streaming edits one message in place while the answer grows, when the Route enables it.

## Limits

- Socket Mode holds one live connection per Hub process. Events that arrive while Hub is stopped are missed — there is no backfill.
- The approval card's edit-in-place path still posts through `chat.update`; a native Slack stream transport is not driven by Hub yet.
- Slack rate limits per method. Bursts of reactions or reads back off rather than failing.

## Verified live

| Capability                       | Evidence                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mention → agent reply in thread  | Verified 2026-09-07.                                                                                                                                                                 |
| Long formatted reply, chunked    | Verified 2026-09-07 — four chunks, order preserved.                                                                                                                                  |
| Outbound files                   | Verified 2026-09-07 — text and image uploaded to the thread.                                                                                                                         |
| Inbound files                    | Not exercised live.                                                                                                                                                                  |
| Message tool actions past `send` | Verified 2026-09-07 — two file sends, a reaction, an edit, and a pin, all under the bot identity.                                                                                    |
| Markdown rendering               | Verified 2026-09-07 — headings, bold, italic, links, both list kinds, quote, inline and fenced code, and a table as an aligned code block.                                           |
| Native charts and tables         | Verified 2026-09-08 — a `presentation` with a bar chart and a table posted as `data_visualization` + `data_table`; a caption-less table posted with the first header as its caption. |
| Streaming, approval prompts      | Not verified live.                                                                                                                                                                   |

The running record with message timestamps is `docs/tests/channels/p0-live-scenarios.md` in the repository.

## Troubleshooting

**The account never leaves `starting` or reports `failed`.** `paseo channels status` prints the detail. A bad or revoked bot token shows as a Slack `invalid_auth`; an app token without `connections:write` fails the Socket Mode open. A loaded host that cannot answer `auth.test` inside the 15 s start budget logs an error naming the budget and retries once before the account fails.

**An action returns `missing_scope`.** Add the scope from the table above and reinstall the app. The action names the method it called.

**The bot sees nothing in a channel.** It has to be a member. `/invite @Paseo`.

**A message from another bot is ignored.** Bot-authored traffic is admitted only when the message mentions the bot explicitly.

**Replies stop after a Hub restart.** Check `paseo channels status` first; if the account is running, the conversation may be holding an agent session created before the restart. Start a fresh one with `/new`.
