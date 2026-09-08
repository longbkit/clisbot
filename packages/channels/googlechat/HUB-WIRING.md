# Hub wiring for `@getpaseo/channels-googlechat`

Slice 14 built the vertical; **slice 14b wired it into the Hub** (2026-09-07).
The sections below are the contract that wiring was written against, kept as the
reference for the next change. Two things to know before reading them:

- **A reverse proxy is required, and this slice did not add one.** The Hub
  carries `webhookUrl` / `webhookPath` / `webhookPort` / `webhookHost` through
  the compiled config to the vertical's own `node:http` listener, and that is
  all: the operator terminates TLS in front of it and forwards the Chat app's
  request URL to `webhookHost:webhookPort` (option 1 in §6). The Paseo
  service-proxy integration (option 2) is NOT in this slice, so live E2E stays
  blocked on the operator's proxy.
- **The credential is probed before it is stored.**
  `packages/hub/src/channels/connections/googlechat.ts` validates the
  service-account document with this package's own rules and then mints one
  access token from it; `googlechat.test.ts` runs the Hub validator and the
  vertical's `resolveValidatedGoogleChatCredentials` over the same documents and
  requires them to accept and refuse the same ones. `AccountCarrierInput` no
  longer requires a bot token (§4): every credential field on it is optional now.

Install: `paseo channels add googlechat --account <id> --secret-file <path>`,
where the file is the service-account JSON the Google Cloud console downloads, or
`{"serviceAccountFile": "/run/secrets/googlechat.json"}` for a secret mount.

## 1. Catalog entry (`packages/hub/src/channels/catalog.ts`)

The `googlechat` entry exists with `status: "planned"`. Change:

| Field          | Now                            | Must become                                                                                                                                                                                                                  |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `"planned"`                    | `"in-repo"`                                                                                                                                                                                                                  |
| `capabilities` | includes `approval`, `buttons` | drop `approval`; keep `buttons`/`select` only as _inbound_ card clicks — the vertical does not render cards. Drop `media`, `file` and `voice`: attachment upload is user-OAuth only and inbound media is not downloaded yet. |
| `extraTools`   | `[]`                           | stays `[]`                                                                                                                                                                                                                   |
| `notes`        | —                              | add "Message actions: send, edit, delete. Inbound: message, command, callback, member. No attachment upload (user OAuth only), no inbound media download, no native approval card."                                          |

`sdkPackages` (`["google-auth-library"]`) and the single `webhook` transport are
already right. `requiredConfig` for that transport should read
`["serviceAccount", "audienceType", "audience", "webhookUrl"]` — the vertical
refuses to start without all four (`lifecycle/start-account.ts`).

Adding `googlechat` to `SUPPORTED_CHANNEL_NAMES` is automatic once `status` is
`"in-repo"`, since 13b derived that union from the catalog.

## 2. Pin (`packages/hub/channel-pins.json`)

Add, mirroring the Discord entry:

```jsonc
"googlechat": {
  "channel": {
    "package": "@openclaw/googlechat",
    "version": "2026.9.2",
    "dist": { "integrity": "sha512-…", "gitHead": "…" }   // sync reference only
  },
  "loadMode": "in-repo",
  "inRepoPackage": "@getpaseo/channels-googlechat",
  "entry": "./dist/index.js",
  "plugin": { "specifier": "./dist/plugin.js", "exportName": "googlechatPlugin" },
  "notices": "googlechat"
}
```

Also add `@getpaseo/channels-googlechat` to the loader's in-repo allowlist
(`packages/hub/src/channels/loader/`), the same place `channels-discord` was
added in 13b.

## 3. Config enum, schema and compile

- `SUPPORTED_CHANNEL_NAMES` / `P0ChannelName` / trigger + activity unions: no
  edit needed if they are still derived from the catalog (13b). Verify.
- DB `CHANNEL_NAMES` check constraint (`packages/hub/src/db/schema.ts` plus a
  migration, as 0067 did for `discord`): add `googlechat`.
- The channel config schema and its compile step
  (`packages/hub/src/channels/config/compile.ts`) must accept, per account:
  - `audienceType`: enum `"app-url" | "project-number"` — **required**.
  - `audience`: string — **required**. The app URL for `app-url`, the numeric
    project number for `project-number`.
  - `appPrincipal`: string, optional. Only meaningful with `app-url`; it is the
    numeric OAuth 2.0 client id (21 digits, **not** an email) that add-on tokens
    must carry. The vertical warns at start when it is missing or looks like an
    email (`warnAppPrincipalMisconfiguration`).
  - `webhookUrl`: string — the public HTTPS URL Google posts to. The listen path
    is derived from it; `webhookPath` overrides the path directly.
  - `webhookPort` / `webhookHost`: number / string, optional. The vertical owns
    its own `node:http` listener (see §6); the Hub supervisor must allocate and
    persist a port per account so a restart keeps the same endpoint.
  - `botUser`: string, optional, `users/<id>`. Without it, mention detection
    only recognises the `users/app` alias.
  - `allowBots`: boolean, optional. Default false.
  - `mediaMaxMb`, `textChunkLimit`, `groups`, `allowFrom`, `dmPolicy`,
    `requireMention`: the shared channel knobs; the vertical reads
    `mediaMaxMb`, `textChunkLimit` and `groups.<space>.requireMention`.

## 4. Account carrier (`packages/hub/src/channels/supervisor/account-carriers.ts`)

Add a `googlechat` builder. Unlike Slack/Telegram/Discord there is **no bot
token**: the credential is a service-account JSON document. The vertical reads
exactly two field names, and only through
`packages/channels/googlechat/src/fusion/account-config.ts` — that file is the
contract:

