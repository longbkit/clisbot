# Zalo Personal

## Purpose

Use this guide for the `zalo-personal` channel.

Zalo Personal uses an unofficial Zalo Web personal-account session through
`zca-js`. It is more powerful than the official Zalo Bot surface for personal
account automation because it can operate like a real Zalo user: manage groups,
manage friends, send friend invites, and send text, images, audio, files, and
video. It is still unofficial, so account-ban or restriction risk is real and
the operator is responsible for how they use it.

## Safety Notes

- Use a separate phone number and Zalo account for automation, and avoid
  high-volume messaging, spam, or other abusive automation patterns.
- Login is QR-only in clisbot.
- `--qr-path` only saves a copy of the QR image; clisbot still prints the QR in
  the console.
- Run only one active listener per Zalo account. Multiple `zalo-personal` bots
  are stable only when they use separate Zalo accounts and separate
  `tokenFile` session paths.
- Zalo Personal is silent by default because it runs from a personal account
  that may have real friends and groups. Do not open every DM or group unless
  that is an intentional operator decision.

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
| Account setup | `start`, `bots add`, `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` | QR login, session-file lifecycle, runtime connection diagnostics. | Shipped |
| Routes and access | `routes add`, `routes get`, `routes set-policy`, `pairing approve`, `queues create`, `loops create` | Admit only explicit DMs/groups and keep queue/loop addressing bot-scoped. | Shipped |
| Contacts discovery | `contacts list/search/get`, `contacts aliases list`, `contacts labels list`, `contacts recommendations list`, `contacts mutual-groups list`, `contacts boards list` | Find raw user ids and Zalo classification state without opening routes. | Phase 1 |
| Friend invites | `contacts friend-invites list/status/send/accept/reject/cancel` | Inspect and manage friend-request state; `list` supports `--direction incoming\|sent\|all`. | Phase 1/2 |
| Groups discovery | `groups list/search/get`, `groups members list`, `groups boards list`, `groups group-invites list/get` | Find group ids, inspect members, boards, and received group invites. | Phase 1 |
| Group mutations | `groups members add/remove`, `groups group-invites send/accept/reject/cancel`, `groups invite-link get/update/enable/disable`, `groups join` | Mutate membership and invite state behind confirmation. | Phase 2 |
| Shared messages | `message send`, `message react`, `message read`, `message delete` | Cross-channel send/read/react/delete where Zalo support is proven. | Shipped |
| Native Zalo extras | `channel-native --channel zalo-personal ...` | Zalo-only messages, profile, settings, stickers, notes, reminders, quick messages, catalog, and conversation state. | Native |

## Routes

### Default Safety Behavior

A newly added Zalo Personal bot starts silent:

- `dmPolicy: "allowlist"` and `directMessages["*"].allowUsers: []` mean
  incoming DMs from regular users are ignored, including `/status` and
  `/whoami`, until the sender is added to the DM allowlist.
- An unknown regular DM sender is a raw Zalo user id that is not in
  `directMessages["*"].allowUsers` and is not an app owner or admin.
- The only default DM exception is first-owner claim: if no app owner exists
  yet, the first DM user during the configured claim window can become owner.
  After an owner exists, unknown DM senders receive no reply unless they are
  allowlisted.
- `groupPolicy: "allowlist"` means groups are ignored until an exact
  `group:<id>` route is added, even if someone tags the Zalo account.
- Added group routes should normally keep `--require-mention true`, so the bot
  only responds when mentioned or when a supported slash command is used.
- pairing is opt-in. Zalo Personal should not send pairing prompts to unknown
  DM senders by default.

### Enable DMs

For one known user, add that user to the wildcard DM allowlist:

```bash
clisbot routes add-allow-user --channel zalo-personal dm:* --bot default --user <user-id>
```

Use `--bot <id>` only when you created a Zalo Personal bot with a custom id,
for example `--bot work`.

The default wildcard `dm:*` route stays in `allowlist` mode. It does not reply
to unknown DM senders, does not send pairing prompts, and only admits users
listed in `allowUsers`.

For a few users, repeat the `routes add-allow-user` command for each raw Zalo
user id. Use an exact `dm:<user-id>` route only when that one DM needs
different behavior, such as a different agent, response mode, follow-up mode,
timezone, or explicit disable.

Use wildcard DM access only when the account is dedicated to automation:

```bash
clisbot bots set-dm-policy --channel zalo-personal --bot default --policy open
```

Use pairing only when you intentionally want unknown DM senders to receive a
pairing prompt:

```bash
clisbot routes set-policy --channel zalo-personal dm:* --bot default --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy` is only the summary for the wildcard DM route. The actual DM routing
surface is `directMessages`.

