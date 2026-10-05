# `/status` and `/me`: ids for anyone, more for each standing (2026-10-05)

Decision record. Status: decided and built 2026-10-05 (hub:
`channels/commands-caller.ts`, the public-command branch of
`channels/execution.ts`, `accessGateAllows` in `channels/policy/gate.ts`,
`interaction.publicCommands` in `channels/config/schema.ts`). Amends
[2026-09-18 chat authority](2026-09-18-channel-chat-authority-and-limits.md),
which listed `/status` among the commands a sender needs chat authority for.

## Context

A Rule names conversations (Where) and senders (Who) by the provider's ids:
`C0123` for a Slack channel, `-1001…` for a Telegram group, `slack:U0…` or
`telegram:4242` for a person. People asking for access, and the admins
granting it, had no easy way to find them. The Route form's pickers list only
what the ingress queue still holds, often without a name, and a chat the bot
never heard from is not there at all.

`/me` already answered anyone and printed the sender's identity. `/status` sat
behind the Route's gates, so the sender who most needed the ids, one no Rule
admits, got silence or "Sender may not control this conversation."

## Decision

Both commands are public. The tier is decided by the caller's standing, not by
which command they typed. `/me` is about you; `/status` is about this chat.

| Standing                                           | `/me`                                 | `/status`                                                                   |
| -------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Anyone (not admitted, or no Route serves the chat) | Your ID, whether you are linked, a no | The chat ID and thread/topic ID, a no                                       |
| Admitted by the Route, not linked to a Hub Member  | Your ID, a yes                        | Adds: whether a mention is needed, and whether the bot is working or idle   |
| Admitted **and** linked to a Hub Member            | Adds: your privileges here            | Adds: agent, model, context, pending approvals, session links (or the runs) |
| Connection manager (`channel.manage`)              | Adds: why you are refused             | Adds: which Route serves the chat, and why the sender is refused            |

- **Session details need both.** A linked Member is shown the session only
  where a Rule admits them. The session belongs to the Route, not to the
  account. An admitted guest sees one line: working or idle. Before this, a
  Guest given chat authority saw the whole session.
- **A no is the same for every reason.** "No Route serves this chat", "no Rule
  lets you in" and "the access list wants pairing" all read "You can't talk to
  the bot here". The reason, the Route, its Rules and who they admit are a
  manager's to see. Telling a stranger which reason applies tells them what to
  impersonate or which chat to get into.
- **The gates are the real ones, dry-run.** `resolveCommandCaller` runs
  `accessGateAllows` (the `access:` block without minting a pairing request)
  and `mayUseChannelRoute`. A second, report-only evaluator would drift from
  the one that decides messages. Nothing is recorded, no execution slot is
  taken, no binding is created. A lookup that fails answers as the
  least-trusted caller.
- **Only the caller's own id.** `/me` never prints anyone else's. In a group
  on a channel where members cannot see each other's ids (Telegram, Zalo,
  Feishu, Google Chat), `/me` withholds the id and asks for a DM. Slack and
  Discord show ids to members already.
- **Strangers are throttled.** A sender the Route does not admit gets one
  answer per command per 30 seconds (in memory, per plane). Admitted senders
  and managers are not throttled. Per command, so a stranger still gets both
  ids an admin needs.
- **A Connection can stay silent.** `defaults.interaction.publicCommands:
false` (organization or Connection; a Route does not author it) makes
  `/help`, `/me` and `/status` answer only admitted senders and managers. The
  default is on. Set it in the Connection's Advanced YAML.

## Options considered

- **Extend only `/me`.** Rejected: whether the command is gated is not a
  property of the command. Tiering by standing works for both, and `/status`
  is the word people try first.
- **Show the refusal reason to everyone.** Rejected for the reconnaissance
  reason above.
- **Reply privately (Slack ephemeral, DM).** Rejected: a reply anywhere but
  the conversation reads as the bot ignoring the command. Withholding a
  non-visible id in groups covers the privacy case.

## What it does not fix

A chat the bot receives no events from (a Slack channel it was not invited
to) answers nothing, and does not appear in the pickers. Invite the bot first.
