# Zalo Personal Contacts, Groups, And Full Tool Surface

## Source Of Truth

Status: `In Progress`
Priority: `P1`
Owner system: channels / control

This task owns the next Zalo Personal expansion after the current alpha:
bot-scoped account discovery, `contacts`, `groups`, richer `message` actions,
and explicitly marked channel-native extras.

The current alpha task remains the source of truth for QR login, `tokenFile`
session storage, runtime listener behavior, routes, pairing, queue/loop
addressing, and text send:
[Zalo Personal Free Local Adapter Alpha](2026-04-18-zalo-personal-free-local-adapter-alpha.md).

Evidence used for this task:

- [Zalo Personal user guide](../../../user-guide/zalo-personal.md)
- [Friend invites and message backfill implementation notes](2026-05-23-zalo-personal-friend-invites-and-message-backfill-implementation.md)
- [Telegram, Official Zalo Bot, zca-js, Discord, And clisbot Channel Interface Matrix](../../../research/channels/2026-05-08-telegram-zalo-discord-channel-interface-matrix.md)
- OpenClaw local `zalouser` docs and implementation
- https://zca-cli.dev/docs
- local `zca-js` API declarations under `node_modules/zca-js/dist/apis`

No separate local `zaloclaw` repository was found during this pass. The
ZaloClaw coverage claim in this task should therefore be treated as
ZaloClaw-style Zalo Personal coverage through OpenClaw `zalouser`, public
`zca-cli` docs, and local `zca-js` APIs until a separate source is added.

The old research proposal for a generic v2 channel tool surface has been
removed. The stable operator contract for this work should live here, then move
into CLI help and user-guide docs as commands ship.

## Decisions

- Keep channel id/config key `zalo-personal`; do not collapse it into plain
  `zalo`.
- Keep the account selector as existing `--bot <id>`, not a new profile/account
  flag. `zca-cli` profiles map to clisbot bot records.
- Add plural parent commands: `contacts` and `groups`.
- Keep shared outbound chat actions under existing `message`.
- Prefer nested noun commands for subresources: `groups members add`, `groups
  members list`, `contacts friend-invites accept`.
- Use plural subtree names only for collection-like resources. Keep
  `contacts friend-invites`, `groups members`, `groups pending`, and `groups
  group-invites`; use `groups invite-link` for the current group's singleton
  invite-link capability. Use top-level `groups join` for joining by an
  external invite URL/token so it cannot be confused with managing the current
  group's invite link.
- Use cross-channel contact concepts in CLI flags. `contacts list --favorite`
  is the generic favorite/pinned/close-contact filter; Zalo Personal maps it to
  the Zalo close-friends capability instead of exposing `--close-friends`.
- Do not use flat `group member-add` for new Zalo Personal work. Existing
  clisbot has old flat command names such as `routes add-allow-user`, but the
  shared `command-tree` parser already supports nested commands and tests cover
  examples like `groups list`. New domain surfaces should use the cleaner
  nested style.
- Discovery output may show names for humans, but route and auth state must use
  raw ids: `dm:<userId>`, `group:<groupId>`, and principal
  `zalo-personal:<userId>`.
- Discovery output for large personal accounts must be bounded by default and
  careful with personal data. Human-readable output should prioritize id,
  display name, and route examples; raw phone/avatar/profile payloads belong in
  explicit `--json` output or narrower `search`/`get` commands.
- Read-only discovery must not mutate routes, allowlists, pairing state, or the
  surface directory as an auth source.
- Mutating commands require `--confirm` unless an existing clisbot safety helper
  provides an equivalent confirmation path.
- Zalo Personal remains fail-closed by default: no wildcard DM pairing by
  default, exact group routes before group replies, and mention gating by
  default for groups.
- Mark channel-native or high-risk features instead of pretending they are
  shared Slack/Telegram parity.

Regression side effects to watch:

- New root commands `contacts`, `groups`, and later `channel-native` must be registered
  in the root CLI parser and help. They are not implemented today.
- Shared `message` behavior for Slack, Telegram, and Zalo Bot must not change
  when adding Zalo Personal media/history/poll actions.
- Discovery commands must use the selected Zalo Personal `--bot` session only;
  never infer from display names, global config defaults, or surface directory
  cache.
- `contacts` and `groups` are operator discovery and mutation surfaces. They
  must not replace route/auth CLI ownership for admission decisions.
- `zca-js` login/session/cache APIs stay under the alpha account-control work;
  do not expose a parallel `auth` or `account` command family for Zalo Personal.
- `zca-cli serve` REST/SSE server support is a source coverage item, not a
  direct clisbot command target. clisbot already owns runtime delivery,
  queueing, loops, and listener events; do not add a second HTTP server surface
  unless a future integration task proves it is needed.
- `zca-js` low-level `custom` API access is not a public CLI target. If a
  missing channel-native capability is needed later, add a named command with docs,
  confirmation, tests, and channel risk notes instead of a raw request escape
  hatch.

Documentation side effects from this task:

- The old generic v2 tool-surface proposal is deleted to avoid a competing
  source of truth.
- `docs/tasks/backlog.md` links this task as the planned P1 expansion.
- The Zalo Personal setup guide and alpha task link forward to this task for
  unimplemented discovery/mutation/media/channel-native work.
- The channel interface matrix remains research context only and links here for
  the operator contract.

## Current Phase

Current alpha implementation already covers:

| Area | Current status |
| --- | --- |
| Account bootstrap | `start --channel zalo-personal`, `bots add`, QR console rendering, optional `--qr-path` |
| Session storage | `tokenFile` path contract stores opaque `zca-js` session/cookie data; session refresh writes back after restore |
| Account control | `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` |
| Message send | text send to `dm:<id>` and `group:<id>` through shared `message send` |
| Listener | inbound text DM/group events, object/link text normalization, mention stripping, reply-to-bot addressing |
| Access | routes, pairing, queue/loop addressing, `dmPolicy` as wildcard summary, fail-closed default |
| Docs/tests | alpha task, setup guide, regression tests for route/auth/session/listener behavior |

Not yet implemented in alpha:

- `bots me` / own Zalo id lookup
- `contacts` read-only discovery
- `groups` read-only discovery and group member listing
- friend request send/list/accept/reject/cancel
- group add, member add/remove, admins, pending members, invite links,
  blocking
