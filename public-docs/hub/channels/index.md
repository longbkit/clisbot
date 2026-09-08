---
title: Hub channels
description: The seven chat platforms a Hub can run an agent in, what each one can do, and which capabilities have live evidence.
nav: Channels
order: 81
category: Hub
---

# Channels

A channel puts an agent in a chat platform. Someone mentions the bot in Slack, DMs it on Telegram, or messages it in a Feishu group; Hub routes that conversation to an agent on one of your daemons and posts the answer back into the same conversation.

```text
Slack / Telegram / Discord / Google Chat / Feishu / Zalo
        │
        ▼
      Hub  ──►  daemon  ──►  agent session
        ▲                        │
        └──────── reply ─────────┘
```

Three resources make that work, and they are separate on purpose:

- A **Connection** owns the credential — one Slack workspace installation, one bot token, one linked Zalo account. Hub encrypts it and never shows it again.
- A **Channel account** is the behaviour attached to that Connection: transport settings, ordered Routes, access, reply synchronization.
- A **Route** picks what a matching conversation runs — a direct agent, or an Automation. First match wins.

[How Hub works](/docs/hub/concepts) covers the resource model. This section covers the platforms.

## The seven channels

| Channel                                      | Credential                                 | Inbound transport                  | Needs a public HTTPS URL |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------- | ------------------------ |
| [Slack](/docs/hub/channels/slack)            | Bot token + app token                      | Socket Mode, or Events API webhook | Webhook only             |
| [Telegram](/docs/hub/channels/telegram)      | Bot token                                  | Bot API polling, or webhook        | Webhook only             |
| [Discord](/docs/hub/channels/discord)        | Bot token                                  | Gateway                            | No                       |
| [Google Chat](/docs/hub/channels/googlechat) | Service-account JSON                       | HTTP webhook                       | **Yes, always**          |
| [Feishu / Lark](/docs/hub/channels/feishu)   | App ID + app secret (+ webhook secrets)    | Long connection, or webhook        | Webhook only             |
| [Zalo Official Bot](/docs/hub/channels/zalo) | Bot token                                  | Bot API polling, or webhook        | Webhook only             |
| [Zalo Personal](/docs/hub/channels/zalouser) | A QR-linked session for a personal account | Push socket                        | No                       |

Zalo Personal is the odd one: there is no token to paste. You link it by scanning a QR code with a phone, and the session expires and has to be relinked. Everything that account can do, a human on that account can do. Read its page before you use it.

## Capability matrix

What each vertical implements. A blank cell means the platform or the vertical has no such thing; footnoted cells work with a restriction.

| Capability            | Slack | Telegram | Discord | Google Chat | Feishu | Zalo Bot | Zalo Personal |
| --------------------- | ----- | -------- | ------- | ----------- | ------ | -------- | ------------- |
| Text messages         | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Threads               | ✅    | ✅       | ✅      | ✅          | ✅     |          |               |
| Mentions              | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Rich formatting       | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Long-message chunking | ✅    | ✅       | ✅      | ✅          | ✅     | ✅       | ✅            |
| Media                 | ✅    | ✅       | ✅      |             |        | ¹        | ✅            |
| File attachments      | ✅    | ✅       | ✅      |             |        |          | ✅            |
| Reactions             | ✅    | ✅       | ²       |             | ✅     |          | ✅            |
| Edit messages         | ✅    | ✅       | ✅      | ✅          | ✅     |          |               |
| Delete messages       | ✅    | ✅       | ✅      | ✅          |        |          |               |
| Voice messages        | ✅    | ✅       |         |             |        |          | ✅            |
| Video                 | ✅    | ✅       |         |             |        |          |               |
| Video notes           |       | ✅       |         |             |        |          |               |
| Location              |       | ✅       |         |             |        |          |               |
| Polls                 | ✅    | ✅       | ✅      |             |        |          |               |
| Forum topics          |       | ✅       |         |             |        |          |               |
| Tables and charts     | ✅    | ✅       | ✅      |             |        |          |               |
| Buttons               | ✅    | ✅       | ✅      | ³           | ⁴      |          |               |
| Select menus          | ✅    | ✅       | ✅      | ³           | ⁴      |          |               |
| Approval prompts      | ✅    | ✅       |         |             |        |          |               |
| Native commands       | ✅    | ✅       | ⁵       |             |        |          |               |
| Group DMs             | ✅    |          |         |             | ✅     |          |               |
| Emoji discovery       | ✅    | ✅       | ✅      |             |        |          |               |

