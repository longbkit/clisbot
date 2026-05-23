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

Before promoting beyond alpha, validate:

- send one image from local file
- send many images from local files
- send one image from URL
- send many images from URLs
- receive one image
- receive many images
- send and receive voice or audio if supported by the provider
- send and receive one or many generic attachments

If a capability is unsupported, document the exact limitation in the user guide
and keep the message CLI error explicit.