- media, reactions, typing/seen/delivered, forward/delete/undo/polls
- channel-native extras such as profile/avatar/settings, quick messages, reminders,
  notes, board items, conversation state, catalog/product, and stickers
- live Zalo account validation across a large real contact/group graph

## Pickable Batches

If a Long wants to pull follow-up work into the current implementation, pick in
this order:

1. **Safe discovery first**: `bots me`, `contacts list/search/get`, and
   `groups list/search/get/members list/group-invites list`, plus Zalo Personal
   `message send --input md --render native` Markdown-to-`TextStyle`
   rendering. This unlocks route allowlists and keeps AI replies readable.
2. **High-value group ops**: `groups add`, `groups members add/remove`,
   and `groups pending list/approve/reject`.
   These are important but should require confirmation and live validation.
3. **Friend invites**: `contacts friend-invites list/status/send/accept/reject/cancel`.
   Sent/status paths are directly evidenced; incoming list needs source
   verification before claiming full support.
4. **Message parity**: file/image/video/voice/link/sticker send, reactions,
   typing/seen/delivered, delete/undo/forward, and group history.
5. **Sensitive group governance**: admins, owner transfer, settings, community
   upgrade, leave, and disperse. These can surprise real groups and should not
   ship with ordinary member-management commands.
6. **Channel-native extras**: profile, conversation state, notes, reminders,
   quick messages, catalog/product, stickers, board items, and business helpers
   behind a channel-native gateway after the shared CLI shape is decided.

Do not start with channel-native extras before discovery. Discovery gives operators the
raw ids needed to keep Zalo Personal fail-closed on real accounts with many
friends and groups.

## Phase Plan

The command tables include test columns as implementation-prep status. `Planned`
means the task doc defines the target surface, but the corresponding unit,
integration, or live end-to-end coverage has not shipped yet.

### Phase 1: Read-Only Discovery

Goal: let an operator safely find route-ready ids without opening broad DM or
group access.

| Command | Meaning | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot bots me --channel zalo-personal --bot <bot-id> [--json]` | Show the logged-in Zalo account identity, including the raw id needed for diagnostics and route ownership. | Done | Done | Planned |
| `clisbot contacts list --channel zalo-personal --bot <bot-id> [--status all\|online] [--favorite] [--label <label-id-or-name>...] [--label-match any\|all] [--limit N] [--json]` | List contacts for the selected account. `--status online` narrows to online contacts, `--favorite` is the cross-channel favorite/pinned/close-contact filter and maps to Zalo's close-friends API, and repeated `--label` filters by one or more classification labels. `--label-match` defaults to `any`; use `all` only when a contact/conversation must belong to every provided label. | Done | Done | Planned |
| `clisbot contacts search --channel zalo-personal --bot <bot-id> [<query>] [--phone <phone>...] [--username <username>] [--limit N] [--json]` | Search contacts/users by text, phone, or Zalo `user_name`; use the result's raw `userId` for routes and later mutations. | Done | Done | Planned |
| `clisbot contacts get --channel zalo-personal --bot <bot-id> <user-id> [--business] [--json]` | Fetch one user's profile/contact details by raw Zalo user id; `--business` also fetches business-account metadata when available. | Done | Done | Planned |
| `clisbot contacts recommendations list --channel zalo-personal --bot <bot-id> [--json]` | List Zalo friend recommendations for this account. | Done | Done | Planned |
| `clisbot contacts aliases list --channel zalo-personal --bot <bot-id> [--json]` | List local contact aliases/nicknames configured in Zalo. | Done | Done | Planned |
| `clisbot contacts labels list --channel zalo-personal --bot <bot-id> [--json]` | List Zalo classification labels/tags, their conversation ids, and channel-specific version. | Done | Done | Planned |
| `clisbot contacts boards list --channel zalo-personal --bot <bot-id> <conversation-id> [--json]` | List friend-board data for one conversation. The upstream payload is not yet well documented; keep `--json` available and finalize the operator meaning after live validation. | Done | Done | Planned |
| `clisbot contacts mutual-groups list --channel zalo-personal --bot <bot-id> <user-id> [--json]` | List mutual/related groups shared with one user when Zalo exposes them. | Done | Done | Planned |
| `clisbot contacts friend-invites list --channel zalo-personal --bot <bot-id> [--direction incoming\|sent\|all] [--json]` | List friend invites. `--direction sent` maps to `zca-js` `getSentFriendRequest`; Zalo can return code `112` for an empty sent list, so clisbot normalizes that to `sent: {}`. `--direction all` combines normalized sent requests with incoming recommendations where `recommType=2`. | Done | Done | Planned |
| `clisbot contacts friend-invites status --channel zalo-personal --bot <bot-id> <user-id> [--json]` | Check the friend-invite relationship/status with one user. | Done | Done | Planned |
| `clisbot groups list --channel zalo-personal --bot <bot-id> [--limit N] [--json]` | List groups visible to the selected Zalo Personal account. | Done | Done | Planned |
| `clisbot groups search --channel zalo-personal --bot <bot-id> <query> [--limit N] [--json]` | Search the selected account's visible groups by name/text. | Done | Done | Planned |
| `clisbot groups get --channel zalo-personal --bot <bot-id> <group-id> [--json]` | Fetch one group's details by raw Zalo group id. | Done | Done | Planned |
| `clisbot groups members list --channel zalo-personal --bot <bot-id> <group-id> [--limit N] [--json]` | List members of one group, bounded for large groups. | Done | Done | Planned |
| `clisbot groups boards list --channel zalo-personal --bot <bot-id> <group-id> [--page N] [--limit N] [--json]` | List group board items, currently typed by `zca-js` as notes, pinned messages, or polls. Use this to audit group board state before changing group state. | Done | Done | Planned |
| `clisbot groups group-invites list --channel zalo-personal --bot <bot-id> [--json]` | List group invitations received by this account. This is "groups invited me", not `groups pending`. | Done | Done | Planned |
| `clisbot groups group-invites get --channel zalo-personal --bot <bot-id> <invite-id> [--json]` | Inspect one received group invitation. | Done | Done | Planned |

Discovery output should print ready-to-copy route examples, but it must not run
them: `clisbot routes add --channel zalo-personal group:<group-id> --bot <bot-id>`.

Example discovery filters:

```bash
# Generic favorite/pinned/close-contact filter; Zalo maps this to close friends.
clisbot contacts list --channel zalo-personal --bot work --favorite