¹ Inbound images only; the Zalo Bot API has no upload endpoint.
² Outbound reactions only; inbound reaction events are not wired yet.
³ Card clicks arrive inbound; Hub renders no card of its own.
⁴ Card clicks arrive inbound; Hub renders no Lark card of its own.
⁵ Slash commands and interaction callbacks are not wired yet.

The same matrix appears per account under **Channels → Catalog** in the Paseo app, where a claimed capability shows as **Not verified** until the account has actually exercised it. The catalog is a claim; a green check in the app means evidence.

## Commands in a conversation

The same verbs work on every channel, with or without a leading `/`, and with or without a mention in front. An addressed `@bot /new` and a Telegram-style `/new@yourbot` both normalize to the same command.

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `/new`, `/reset`    | Start a fresh agent session for this conversation. |
| `/stop`, `/cancel`  | Stop what the agent is doing.                      |
| `/status`, `/state` | Report what the conversation is bound to.          |
| `/help`             | List the commands.                                 |
| `/agent <name>`     | Switch this conversation to another agent.         |
| `/model <name>`     | Switch this conversation to another model.         |
| `/approve`, `/deny` | Answer a pending permission request.               |

Approve and deny also arrive as button presses where the platform has buttons.

`/agent` and `/model` only offer what the route lists:

```yaml
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker
    environment: repo
    agents: [reviewer] # plus `worker`, the route's own — always offered
    models: [gpt-5.6-luna, claude-sonnet-4.6]
```

A route that lists neither refuses both commands. A bare `/model` prints the
menu. Switching ends the running session, because an agent's model is fixed when
it starts; the next message opens a session on the new choice, and the choice
outlives `/new`.

## Who may do what

Four roles, worked out per conversation from the identities and roles you
already configured — there is no separate roster to maintain.

| Role     | Who it is                                                     | May                                                              |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `owner`  | Whoever started this conversation's session, or a `*` grant.  | Everything below, plus `/stop`, `/new`.                          |
| `admin`  | Anyone holding an `approval.*` privilege on the route.        | Answer approvals, `/agent`, `/model`, and stop anyone's session. |
| `member` | A linked identity with `bot.interact`.                        | Chat, `/status`.                                                 |
| `guest`  | Admitted by an open-audience route or by the allowlist below. | Chat.                                                            |

Commands never need a mention. `requireMention` decides when a plain message
wakes the agent; it has nothing to say about someone controlling a session they
are allowed to control.

## Allowlists, pairing, and who may talk to the bot

`access:` is the sender gate. It uses OpenClaw's names and semantics, so an
account file written for OpenClaw works unchanged, and it is authorable at any
layer — organization policy, account, or a single route:

```yaml
defaults:
  access:
    dmPolicy: pairing # open | pairing | allowlist | disabled
    groupPolicy: allowlist # open | allowlist | disabled
    allowFrom: ["U0ALICE"] # `*` admits anyone
    groupAllowFrom: ["U0ALICE", "U0BOB"] # falls back to allowFrom when absent
    deniedReply: "Ask an operator for access." # omit to refuse silently
```

Omit the whole `access:` block and nothing is gated by it — the Hub's own roles
decide, exactly as they did before the block existed. Add one leaf and the gate
runs in front of them: both have to allow.

