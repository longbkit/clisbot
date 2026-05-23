# Zalo Personal Alpha Tests

## Purpose

Use this checklist before calling the `zalo-personal` alpha release-facing.

The channel is listener-based through `zca-js`, not webhook-based. Validate it
with a separate Zalo account and avoid running another Zalo Web browser or
listener for the same account during the test.

## Setup

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png \
  --confirm
```

Expected:

- warning is printed in English and Vietnamese
- QR is printed in the console
- QR is also saved to `--qr-path`
- command waits until the mobile scan succeeds or fails
- auth/session is saved to the configured `tokenFile`
- stored session reuse refreshes the same `tokenFile` when `zca-js` returns
  updated cookie/context data
- `clisbot bots status --channel zalo-personal` reports `login=present`

## DM Flow

1. Send `hi` to the Zalo Personal account.
2. Approve the pairing code:

```bash
clisbot pairing approve zalo-personal <code>
```

3. Send `hello`.
4. Send `/whoami`.
5. Send `/queue summarize this`.

Expected:

- unknown DM sender receives pairing guidance
- approved sender reaches the routed agent
- `/whoami` shows a `zalo-personal:<user-id>` sender
- queue item is accepted behind any active run

## Friend Invites And Stranger Messages

1. From the Clisbot Zalo account, send a DM to a non-friend test account while
   clisbot is logged in.
2. Check friend invite lists:

```bash
clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction sent --json
clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction all --json
```

3. Inspect zca-js `listener.requestOldMessages(ThreadType.User)` output for
   self-authored `old_messages`.
4. Send a fresh reply from the non-friend test account while clisbot is still
   logged in.

Expected:

- empty sent-request lists render as `sent: {}` instead of failing on Zalo code
  `112`
- an outgoing non-friend DM can appear in `old_messages` even when no active
  friend request is visible
- messages sent manually from mobile before clisbot login are not treated as
  listener regressions
- incoming stranger DMs remain unclaimed until a live listener event or
  target-specific history path is proven

## Group Flow

1. Add the Zalo Personal account to a group.
2. Send a mention or command that the listener can see.
3. Add the route:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot default --require-mention true
```

Expected:

- unrouted group messages do not create agent runs
- routed group messages require a mention by default
- bot mentions are stripped from prompt text before agent execution
- replies quoting the bot count as addressing the bot
- follow-up stays mention-only by default
- sender allow/block rules use raw Zalo user ids

## Multi-Account Stability

Create a second bot with a different Zalo account:

```bash
clisbot bots add --channel zalo-personal --bot work --qr-path ./zalo-work-qr.png --confirm
```

Expected:

- each bot has a separate `tokenFile`
- both accounts can connect only when they are different Zalo accounts
- starting two listeners for the same account fails or closes truthfully

## Media Parity Gap

Current live validation:

- send one image from local file: passed on `2026-05-23`
- send one image from URL: passed on `2026-05-23`; clisbot downloads the URL, then uploads to Zalo
- send one generic file from local file: passed on `2026-05-23`
- send one generic file from URL: passed on `2026-05-23`; clisbot downloads the URL, then uploads to Zalo
- send one audio file from local file: passed on `2026-05-23` as a generic attachment
- send one voice note from local audio file: passed on `2026-05-23` through the Zalo voice API
- send one video from local file: passed on `2026-05-23` through shared attachment upload
- send one video from URL: passed on `2026-05-23`; clisbot downloads the URL, then uploads to Zalo
- send one channel-native styled text message: passed on `2026-05-23`;
  recipient screenshot confirmed red urgency, bold, and green style
- parse and send one channel-native link preview: passed on `2026-05-23`;
  recipient screenshot confirmed the native link preview card
- send one direct native video with uploaded thumbnail: command returned `msgId`
  on `2026-05-23`; recipient visual confirmation is still needed for thumbnail
  display
- send one direct native video with JPEG/RGB thumbnail: passed on
  `2026-05-23`; recipient screenshot confirmed thumbnail preview rendered before
  playback
- repeated `--file` is intentionally rejected until multi-file semantics are designed

Before promoting beyond alpha, validate:

- send many images from local files
- send many images from URLs
- receive one image
- receive many images
- receive voice or audio
- receive one or many generic attachments
- send many generic attachments
- decide whether shared `message send --file --file-type video` should stay as a
  generic attachment or switch to the native video path with thumbnail metadata

If a capability is unsupported, document the exact limitation in the user guide
and keep the message CLI error explicit.