# Multiple labels default to --label-match any.
clisbot contacts list --channel zalo-personal --bot work --label khách-hàng --label vip

# Require every supplied label.
clisbot contacts list --channel zalo-personal --bot work --label khách-hàng --label vip --label-match all

# Search can narrow by phone, and username stays optional if Zalo support works.
clisbot contacts search --channel zalo-personal --bot work --phone 84901234567 --limit 5
clisbot contacts search --channel zalo-personal --bot work --username longbkit --json

# Fetch one profile and include business metadata only when needed.
clisbot contacts get --channel zalo-personal --bot work 123456789 --business --json
```

### Phase 2: Controlled Contacts And Groups Mutations

Goal: expose high-value graph and group operations with explicit confirmation.

| Command | Meaning | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot contacts friend-invites send --channel zalo-personal --bot <bot-id> --user <user-id> [--message <text>] [--confirm]` | Send a friend request to a known raw user id. | Done | Done | Planned |
| `clisbot contacts friend-invites send --channel zalo-personal --bot <bot-id> --phone <phone> [--message <text>] [--confirm]` | Send a friend request after resolving a phone number. Username is intentionally not accepted here; search by username first, then send by raw user id. | Done | Done | Planned |
| `clisbot contacts friend-invites accept --channel zalo-personal --bot <bot-id> <request-id-or-user-id> [--confirm]` | Accept an incoming friend request from another user. | Done | Done | Planned |
| `clisbot contacts friend-invites reject --channel zalo-personal --bot <bot-id> <request-id-or-user-id> [--confirm]` | Reject an incoming friend request. | Done | Done | Planned |
| `clisbot contacts friend-invites cancel --channel zalo-personal --bot <bot-id> <request-id-or-user-id> [--confirm]` | Cancel a friend request that this account already sent. This is different from `reject`. | Done | Done | Planned |
| `clisbot contacts aliases set --channel zalo-personal --bot <bot-id> <user-id> --alias <name> [--confirm]` | Set the local nickname for an existing friend/contact. | Done | Done | Planned |
| `clisbot contacts aliases clear --channel zalo-personal --bot <bot-id> <user-id> [--confirm]` | Clear the local nickname for an existing friend/contact. | Done | Done | Planned |
| `clisbot contacts labels add --channel zalo-personal --bot <bot-id> --name <name> [--color <hex>] [--emoji <emoji>] [--confirm]` | Add a Zalo classification label by reading current labels, adding one label, then writing the versioned label payload. | Done | Done | Planned |
| `clisbot contacts labels update --channel zalo-personal --bot <bot-id> <label-id> --name <name> [--confirm]` | Update one classification label through the same read-modify-write label payload. | Done | Done | Planned |
| `clisbot contacts labels remove --channel zalo-personal --bot <bot-id> <label-id> [--confirm]` | Remove one classification label. | Done | Done | Planned |
| `clisbot contacts labels assign --channel zalo-personal --bot <bot-id> <label-id> --target <target>... [--confirm]` | Add one or more conversations, such as `dm:<user-id>` or `group:<group-id>`, to a label. | Done | Done | Planned |
| `clisbot contacts labels unassign --channel zalo-personal --bot <bot-id> <label-id> --target <target>... [--confirm]` | Remove one or more conversations from a label. | Done | Done | Planned |
| `clisbot contacts blocked add --channel zalo-personal --bot <bot-id> --user <user-id> [--confirm]` | Add one user to the direct-contact blocked list. | Done | Done | Planned |
| `clisbot contacts blocked remove --channel zalo-personal --bot <bot-id> --user <user-id> [--confirm]` | Remove one user from the direct-contact blocked list. | Done | Done | Planned |
| `clisbot contacts feed-blocked add --channel zalo-personal --bot <bot-id> --user <user-id> [--confirm]` | Add one user to the feed/timeline visibility blocked list. | Done | Done | Planned |
| `clisbot contacts feed-blocked remove --channel zalo-personal --bot <bot-id> --user <user-id> [--confirm]` | Remove one user from the feed/timeline visibility blocked list. | Done | Done | Planned |
| `clisbot contacts remove --channel zalo-personal --bot <bot-id> <user-id> [--confirm]` | Remove an existing friend from the contact list. | Done | Done | Planned |
| `clisbot groups add --channel zalo-personal --bot <bot-id> --name <name> --user <user-id>... [--confirm]` | Add a group with the supplied initial members. | Done | Done | Planned |
| `clisbot groups update --channel zalo-personal --bot <bot-id> <group-id> --name <name> [--confirm]` | Update a group title. | Done | Done | Planned |
| `clisbot groups avatar set --channel zalo-personal --bot <bot-id> <group-id> --file <path> [--confirm]` | Change a group avatar image. | Done | Done | Planned |
| `clisbot groups members add --channel zalo-personal --bot <bot-id> <group-id> --user <user-id>... [--confirm]` | Add one or more users into an existing group. | Done | Done | Planned |
| `clisbot groups members remove --channel zalo-personal --bot <bot-id> <group-id> --user <user-id>... [--confirm]` | Remove one or more users from an existing group. | Done | Done | Planned |
| `clisbot groups pending list --channel zalo-personal --bot <bot-id> <group-id> [--json]` | List users waiting for approval to join a specific group. | Done | Done | Planned |
| `clisbot groups pending approve --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Approve one pending user into a group. | Done | Done | Planned |
| `clisbot groups pending reject --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Reject one pending user waiting to join a group. | Done | Done | Planned |
| `clisbot groups blocked list --channel zalo-personal --bot <bot-id> <group-id> [--json]` | List users blocked from a group. | Done | Done | Planned |
| `clisbot groups blocked add --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Add one user to a group's blocked list. | Done | Done | Planned |
| `clisbot groups blocked remove --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Remove one user from a group's blocked list. | Done | Done | Planned |
| `clisbot groups invite-link get --channel zalo-personal --bot <bot-id> <group-id> [--json]` | Get the current invite-link metadata for a group, including URL, enabled state, and expiration when Zalo returns them. | Done | Done | Planned |
| `clisbot groups invite-link enable --channel zalo-personal --bot <bot-id> <group-id> [--confirm]` | Enable invite-link joining for a group and return the link metadata. | Done | Done | Planned |
| `clisbot groups invite-link disable --channel zalo-personal --bot <bot-id> <group-id> [--confirm]` | Disable invite-link joining for a group. | Done | Done | Planned |
| `clisbot groups join --channel zalo-personal --bot <bot-id> <invite-url-or-token> [--confirm]` | Join a group by an external invite URL or token. This is intentionally not under `groups invite-link`. | Done | Done | Planned |
| `clisbot groups group-invites send --channel zalo-personal --bot <bot-id> --group <group-id> --user <user-id>... [--confirm]` | Send group invitations to one or more known raw user ids. This is not the same as `groups members add`; recipients may still need to accept through Zalo's normal flow. | Done | Done | Planned |
| `clisbot groups group-invites send --channel zalo-personal --bot <bot-id> --group <group-id> --phone <phone>... [--confirm]` | Send group invitations after resolving one or more phone numbers, mirroring `contacts friend-invites send --phone`. Source support must be verified before claiming shipped. | Done | Done | Planned |
| `clisbot groups group-invites accept --channel zalo-personal --bot <bot-id> <invite-id> [--confirm]` | Accept one received group invitation. | Done | Done | Planned |
| `clisbot groups group-invites reject --channel zalo-personal --bot <bot-id> <invite-id> [--confirm]` | Reject one received group invitation. This maps to declining an inbound invite, not deleting an arbitrary record. | Done | Done | Planned |
| `clisbot groups group-invites cancel --channel zalo-personal --bot <bot-id> --group <group-id> --user <user-id> [--confirm]` | Cancel a group invitation this account sent to another user; source support must be verified before claiming shipped. | Blocked | Done | Planned |