```ts
googlechat: ({ accountId, compiled, serviceAccount, serviceAccountFile }) => ({
  //  the flat carrier: credentials only, no authored config
  account: {
    accountId,
    ...(serviceAccount === undefined ? {} : { serviceAccount }),
    ...(serviceAccountFile === undefined ? {} : { serviceAccountFile }),
  },
  //  cfg.channels.googlechat.accounts.<id>: the compiled config block
  cfgAccount: { ...compiled.config },
}),
```

`serviceAccount` may be the JSON **string** or an already-parsed object; both are
accepted (`accounts.ts` `parseServiceAccount`). The carrier value always wins
over anything authored in the config block, the same precedence the other three
carriers use.

`AccountCarrierInput` currently types `botToken: string` as required. It must
become a per-channel credential union, or `botToken` optional — a Google Chat
connection has no token and the current shape cannot express that.

## 5. Connection credentials

A `googlechat` connection's credential envelope carries:

| Field                | Secret | Required | What it is                                                                    |
| -------------------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `serviceAccount`     | yes    | one of   | The service-account JSON document, verbatim.                                  |
| `serviceAccountFile` | yes    | one of   | Absolute path to that JSON on the daemon host (for secret-mount deployments). |

The vertical validates the document before it is handed to `google-auth-library`
(`google-auth.runtime.ts`): `type` must be `service_account`, `client_email` and
`private_key` must be present and non-empty, `universe_domain` must be
`googleapis.com`, and `auth_uri` / `token_uri` /
`auth_provider_x509_cert_url` / `client_x509_cert_url` must be Google's own
endpoints. A document that redirects any of those is refused — the Hub should
surface that error text as-is during connection create, because it is the only
place an operator learns the file was tampered with.

The file form is capped at 64 KiB
(`MAX_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE_BYTES`).

Neither the project id nor a Pub/Sub subscription is a credential here: this
vertical uses the **HTTP webhook** delivery model, not Pub/Sub. If Pub/Sub push
delivery is wanted later it is a second transport, not a second credential.

## 6. The public endpoint — the one real blocker

Google Chat delivers events by POSTing to a **public HTTPS URL** configured on
the Chat app in the Google Cloud console. There is no polling or socket mode.
The vertical listens on `webhookHost:webhookPort` and verifies every request's
bearer JWT against the configured audience before it touches the body, so what
is missing is only reachability.

Two options, in order of preference:

1. **Reverse proxy in front of the Hub.** The operator terminates TLS at nginx /
   Caddy / Cloudflare and forwards `POST https://chat.example.com/googlechat` to
   the account's `webhookHost:webhookPort`. `webhookUrl` is then the public URL
   and `webhookPath` is its path. The proxy must forward the `Host` header
   unchanged and set `X-Forwarded-For`; the account's `gateway.trustedProxies`
   (CIDRs) must list the proxy so the ported rate limiter keys on the real client
   ip instead of the proxy's — with no `trustedProxies`, headers are ignored and
   the socket address is used, which collapses every request into one bucket.

2. **The Paseo service proxy** ([docs/service-proxy.md](../../../docs/service-proxy.md)).
   It already does hostname-routed public exposure with a `publicBaseUrl` and
   wildcard DNS, and it forwards `Host` / `X-Forwarded-Proto` / `X-Forwarded-For`
   correctly. Two gaps to close before it can serve this:
   - It routes to **workspace scripts** (`paseo.json` `"type": "service"`),
     keyed on `<script>--<branch>--<project>`. A channel webhook is a Hub-owned
     listener, not a workspace script, so it needs a route source the Hub can
     register — e.g. a channel-account route whose hostname label is
     `<channel>--<accountId>`.
   - Its `X-Forwarded-For` is documented as "the immediate peer address,
     replaces any existing chain". Behind the service proxy the vertical would
     see the proxy's address, so `trustedProxies` must name the proxy and the
     proxy must preserve the inbound chain, or the client-ip bucket is useless.

   Until one of those lands, live Google Chat E2E is blocked; that is why
   `fusion/webhook-session.ts` carries the "UNEXERCISED IN PRODUCTION" header.

## 7. Inbound routing

The vertical emits `ChannelInboundEvent.kind` for four families, all already in
the shared contract and the Hub's `plane/inbound-kinds.ts` table:

| kind       | When                                      | Facts                                               |
| ---------- | ----------------------------------------- | --------------------------------------------------- |
| `message`  | `MESSAGE`                                 | —                                                   |
| `command`  | `MESSAGE` whose body is a leading `/verb` | `command: { name, args }`                           |
| `callback` | `CARD_CLICKED`                            | `callback: { actionId, value, actorId, messageId }` |
| `member`   | `ADDED_TO_SPACE` / `REMOVED_FROM_SPACE`   | `member: { userId, joined }`                        |

No Hub table change is needed. Note that a `callback` arrives with
`wasMentioned: true` on purpose (a button click is addressed at the app that
rendered the card), so a mention-gated space still routes it.

## 8. Status surface

`ctx.setStatus` reports `{ state, accountId, webhookPath, audienceType }` on
start and `{ mode: "webhook", connected, webhookPath }` from the session. There
is no `connected` heartbeat after the listener binds — a webhook channel has no
connection to keep alive — so health evaluation must not read "no traffic" as
"unhealthy".

## 9. Live-boot case

Mirror the Discord live-boot contract test: start a `googlechat` account against
a fake service-account credential and a loopback listener, assert the account
reaches `state: "connected"` with the derived `webhookPath`, POST a signed
envelope, and assert a row lands in `channel_ingress_queue` before the 200.
`packages/channels/googlechat/src/fusion/webhook-session.test.ts` is that test
minus the Hub; it needs the real `InboundQueueSink` instead of the fake one.