### Enable Groups

Add one exact group route for each Zalo group that should be admitted:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot default --require-mention true
```

Repeat that command for several groups. Avoid `group:*` admission on a personal
account unless every group on the account is safe for automation.

To limit who can use the bot inside admitted groups, add allowed users to the
group route:

```bash
clisbot routes add-allow-user --channel zalo-personal group:<group-id> --bot default --user <user-id>
```

Use `group:*` only for a default sender rule shared by all already admitted
groups:

```bash
clisbot routes add-allow-user --channel zalo-personal group:* --bot default --user <user-id>
```

Queue and loop examples:

```bash
clisbot queues create --channel zalo-personal --bot default --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot default --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

### Queue, Loop, And Native Action Permissions

Zalo Personal routes decide which DMs or groups may reach a bot, but queue and
loop creation plus contact/group/native actions are agent permissions. Before
opening a personal-account bot to other people, keep the default `member` role
limited to normal chat unless those users should operate durable work or Zalo's
social graph. If `member` users should be able to chat but not create durable
queues or loops, remove `queueManage` and `loopManage` from the agent `member`
role:

```bash
clisbot auth remove-permission agent-defaults --role member --permission queueManage
clisbot auth remove-permission agent-defaults --role member --permission loopManage
```

Use an agent-local override when only one agent should be stricter:

```bash
clisbot auth remove-permission agent --agent default --role member --permission queueManage
clisbot auth remove-permission agent --agent default --role member --permission loopManage
```

Keep `sendMessage` on `member` if those users should still talk to the agent.
Grant trusted users `admin` on the target agent, or another role that still has
`queueManage`, `loopManage`, `contactsManage`, `groupsManage`, or
`sensitiveChannelActionManage`, when they should keep scheduling access or use
sensitive native Zalo Personal actions, including poll mutations or poll reads
that reveal voter ids. By default, these sensitive contact, group, and
channel-native permissions are admin-only. Until the provider poll-detail
payload is proven safe, `channel-native messages polls get` also requires
`--confirm`. Zalo Personal principals use the
`zalo-personal:<user-id>` format, for example:

```bash
clisbot auth add-user agent --agent default --role admin --user zalo-personal:<user-id>
```

## Messages And History

What clisbot can see:

- Messages received while the Zalo Personal listener is connected.
- Supported inbound media, such as image messages, downloaded into the routed
  workspace `.attachments/` tree and passed to the agent as attachment paths.
- A multi-image Zalo send may arrive from `zca-js` as one message event per
  image, even when the Zalo client visually groups the images as an album.
  Current live validation found album metadata in `content.params` JSON:
  `group_layout_id`, `id_in_group`, and `total_item_in_group`. clisbot buffers
  those image events briefly, sorts by `id_in_group`, then processes them as
  one inbound agent message with multiple attachment paths and joined captions.
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

For multiple images with a different caption per image, send one image message
per caption. Zalo may visually group adjacent image messages as an album, but
the current shared `message send` surface does not expose an atomic multi-file
send with per-image captions.

Video sent through the shared attachment path may render as a generic Zalo
video attachment and can show a placeholder thumbnail until playback starts. If
the thumbnail matters, use the native video command and provide a JPEG/RGB
thumbnail:

```bash
clisbot channel-native --channel zalo-personal --bot default messages video send \
  --target dm:<user-id> \
  --file ./video.mp4 \
  --thumbnail ./thumbnail.png \
  --message "video"
```

## Stickers

Sticker send is a Zalo-native surface:

```bash
clisbot channel-native --channel zalo-personal --bot default stickers search ok --json
clisbot channel-native --channel zalo-personal --bot default stickers search ok --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers list --query ok --limit 10 --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers get <sticker-id> --json
clisbot channel-native --channel zalo-personal --bot default stickers send --target dm:<user-id> --id <id> --category <cate-id> --type <type>
```

Use the `id`, `cateId`, and `type` fields returned by `stickers get --json`
when sending a sticker. `stickers categories get <category-id> --json` returns
the stickers in one category. zca-js does not expose an unfiltered sticker
catalog, so `stickers list` requires `--query`. `list` and `search` default to
10 items. Plain output is the raw ids/rows; add `--detail` when you need text
and sticker URLs for inspection.

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
6. Check whether the listener receives an event. A pairing prompt should appear
   only when the DM route policy is intentionally set to `pairing`.
7. Only after friendship is accepted, retest contact search, status, and DM
   routing.

Do not use messages sent before login as proof that the listener is broken. Use
a fresh message while clisbot is connected.