Examples for mutation params:

```bash
# Add several users to one existing group.
clisbot groups members add --channel zalo-personal --bot work 456 \
  --user 111 --user 222 --confirm

# Manage the current group's invite link.
clisbot groups invite-link enable --channel zalo-personal --bot work 456 --confirm
clisbot groups invite-link get --channel zalo-personal --bot work 456 --json

# Join from a link somebody sent this account, not from a current group id.
clisbot groups join --channel zalo-personal --bot work "https://zalo.me/g/abc123" --confirm

# Invite users to a group by raw user id, or by phone when Zalo supports lookup.
clisbot groups group-invites send --channel zalo-personal --bot work \
  --group 456 --user 123 --user 789 --confirm
clisbot groups group-invites send --channel zalo-personal --bot work \
  --group 456 --phone "+84901234567" --confirm

# Decline an invitation this account received; cancel an invitation this account sent.
clisbot groups group-invites reject --channel zalo-personal --bot work invite_abc --confirm
clisbot groups group-invites cancel --channel zalo-personal --bot work \
  --group 456 --user 123 --confirm

# Friendly label edit path.
clisbot contacts labels assign --channel zalo-personal --bot work lbl_vip \
  --target dm:123 --target group:456 --confirm

# Send by phone when raw user id is not known yet.
clisbot contacts friend-invites send --channel zalo-personal --bot work \
  --phone 84901234567 --message "Chào anh, em là Long." --confirm
```

### Phase 3: Message And Media Parity

Goal: fill the high-value OpenClaw `zalouser`, ZaloClaw-style, and zca-cli
messaging surface while preserving the existing shared `message` command owner.
Shared commands stay limited to behavior that already has a cross-channel
meaning. Zalo-only message shapes move under `channel-native ... messages ...`
instead of adding more Zalo-specific flags to shared `message send`.

Important render boundary: `--render native` is the existing clisbot render
mode where the selected channel chooses its best native-looking output, not a
new Zalo Personal flag. AI should keep producing Markdown by default. For Zalo
Personal, native rendering should parse Markdown in clisbot and send the best
available Zalo-native payload: visible plain text plus zca-js `TextStyle`
ranges for supported formatting. Source checks found zca-js `sendMessage`
accepts a `msg` string plus explicit `styles`, `mentions`, `quote`, `urgency`,
and `ttl`; zca-cli mirrors the same low-level specs. No source checked here
proves Zalo Personal parses HTML, Slack `mrkdwn`, or raw Markdown as rich text,
so Markdown-to-Zalo rich text must be a clisbot renderer/compiler. The shipped
renderer covers common AI Markdown, Zalo `TextStyle` ranges, and `<@uid|Name>`
mention remapping; live E2E still must verify Vietnamese/emoji offsets, actual
Zalo client display, group mention delivery, and attachment captions.

