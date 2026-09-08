# Hub wiring for `@getpaseo/channels-zalouser`

Slice 17 built the vertical only. This file is the exact list of Hub changes the
follow-up slice must make, in the shape slices 13b/13c made them for Discord. It
is written against `packages/hub` as of 2026-09-07; nothing here has been done,
and no file under `packages/hub/**` was touched by slice 17.

Every field name below is one the vertical already reads at runtime.

Read §6 first if you read nothing else. Zalo Personal is the only channel in the
catalog whose credential is a **live session for a human's account**, and the
Hub owns where those bytes rest.

## 1. Catalog entry (`packages/hub/src/channels/catalog.ts`)

The `zalouser` entry exists with `status: "planned"`. Change:

| Field          | Now                                                                       | Must become                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `"planned"`                                                               | `"in-repo"`                                                                                                                                                                                                                                                      |
| `transports`   | one `qr` transport requiring `sessionDir`                                 | keep the single `qr` transport, but its required config is `profile`, **not** `sessionDir`. The vertical never resolves a session directory: the session lives in the injected store (§6).                                                                       |
| `credentials`  | `sessionDir` (a path)                                                     | `profile` — a non-secret label, `required: false`, defaulting to the account id. There is **no operator-supplied secret for this channel**; the credential is created by the QR scan.                                                                            |
| `capabilities` | `…commonCapabilities`, `voice`, `video`, `presentation`, `native-actions` | drop `video`, `presentation` and `native-actions` — the platform has no API for any of them. Keep `voice` (an outbound audio upload becomes a voice message). Drop `file` only if `commonCapabilities` implies inbound download; outbound file upload IS native. |
| `auth`         | absent                                                                    | `"qr"` — the discriminator the app's setup UI switches on (§7). Every other channel in the catalog is `"token"`-shaped; this is the first that is not.                                                                                                           |
| `extraTools`   | `zalouser`                                                                | unchanged — one tool, `zalouser`, with actions `send`, `image`, `link`, `friends`, `groups`, `me`, `status`.                                                                                                                                                     |
| `notes`        | one note                                                                  | add: "Message actions: react only. Inbound: message, command. No threads, no inbound media download, no edits/deletes/pins/polls. Linking requires a human QR scan; relink is expected, not exceptional."                                                        |

Adding `zalouser` to `SUPPORTED_CHANNEL_NAMES` is automatic once `status` is
`"in-repo"`, since 13b derived that union from the catalog. That also widens the
DB check constraints, which need a migration (§3).

## 2. Pin (`packages/hub/channel-pins.json`)

Add under `channels`, mirroring the Zalo Official Bot entry:

```jsonc
"zalouser": {
  "channel": {
    "package": "@openclaw/zalouser",
    "version": "2026.9.2",
    "dist": { "integrity": "sha512-…" }   // sync reference only; nothing loads it
  },
  "loadMode": "in-repo",
  "inRepoPackage": "@getpaseo/channels-zalouser",
  "entry": "./dist/index.js",
  "plugin": { "specifier": "./dist/plugin.js", "exportName": "zalouserPlugin" },
  "notices": "zalouser"
}
```

The loader's in-repo allowlist needs `@getpaseo/channels-zalouser`.

## 3. Enums, schema, migration

- `CHANNEL_NAMES` in `packages/hub/src/db/channels.ts` and the check-constraint
  migration that follows it (0067 did this for Discord; a new migration adds
  `zalouser`).
- The app-side channel-name contracts widened in 13b.
- `packages/hub/src/channels/config/compile.ts`: the `zalouser` section, §4.

## 4. Config the vertical reads

Compiled into `cfg.channels.zalouser` (+ `.accounts.<id>` overrides). Every key
here is read by ported code; nothing else is:

```jsonc
{
  "enabled": true,
  "profile": "default", // credential profile; the session store key
  "name": "Long's Zalo", // operator label
  "mediaMaxMb": 20, // outbound media cap (also agents.defaults.mediaMaxMb)
  "historyLimit": 20, // read by the omitted monitor only; harmless
  "textChunkMode": "length", // "length" | "newline"  (D-ZU-010)
  "textChunkLimit": 2000, // D-ZU-010
  "dangerouslyAllowNameMatching": false, // group entries may match by NAME, not id
  "groups": {
    // per-group scope: enabled, requireMention, tools
    "group:123": { "enabled": true, "requireMention": true },
  },
  "dmPolicy": "pairing", // read by the Hub's access layer (slice 23), not here
  "allowFrom": [], // ditto
  "groupPolicy": "allowlist", // ditto; the vertical defaults it to "allowlist"
  "groupAllowFrom": [], // ditto
}
```

