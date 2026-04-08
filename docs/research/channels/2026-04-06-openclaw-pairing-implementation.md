# OpenClaw Pairing Implementation

## Summary

This research captures how OpenClaw implements pairing for messaging channels.

Main conclusion:

- OpenClaw pairing is primarily a DM access-control mechanism, not a session or agent concept
- unknown DM senders are blocked before normal routing and receive a short approval code when the channel policy is `pairing`
- approval writes the sender identity into a local allowlist store
- the core design is shared across channels through one pairing store plus channel-specific adapters
- pairing approval is channel-wide, not per-agent and not per-session

## Important Default Posture

OpenClaw default posture is:

- DM: `pairing`
- shared channels or groups: `allowlist`
- allowed shared channels or groups: `requireMention: true` unless a route overrides it

Important Slack nuance:

- Slack DM default is still clearly `pairing`
- Slack `groupPolicy` falls back to `open` only when `channels.slack.groupPolicy`, `channels.defaults.groupPolicy`, and `channels.slack.channels` are all absent
- this is a sparse-config runtime fallback, not the main secure posture shown in OpenClaw docs and examples

For `muxbot`, the OpenClaw-compatible default target should be:

- Slack and Telegram direct messages default to `pairing`
- shared channel and group routes stay `allowlist`
- per-route mention gating stays `requireMention: true` by default on shared surfaces

This note focuses on DM pairing for chat channels, not node or device pairing.

## Source Baseline

Local OpenClaw reference used for this analysis:

- repo: `https://github.com/openclaw/openclaw/tree/develop`
- branch: `develop`
- commit: `e78ae48e69`

Important constraint:

- this note is truthful to the local checkout above plus its docs
- if strict parity with latest OpenClaw `main` becomes important before implementation work starts, pairing should be re-checked on `main` first

## Scope

This note covers:

- what pairing means in OpenClaw
- where pairing state is stored
- how pending pairing requests are created and approved
- how channels plug into the shared pairing system
- what this means for `muxbot`

This note does not define final `muxbot` behavior yet.

## Key Sources