| Command | Meaning | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot message send --channel zalo-personal --bot <bot-id> --target dm:<id>\|group:<id> --message <text>` | Send plain text to a Zalo DM or group through the shared message command. | Done | Done | Done |
| `clisbot message send --channel zalo-personal --bot <bot-id> --target <target> --input md --render native --message <markdown>` | Send AI-generated Markdown using the shared render contract. For Zalo Personal this should render to visible text plus Zalo `TextStyle` ranges where supported, falling back to readable plain text for unsupported Markdown. | Done | Done | Done |
| `clisbot message send --channel zalo-personal --bot <bot-id> --target <target> [--message <text>] --file <path-or-url> [--file-type auto\|file\|image\|video\|audio\|voice]` | Send one attachment through the shared file path. `auto` is the default; `file` is the portable replacement for Telegram's current `--force-document`; `voice` is only valid where a channel implements a real voice-note send. | Done | Done | Done |
| `clisbot message react --channel zalo-personal --bot <bot-id> --target <target> --message-id <id> --emoji <emoji>` | React to one message when Zalo exposes reaction support. | Done | Done | Planned |
| `clisbot message read --channel zalo-personal --bot <bot-id> --target <target> [--limit N] [--json]` | Read recent messages through the existing shared read/history action for diagnostics or reply context. Current zca-js request/response support is group history only; `dm:<id>` intentionally returns unsupported until a real DM/stranger history source is proven. | Done | Done | Planned |
| `clisbot message delete --channel zalo-personal --bot <bot-id> --target <target> --message-id <id> [--confirm]` | Delete one message where the account has permission. Keep this shared because Slack and Telegram already implement `message delete`. | Done | Done | Planned |

Channel-native Zalo message commands:

| Command | Meaning | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages send --target <target> --message <text> [--quote <json>] [--mention <spec>...] [--style <spec>...] [--urgency default\|important\|urgent\|0\|1\|2] [--ttl <ms>]` | Send Zalo enhanced text with quote/reply, mentions, styles, urgency, or self-delete TTL. Prefer inline mention placeholders in `--message`; keep `--mention` only as a low-level fallback. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages link send --target <target> <url> [--message <text>] [--ttl <ms>]` | Send a Zalo link preview/card. zca-js asks Zalo to parse title/description/thumb; do not expose fake manual `--title` or `--description` unless a source proves they are accepted. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages parse-link <url> [--json]` | Ask Zalo to parse link metadata before sending a link card. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages upload --target <target> --file <path> [--json]` | Diagnostic/pre-upload helper for Zalo APIs that require uploaded media URLs before send, not the normal operator send path. | Done | Done | Done |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages contact-card send --target <target> --user <user-id>` | Send a Zalo contact card for one user. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages bank-card send --target <target> --bin-bank <json-or-code> --account-number <account-number> [--account-name <name>]` | Send a bank-card/account card using Zalo's channel-native `binBank`, account number, and optional account name payload. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages typing --target <target>` | Send a Zalo typing indicator to one conversation. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages delivered --target <target> --message-id <id>` | Mark one message as delivered when Zalo exposes that event. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages seen --target <target> --message-id <id>` | Mark one message as seen/read. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages undo --target <target> --message-id <id> [--confirm]` | Undo/recall one sent message using Zalo recall semantics. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages forward --message <text> --to <target> [--reference <json>] [--ttl <ms>] [--confirm]` | Forward a message payload to another Zalo target. zca-js forwards supplied content and optional reference metadata; it does not fetch a source message from `--message-id`. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls add --target <target> --question <text> --option <text>...` | Add a poll in a Zalo conversation. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls vote --target <target> --poll-id <id> --option <id>` | Vote for one option in a poll. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls lock --target <target> --poll-id <id> [--confirm]` | Lock/close a poll. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls get --target <target> --poll-id <id> [--json]` | Fetch poll details/results. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls options add --target <target> --poll-id <id> --option <text>... [--confirm]` | Add one or more options to an existing poll. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages polls share --poll-id <id> [--confirm]` | Share a poll through zca-js' native poll-share endpoint. Current zca-js does not expose a destination parameter, so do not invent `--to`. | Done | Done | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> messages report --target <target> --reason <reason> [--confirm]` | Report a conversation/message target through Zalo channel-native reporting. | Done | Done | Planned |

Examples for shared file/media send:

```bash
# Shared text send stays the normal path for Slack, Telegram, and Zalo Personal.
clisbot message send --channel zalo-personal --bot work --target dm:123 \
  --message "Đã nhận, để em check."

# AI can return Markdown; --render native should compile supported Markdown
# ranges into Zalo TextStyle metadata and degrade unsupported syntax to text.
clisbot message send --channel zalo-personal --bot work --target group:456 \
  --input md --render native \
  --message "**Quan trọng**: chốt hôm nay\n- Gửi file\n- Confirm owner"

# Image, video, audio, and generic files all use --file plus an optional type hint.
clisbot message send --channel zalo-personal --bot work --target group:456 \
  --message "Ảnh hiện trường" --file ./photo.jpg --file-type image
clisbot message send --channel zalo-personal --bot work --target group:456 \
  --file ./demo.mp4 --file-type video
clisbot message send --channel zalo-personal --bot work --target dm:123 \
  --file ./contract.pdf --file-type file

# Voice is not just "audio" on every channel; only use it after channel support exists.
clisbot message send --channel zalo-personal --bot work --target dm:123 \
  --file ./voice.ogg --file-type voice
```

Examples for Zalo channel-native message params:

```bash
# Reply when listener/history captured msgId, cliMsgId, uidFrom, and timestamp.
clisbot channel-native --channel zalo-personal --bot work messages send --target dm:123 \
  --message "Đã nhận, để em check." \
  --quote '{"content":"cũ","msgType":"chat","propertyExt":"","uidFrom":"123","msgId":"m1","cliMsgId":"c1","ts":1700000000,"ttl":0}'

# AI-friendly mention placeholder. clisbot should render visible text as
# "@Alice xem giúp phần này" and derive Zalo metadata {pos, uid, len}.
clisbot channel-native --channel zalo-personal --bot work messages send --target group:456 \
  --message "<@alice_uid|Alice> xem giúp phần này"

# Low-level fallback when the caller already knows final offsets.
clisbot channel-native --channel zalo-personal --bot work messages send --target group:456 \
  --message "@Alice xem giúp phần này" --mention "alice_uid:0:6"

# Style text ranges. Spec is <style>:<zero-based-offset>:<length>.
# Style values should map to zca-js TextStyle: bold, italic, underline,
# strike, red, orange, yellow, green, small, big, unordered-list, ordered-list.
clisbot channel-native --channel zalo-personal --bot work messages send --target dm:123 \
  --message "Quan trọng: chốt hôm nay" \
  --style "bold:0:10" --style "red:0:10"

# Urgency maps to zca-js Urgency: 0 default, 1 important, 2 urgent.
# TTL is milliseconds, e.g. 300000 = 5 minutes.
clisbot channel-native --channel zalo-personal --bot work messages send --target dm:123 \
  --message "OTP tạm thời" --urgency 1 --ttl 300000

# Link preview metadata is parsed by Zalo from the URL; --message is optional text.
clisbot channel-native --channel zalo-personal --bot work messages link send \
  --target group:456 https://example.com/spec --message "Bản review"

# Forward sends supplied content; add --reference only with a captured zca-js reference payload.
clisbot channel-native --channel zalo-personal --bot work messages forward \
  --message "Nhờ team xem lại phần này" --to group:456 --confirm
```

Mention implementation note: zca-js requires `mentions: [{ pos, uid, len }]`
metadata and only keeps it for group messages. It does not infer mentions from a
plain `@Alice` string. The placeholder form is the friendly CLI proposal because
AI can generate one message body; clisbot can rewrite it before send and compute
offsets on the final visible string. Tests must cover Vietnamese accents, emoji,
and attachments. zca-js only attaches mention metadata to attachment captions
for a single image without quote; multi-file or quoted attachment sends may need
a separate text message.

