# @getpaseo/channels-discord

The in-repo Discord channel vertical (goal ledger slice 13). Ported from
`extensions/discord/src@5d8067a4483` — see `upstream-sync.json` for the
file-by-file mapping, the deviations (`D-DC-0xx`) and what is omitted.

Third-party SDKs are upstream's, at upstream's versions: `discord-api-types`,
`ws`, `undici`, `typebox`, `mdast-util-from-markdown`. Upstream hand-rolls its
Discord REST + gateway client in `src/internal/` rather than depending on
`discord.js`; that client is carried verbatim.

## What a live test needs

Provision these yourself and put them in the repo-root `.env`. This package
never reads `.env` and no value here is a real credential — only names.

### Discord application

1. Create an application at <https://discord.com/developers/applications>, add a
   Bot user, and copy its token into `DISCORD_BOT_TOKEN`. The application id is
   decoded from the token, so `applicationId` in config is only needed when REST
   application lookup is blocked.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content
   Intent**. Without it Discord delivers empty `content` for guild messages the
   bot is not mentioned in, and only mention-addressed traffic works.
   **Server Members** and **Presence** stay off — the vertical does not request
   them unless `channels.discord.accounts.<id>.intents` asks.
3. Under **OAuth2 → URL generator**, select scopes `bot` and
   `applications.commands`, then bot permissions:
   - View Channels, Send Messages, Send Messages in Threads
   - Create Public Threads, Manage Threads
   - Embed Links, Attach Files, Read Message History
   - Add Reactions, Manage Messages (needed for pin/unpin and delete)
   - Use External Emojis (only for `discord.emoji-list` across guilds)
4. Invite the bot to a test guild with the generated URL.

### Test surfaces

| Env var                    | What it must be                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`        | The bot under test. Never the driver account.                                         |
| `DISCORD_TEST_GUILD_ID`    | The guild the bot was invited to.                                                     |
| `DISCORD_TEST_CHANNEL_ID`  | A guild **text** channel the bot can read and post in.                                |
| `DISCORD_TEST_THREAD_ID`   | A thread under that channel (a Discord thread is itself a channel id).                |
| `DISCORD_TEST_DM_USER_ID`  | The user id the bot opens a DM with. That user must share the guild with the bot.     |
| `DISCORD_TEST_BOT_USER_ID` | The bot's own user id, for the `<@id>` mention marker and the own-message filter.     |
| `DISCORD_DRIVER_BOT_TOKEN` | A **second** bot, used only as the external sender. Never configure the host with it. |

The driver/bot-under-test split is the same rule the Telegram vertical follows
(CLAUDE.md, "Required Slack and Telegram E2E roles"): a direct `sendText` is an
outbound smoke test only. The required proof is external sender → gateway →
agent turn → reply in the same conversation, then a REST read-back
(`GET /channels/{id}/messages`) matching the returned message id.

### Minimal account config

```yaml
channel: discord
accountId: main
connectionId: <hub connection id>
transport: { mode: gateway }
routes:
  - match: { kind: dm }
    agent: <agent>
    environment: <environment>
  - match: { kind: channel, ids: ["<DISCORD_TEST_CHANNEL_ID>"] }
    agent: <agent>
    environment: <environment>
```

The bot token lives in the Hub connection's credentials under `token`, not in
this file.

## Supported today

Inbound (`MESSAGE_CREATE` over the gateway): DM, guild text channels and threads;
mention detection (explicit `<@id>` mention or a reply to the bot); own-message
and bot-author filtering; durable admission into the Hub ingress queue keyed on
the Discord message id, so a gateway RESUME redelivery is dropped rather than
replayed.

Outbound: text with upstream's markdown rendering, chunking and mention
rewriting; files of any type (one message per file, size-gated); message edit
and delete; pin/unpin/list-pins; reactions (add, remove, list); thread create
and thread reply; polls; stickers; emoji upload and `emoji-list`; webhook sends;
embeds and message components (buttons, selects) including the presentation
adapter; typing indicator; guild/channel/member/role reads and the guild-admin
actions upstream gates behind a trusted requester.

## Not supported yet

Named here so nothing above is read as more than it is.

- **Voice messages and voice channels** — `send.voice.ts`, `voice-message.ts` and
  the whole `src/voice` tree are omitted (ffmpeg/opus transcoding,
  `@discordjs/voice`). The `send` action's `asVoice` branch throws (D-DC-004).
- **Activities** — `src/activities` needs a public endpoint the Hub does not
  expose.
- **Slash commands and interaction callbacks** — command deploy and interaction
  dispatch are carried in `src/internal`, but nothing registers or routes them
  yet; button and select clicks do not reach the Hub.
- **Inbound reactions, message edits/deletes, attachments** — the gateway
  transport only normalizes `MESSAGE_CREATE`. Inbound media is not downloaded.
- **Gateway proxy** — a configured `proxy` is refused loudly rather than
  silently ignored (D-DC-008).
- **Setup/doctor surfaces** — the OpenClaw wizard and `doctor` trees are omitted;
  the Hub owns onboarding.
