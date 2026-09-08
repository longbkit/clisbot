---
title: Zalo Personal channel
description: Run an agent on a personal Zalo account linked by QR code, and understand what that costs you.
nav: Zalo Personal
order: 88
category: Hub
---

# Zalo Personal

Zalo Personal is not a bot. It drives a **real personal Zalo account** through a community client, and the account is linked by scanning a QR code with a phone. That one fact shapes everything else:

- There is no token to paste. Onboarding is a live, multi-step QR flow.
- The credential is a session, not a static secret. It expires, it rotates, and relinking is routine rather than exceptional.
- Everything that account can do, a human on that account can do. This is the highest-trust channel in the catalog.
- A personal-account client is not a sanctioned API. Use an account you are willing to lose.

For an Official Account bot with a token, use [Zalo Official Bot](/docs/hub/channels/zalo) instead.

## What you need

A phone signed in to the Zalo account you want the agent to act as, and someone to hold it. There is no way around the scan.

## Add it to Hub

Create the account first — it has no credential, so there is no secret file:

```sh
paseo channels add zalouser --account main --profile main
```

`--profile` names the stored session and defaults to the account id. The account starts, finds no session, and reports the transport state **`needs-login`**. That is the designed first state, not a failure.

Then link it from the app: **Channels → Accounts**, select the account, and use its QR operations. The flow is start → show the QR → poll → linked. Confirm the reported user id is the account you meant before you point a Route at it.

Five verbs drive it, and the app renders all five:

| Verb       | When you use it                                                                  |
| ---------- | -------------------------------------------------------------------------------- |
| **Start**  | First link. Returns the QR image.                                                |
| **Poll**   | Runs on a timer while the code is pending.                                       |
| **Cancel** | Abandon a pending code. It refuses to touch a healthy session.                   |
| **Relink** | Session died, or you want a different account. Discards the old one first.       |
| **Logout** | Unlink. Leaves a revocation marker so a stale copy cannot resurrect the session. |

The QR expires after about three minutes. An expired code is not an error state — generate a new one. A start that completes inside its own budget can come back linked without a poll.

Once the scan succeeds, restart the account (**Retry** in the app) to clear `needs-login`.

## Where the session lives

The stored value is a complete, replayable credential for that person's Zalo account. Hub keeps it encrypted at rest under the same key custody as every other channel credential, scoped to one organization and one account, and never writes it to a log line, a status snapshot, or an error message. Logout writes a revocation marker rather than deleting the row; deleting the account removes the namespace outright.

## Conversations it handles

Direct chats and groups. Inbound covers messages, a leading `/verb` as a command, sender labels, group names, quotes (the quoted text and its owner travel with the message), and explicit and implicit mentions. A DM always counts as addressed to the account.

There are no threads. Zalo Personal has none, so a reply is a plain message on the conversation.

## What the agent can do

Text rendered into Zalo's native style ranges — Zalo takes styled ranges rather than markdown — chunked at 2000 characters with the styles sliced per chunk; native file upload, where an audio file becomes a voice message; and links.

Message tool actions: `send` — the Hub's own outbound path, present on every channel — and `react`.

One channel tool, `zalouser`, with seven actions: `send`, `image`, `link`, `friends`, `groups`, `me`, `status`. Friend and group lookup works by name or id, and group members can be listed.

## Limits

- **No threads, edits, deletes, pins, polls, or buttons.** The platform has none.
- **No inbound media download.** Attachments arrive as message content, not as agent attachments.
- **Typing, delivered, and seen are wired but not driven.** Hub's streaming producer does not know this channel.
- **The push socket has no acknowledgement and no cursor.** A message the server pushed is gone if the process drops it. Hub retries admission five times and then drops it loudly.

## Verified live

Nothing. A live run needs a human with a phone. The QR state machine, the session store, and the outbound path are covered by tests against a faked client.

## Troubleshooting

**The account reports `needs-login`.** It has no live session. Run the QR flow, then retry the account. Reconciling the same configuration revision will not clear it — only a successful start does.

**The QR image never resolves.** It expired, or the scan was declined. Both are reported rather than swallowed. Start again.

**The session dies for no reason.** It does that. The phone can sign the session out and Zalo rotates it. Offer relink whenever the account start fails with "not linked".

**Cancel says it will not run.** Cancel refuses when the session is still good. Use logout to unlink deliberately.