`dangerouslyAllowNameMatching` is a break-glass flag: with it off, a `groups`
entry that is a group NAME rather than an id is ignored for policy, because a
group name is mutable and can drift onto an untrusted room.

## 5. Account carrier

`packages/hub/src/channels/supervisor/account-carriers.ts` must produce, for a
`zalouser` account:

```jsonc
{ "accountId": "...", "profile": "...", "name": "..." }
```

`fusion/account-config.ts` is the single reader. It accepts `profile` or
`zcaProfile` for the same value, and folds the carrier over the compiled config
entry so a connection field wins.

**There is no token field.** Do not add one, and do not route this channel
through `configureChannelBotConnection` — a Zalo Personal connection stores no
operator secret. The connection row is a label plus a profile; the credential
that matters is created later by the QR scan and lands in the session store.

## 6. Session store contract — the important one

The vertical persists its QR session through an injected port
(`src/fusion/session-store.ts`):

```ts
interface ZalouserSessionStore {
  entries(): Promise<Array<{ key: string; value: ZaloCredentialStateRecord }>>;
  register(key: string, value: ZaloCredentialStateRecord): Promise<void>;
}
```

The shipped implementation is `createHostRuntimeSessionStore({ hostRuntime,
accountId })`, over `HostRuntime.state.openKeyedStore` with namespace
`credentials`, `maxEntries: 256`, `overflowPolicy: "reject-new"`.
`lifecycle/start-account.ts` installs and hydrates it before anything reads a
credential, and uninstalls it when the account stops.

Two corrections slice 17b made to this section, because the wiring could not be
built as written:

- The namespace is `credentials`, not `credentials:<accountId>`. A plugin-state
  namespace must be a safe path segment (upstream
  `plugin-state/plugin-store-validation.ts`, `/^[a-z0-9][a-z0-9._-]*$/i`), which
  the colon form is not; the Hub opens one keyed-store root per account, so the
  name is already account-scoped.
- `plugin.setup` gained `bindAccountSession({ accountId })`. The §7 verbs run
  exactly when the account start has failed for a missing session, so nothing
  else installs the store on that path and a freshly scanned credential would
  never reach the backing.

The Hub side is slice 17b's **encrypted keyed-store namespaces** mechanism:
`packages/hub/src/channels/state/encrypted-namespaces.ts` names the namespaces
that hold credential material, and `state/secret-backend.ts` backs them with
`channel_state_secrets` rows — one credential envelope per organization +
channel + account + namespace, sealed by the Connection cipher and bound by AAD
to that scope (migration `0070`). Every other namespace keeps the plain JSON
file under the account's state dir.

What the Hub must guarantee behind that store:

1. **Encrypted at rest.** The value is `{ imei, cookie, userAgent, language,
createdAt, lastUsedAt }` — a complete, replayable credential for a human's
   Zalo account. This is the runtime-strategy §0.1 note 7 rule: QR-login session
   files keep native storage semantics with **encrypted-at-rest** storage; they
   are NOT forced into the Hub DB as plaintext rows. Whatever backs
   `openKeyedStore` for this channel must encrypt, with the same key custody the
   connection credential envelope uses.
2. **Per account, per organization.** The namespace is already account-scoped;
   the store must not let one organization read another's.
3. **Durable across restarts.** A lost store means a human has to scan again.
4. **Never logged.** No value from this namespace may reach a log line, a status
   snapshot, or an error message. The vertical does not print them; the Hub must
   not either.
5. **Deletable.** `logout` writes a `{ kind: "revoked" }` marker rather than
   deleting the row, on purpose: it is what stops a stale copy resurrecting a
   session an operator explicitly cleared. Account deletion removes the
   namespace outright — the supervisor's reconcile does it when the account
   leaves the configuration, and never when it is only disabled.

Writes are write-behind (the ported credential closure is synchronous);
`flushZalouserSessions()` awaits them and rethrows the first failure. The QR
verbs already flush before reporting success, so the Hub does not need to.

## 7. QR setup operations the app must render

`plugin.setup` carries five verbs (`src/fusion/qr-setup.ts`). They are
non-blocking; the app polls. This is the whole onboarding for this channel.

