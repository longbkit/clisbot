# Zalo Personal Messages And History

## Purpose

Use this guide when validating Zalo Personal message delivery, stranger DMs,
and what clisbot can or cannot read after QR login.

Zalo Personal uses a logged-in Zalo Web session through `zca-js`. It is
listener-first: messages are most reliable when the clisbot runtime is already
logged in and listening.

## What Clisbot Can See

- Messages received while the Zalo Personal listener is connected.
- Sent messages produced by clisbot through `clisbot message send`.
- Some recent user-message backfill from zca-js
  `listener.requestOldMessages(ThreadType.User)`.
- Group history through zca-js `getGroupChatHistory`, exposed by shared
  `message read` for `group:<id>`.

On 2026-05-23, live validation proved a DM sent from the Clisbot Zalo account
to a non-friend account still appeared in zca-js `old_messages` after login.
The item was self-authored, had the non-friend target as `threadId/idTo`, and
contained the sent text.

## What Clisbot Cannot Claim Yet

- `message read --target dm:<id>` for target-specific DM history.
- Complete inbox recovery for messages sent or received before clisbot logged
  in.
- Reliable incoming stranger-message discovery before friendship is accepted.
- A durable conversation archive equivalent to Slack `conversations.history`.

The important distinction: a message may exist in the Zalo mobile app, but that
does not mean clisbot has already seen it. If the message was sent manually from
mobile before the Zalo Personal session was logged in, clisbot may have no
listener event for it. It may later appear in websocket backfill, but that path
is global and not yet exposed as stable user-facing DM history.

## Friend Invites

Use these commands to inspect friend-request state:

```bash
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction sent --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction incoming --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction all --json
clisbot contacts friend-invites status --channel zalo-personal --bot default <user-id> --json
```

Zalo may return code `112` when the sent-request list is empty. clisbot treats
that as `sent: {}` instead of an operator error.

## Validation Checklist

1. Start or restart clisbot after QR login and confirm `zalo-personal` is active.
2. Send a message from clisbot to a known test account, including a non-friend.
3. Confirm the message is visible on the recipient account.
4. Check friend-invite state with `sent`, `incoming`, and `all`.
5. Send a new message from the test account back to Clisbot while the listener
   is active.
6. Check whether the listener receives an event or pairing prompt.
7. Only after friendship is accepted, retest contact search, status, and DM
   routing.

Do not use messages sent before login as proof that the listener is broken.
Use a fresh message while clisbot is connected.
