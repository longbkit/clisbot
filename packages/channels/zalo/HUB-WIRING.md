# Hub wiring for `@getpaseo/channels-zalo`

Slice 16 built the vertical; **slice 16b wired it into the Hub** (2026-09-07).
The sections below are the contract that wiring was written against, kept as the
reference for the next change. Three things ended up different from the text:

- **Polling only, at compile.** The catalog lists both transports, but
  `config/compile-support.ts` refuses `transport.mode: webhook` — the Hub
  publishes no public HTTPS URL, and polling needs none (§6 says the same). The
  webhook session stays unexercised until the endpoint story lands.
- **`webhookSecret` rides both carriers.** §4's sketch put it on the flat
  carrier only; the Hub also folds it into `cfg.channels.zalo.accounts.<id>`, so
  the ported `accounts.ts` reads it from either.
- **The credential is probed before it is stored.** `POST /bot<token>/getMe`
  runs in `packages/hub/src/channels/connections/zalo.ts`, pinned to this
  package's `probe.ts` by `zalo.test.ts`. A rejected token fails
  `channels add zalo` instead of installing an account that can never start.

Install: `paseo channels add zalo --account <id> --secret-file <path>`, where the
file is a raw token or `{"botToken": "…", "webhookSecret": "…"}`.

Every field name below is one the vertical already reads at runtime. The two
files that define them are `src/fusion/account-config.ts` (the carrier) and
`src/fusion/webhook-session.ts` (the endpoint).

## 1. Catalog entry (`packages/hub/src/channels/catalog.ts`)

The `zalo` entry exists with `status: "planned"`. Change:

| Field          | Now         | Must become                                                                                                                                                                                                     |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `"planned"` | `"in-repo"`                                                                                                                                                                                                     |
| `capabilities` | —           | `dm`, `group`, `media` (inbound images only — see below). Do NOT list `threads`, `reactions`, `edit`, `delete`, `buttons`, `approval`, `polls` or `commands`: the Zalo Bot API has no endpoint for any of them. |
| `extraTools`   | `[]`        | stays `[]`                                                                                                                                                                                                      |
| `notes`        | —           | "Message actions: send (text, or an image by HTTPS URL). Inbound: message, command. Stickers and unsupported events are ignored. No upload API — local files are refused with a notice."                        |

Transports: `polling` **and** `webhook`; the vertical picks by whether the
account config carries a `webhookUrl` (upstream's own rule, `accounts.ts`
`inspectZaloAccount`). `requiredConfig` is `["botToken"]` for polling and
`["botToken", "webhookUrl", "webhookSecret"]` for webhook — `start-account.ts`
refuses webhook mode without a secret, because Zalo signs every delivery with it
and an unverifiable request must be refused.

`sdkPackages` is `[]`: Zalo ships no SDK and upstream hand-rolls the client over
`fetch`. The package's only runtime third-party dependencies are `zod` (the
webhook envelope schemas, at upstream's `4.4.3`) and `undici` (the proxy agent,
in a dynamic import).

Adding `zalo` to `SUPPORTED_CHANNEL_NAMES` is automatic once `status` is
`"in-repo"`, since 13b derived that union from the catalog.

## 2. Pin (`packages/hub/channel-pins.json`)

Add, mirroring the Discord entry:

```jsonc
"zalo": {
  "channel": {
    "package": "@openclaw/zalo",
    "version": "2026.9.2",
    "dist": { "integrity": "sha512-…", "gitHead": "…" }   // sync reference only
  },
  "loadMode": "in-repo",
  "inRepoPackage": "@getpaseo/channels-zalo",
  "entry": "./dist/index.js",
  "plugin": { "specifier": "./dist/plugin.js", "exportName": "zaloPlugin" },
  "notices": "zalo"
}
```

Also add `@getpaseo/channels-zalo` to the loader's in-repo allowlist
(`packages/hub/src/channels/loader/`), the same place `channels-discord` was
added in 13b.

## 3. Config enum, schema and compile

- `SUPPORTED_CHANNEL_NAMES` / `P0ChannelName` / trigger + activity unions: no
  edit needed if they are still derived from the catalog (13b). Verify.
- DB `CHANNEL_NAMES` check constraint (`packages/hub/src/db/schema.ts` plus a
  migration, as 0067 did for `discord`): add `zalo`.
- The channel config schema and its compile step
  (`packages/hub/src/channels/config/compile.ts`) must accept, per account:

| Field                                                    | Type                                        | Read by                                                                          |
| -------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `webhookUrl`                                             | string, optional                            | the mode switch + `setWebhook`. Absent = polling mode.                           |
| `webhookPath`                                            | string, optional                            | overrides the path derived from `webhookUrl`.                                    |
| `webhookPort`                                            | number, optional                            | the owned `node:http` listener (see §6).                                         |
| `webhookHost`                                            | string, optional                            | same.                                                                            |
| `webhookSecret`                                          | secret string, **required in webhook mode** | the `x-bot-api-secret-token` compare. 8–256 chars, enforced at start.            |
| `mediaMaxMb`                                             | number, optional (upstream default 5)       | the inbound photo size cap.                                                      |
| `proxy`                                                  | string, optional                            | the outbound proxy agent (`proxy.ts`).                                           |
| `botNames`                                               | string[], optional — **Fusion-added**       | extra group-mention aliases; see §7.                                             |
| `allowFrom`, `groupAllowFrom`, `dmPolicy`, `groupPolicy` | the shared access knobs                     | carried on the account for the Hub's own policy; the vertical only reports them. |
| `enabled`, `name`                                        | the shared account knobs                    | `accounts.ts`.                                                                   |

