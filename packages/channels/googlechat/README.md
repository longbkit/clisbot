# @getpaseo/channels-googlechat

The in-repo Google Chat channel vertical (goal ledger slice 14). Ported from
`extensions/googlechat/src@5d8067a4483` — see `upstream-sync.json` for the
file-by-file mapping, the deviations (`D-GC-0xx`) and what is omitted.

Third-party SDKs are upstream's, at upstream's versions: `google-auth-library`
`11.0.2`. Upstream hand-rolls its Chat API client over `fetch` rather than
depending on `googleapis`; that client (`api.ts`) is carried verbatim.

Hub wiring landed in a follow-up slice. [HUB-WIRING.md](HUB-WIRING.md) is the
handoff document it was built from and stays the record of what the Hub side owns;
`docs/channels-platform.md` describes the platform as built. Live E2E remains
blocked on the public HTTPS endpoint, not on the wiring.

## What a live test needs

Provision these yourself and put them in the repo-root `.env`. This package never
reads `.env` and no value here is a real credential — only names.

### Google Cloud / Workspace setup

1. In a Google Cloud project, create a **service account** and download its JSON
   key. That document is the whole credential; there is no bot token.
2. Enable the **Google Chat API** on the project.
3. Under **Google Chat API → Configuration**, create the Chat app: set a name and
   avatar, enable **Receive 1:1 messages** and **Join spaces and group
   conversations**, and choose **App URL** as the connection setting with your
   public HTTPS endpoint.
4. Note the **audience** for request verification:
   - `audienceType: "app-url"` → `audience` is that same app URL, and
     `appPrincipal` is the app's numeric OAuth 2.0 client id (21 digits, not an
     email) so add-on tokens can be bound to it.
   - `audienceType: "project-number"` → `audience` is the Cloud project number.
5. Publish the app to your Workspace domain (or to specific testers) — a
   Workspace admin has to approve it before anyone can add it to a space.
6. Add the app to a test space and start a DM with it.

### Test surfaces

| Env var                                | What it must be                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GOOGLECHAT_SERVICE_ACCOUNT_JSON_PATH` | Path to the service-account JSON key. Never commit the file.                                        |
| `GOOGLECHAT_PROJECT_NUMBER`            | The Cloud project number, for `audienceType: "project-number"`.                                     |
| `GOOGLECHAT_APP_URL`                   | The public HTTPS endpoint configured on the Chat app, for `audienceType: "app-url"`.                |
| `GOOGLECHAT_APP_PRINCIPAL`             | The app's numeric OAuth 2.0 client id (21 digits). Only for `app-url`.                              |
| `GOOGLECHAT_PUBLIC_URL`                | The public URL Google posts to (usually the same as `GOOGLECHAT_APP_URL`).                          |
| `GOOGLECHAT_TEST_SPACE_ID`             | `spaces/<id>` of a space the app was added to and can post in.                                      |
| `GOOGLECHAT_TEST_DM_USER_ID`           | `users/<id>` of the human tester the app opens a DM with.                                           |
| `GOOGLECHAT_TEST_BOT_USER_ID`          | `users/<id>` of the app itself, for the mention marker and the own-message filter.                  |
| `GOOGLECHAT_DRIVER_ACCOUNT`            | A **human** Workspace account used as the external sender. Never drive inbound with the app itself. |

The driver / app-under-test split is the same rule the Telegram vertical follows
(CLAUDE.md, "Required Slack and Telegram E2E roles"): a direct `sendText` is an
outbound smoke test only. The required proof is external sender → webhook →
agent turn → reply in the same space, then a REST read-back
(`GET /v1/spaces/{space}/messages`) matching the returned message resource name.

**Live E2E is blocked until the public endpoint exists.** Google Chat has no
polling or socket mode; it only POSTs to a public HTTPS URL. See
[HUB-WIRING.md §6](HUB-WIRING.md#6-the-public-endpoint--the-one-real-blocker).

### Minimal account config

```yaml
channel: googlechat
accountId: main
connectionId: <hub connection id>
audienceType: project-number
audience: "<GOOGLECHAT_PROJECT_NUMBER>"
webhookUrl: "<GOOGLECHAT_PUBLIC_URL>"
botUser: "<GOOGLECHAT_TEST_BOT_USER_ID>"
routes:
  - match: { kind: dm }
    agent: <agent>
    environment: <environment>
  - match: { kind: channel, ids: ["<GOOGLECHAT_TEST_SPACE_ID>"] }
    agent: <agent>
    environment: <environment>