| Verb            | Signature                                                                                           | Renders as                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `startQrLogin`  | `{ profile, relink?, timeoutMs?, writeTempFile? }` → `{ status, qrDataUrl?, qrFilePath?, message }` | The QR image. `status: "pending"` means show it; `"linked"` means it was already linked; `"failed"` means show `message`.          |
| `pollQrLogin`   | `{ profile, timeoutMs? }` → `{ status, message, user? }`                                            | Poll on a timer while `pending`. `linked` carries `user.userId` / `displayName` — show it, and confirm it is the intended account. |
| `cancelQrLogin` | `{ profile }` → `{ cancelled, message }`                                                            | The dialog's close/cancel. Refuses to touch a session that is still good.                                                          |
| `relinkQrLogin` | `{ profile }` → same as start                                                                       | "Link a different account" / "Session expired, link again". Discards the stored session first.                                     |
| `logout`        | `{ profile }` → `{ cleared, message }`                                                              | "Unlink". Leaves the durable revocation marker.                                                                                    |

The Hub serves all five at `POST
/api/management/v1/organizations/<org>/channel-accounts/zalouser/<account>/qr/<verb>`
(`start`, `poll`, `cancel`, `relink`, `logout`) behind `channel.manage` and the
mutation guard. `profile` is the Hub's, taken from the account carrier — a
request never names one. The response is rebuilt field by field
(`packages/hub/src/channels/supervisor/qr-login.ts`), so no session material can
travel this path.

UX facts the app needs and cannot derive:

- The QR **expires** (upstream's TTL is three minutes) and upstream retries it
  in place once. A `failed` with an expiry message means: generate a new one.
- A start that lands inside its own budget can come back `linked` directly —
  do not require a poll before showing success.
- `qrDataUrl` is a `data:image/png;base64,…`; `qrFilePath` is a 0600 file on the
  daemon host, useful when the operator is on the box and useless when they are
  not.
- Relink is **routine**, not an error path. A personal-account session dies for
  ordinary reasons (the phone signs the session out, Zalo rotates it). The
  status surface should offer relink whenever the account start fails with
  "not linked".

## 8. Drive surface

`plugin.gateway.startAccount` is `startZalouserAccount`; it resolves only when
`ctx.abortSignal` fires. It **fails the start** when the profile has no live
session (D-ZU-020) — the supervisor should surface that as "needs linking" and
point at §7, not retry-loop it.

An account whose start fails that way lands in the supervisor's `needs-login`
transport state (`packages/hub/src/channels/supervisor/needs-login.ts`), which
`channel-accounts/status` reports and which reconcile leaves alone until a human
scans or the revision changes.

`plugin.outbound.sendText` / `sendMedia` are the Hub's post path.
`plugin.messageActions` is `react` only.

`plugin.agentTools` is the `zalouser` agent tool. Slice 17b corrected its shape:
the Hub reads exactly one (`channels/channel-agent-tools.ts`
`readAgentToolsSurface`) — `{ names, collect, registerTools }`, the shape the
Feishu vertical publishes — and a bare factory array mounted nothing. The
factory list stays exported from `fusion/tools.ts` for callers that want the
catalog.

Group-member listing rides `plugin.directoryMembers.listGroupMembers`, not
`plugin.directory`: the shared `ChannelPlugin.directory` slot only types
`resolveConversation`. Widen the shared type or read the open key — the vertical
does not care which, but pick one rather than adding a second spelling.

## 9. Inbound kinds

The vertical emits two of the shared `ChannelInboundKind` values:

| Kind      | When                                                   | Facts                         |
| --------- | ------------------------------------------------------ | ----------------------------- |
| `message` | Any admitted direct or group message                   | —                             |
| `command` | The body (after mention stripping) starts with `/verb` | `{ command: { name, args } }` |

Fields worth knowing on the event:

- `externalMessageId` is `"<msgId>:<cliMsgId>"`. Both halves are required by
  `addReaction`, so the Hub must pass it back whole for a `react` action; the
  vertical splits it (`resolveZalouserReactionMessageIds`).
- `replyTo` is `user:<id>` or `group:<id>` — a canonical target the outbound
  path parses, not a bare id.
- `wasMentioned` is a FACT, not a policy decision: it is true for every DM, and
  in a group for an explicit mention, a quote of the account's own message, or a
  mention the client could not attribute. Mention policy stays Hub-side.
- There is no `messageThreadId`; this channel has no threads.