**Important multi-file next step:** current Slack file send uses one
`files.uploadV2` file with `--message` as `initial_comment`; current Telegram
file send infers photo/video/audio/document from extension and has
`--force-document`. Zalo Personal can upload attachment arrays and also has
separate voice/video URL APIs. Do not expose repeated `--file` yet. First
live-test Slack multiple upload behavior, Telegram media group vs independent
sends, and Zalo attachment ordering, limits, and partial failure.

Zalo Personal URL send note: zca-js `sendMessage({ attachments })` and
`uploadAttachment()` treat string attachments as local filesystem paths, not
remote URLs. For the shared `message send --file <path-or-url>` contract,
clisbot downloads remote URLs into an attachment buffer before calling
`uploadAttachment()`. zca-js also has direct `sendVoice({ voiceUrl })` and
`sendVideo({ videoUrl, thumbnailUrl })` APIs for already-uploaded or public
media URLs, but those are channel-native send paths, not the generic
image/file/audio attachment path.

### Phase 4: Channel-Native Extensions

Goal: cover the remaining `zca-js` and `zca-cli` families without confusing
them with shared cross-channel behavior.

Candidate channel-native groups:

| Channel-native group | Covered capabilities |
| --- | --- |
| messages | enhanced text, quote/reply, mentions, style, urgency, TTL, link cards, upload/parse helpers, contact/bank cards, undo/recall, forward, polls, report |
| account/profile | account info/id, profile update, avatar list/get/set/remove/reuse, online status, last online |
| settings/language | app settings, language, profile bio |
| conversation state | unread mark, archive, mute, pin, hidden conversations, auto-delete chat, remove chat |
| stickers | sticker list/search/get/send |
| notes/reminders | add, list, get, update, remove reminders or notes |
| quick messages/auto reply | list/add/update/remove quick messages and auto replies |
| boards | group board items such as notes, pinned messages, and polls; friend board payloads need live validation |
| catalog/product | catalog and product add/update/remove, product photos upload |
| business helpers | business account helpers not already covered by `contacts get --business` |
| listener/keep-alive | self-message inclusion, raw JSON, webhook forwarding, restart policy if clisbot needs a debug mode |

These are channel-native and should ship only with explicit help text that says
they are unofficial Zalo Personal features.

Command-shape decision for Phase 4:

- Prefer existing shared homes when they fit: `bots me`, `contacts ...`,
  `groups ...`, and `message ...`.
- For Zalo-only capabilities that do not fit a shared home, including
  message-domain extras, use the shared channel-native gateway:
  `clisbot channel-native --channel zalo-personal --bot <bot-id> <group> <action>`.
- Do not add many channel-specific root commands such as
  `clisbot zalo-personal-notes ...`; that would make help and ownership drift.
- Before implementation, update the accepted custom-message ADR if
  `channel-native ... messages ...` becomes the general replacement for
  channel-specific message subtrees.

## Standardization Notes

- `groups group-invites send/accept/reject/cancel` mirrors friend-invite
  direction: send/cancel outbound invites, accept/reject inbound invites. Support
  sending by raw user id and by phone where Zalo lookup supports it.
- Keep group invitations under `groups group-invites`, not `groups members`.
  `groups members add/remove/list` is reserved for real membership state.
- Use `contacts aliases set/clear` under the same plural collection as
  `contacts aliases list`.
- Use `groups invite-link get`, not `status` or `detail`; `get [--json]`
  covers link URL, enabled state, expiration, and other returned metadata.
- Prefer `add/remove/update` for resource CRUD where the command is not a
  channel-native verb.
- Keep raw label replacement out of Phase 2. `contacts labels replace --file`
  is a sensitive backup/import repair path because it writes the full versioned
  label payload.
- Shared media send is one path: `message send --file [--file-type auto|file|image|video|audio|voice]`.
  Do not add separate shared `--image`, `--video`, or `--voice` flags.
- Zalo Personal `--render native` should accept AI-authored Markdown and render
  the best Zalo-native output available. Implement this as a clisbot
  Markdown-to-Zalo renderer that strips Markdown markers into visible text and
  emits zca-js `TextStyle` ranges for supported formatting. Unsupported
  Markdown falls back to readable plain text. Do not assume Zalo Personal itself
  parses raw Markdown, HTML, or Slack `mrkdwn`.
- Use the existing shared `message read` action for recent-message/history
  reads; do not add a parallel `message history list` shape. For Zalo Personal,
  current implementation supports group history through zca-js
  `getGroupChatHistory` only. Do not claim DM history support from
  `listener.requestOldMessages(ThreadType.User)` yet: it is a listener-level
  websocket backfill emitting `old_messages`, not a proven target-specific
  request/response read API.
- Zalo-only message semantics live under `channel-native ... messages ...`.
  `messages upload` is a diagnostic/pre-upload helper, not the normal send path.
- zca-js `forwardMessage` forwards caller-supplied content plus optional
  reference metadata; it does not expose source-message lookup by `--message-id`.
- zca-js `sharePoll(pollId)` does not expose a destination argument; keep it
  destination-free until a source proves otherwise.
- Mention UX should prefer inline placeholders such as `<@alice_uid|Alice>` in
  the message body so AI-generated content can carry both visible text and the
  user id. Raw `--mention <uid>:<offset>:<length>` remains a fallback because
  zca-js itself requires metadata and does not infer mentions from `@Alice`.
- Keep repeated `--file` out of the public contract until Slack, Telegram, and
  Zalo multi-file behavior is live-tested for ordering, captions, media groups,
  limits, and partial failures.

Board research:

- `zca-cli` documents `zca friend boards <conversationId>` as "Get friend
  boards for a conversation", but does not explain the payload beyond `--json`.
- Local `zca-js` exposes `getFriendBoardList(conversationId)` returning raw
  `data: string[]` plus `version`; treat this as unclear until live payloads are
  inspected.
- Local `zca-js` exposes `getListBoard(options, groupId)` returning board items
  typed as `Note`, `PinnedMessage`, or `Poll`. This is the Zalo group board
  surface, not a general social feed/timeline.
- Use case: `groups boards list` audits pinned messages, notes, and polls before
  group changes. Keep `contacts boards list` for coverage, but finalize its
  summary/use case from live payload validation.

