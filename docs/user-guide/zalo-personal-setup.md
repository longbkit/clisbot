# Zalo Personal Setup

## Purpose

Use this guide for the experimental `zalo-personal` channel.

This channel uses an unofficial Zalo Web personal-account session through
`zca-js`. It is useful for local alpha testing, but it is not an official Zalo
Bot or Official Account integration.

## Safety Notes

- Use a separate phone number and Zalo account for automation.
- Zalo Personal login is QR-only in clisbot.
- `--qr-path` only saves a copy of the QR image; clisbot still prints the QR in
  the console.
- The command stays attached until QR login succeeds, fails, or times out.
- Run only one active listener per Zalo account. Multiple `zalo-personal` bots
  are stable only when they use separate Zalo accounts and separate
  `tokenFile` session paths.

## First Start

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
- stores the auth/session data through the existing `tokenFile` path contract
- prints the QR in the terminal
- saves the same QR image when `--qr-path` is provided
- starts the listener after login succeeds

Without `--confirm`, clisbot prints an English and Vietnamese warning and asks
for explicit approval before continuing.

## Add Another Account

Use a second bot id for a second Zalo Personal account:

```bash
clisbot bots add \
  --channel zalo-personal \
  --bot work \
  --qr-path ./zalo-work-qr.png \
  --agent default \
  --confirm
```

The bot id is the local account identity. Do not add another public account
label; use `--bot <id>`.

## Login, Logout, And Status

```bash
clisbot bots login --channel zalo-personal --bot work --qr-path ./zalo-work-qr.png --confirm
clisbot bots logout --channel zalo-personal --bot work
clisbot bots status --channel zalo-personal --bot work
clisbot bots get-credentials-source --channel zalo-personal --bot work
```

`bots status` reports whether the local session file is present and whether the
runtime has a current connection health record. It does not expose session file
contents.

`bots logout` removes the local auth/session file. If the selected bot is still
connected in the running runtime, restart or reload clisbot to close that
listener.

## Routes

Zalo Personal should fail closed on a personal account. Do not open every DM or
group by default when the account may have many friends or group memberships.

Add explicit DM routes for users that should be able to pair or interact:

```bash
clisbot routes add --channel zalo-personal dm:<user-id> --bot work --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy` is only the summary for the DM wildcard route. The actual DM routing
surface is `directMessages`: with the default `dmPolicy: "disabled"` and
`directMessages: {}`, Zalo Personal does not reply to any DM. If
`directMessages["*"]` exists, that wildcard route is the readable source of
truth and `dmPolicy` should match it. For example, `directMessages["*"].policy:
"pairing"` means every DM may enter the pairing flow; `dmPolicy` should read
`"pairing"`, not `"disabled"`.

Add explicit routes when needed:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot work --require-mention true
```

Current alpha does not expose a read-only discovery CLI for Zalo friend or group
ids yet. Do not open `dm:*` or `group:*` just to discover ids on a personal
account with a large contact graph. The planned follow-up is the bot-scoped
[`contacts` and `groups` tool surface](../tasks/features/channels/2026-05-18-zalo-personal-contacts-groups-and-full-tool-surface.md),
which should list ids from the existing QR session without mutating routes or
replying to chats.

Queue and loop examples:

```bash
clisbot queues create --channel zalo-personal --bot work --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot work --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

## Current Alpha Scope

Implemented first slice:

- config seam and template defaults under `bots.zaloPersonal`
- QR login through `start`, `bots add`, and `bots login`
- logout and status
- text send to DM/group targets
- listener-based inbound text handling for DMs and groups

Not yet release-ready:

- live Zalo account validation
- broader contacts/groups discovery, media parity, and native Zalo Personal
  commands; those are tracked in the linked full-surface task
- official Zalo support guarantees