- [OpenClaw Pairing Overview](https://github.com/openclaw/openclaw/blob/develop/docs/start/pairing.md)
- [OpenClaw README DM pairing notes](https://github.com/openclaw/openclaw/blob/develop/README.md)
- [OpenClaw Pairing Store](https://github.com/openclaw/openclaw/blob/develop/src/pairing/pairing-store.ts)
- [OpenClaw Pairing Messages](https://github.com/openclaw/openclaw/blob/develop/src/pairing/pairing-messages.ts)
- [OpenClaw Pairing Labels](https://github.com/openclaw/openclaw/blob/develop/src/pairing/pairing-labels.ts)
- [OpenClaw Pairing Plugin Registry](https://github.com/openclaw/openclaw/blob/develop/src/channels/plugins/pairing.ts)
- [OpenClaw Channel Pairing Adapter Type](https://github.com/openclaw/openclaw/blob/develop/src/channels/plugins/types.adapters.ts)
- [OpenClaw Pairing CLI](https://github.com/openclaw/openclaw/blob/develop/src/cli/pairing-cli.ts)
- [OpenClaw Slack pairing gate](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/message-handler/prepare.ts)
- [OpenClaw Telegram pairing gate](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot-message-context.ts)
- [OpenClaw Discord slash pairing gate](https://github.com/openclaw/openclaw/blob/develop/src/discord/monitor/native-command.ts)
- [OpenClaw Pairing Store Tests](https://github.com/openclaw/openclaw/blob/develop/src/pairing/pairing-store.test.ts)
- [OpenClaw Pairing CLI Tests](https://github.com/openclaw/openclaw/blob/develop/src/cli/pairing-cli.test.ts)

## What Pairing Means In OpenClaw

OpenClaw uses the word "pairing" in two separate places:

1. DM pairing
2. node or device pairing

For chat channels, the relevant one is DM pairing.

DM pairing means:

- the channel DM policy is `pairing`
- an unknown sender is not allowed to talk to the bot yet
- OpenClaw creates a short-lived pending request
- the sender receives a pairing code
- the owner later approves that code through the CLI
- approval adds the sender to a local allowlist store

The key point is:

- pairing is an inbound access gate
- it happens before normal agent routing or session processing

## Where Pairing Sits In The System

OpenClaw pairing is shared infrastructure with channel-specific edges.

The split is:

- shared core:
  - pending request store
  - allowlist store
  - code generation
  - TTL and max-pending enforcement
  - CLI list and approve
- channel-specific logic:
  - how sender ids are identified
  - how allowlist entries are normalized
  - how the pairing reply is sent
  - optional approval notification
  - which DM or command paths are gated

This is why the system uses a pairing adapter interface instead of hardcoding every provider in the store.

## Shared Pairing Store

OpenClaw stores pairing state under:

- `~/.openclaw/credentials/<channel>-pairing.json`
- `~/.openclaw/credentials/<channel>-allowFrom.json`

Current properties of the shared store:

- channel-wide file naming
- JSON file persistence
- atomic file writes
- file locking with `proper-lockfile`
- expiration pruning on read and write
- capped pending queue size

Important consequence:

- pairing state is keyed by channel only
- it is not keyed by agent id
- it is not keyed by account id
- it is not keyed by session key

That means OpenClaw DM pairing approval is effectively provider-wide for that installation.

Example:

- approving one Slack user writes to `slack-allowFrom.json`
- the approval is not isolated to one Slack route or one agent

## Pairing Request Model

Each pending request contains:

- `id`
- `code`
- `createdAt`
- `lastSeenAt`
- optional `meta`

Current behavior from the store implementation:

- codes are 8 characters
- alphabet excludes ambiguous characters such as `0`, `O`, `1`, and `I`
- pending requests expire after 1 hour
- pending requests are capped at 3 per channel

## Upsert Behavior

`upsertChannelPairingRequest(...)` is the main entry point when an unknown sender hits a `pairing` gate.

Important behavior:

- if the same sender already has a non-expired pending request:
  - OpenClaw reuses the existing code
  - returns `created: false`
- if the sender is new and capacity is available:
  - OpenClaw creates a new code
  - returns `created: true`
- if capacity is exhausted:
  - OpenClaw returns no usable new code
  - the new request is not added

This matters because OpenClaw intentionally avoids spamming the same user with a new pairing code on every message.

The channel code usually sends the pairing reply only when `created === true`.

## Approval Behavior

`approveChannelPairingCode(...)` does three things:

1. look up the code inside the pending store
2. remove the matching pending request
3. add the sender id into the channel allowlist store

If the code is not found or already expired:

- approval returns `null`

This is a clean one-way flow:

- pending request
- approval
- allowlist entry

There is no special per-session binding after approval.

## Channel Pairing Adapter Contract

OpenClaw channel plugins can declare pairing support through `plugin.pairing`.

The pairing adapter exposes:

- `idLabel`
- optional `normalizeAllowEntry`
- optional `notifyApproval`

That means channels can customize:

- how the sender id is shown in CLI tables
- how allowlist entries are normalized before storage
- whether the requester can be notified after approval

This is the main reason OpenClaw can share one pairing store across core channels and extension channels.

## CLI Pairing Flow

OpenClaw exposes:

- `openclaw pairing list <channel>`
- `openclaw pairing approve <channel> <code>`

Current CLI behavior:

- lists pending requests in a table
- uses the channel adapter's `idLabel`
- supports `--json`
- supports `--notify` on approval
- supports extension channels outside the core registry if the channel name passes validation

The approval path can optionally call the channel adapter's `notifyApproval(...)`.

So OpenClaw pairing approval is not only storage mutation.

It can also trigger a channel-native acknowledgement when the channel supports it.

## How Slack Uses Pairing

In Slack DM handling, OpenClaw does this:

1. check DM enabled and DM policy
2. if policy is not `open`, resolve effective allowlist
3. if sender is not allowed and policy is `pairing`:
   - create or reuse a pending pairing request for the Slack user id
   - include sender name in `meta`
   - if `created === true`, send a DM pairing reply with the code
   - drop the original user message

Important details:

- the blocked message is not processed
- pairing is checked before normal route/session resolution
- the stored identifier is the Slack user id

## How Telegram Uses Pairing

In Telegram DM handling, OpenClaw does this:

1. check DM policy
2. if policy is not `open`, resolve allowlist match from sender id or username
3. if sender is not allowed and policy is `pairing`:
   - create or reuse a pending pairing request for the Telegram user id
   - include username and name fields in `meta`
   - if `created === true`, send a pairing reply
   - drop the original user message

Important detail:

- Telegram pairing explicitly stores the user id, not the chat id

## Default Sources

The default-policy evidence used in this note is:

- Slack DM default `pairing`: [slack.md](https://github.com/openclaw/openclaw/blob/develop/docs/channels/slack.md)
- Slack provider fallback behavior: [provider.ts](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/provider.ts)
- Slack channel mention default `true`: [channel-config.ts](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/channel-config.ts)
- Telegram DM default `pairing` and group default `allowlist`: [telegram.md](https://github.com/openclaw/openclaw/blob/develop/docs/channels/telegram.md)

## How Discord Uses Pairing

Discord uses the same pairing store for DM slash command authorization.

In the native command path:

1. check DM policy
2. resolve effective allowlist
3. if sender is not permitted and policy is `pairing`:
   - create or reuse a pending request keyed by Discord user id
   - include tag and display name in `meta`
   - if newly created, send an ephemeral pairing reply
   - reject the command

This is useful because it shows pairing is not tied only to plain text DM message handlers.

It can also gate command surfaces.

## Default Policy Direction

OpenClaw README and docs describe `pairing` as the secure default for major chat channels.

That means:

- DMs are locked down by default
- unknown senders are not silently accepted
- approval is explicit

This is a strong product stance:

- pairing is part of the security posture
- not just an onboarding convenience

## What OpenClaw Pairing Is Not

OpenClaw pairing is not:

- per-agent access control
- per-thread access control
- per-session access control
- a conversation resume mechanism
- a memory or context boundary

It is better understood as:

- channel-level inbound identity approval

## Implications For muxbot

If `muxbot` wants OpenClaw-compatible pairing, the closest truthful model is:

- pairing belongs under channels and access control
- pairing approval should happen before session routing and runner creation
- the store should be shared per channel or per provider surface
- approval should populate a durable sender allowlist store
- channel-specific logic should stay limited to:
  - sender identity extraction
  - message formatting
  - allow-entry normalization
  - optional approval notification

## Design Questions For muxbot

Before implementing pairing, these choices should be made explicitly:

1. Should pairing be global per channel like OpenClaw, or scoped more narrowly by account or route?
2. Should Slack and Telegram both default to `pairing` for DMs, or should muxbot keep its current more permissive DM defaults?
3. Should approval be CLI-only at first, or should muxbot also expose control commands or API endpoints for approval?
4. Should pairing support only DM message surfaces first, or also slash command surfaces such as Slack slash commands?

## Practical Takeaway

The clean OpenClaw insight is:

- pairing is a shared access-control subsystem with channel adapters
- not a channel-specific hack
- not an Agent-OS session feature

That is the part worth bringing into `muxbot` if pairing work starts later.