A refused sender never reaches an agent. The refusal is recorded in channel
activity with its reason (`dm_policy_not_allowlisted`, `group_policy_disabled`,
…) and answered only if you set `deniedReply`.

### Pairing

With `dmPolicy: pairing`, an unknown sender's first DM gets a six-character code
instead of an agent, and you decide:

```sh
curl -H "authorization: Bearer $KEY" \
  "$HUB/api/management/organizations/$ORG/channel-accounts/telegram/support/pairing"

curl -X POST -H "authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"senderIdentity":"telegram:77001"}' \
  "$HUB/api/management/organizations/$ORG/channel-accounts/telegram/support/pairing/approve"
```

`.../pairing/deny` is the other half. Approving adds the sender to that
account's allowlist; denying is final — a denied sender is never handed a new
code. The code is a handle so you can tell two strangers apart, not a secret:
knowing it grants nothing.

The requests belong to one organization and one account. Approving someone on
one account does not admit them on another, and never on another organization's.

## Files the agent sends

One tool sends both. The agent's `message` tool takes attachments alongside the
text — one file or many, any type, in the order it names them. Each file becomes
its own post in the same conversation, so a reply that says "here is the report"
and attaches it arrives as two messages, not one.

A file has to live under the Project the session is bound to. A path outside it
is refused and the agent is told why; the same goes for a file over the
channel's upload cap (Telegram 50 MB, Slack 250 MB, Discord 10 MB), which posts
a visible notice in place of the file rather than dropping it silently.

Channels with no upload endpoint — Google Chat, Feishu, Zalo Bot — refuse the
attachment by name. See each channel's page.

## Manage accounts from the CLI

Four verbs, all against a running Hub:

```sh
paseo channels add <channel> --account <id> [--connection-id <uuid> | --secret-file <path>]
paseo channels ls
paseo channels status
paseo channels rm <channel> --account <id> --yes
```

`add` never takes a credential on the command line — a secret in argv lands in `ps` output and shell history. Pass a file and delete it afterwards. Each channel's page shows the file shape it expects.

`status` adds the pin, integrity, and load-trace columns to what `ls` shows, and is the first thing to run when an account is not behaving.

`rm` drops the account from the channel configuration and stops its transport. It refuses without `--yes`. The Connection holding the credential stays — another account can be using it — and `rm` prints its id so you can retire it from the app.

`ls` also answers to `list`, the name it shipped under.

All four accept `--hub <origin>` to target a Hub other than the local one (with `--api-key`), `--home <path>` to pick a different Clisbot home, and `--json`.

## Verified live

A capability is only "verified live" when a message from a real account on the real platform reached an agent and the agent's answer came back to the same conversation, read back through the platform's own API.

| Channel           | Live evidence                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Slack             | Yes — mention → reply in thread, long chunked replies, outbound files (2026-09-07).                            |
| Telegram          | Yes — mention → reply, forum topics, files in and out, edit and poll actions, `/new` and `/stop` (2026-09-07). |
| Discord           | No. Tested against a simulated platform only; needs a bot token and a test guild.                              |
| Google Chat       | No. Blocked on a public HTTPS endpoint and Workspace admin approval.                                           |
| Feishu / Lark     | No. Tested against a faked Lark SDK client only; needs Lark app credentials.                                   |
| Zalo Official Bot | No. Polling E2E is runnable with a bot token and a human sender; not yet run.                                  |
| Zalo Personal     | No. Needs a human to scan a QR code.                                                                           |

Each channel page carries its own per-capability line. The running record of what passed and what failed, with message ids, is `docs/tests/channels/p0-live-scenarios.md` in the repository.

## Before you connect one

A channel is an untrusted input. Anyone who can post in a conversation your Route matches can send text to an agent that has a working directory, a shell, and network access. Read [Hub security](/docs/hub/security) and set the account's access rules before you point a Route at a real project.
