---
title: Google Chat channel
description: Run an agent in Google Chat DMs and spaces through a Chat app whose events arrive over Cloud Pub/Sub — no public URL needed.
nav: Google Chat
order: 85
category: Hub
---

# Google Chat

The Hub receives a Google Chat app's events over **Cloud Pub/Sub**: the app publishes to a topic and the Hub pulls from a subscription, so no public address is needed. Google's other delivery model, an HTTPS endpoint, is ported but **not supported yet** — it has never run against Google, and the Hub refuses an account that asks for it.

A personal Google account can build a Chat app for its own direct messages. Joining spaces needs a Google Workspace account, and a work Workspace may need an admin to allow the app.

## Set up with Cloud Pub/Sub

All of this is in one Google Cloud project.

1. Enable the **Google Chat API** and the **Cloud Pub/Sub API**.
2. Create a **service account** and download a JSON key. The service account needs no project role.
3. In Pub/Sub, create a **topic** (for example `clisbot-chat-events`) and a **pull subscription** on it (`clisbot-chat-events-sub`).
4. On the **topic**, grant the **Pub/Sub Publisher** role to the account Google publishes with. A new Chat app is built as a Workspace add-on by default, and then that account is `service-<project number>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`. If you cleared **Build this Chat app as a Workspace add-on**, it is `chat-api-push@system.gserviceaccount.com`. With the wrong one, Google Chat answers "not responding" and Cloud Logging shows `Failed to publish message to Pub/Sub topic … PERMISSION_DENIED`.
5. On the **subscription**, grant your service account the **Pub/Sub Subscriber** role. Grant it on the subscription, not the project.
6. Under **Google Chat API → Configuration**: name the app, enable **Receive 1:1 messages** and **Join spaces and group conversations**, choose **Cloud Pub/Sub** as the connection setting and enter the topic, `projects/<project>/topics/<topic>`. Set visibility to yourself or your domain.
7. Add the Connection in the app (**Channels → Add Connection → Google Chat**): paste the JSON key and the subscription name, `projects/<project>/subscriptions/<subscription>`. Or from the CLI:

   ```sh
   clisbot channels add googlechat --account main \
     --secret-file ./chat-service-account.json \
     --subscription projects/my-project/subscriptions/clisbot-chat-events-sub
   ```

   The Hub mints a token from the key and checks that the service account may pull from the subscription before it stores anything. A missing role fails here with the role to grant.

8. Add a Route, then open Google Chat, find the app, and message it — or add it to a space and mention it.

## HTTP endpoint (not supported yet)

The vertical carries upstream's webhook receiver (`transport: { mode: webhook }` with `audienceType`, `audience` and `webhookUrl`), but the Hub refuses it until it has run end to end against Google. Use Cloud Pub/Sub.

## Optional account settings

`botUser` (`users/<id>`, the app's own user) lets the app recognise a mention by its id as well as by the `users/app` alias. `allowBots: true` admits messages from other apps.

## Conversations it handles

Spaces, group conversations, and DMs. Message threads inside a space are supported, with an option to fall back to a new thread.

Inbound covers messages, a leading `/verb` line as a command, `CARD_CLICKED` as a callback carrying the button's action id and the clicking user, and `ADDED_TO_SPACE` / `REMOVED_FROM_SPACE` as member events. Mention detection reads Google's `USER_MENTION` annotations. Bot-authored and app-authored messages are filtered.

A message is acknowledged only after it is durably stored; a failed store returns it to the subscription for redelivery.

## What the agent can do

Message tool actions: `send`, `edit`, `delete`.

Replies use Google Chat's own markdown — bold, italic, strikethrough, code, `<href|label>` links, blockquotes, and bullet lists, with tables flattened to bullets — and a byte-bounded chunker. The agent can open a DM with a user and look up a space.

## Limits

- **No attachment upload.** Google Chat's media upload endpoint is user-OAuth only, and a service-account app cannot use it. An attempt posts a visible in-channel notice instead of silently dropping the file.
- **No inbound media download.** An attachment-only message is refused as empty.
- **No native approval card.** Card clicks still arrive as inbound callbacks for Hub's own approval policy.
- **No typing indicator, reactions, pins, read-back, emoji discovery, or polls.** No service-account API exists for them, so the agent gets `unsupported_action` rather than a transport error.

## Verified live

2026-10-06: a personal Google account's Chat app built as a Workspace add-on, Cloud Pub/Sub delivery, codex agent. A direct message reached the Hub through the subscription, started a session, and the answer posted back into the same DM. Spaces, cards and the HTTP endpoint are not verified.

## Troubleshooting

**Adding the Connection says the service account cannot pull from the subscription.** Grant it Pub/Sub Subscriber on that subscription.

**Messages to the app get no answer and the account shows a pull error.** The subscription was deleted or the role was removed. `clisbot channels status` shows the last error.

**Google Chat says the app is not responding.** Google cannot publish to the topic: grant Publisher to the account in step 4, or check the app's connection names this topic. Cloud Logging for the project shows the refused publish.

**Messages arrive but replies fail with `insufficient authentication scopes`.** The account is signing with the host's own Google credentials instead of the service account; update the Hub.

**The app cannot be added to a space.** It is not visible to you, or a Workspace admin has not allowed it.

**A file the agent sent never appeared.** It cannot. See the upload limit above; the channel posts a notice in its place.