Sticker reads use `stickers get`, not `stickers detail`; zca-js
`getStickersDetail` returns full `StickerDetail[]`, so `get [--json]` covers it.

Keep `message delete` as-is. It is already a shared message action in the
current CLI and is implemented by Slack and Telegram; Zalo Personal should use
the same shared verb when delete is supported. Zalo channel-native recall moves
under `channel-native ... messages undo`.

Friend-invite and stranger-message validation notes live in
[Friend Invites And Message Backfill Implementation Notes](2026-05-23-zalo-personal-friend-invites-and-message-backfill-implementation.md).
Keep the shared `message read` contract conservative until target-specific DM
history is proven.

Candidate channel-native command shapes after a `channel-native` gateway exists:

| Command | Meaning | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile get [--json]` | Show the account profile. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile update [--name <name>] [--gender <value>] [--birthday YYYY-MM-DD] [--confirm]` | Update basic profile fields. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile avatar set --file <path> [--confirm]` | Upload and set a new account avatar. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile avatar get <user-id> [--size thumbnail\|full] [--json]` | Get one user's avatar/profile image; `--size` defaults to `thumbnail`, and `full` maps to Zalo's full-avatar API when available. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile avatar remove <photo-id> [--confirm]` | Remove one account avatar photo. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile avatar reuse <photo-id> [--confirm]` | Reuse an existing avatar photo as the current avatar. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile avatars list [--json]` | List previous/current avatar photos. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile bio set <text> [--confirm]` | Set the account profile bio. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile status set online\|offline [--confirm]` | Set channel-native online/offline presence where supported. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> profile last-online get <user-id> [--json]` | Read a user's last-online information where visible. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> settings get [--json]` | Read account settings. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> settings update --type <view_birthday\|show_online_status\|display_seen_status\|receive_message\|accept_stranger_call\|add_friend_via_phone\|add_friend_via_qr\|add_friend_via_group\|add_friend_via_contact\|display_on_recommend_friend\|archivedChatStatus\|quickMessageStatus> --value <number> [--confirm]` | Update one account setting by channel-specific setting type. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> settings language set <language> [--confirm]` | Change the account language setting. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations unread list [--json]` | List conversations marked unread. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations unread set <target> on\|off` | Mark one conversation unread or clear its unread mark. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations archive list [--json]` | List archived conversations. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations archive set <target> on\|off [--confirm]` | Archive or unarchive one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations mute list [--json]` | List muted conversations. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations mute set <target> on\|off [--duration <seconds\|until8AM\|forever>] [--confirm]` | Mute or unmute one conversation, optionally for a duration. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations pin list [--json]` | List pinned conversations. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations pin set <target> on\|off [--confirm]` | Pin or unpin one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations hidden list [--json]` | List hidden conversations. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations hidden set <target> on\|off [--confirm]` | Hide or unhide one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations hidden reset <target> [--confirm]` | Reset hidden-chat state for one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations auto-delete get <target> [--json]` | Read auto-delete chat settings for one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations auto-delete set <target> --ttl <no-delete\|one-day\|seven-days\|fourteen-days> [--type user\|group] [--confirm]` | Update auto-delete chat settings for one conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> conversations remove <target> [--confirm]` | Remove one conversation/chat. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> stickers list [--json]` | List available sticker packs/items. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> stickers search <query> [--json]` | Search stickers. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> stickers get <sticker-id> [--json]` | Fetch full sticker metadata for one sticker id; `--json` should expose the full channel payload. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> stickers send --target <target> --id <id> --category <cate-id> --type <type>` | Send a Zalo sticker using the payload fields returned by `stickers get --json`. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> stickers categories get <category-id> [--json]` | Fetch one sticker category. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> notes list [--json]` | List Zalo notes. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> notes add <group-id> --title <text> [--pin on\|off] [--confirm]` | Add a Zalo group note. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> notes update <group-id> --topic-id <topic-id> --title <text> [--pin on\|off] [--confirm]` | Update a Zalo group note. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders list [--json]` | List reminders. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders get <reminder-id> [--json]` | Fetch one reminder. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders add <target> --title <text> [--emoji <emoji>] [--at <epoch-ms>] [--repeat <mode>] [--type user\|group] [--confirm]` | Add a reminder in a user or group conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders update <target> --topic-id <topic-id> --title <text> [--emoji <emoji>] [--at <epoch-ms>] [--repeat <mode>] [--type user\|group] [--confirm]` | Update a reminder in a user or group conversation. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders remove <reminder-id> [--confirm]` | Remove one reminder. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> reminders responses list <reminder-id> [--json]` | List responses/participants for one reminder. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> quick-messages list [--json]` | List quick-message templates. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> quick-messages add --shortcut <text> --message <text> [--media <path>] [--confirm]` | Add a quick-message template. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> quick-messages update <message-id> --shortcut <text> --message <text> [--media <path>] [--confirm]` | Update a quick-message template. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> quick-messages remove <message-id> [--confirm]` | Remove a quick-message template. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> auto-replies list [--json]` | List auto-reply rules. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> auto-replies add --content <text> --enabled on\|off --start <epoch-ms> --end <epoch-ms> --scope <scope> [--user <user-id>...] [--confirm]` | Add an auto-reply rule. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> auto-replies update <reply-id> --content <text> --enabled on\|off --start <epoch-ms> --end <epoch-ms> --scope <scope> [--user <user-id>...] [--confirm]` | Update an auto-reply rule. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> auto-replies remove <reply-id> [--confirm]` | Remove an auto-reply rule. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog list [--json]` | List product/catalog groups. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog add --name <name> [--confirm]` | Add a catalog. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog update <catalog-id> --name <name> [--confirm]` | Rename/update a catalog. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog remove <catalog-id> [--confirm]` | Remove a catalog. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog products list [--json]` | List catalog products. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog products add <catalog-id> --name <name> --price <price> --description <text> [--file <path>...] [--photo-url <url>...] [--confirm]` | Add a product in a catalog. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog products update <catalog-id> <product-id> --name <name> --price <price> --description <text> --create-time <epoch-ms> [--file <path>...] [--photo-url <url>...] [--confirm]` | Update a catalog product. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog products remove <catalog-id> <product-id> [--confirm]` | Remove one catalog product. | Planned | Planned | Planned |
| `clisbot channel-native --channel zalo-personal --bot <bot-id> catalog products photos upload <path> [--json]` | Upload a product photo and return channel metadata. | Planned | Planned | Planned |

