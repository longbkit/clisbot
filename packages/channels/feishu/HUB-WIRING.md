# Hub wiring for `@getpaseo/channels-feishu`

Slice 15 built the vertical; **slice 15b wired it into the Hub** (2026-09-07).
The sections below are the contract that wiring was written against, kept as the
reference for the next change. Three things ended up different from the text:

- **Long connection only, at compile.** Both transports are catalogued, but
  `config/compile-support.ts` refuses `transport.mode: webhook`: the Hub
  publishes no public HTTPS URL and the long connection needs none. The Hub's
  compiled transport also decides `connectionMode`, so an authored value cannot
  contradict it.
- **The tools are taken from the LOADED plugin, not imported.** §7 names
  `registerFeishuTools(registrar, …)` as the entry point; the Hub reaches the
  same functions through `plugin.agentTools` on the vertical the loader already
  loaded (`packages/hub/src/channels/channel-agent-tools.ts`), because Hub
  production code never imports a channel package. Everything else in §7 holds:
  `collect` is re-run against the account's live `cfg` on every list AND every
  call, factories are built per execution with the Hub's
  `OpenClawPluginToolContext`, `feishu_perm` appears only when the account sets
  `tools.perm`, and the result's untrusted-content markers are passed through.
- **The credential is probed before it is stored.** `feishu_connections`
  (migration `0069`) holds the four fields; the Hub mints a tenant access token
  and reads `/open-apis/bot/v3/info`, pinned to this package's `probe.ts` by a
  differential test that drives both over the same fake open platform.

Install: `paseo channels add feishu --account <id> --secret-file <path>`, where
the file is `{"appId": "…", "appSecret": "…", "verificationToken": "…",
"encryptKey": "…", "domain": "feishu|lark"}`.

Every field name below is one the vertical already reads at runtime.

## 1. Catalog entry (`packages/hub/src/channels/catalog.ts`)

The `feishu` entry exists with `status: "planned"`. Change:

| Field          | Now                                                             | Must become                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `"planned"`                                                     | `"in-repo"`                                                                                                                                                                                                                                                                                           |
| `transports`   | one `webhook` transport                                         | **two**: `websocket` (long connection, the default, needs no public URL) and `webhook` (event subscription, needs a public HTTPS URL). See §2.                                                                                                                                                        |
| `capabilities` | includes `approval`, `native-actions`, `media`, `file`, `voice` | drop `approval` and `native-actions`; keep `buttons`/`select` as _inbound_ card clicks only — the vertical decodes them (`card-interaction.ts`) but the Hub does not yet render a Lark card. Drop `media`, `file`, `voice`: inbound media download and outbound upload land with the Hub media slice. |
| `extraTools`   | `feishu_bitable` (collapsed)                                    | the eight real names (`feishu_bitable_create_app`, `…_create_field`, `…_create_record`, `…_get_meta`, `…_get_record`, `…_list_fields`, `…_list_records`, `…_update_record`) — the collapsed name is not a registered tool.                                                                            |
| `notes`        | one note                                                        | add: "Message actions: send, thread-reply, read, edit, pin, unpin, list-pins, member-info, channel-info, plus react/reactions when `actions.reactions` is on. Inbound: message, callback (card click), member. No sticker, no upload-file, no inbound media download yet."                            |

Adding `feishu` to `SUPPORTED_CHANNEL_NAMES` is automatic once `status` is
`"in-repo"`, since 13b derived that union from the catalog.

## 2. Transports and required config

The vertical picks its mode from `connectionMode` (`src/fusion/webhook-session.ts`
`resolveFeishuConnectionMode`), default `websocket`.

```jsonc
transports: [
  {
    id: "websocket",
    label: "Long connection",
    requiredConfig: ["appId", "appSecret"],
    setup: "Create a Feishu/Lark custom app, add the bot, and enable Event subscription -> Use long connection.",
  },
  {
    id: "webhook",
    label: "Event subscription webhook",
    requiredConfig: ["appId", "appSecret", "verificationToken", "encryptKey"],
    setup: "Publish a public HTTPS URL for the app's request URL and copy the verification token and encrypt key.",
  },
]
```

`encryptKey` must become `required: true` for the webhook transport: the ported
transport signs every inbound request with it and `startFeishuAccount` refuses
to start a webhook account without one. It stays optional for `websocket`.

## 3. Pin (`packages/hub/channel-pins.json`)

Add, mirroring the Discord and Google Chat entries:

```jsonc
"feishu": {
  "channel": {
    "package": "@openclaw/feishu",
    "version": "2026.9.2",
    "dist": { "integrity": "sha512-…", "gitHead": "…" }   // sync reference only
  },
  "loadMode": "in-repo",
  "inRepoPackage": "@getpaseo/channels-feishu",
  "entry": "./dist/index.js",
  "plugin": { "specifier": "./dist/plugin.js", "exportName": "feishuPlugin" },
  "notices": "feishu"
}
```

Also add `@getpaseo/channels-feishu` to the loader's in-repo allowlist
(`packages/hub/src/channels/loader/`), where `channels-discord` was added in 13b.

## 4. Config enum, schema and compile

- `SUPPORTED_CHANNEL_NAMES` / `P0ChannelName` / trigger + activity unions: no
  edit needed if they are still derived from the catalog (13b). Verify.
