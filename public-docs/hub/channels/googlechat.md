---
title: Google Chat channel
description: Run an agent in Google Chat spaces and DMs through a Workspace app and a public HTTPS endpoint.
nav: Google Chat
order: 85
category: Hub
---

# Google Chat

Google Chat is the one channel that cannot run on a laptop. It has no polling and no socket mode: Google POSTs events to a public HTTPS URL, and nothing happens until that URL exists.

## What you need

1. In a Google Cloud project, create a **service account** and download its JSON key. That document is the whole credential — there is no bot token.
2. Enable the **Google Chat API** on the project.
3. Under **Google Chat API → Configuration**, create the Chat app: name it, enable **Receive 1:1 messages** and **Join spaces and group conversations**, and choose **App URL** as the connection setting, pointing at your public HTTPS endpoint.
4. Decide how Google's request tokens are verified:
   - `audienceType: app-url` — `audience` is that same app URL, and `appPrincipal` is the app's numeric OAuth 2.0 client id (21 digits, not an email).
   - `audienceType: project-number` — `audience` is the Cloud project number.
5. Publish the app to your Workspace domain or to named testers. **A Workspace admin has to approve it** before anyone can add it to a space.
6. Add the app to a space and start a DM with it.

### The public endpoint

Hub publishes no endpoint of its own. Put a reverse proxy in front of the account's webhook listener and give Google that URL:

```caddyfile
chat.example.com {
  reverse_proxy 127.0.0.1:<listener port>
}
```

The listener answers `200` only after the event is durably stored. A failed store answers `503` so Google redelivers; a malformed envelope answers `400` so it does not.

## Add it to Hub

The secret file is the downloaded service-account document itself:

```sh
paseo channels add googlechat --account main --secret-file ./chat-service-account.json
```

It may instead be JSON naming `serviceAccountFile` (an absolute path on the daemon host) or `serviceAccount` (the document inline). Hub verifies the credential by minting an RS256 token before storing it.

The account also needs `audienceType`, `audience`, `webhookUrl`, and `botUser` in its Channel account configuration. The account refuses to start without all four.

## Conversations it handles

Spaces, group conversations, and DMs. Message threads inside a space are supported, with an option to fall back to a new thread.

Inbound covers messages, a leading `/verb` line as a command, `CARD_CLICKED` as a callback carrying the button's action id and the clicking user, and `ADDED_TO_SPACE` / `REMOVED_FROM_SPACE` as member events. Mention detection reads Google's `USER_MENTION` annotations. Bot-authored and app-authored messages are filtered.

Request authentication runs before the body is read past a pre-auth size cap: an ID-token verification for `app-url` (including the Workspace add-on issuer, bound to `appPrincipal`), or a signed-JWT verification against Google's Chat certificates for `project-number`.

## What the agent can do

Message tool actions: `send`, `edit`, `delete`.

Replies use Google Chat's own markdown — bold, italic, strikethrough, code, `<href|label>` links, blockquotes, and bullet lists, with tables flattened to bullets — and a byte-bounded chunker. The agent can open a DM with a user and look up a space.

## Limits

- **No attachment upload.** Google Chat's media upload endpoint is user-OAuth only, and a service-account app cannot use it. An attempt posts a visible in-channel notice instead of silently dropping the file.
- **No inbound media download.** An attachment-only message is refused as empty.
- **No native approval card.** Card clicks still arrive as inbound callbacks for Hub's own approval policy.
- **No typing indicator, reactions, pins, read-back, emoji discovery, or polls.** No service-account API exists for them, so the agent gets `unsupported_action` rather than a transport error.
- **No Pub/Sub delivery.** HTTP webhook only.

## Verified live

Nothing. Blocked on the public HTTPS endpoint and Workspace admin approval. The vertical's webhook receiver is exercised against a real local HTTP listener in tests; the Chat API itself has never been called with a real credential.

## Troubleshooting

**Google reports the app is not responding.** The reverse proxy is not reaching the account's listener, or the account is not running. Check `paseo channels status` first.

**Every request is rejected as unauthenticated.** `audienceType` and `audience` disagree with what the Chat app configuration says. For `app-url` they must be the exact app URL, and `appPrincipal` must be the numeric client id.

**The app cannot be added to a space.** It is not published, or a Workspace admin has not approved it.

**A file the agent sent never appeared.** It cannot. See the upload limit above; the channel posts a notice in its place.