Examples for complex channel-native params:

```bash
clisbot channel-native --channel zalo-personal --bot work settings update \
  --type display_seen_status --value 0 --confirm

clisbot channel-native --channel zalo-personal --bot work conversations mute set \
  group:456 on --duration until8AM --confirm

clisbot channel-native --channel zalo-personal --bot work conversations auto-delete set \
  dm:123 --ttl seven-days --type user --confirm

clisbot channel-native --channel zalo-personal --bot work reminders add \
  group:456 --title "Check hợp đồng" --at 1779600000000 --type group --confirm

clisbot channel-native --channel zalo-personal --bot work auto-replies add \
  --content "Em đang bận, sẽ phản hồi sau." --enabled on \
  --start 1779523200000 --end 1779609600000 --scope selected --user 123 --confirm

clisbot channel-native --channel zalo-personal --bot work stickers send \
  --target group:456 --id 123 --category 456 --type 1

clisbot channel-native --channel zalo-personal --bot work messages bank-card send \
  --target dm:123 --bin-bank '{"bin":"970436","name":"Vietcombank"}' \
  --account-number 0123456789 --account-name "LONG"
```

### Phase 5: Sensitive And High-Risk Mutations

Goal: isolate hard-to-undo group power/state/membership changes and raw
payload-rewrite repair tools behind stronger confirmation and live validation.

| Command | Meaning / risk | Unit test | Integration test | E2E test |
| --- | --- | --- | --- | --- |
| `clisbot contacts labels replace --channel zalo-personal --bot <bot-id> --file <path> [--confirm]` | Advanced bulk replace for the raw `labelData[] + version` payload. This can overwrite classification state across many conversations and is reserved for backup/import repair. | Planned | Planned | Planned |
| `clisbot groups admins add --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Grant deputy/admin rights. This can change who controls moderation or settings. | Planned | Planned | Planned |
| `clisbot groups admins remove --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Remove deputy/admin rights. This can reduce another account's moderation power. | Planned | Planned | Planned |
| `clisbot groups owner transfer --channel zalo-personal --bot <bot-id> <group-id> --user <user-id> [--confirm]` | Transfer group ownership. This is highest-risk because it can remove control from the automation account. | Planned | Planned | Planned |
| `clisbot groups settings update --channel zalo-personal --bot <bot-id> <group-id> [--block-name on\|off] [--sign-admin-msg on\|off] [--set-topic-only on\|off] [--enable-msg-history on\|off] [--join-approval on\|off] [--lock-create-post on\|off] [--lock-create-poll on\|off] [--lock-send-msg on\|off] [--lock-view-member on\|off] [--confirm]` | Change group policy/settings. Bad defaults could alter who can join, post, or manage the group. | Planned | Planned | Planned |
| `clisbot groups community upgrade --channel zalo-personal --bot <bot-id> <group-id> [--confirm]` | Convert or upgrade the group into a community-style surface. Treat as structural and potentially irreversible until proven otherwise. | Planned | Planned | Planned |
| `clisbot groups leave --channel zalo-personal --bot <bot-id> <group-id> [--confirm]` | Make the automation account leave the group, which can break configured routes/loops. | Planned | Planned | Planned |
| `clisbot groups disperse --channel zalo-personal --bot <bot-id> <group-id> [--confirm]` | Disband the group. This is destructive and should need the strongest confirmation. | Planned | Planned | Planned |

Examples for sensitive params:

```bash
# Lock member-created polls while preserving normal messages.
clisbot groups settings update --channel zalo-personal --bot work 456 \
  --lock-create-poll on --confirm

# Transfer ownership only after live validation with a disposable test group.
clisbot groups owner transfer --channel zalo-personal --bot work 456 \
  --user 123 --confirm

# Raw full-payload label replace is reserved for backup/import repair workflows.
clisbot contacts labels replace --channel zalo-personal --bot work \
  --file ./zalo-labels-export.json --confirm
```

## Coverage Checklist

| Source surface | clisbot target |
| --- | --- |
| OpenClaw `zalouser` actions `send`, `image`, `link` | Current alpha text send, Phase 3 shared `--file` media and channel-native link |
| OpenClaw `zalouser` actions `friends`, `groups`, `me`, `status` | Phase 1 contacts/groups/bots me, existing `bots status` |
| OpenClaw `zalouser` reaction/typing/delivered/seen | Phase 3 message actions |
| zca-cli `auth` and `account` | Existing `bots add/login/logout/status`; no zca profile clone |
| zca-cli `msg` | Phase 3 shared `message` plus `channel-native ... messages ...` for Zalo-only shapes |
| zca-cli `friend` | Phase 1/2 `contacts` |
| zca-cli `group` | Phase 1/2 `groups` |
| zca-cli `me` | Phase 1 `bots me`, Phase 4 profile/account channel-native commands |
| zca-cli `listen` and `keep-alive` | Existing runtime listener; Phase 4 debug/channel-native listener controls only if useful |
| zca-cli `serve` REST/SSE API | Out of scope as a public clisbot command; endpoint categories map to Phases 1-4 |
| zca-cli `license` | Out of scope; clisbot uses bundled `zca-js`, not the paid `zca-cli` runtime |
| zca-js auth/session helpers | Existing alpha QR login/session file flow; no separate public auth/account command |
| zca-js broad channel-native APIs | Phase 4, marked channel-native/high-risk |
| zca-js low-level `custom` API | Out of scope as a raw CLI escape hatch; add named commands instead |

## Done Criteria

- Backlog, setup guide, CLI help, and user-guide docs agree on shipped command
  names and phase status.
- `contacts` and `groups` commands return raw ids and route-ready examples
  without mutating routes.
- Mutating contacts/groups commands require confirmation and test both accepted
  and denied confirmation paths.
- Route/auth tests prove discovery cannot bypass fail-closed DM/group defaults.
- Large-contact and large-group-list behavior is paginated or bounded.
- Channel-native commands are labeled as channel-native/high-risk in docs and help.
- Live validation is recorded before any release note claims the full surface works.
