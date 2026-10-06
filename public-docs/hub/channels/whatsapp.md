---
title: WhatsApp channel
description: Run an agent on a WhatsApp number linked as a device by QR code, and understand what that costs you.
nav: WhatsApp
order: 89
category: Hub
---

# WhatsApp

WhatsApp is not a bot API. Hub logs in to a **real WhatsApp account** the same way WhatsApp Web does (as one of the phone's linked devices), through the Baileys client. You log in by scanning a QR code in WhatsApp on the phone. That shapes the rest of this page:

- There is no token to paste. Onboarding is a live QR flow.
- The credential is the login's keys. WhatsApp can end the session, and logging in again is routine.
- Everything that number can do, a human on that number can do.
- Automating a personal number can break WhatsApp's terms. Use a separate number made for this, never your own.

## What you need

A phone with WhatsApp signed in to the number you want the agent to act as, and someone to hold it for the scan.

## Add it to Hub

Create the account first. It has no credential, so there is nothing to paste. In the app, open **Channels → Channel Integrations → WhatsApp → Connect WhatsApp**, give the account a name, and scan the QR code that shows next. Then add a Route to it. From the CLI:

```sh
clisbot channels add whatsapp --account main --name "Support line"
```

`--name` is a label for the account and defaults to the account id. The account id is the identity; there is no profile to pick. The account starts, finds no login, and reports the transport state **`needs-login`**. That is the designed first state.

Adding the Connection in the app shows the QR code straight away. Until the scan is done, the Connection's card under **Channels → Connections** shows the same **Log in** row. On the phone, open **WhatsApp → Settings → Linked devices → Link a device** and scan the code. The flow is start → show the QR → poll → logged in. Confirm the reported number is the one you meant before you point a Route at it.

The same five verbs as [Zalo Personal](/docs/hub/channels/zalouser#add-it-to-hub) drive it: **Log in**, **Cancel**, **Log in with a different account** and **Log out**, plus the poll the app runs while a code waits. A code that times out is not an error; start again.

Once the scan succeeds, Hub starts the account and `needs-login` clears within a few seconds. If it stays, use **Retry** in the app.

## Where the keys live

The login's auth state — its credentials and the Signal session keys — is a complete credential for that number: whoever holds it can read and send as it. Hub keeps it encrypted at rest under the same key custody as every other channel credential, scoped to one organization and one account, and never writes it to a log line, a status snapshot, or an error message. Deleting the account removes it.

## Conversations it handles

Direct chats and groups. The agent receives the text and the images, videos, documents, audio and stickers people send, up to 50 MB each. A shared location, contact cards, and the ad a message answers arrive as labeled JSON blocks after the text, so the agent reads coordinates, names and phone numbers as fields.

In a group, a message addresses the account when it @mentions the account's number or replies to one of the account's own messages. A direct message always addresses it. Whether an unaddressed group message reaches the agent is the Route's Rule, not the channel's.

When a message replies to (quotes) another, the agent reads the quoted text first, as `[Reply to <who>] <text>`, and gets the quoted message's file if it had one.

Answers do not quote by default. A message-tool `send` that names `replyTo` quotes that message. Set `replyToMode` in the account's `config:` to `first` (the answer's first message quotes the message it answers) or `all` (every message of a long answer does). Useful in busy groups.

There are no threads. The agent answers in the same chat.

## What the agent can do

Text, with Markdown converted to WhatsApp's own formatting and @mentions of group members, chunked at 4000 characters; images, videos and documents up to 50 MB per file; audio as voice notes; and reactions.

A `send` with `forceDocument` posts an image or video as a document, so WhatsApp does not recompress it. `gifPlayback` plays a video as a looping GIF.

An audio file posts as a voice note. Audio that is not already Ogg/Opus is converted with `ffmpeg` on the Hub host; without it, the send fails with a message saying so. Install `ffmpeg` (or set `FFMPEG_PATH`) if agents will send audio.

Message tool actions: `send` — the Hub's own outbound path, present on every channel — `react`, and `poll`, a native WhatsApp poll with up to 12 options. A vote comes back as a `poll_answer` in the Route's Activity, not as a new turn for the agent. Votes are read for polls this account sent or saw, for 30 days. The channel tool `whatsapp_send_location` posts a native location pin (latitude, longitude, and an optional name and address) into the chat the agent is answering.

## Approvals and agent questions

WhatsApp has no buttons, so an approval prompt or an agent question is answered by reacting to it: 👍 approves, 👎 denies or dismisses, and 1️⃣–4️⃣ pick a question's option. The prompt lists which reaction does what. Hub checks the person who reacted the same way it checks a typed answer, and posts the outcome as a reply to the prompt. A question with more than four options, or one that only takes free text, has no reactions; answer it with the typed command the prompt shows, which always works.

## Limits

- **No threads, edits, or deletes.** Buttons are reactions (see above), and a prompt is never edited after it is answered.
- **Voice notes from non-Ogg audio need `ffmpeg`** on the Hub host.
- **Proxies:** `HTTPS_PROXY`/`HTTP_PROXY` (and `NO_PROXY`) apply to the WhatsApp connection and media uploads. SOCKS proxies are not supported.
- **Logging out while an account is reconnecting** stops it, but WhatsApp cannot be told then: Log out says so, and you remove the device under Linked devices on the phone.
- **Prompts longer than 4000 characters** can only be answered with the typed command, not by reacting.
- **The login can be signed out.** WhatsApp ends linked-device sessions, for example when the phone stays offline too long. The account goes back to `needs-login`; log in again.

## Verified live

- 2026-10-06: the QR start against WhatsApp's servers, through the Hub's own loader and QR operations (start → pending with a code → poll → cancel). Nothing is stored before a scan.
- Not yet: a scan, and a message in and out. Those need a spare number and someone holding the phone.

## Troubleshooting

**The account reports `needs-login`.** It has no login. Run the QR flow, then retry the account. Reconciling the same configuration revision will not clear it; only a successful start does.

**The QR never resolves.** It timed out, or the scan was declined. Start again.

**Log out** ends the login on WhatsApp's side and stops the account before Hub deletes the keys, so the device disappears from the phone's Linked devices list.

**The session ended on its own.** The phone removed the device from Linked devices, or WhatsApp signed it out. Log in again.
