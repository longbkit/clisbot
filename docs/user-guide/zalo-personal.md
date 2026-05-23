# Zalo Personal

## Purpose

Use this guide for the experimental `zalo-personal` channel.

Zalo Personal uses an unofficial Zalo Web personal-account session through
`zca-js`. It is useful for local alpha testing, but it is not an official Zalo
Bot or Official Account integration.

## Safety Notes

- Use a separate phone number and Zalo account for automation.
- Login is QR-only in clisbot.
- `--qr-path` only saves a copy of the QR image; clisbot still prints the QR in
  the console.
- Run only one active listener per Zalo account. Multiple `zalo-personal` bots
  are stable only when they use separate Zalo accounts and separate
  `tokenFile` session paths.
- Zalo Personal should fail closed on a personal account. Do not open every DM
  or group by default when the account may have many friends or groups.

## Setup

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png \
  --confirm
```

What this does:

- creates or updates `bots.zaloPersonal.default`
- stores auth/session data through the configured `tokenFile`
- prints the QR in the terminal and optionally saves it to `--qr-path`
- starts the listener after login succeeds

Add another Zalo Personal account with a separate bot id:

```bash
clisbot bots add \
  --channel zalo-personal \
  --bot work \
  --qr-path ./zalo-work-qr.png \
  --agent default \
  --confirm
```

## Command Groups

| Group | Commands | Use case | Status |
| --- | --- | --- | --- |
| Account setup | `start`, `bots add`, `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` | QR login, session-file lifecycle, runtime connection diagnostics. | Shipped alpha |
| Routes and access | `routes add`, `routes get`, `routes set-policy`, `pairing approve`, `queues create`, `loops create` | Admit only explicit DMs/groups and keep queue/loop addressing bot-scoped. | Shipped alpha |
| Contacts discovery | `contacts list/search/get`, `contacts aliases list`, `contacts labels list`, `contacts recommendations list`, `contacts mutual-groups list`, `contacts boards list` | Find raw user ids and Zalo classification state without opening routes. | Phase 1 |
| Friend invites | `contacts friend-invites list/status/send/accept/reject/cancel` | Inspect and manage friend-request state; `list` supports `--direction incoming\|sent\|all`. | Phase 1/2 |
| Groups discovery | `groups list/search/get`, `groups members list`, `groups boards list`, `groups group-invites list/get` | Find group ids, inspect members, boards, and received group invites. | Phase 1 |
| Group mutations | `groups members add/remove`, `groups group-invites send/accept/reject/cancel`, `groups invite-link get/update/enable/disable`, `groups join` | Mutate membership and invite state behind confirmation. | Phase 2 |
| Shared messages | `message send`, `message react`, `message read`, `message delete` | Cross-channel send/read/react/delete where Zalo support is proven. | Phase 3 |
| Native Zalo extras | `channel-native --channel zalo-personal ...` | Zalo-only messages, profile, settings, stickers, notes, reminders, quick messages, catalog, and conversation state. | Phase 3+ |

## Routes

Add explicit DM routes for users that should be able to pair or interact:

```bash
clisbot routes add --channel zalo-personal dm:<user-id> --bot work --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy` is the summary for the DM wildcard route. The actual DM routing
surface is `directMessages`: with the default `dmPolicy: "disabled"` and
`directMessages: {}`, Zalo Personal does not reply to any DM.

Add group routes when needed:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot work --require-mention true
```

Queue and loop examples:

```bash
clisbot queues create --channel zalo-personal --bot work --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot work --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

## Messages And History

What clisbot can see:

- Messages received while the Zalo Personal listener is connected.
- Sent messages produced by clisbot through `clisbot message send`.
- Some recent user-message backfill from zca-js
  `listener.requestOldMessages(ThreadType.User)`.
- Group history through zca-js `getGroupChatHistory`, exposed by shared
  `message read` for `group:<id>`.

What clisbot cannot claim yet:

- `message read --target dm:<id>` for target-specific DM history.
- Complete inbox recovery for messages sent or received before clisbot logged
  in.
- Reliable incoming stranger-message discovery before friendship is accepted.
- A durable conversation archive equivalent to Slack `conversations.history`.

On 2026-05-23, live validation proved a DM sent from the Clisbot Zalo account
to a non-friend account appeared in zca-js `old_messages` after login. The
earlier missing message was explained by timing: it was sent manually from the
mobile app before the Zalo Personal session was logged in and listening.

## Media Sends

Shared sends use one file input:

```bash
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "image" --file ./image.png --file-type image
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "video" --file ./video.mp4 --file-type video
```

`--file` accepts either a local file path or an HTTP(S) URL. For URLs, clisbot
downloads the file first, then uploads it to Zalo. `channel-native messages
upload` is a diagnostic primitive that returns Zalo upload metadata; normal
sends do not require running upload separately.

Video sent through the shared attachment path may render as a generic Zalo
video attachment and can show a placeholder thumbnail until playback starts. If
the thumbnail matters, use the native video command and provide a thumbnail:

```bash
clisbot channel-native --channel zalo-personal --bot default messages video send \
  --target dm:<user-id> \
  --file ./video.mp4 \
  --thumbnail ./thumbnail.png \
  --message "video"
```

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

Do not use messages sent before login as proof that the listener is broken. Use
a fresh message while clisbot is connected.