- DB `CHANNEL_NAMES` check constraint (`packages/hub/src/db/schema.ts` plus a
  migration, as 0067 did for `discord`): add `feishu`.
- The channel config schema and its compile step
  (`packages/hub/src/channels/config/compile.ts`) must emit, per account, the
  keys the vertical reads. The authority for the shape is the ported zod schema
  `packages/channels/feishu/src/config-schema.ts` (`FeishuAccountConfigSchema`);
  the ones the runtime path depends on today are:
  - `appId`, `appSecret` — **required**, both transports.
  - `verificationToken`, `encryptKey` — required for `connectionMode: "webhook"`.
  - `domain`: `"feishu" | "lark"`, default `"feishu"`.
  - `connectionMode`: `"websocket" | "webhook"`, default `"websocket"`.
  - `webhookPath` (default `/feishu`), `webhookPort`, `webhookHost` — webhook mode.
  - `allowBots` (boolean), `actions.reactions`, `actions.sticker`.
  - `tools.{doc,chat,wiki,drive,perm,scopes,bitable}` — the tool-family gate.
    Upstream defaults: everything on except `perm`.
  - `mediaMaxMb`, `httpTimeoutMs`.

## 5. Account carrier field names

`packages/hub/src/channels/supervisor/account-carriers.ts` must build the flat
`ctx.account` for `feishu`. `src/fusion/account-config.ts` is the ONLY file that
reads it, and it reads exactly these string fields:

```
appId, appSecret, verificationToken, encryptKey, domain, connectionMode
```

There is no `botToken` and no `token`. Blank strings are ignored; a present
field wins over authored config. The nested carrier
`cfg.channels.feishu.accounts.<id>` must exist too — the ported `accounts.ts`
resolves the merged account from it.

Environment fallbacks (`FEISHU_APP_ID` and friends) are deliberately NOT carried
into the vertical (manifest `D-FS-012`): the Hub process serves every
organization, so an ambient app secret would leak one tenant's app into another
tenant's account. The Hub must pass credentials explicitly.

## 6. Connection store

Feishu needs a **four-field** credential envelope (app id, app secret,
verification token, encrypt key), unlike Discord's single bot token. Follow
13c's `discord_bot_connections` shape on the shared envelope service, with a
Hub-side probe before any store: `POST /open-apis/auth/v3/tenant_access_token/internal`
with `{app_id, app_secret}` (the vertical's `probe.ts` uses the SDK equivalent —
pin the Hub probe to it with a differential test, as 13c did).

`channels add feishu --account <id> --secret-file <path>` should take the
secrets from a file, never from argv.

## 7. Tool registration entry point and authorization

Upstream registers the six `feishu_*` families through the OpenClaw plugin
host's `registerFull(api)`. The Hub never imports this package: the vertical
publishes the families on its plugin object, and the Hub reads them off the
plugin it loaded for the account.

```ts
// packages/channels/feishu/src/plugin.ts — what this package publishes
agentTools: { names: FEISHU_TOOL_NAMES, collect: collectFeishuToolRegistrations, registerTools: registerFeishuTools }
```

- The loader registers the slot per account
  (`hub/src/channels/loader/load-channel.ts` → `registerChannelAgentTools`),
  keyed by organization + channel + account, and drops it when the account
  unloads. `hub/src/channels/channel-agent-tools.ts` is the only reader: it
  calls `collect({ cfg })` for the account's current drive-time `cfg`.
- `collectFeishuToolRegistrations` returns the registrations without
  registering; `registerFeishuTools(registrar, { cfg, logger })` runs the same
  six `register*Tools` entry points against a host registrar, for a host that
  has one.
- A registration is either a tool or a **factory** `(ctx) => tool | tool[]`.
  The Hub must call the factory per execution with an
  `OpenClawPluginToolContext` (`@getpaseo/channels-core/plugin-sdk/plugin-entry`);
  the members the ported executors read are `config`, `fsPolicy`,
  `workspaceDir`, `messageChannel`, `agentAccountId`, `deliveryContext`,
  `nativeChannelId`, `requesterSenderId`, `conversationReadOrigin`.
- **Authorization is re-resolved at execution, never cached.** Each executor
  calls `resolveFeishuToolAccount` (account enabled + the family's `tools.*`
  gate) and, for chat reads, `read-policy.ts` against the live `cfg`. A Hub
  catalog that caches the tool list must still pass the current `cfg` on every
  call, and must re-run discovery when a config revision changes.
- `feishu_perm` is off by default; it appears only when an account sets
  `tools.perm: true`.
- The tool result is wrapped as untrusted external content
  (`resultContentSource: "network"`), so the Hub must not strip the boundary
  markers before the model sees it.

## 8. Not wired here

- Outbound media upload and inbound media download (the ported `media.ts` is
  omitted; `src/fusion/media-resource.ts` carries the download half only).
- The streaming card (`streaming-card.ts` omitted) — needs the slice 22b Hub
  producer plus a `startStream` drive verb.
- Doc-comment ingress (`comment-dispatcher.ts` omitted).
- Ingress access policy: `policy.ts` is a partial port (`D-FS-010`); DM/group
  allowlists stay Hub-owned (goal slice 23).