```

The service-account document lives in the Hub connection's credentials under
`serviceAccount` (or `serviceAccountFile`), not in this file.

## Supported today

**Inbound** (HTTP webhook): `MESSAGE` in spaces, group chats and DMs; a leading
`/verb` line classified as a `command`; `CARD_CLICKED` as a `callback` carrying
the button's action id, its parameter value and the clicking user;
`ADDED_TO_SPACE` / `REMOVED_FROM_SPACE` as `member` events. Mention detection
reads `USER_MENTION` annotations against `users/app` and the configured
`botUser`. Bot-authored and app-authored messages are filtered unless
`allowBots` is set.

Request authentication is upstream's, unchanged: the bearer JWT is verified
against the configured audience — an ID-token verification for `app-url`
(including the Workspace add-on issuer, bound to `appPrincipal`) and a
signed-JWT-with-certs verification against Google's Chat certificates for
`project-number` — **before** the request body is read past the pre-auth size
cap. The 200 is written only after the event is durably admitted to the Hub
ingress queue; a failed admission answers 503 so Google redelivers, and a
malformed envelope answers 400 so it does not.

**Outbound**: text with upstream's Google Chat markdown renderer (bold/italic/
strike/code, `<href|label>` links, blockquotes, bullet lists, table→bullet
fallback) and its byte-bounded chunker; thread replies with the
fallback-to-new-thread option; message edit (`cardsV2` supported on the update
path); message delete; DM opening through `spaces:findDirectMessage`; space
lookup and the account probe.

**Message tool actions**: `send`, `edit`, `delete`.

## Not supported yet

Named here so nothing above is read as more than it is.

- **Attachment upload** — Google Chat's media upload endpoint is user-OAuth
  only; a service-account app cannot use it. `sendMedia` posts a visible
  in-channel notice and reports `mediaPosted: false` (D-GC-016), and the `send`
  action refuses an attachment loudly rather than dropping it.
- **Inbound media download** — the envelope's `attachment` array is parsed but
  the file is not fetched, so an attachment-only message is refused as
  empty-bodied. Upstream's download lives in the omitted `monitor.ts`.
- **Native approval cards** — the whole `approval-*` family is omitted (it sits
  on OpenClaw's approval gateway runtime). Card _clicks_ still reach the Hub as
  inbound `callback` events for the Hub's own approval policy to act on.
- **Typing indicator** — upstream posts an `_… is typing…_` message and edits it
  into the answer; that lives in the omitted `monitor.ts`. The reaction mode
  upstream also offers needs user OAuth and does not work for a service-account
  app at all.
- **Reactions, pin, read-back, emoji discovery, polls** — no service-account API
  on this channel. `supportsAction` refuses them, so the Hub answers
  `unsupported_action` rather than a transport error.
- **Pub/Sub push delivery** — this vertical implements the HTTP webhook model
  only.
- **Proxy support for the auth transport** — upstream routes google-auth through
  OpenClaw's pinned-dispatcher stack, which honours explicit/env proxies and
  client TLS certs. The Fusion guard accepts a `dispatcherPolicy` and ignores it
  (D-GC-005).
- **Setup/doctor surfaces** — the OpenClaw wizard and `doctor` trees are
  omitted; the Hub owns onboarding.

## Layout

```
src/
  api.ts auth.ts google-auth.runtime.ts   ← upstream Chat REST + service-account auth
  accounts.ts targets.ts format.ts        ← upstream account/target/format closure
  actions.ts message-tool-api.ts          ← upstream message-tool adapter
  monitor-event.ts monitor-webhook.ts     ← upstream envelope parser + request handler
  channel-actions.ts outbound.ts          ← Fusion: Hub drive surface
  lifecycle/start-account.ts              ← Fusion: L4 account lifecycle
  fusion/                                 ← Fusion: every boundary, one per D-GC-0xx
    account-config.ts   Hub account carrier → upstream account resolution
    admission.ts        durable admission before the webhook 200
    inbound-adapter.ts  envelope → ChannelInboundEvent (kind + facts)
    webhook-session.ts  the owned node:http listener
    ssrf-fetch.ts       the guarded-fetch boundary
    secret-file.ts      the credential-file reader
    runtime.ts          HostRuntime → the ported PluginRuntime
```