`botToken` and `tokenFile` are accepted by the ported resolver too, but in Hub
deployments the token arrives on the connection carrier (§4), not in config.

## 4. Account carrier (`packages/hub/src/channels/supervisor/account-carriers.ts`)

Add a `zalo` builder. `src/fusion/account-config.ts` is the contract — it is the
only file that reads these names:

```ts
zalo: ({ accountId, compiled, botToken }) => ({
  //  the flat carrier: credentials only, no authored config
  account: { accountId, token: botToken, config: {} },
  //  cfg.channels.zalo.accounts.<id>: the compiled config block
  cfgAccount: { ...compiled.config, botToken },
}),
```

`token` and `botToken` are both accepted on the flat carrier (Telegram/Discord
spell it `token`, the config entry spells it `botToken`), and the carrier value
always wins over anything authored in the config block — the same precedence the
other carriers use.

Webhook mode additionally needs `webhookSecret` on the carrier if the Hub keeps
it in the connection's credential envelope rather than in the config revision;
`readConnectionCredentials` already accepts it there.

## 5. Connection credentials

A `zalo` connection's credential envelope carries:

| Field           | Secret | Required     | What it is                                                                      |
| --------------- | ------ | ------------ | ------------------------------------------------------------------------------- |
| `botToken`      | yes    | always       | The Zalo Bot API token from Zalo Bot Creator (`https://bot.zaloplatforms.com`). |
| `webhookSecret` | yes    | webhook mode | The 8–256-char token Zalo echoes in `x-bot-api-secret-token`.                   |

The Hub should probe the token before it stores the connection, the same way
13c did for Discord: `POST https://bot-api.zaloplatforms.com/bot<token>/getMe`
returns `{ok:true, result:{id, account_name, account_type, can_join_groups}}`.
Pin that probe to this vertical's `probe.ts` with a differential test rather than
writing a second client — `probeZalo` is exported from the package root.

There is no OAuth, no app id and no signing key: the token is the whole
credential.

## 6. The public endpoint (webhook mode only)

Zalo delivers webhook events by POSTing to a **public HTTPS URL** registered with
`setWebhook`. The vertical listens on `webhookHost:webhookPort` and verifies the
`x-bot-api-secret-token` header with a constant-time compare **before** the body
is read, so what is missing is only reachability. The two options and their gaps
are exactly the ones written up for Google Chat —
[`../googlechat/HUB-WIRING.md` §6](../googlechat/HUB-WIRING.md#6-the-public-endpoint--the-one-real-blocker)
(reverse proxy in front of the Hub, or the Paseo service proxy); the supervisor
must allocate and persist a port per account so a restart keeps the same
endpoint, and the account's `gateway.trustedProxies` must list the proxy or the
rate limiter keys every request into one bucket.

**Polling mode needs none of this** and is the mode to wire first: it is a plain
outbound long poll, it is what the live-test recipe in `README.md` uses, and it
is the mode a developer machine can actually run.

## 7. Inbound routing

The vertical emits two `ChannelInboundEvent.kind` families, both already in the
shared contract and the Hub's `plane/inbound-kinds.ts` table:

| kind      | When                                              | Facts                     |
| --------- | ------------------------------------------------- | ------------------------- |
| `message` | `message.text.received`, `message.image.received` | —                         |
| `command` | a message body that is a leading `/verb`          | `command: { name, args }` |

No Hub table change is needed.

`wasMentioned` is `true` for every DM. In a group it is computed by the vertical
(D-ZL-012) by matching the bot's own `getMe` `account_name` plus any
`botNames` aliases, because the Zalo Bot API carries no mention annotation and
no entity list. If the Hub wants mention-gated Zalo groups (upstream's
`resolveRequireMention: () => true`), that alias list is the knob operators need
in the setup UI.

## 8. Status surface

`ctx.setStatus` reports `{ state, accountId, mode, bot }` at start, then
`{ connected, lifecycle, lastConnectedAt, lastInboundAt, lastError,
terminalDisconnect }` from the polling loop and `{ mode: "webhook", connected,
webhookPath }` from the webhook session. An auth error in polling mode reports
`terminalDisconnect: true` and the loop stops — health evaluation should surface
that as a blocked account, not as a transient disconnect. In webhook mode there
is no heartbeat after the listener binds, so "no traffic" must not read as
"unhealthy".

## 9. Live-boot case

Mirror the Discord live-boot contract test: start a `zalo` account against a fake
token and a loopback Bot API, assert the account reaches `state: "connected"`,
deliver one update, and assert a row lands in `channel_ingress_queue` before the
transport moves on. `src/fusion/webhook-session.test.ts` and
`src/fusion/polling-session.test.ts` are those tests minus the Hub; they need the
real `InboundQueueSink` instead of the fake admission.
