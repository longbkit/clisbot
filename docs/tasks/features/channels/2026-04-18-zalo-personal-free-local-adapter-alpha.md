# Zalo Personal Free Local Adapter Alpha

## Source Of Truth

Status: `In progress`
Current slice: config seam, `tokenFile` QR storage, QR login for
`start`/`bots add`/`bots login`, logout/status, text send, operator docs, and
a `zca-js` text DM/group listener. This alpha doc owns live validation and
first-slice fixes; broader contacts/groups, richer message/media, and native
commands live in the follow-up full-surface task.

This task doc is the implementation source of truth for alpha contract, config,
CLI flow, file plan, and validation. The [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
owns product framing; [Zalo Personal Contacts, Groups, And Full Tool Surface](2026-05-18-zalo-personal-contacts-groups-and-full-tool-surface.md)
owns the follow-up command surface.

## Product Contract

Implement `zalo-personal` as an optional unofficial alpha provider using native
`zca-js` under the existing `clisbot` channel, bot, route, queue, loop, and
message surfaces.

Hard constraints:

- no paid dependency, paid relay, paid browser farm, or vendor subscription
- no public `--backend` flag in the first slice
- no dedicated directory-management CLI in the first slice
- no extra public account-label concept beyond the existing bot id
- QR login must work headlessly from the CLI
- QR login must print the QR in the console even when `--qr-path` also saves it
  to a file
- login commands must stay attached until login succeeds, fails, or times out
- auth/session persistence must follow the existing `tokenFile` architecture
- QR auth/session data must not be modeled as a fake `botToken` literal or a
  `credentialType=mem` runtime credential

Source facts to preserve:

- `zca-js` is unofficial personal-account automation over Zalo Web.
- `zca-js` supports QR login and stored credential/session reuse; the public
  clisbot login flow remains QR-only.
- `zca-js` emits direct-message and group-message listener events.
- `zca-js` documents one web listener per account; Zalo Web can stop it.
- `zca-js` supports message attachments, attachment upload for image/video/file,
  URL-based voice, and URL-plus-thumbnail video sends. `openzca` and OpenClaw
  `zalouser` confirm local/URL media send and inbound media metadata patterns.
- Receive is listener-based, not webhook-based: `zca-js` opens a Zalo Web
  WebSocket with the stored cookie/userAgent/session, decodes direct and group
  events, and emits `message`.
- Run one long-lived listener per bot/account. Multiple Zalo Personal bot
  records are stable only when they use separate Zalo accounts and separate
  `tokenFile` paths; never keep two listeners for the same account.

Reference links:

- https://github.com/RFS-ADRENO/zca-js
- https://www.npmjs.com/package/zca-js
- https://app.unpkg.com/zca-js@2.1.2/files/dist/zalo.d.ts
- https://www.npmjs.com/package/openzca
- https://www.npmjs.com/package/@openclaw/zalouser

## Config Contract

Add provider config under `bots.zaloPersonal`. The public config should look
like other channel configs: defaults plus named bot records.

Canonical defaults:

```jsonc
{
  "bots": {
    "zaloPersonal": {
      "defaults": {
        "enabled": false,
        "defaultBotId": "default",
        "mode": "listener",
        "dmPolicy": "disabled",
        "groupPolicy": "allowlist",
        "streaming": "off",
        "response": "final",
        "responseMode": "message-tool",
        "additionalMessageMode": "steer",
        "followUp": {
          "mode": "mention-only"
        },
        "directMessages": {},
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open",
            "requireMention": true,
            "allowUsers": [],
            "blockUsers": [],
            "allowBots": false
          }
        }
      }
    }
  }
}
```

Example bot:

```jsonc
{
  "bots": {
    "zaloPersonal": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default"
      },
      "default": {
        "enabled": true,
        "name": "default",
        "agentId": "default",
        "credentialType": "tokenFile",
        "tokenFile": "~/.clisbot/credentials/zalo-personal/default/auth-session",
        "dmPolicy": "disabled",
        "groupPolicy": "allowlist",
        "streaming": "off",
        "responseMode": "message-tool",
        "followUp": {
          "mode": "mention-only"
        },
        "directMessages": {},
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open",
            "requireMention": true
          }
        }
      }
    }
  }
}
```

Schema notes:

- The bot id is the local account identity. Two Zalo Personal accounts should
  be configured as two bot records, for example `default` and `work`.
- `credentialType` is a bot-record field, not a provider-default field. Provider
  defaults may set route and response behavior, but credential state belongs to
  a concrete bot/account.
- `credentialType: "tokenFile"` means credential-file mode, even though the
  file stores `zca-js` auth/session credentials rather than a bot token.
- Default credential file path should follow `CLISBOT_HOME`, normally
  `~/.clisbot/credentials/zalo-personal/<botId>/auth-session`.
- `tokenFile` may override the default path, matching existing token-file
  behavior.
- No credential material should be stored inline in `clisbot.json`.
- The implementation must reuse the credential-file path and redaction
  architecture without requiring a literal `botToken` input for QR login.
- The session file content is provider-owned and should be treated as an opaque
  `zca-js` auth/session document by shared config code. Shared config should own
  path resolution and redaction; provider code should own file reading, parsing,
  and validation.
- Existing token helpers are line-oriented and token-shaped. If they cannot
  safely store opaque session JSON without pretending it is a token, add a small
  session-file helper beside them instead of weakening the token contract.
- DMs fail closed by default; add exact `dm:<id>` routes for pairing or
  interaction. Do not default Zalo Personal to `dm:*` pairing because a personal
  account may have many unrelated friends. Group admission defaults to
  `groupPolicy: "allowlist"`; after a group is admitted, the `group:*` sender
  policy defaults to `open` with `requireMention: true`.
- `dmPolicy` is the summary/alias for the `directMessages["*"]` wildcard route,
  not a second independent route source. Config normalization and route CLI
  changes keep the two in sync; if a conflict appears, the explicit wildcard
  route is canonical.
- Follow-up defaults to `mention-only` because Zalo Personal group usage should
  stay mention-driven by default.
- Streaming remains `off`; Zalo Personal should be treated as append-only until
  edit/update behavior is proven.
- Route keys keep the existing raw-id model: `dm:<raw-zalo-user-id>` and
  `group:<raw-zalo-group-id>` at the CLI, raw ids inside config maps.

## CLI Contract

Cold start:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png
```

`--bot <bot-id>` may select a non-default Zalo Personal bot; omitting it uses
the provider `defaultBotId`.

Flow:

- create or update the selected `bots.zaloPersonal.<botId>` record
- bind the selected agent the same way other startup bootstraps do
- if the configured credential file is missing or invalid, start QR login
- print the concise English and Vietnamese unofficial-account warning, then
  require explicit operator confirmation before starting QR login
- print QR to the console; when `--qr-path` is provided, also save the same QR
  image there for scanning outside the terminal
- wait until scan/login succeeds, fails, or times out
- write the resulting auth/session data to the bot `tokenFile`
- start the runtime after login succeeds

Zalo Personal supports only QR login in this slice. `--qr-path` is only an
output path for the QR image; it is not a login method and not a credential
path. Successful login writes the provider-owned auth/session document to
`tokenFile`; there is no supported `credentialType=mem` QR-session mode.

Add another personal account:

```bash
clisbot bots add \
  --channel zalo-personal \
  --bot work \
  --agent default \
  --qr-path ./zalo-work-qr.png
```

`bots add --channel zalo-personal` should create the bot record and perform QR
login before returning when no valid `tokenFile` exists. It must still print the
QR in the console when `--qr-path` is present.
Keep the current `bots add` create-only contract: if the bot already exists,
tell the operator to use `bots login` for relogin or `set-*` commands for config.
Like `start`, it must show the short English/Vietnamese risk warning and require
operator confirmation before QR login.

Zalo Personal QR setup always persists the auth/session file and says where it
was written. It must not stage auth/session state only in runtime memory.

`--qr-path` should be a one-shot QR artifact path, not a credential path. The
QR file may be overwritten during login attempts and should not be used after
the scan succeeds.

Login management:

```bash
clisbot bots login --channel zalo-personal --bot work --qr-path ./zalo-work-qr.png
clisbot bots logout --channel zalo-personal --bot work
clisbot bots status --channel zalo-personal --bot work
```

`bots login`, `bots logout`, and normal `bots status` should operate through
config plus the local `tokenFile`; they must not require the detached `clisbot`
runtime process to be running. `bots status` should check auth/connection truth
by default through a bounded short-lived provider client when needed, but must
not leave a competing long-lived Zalo Web listener.

Status should reuse the existing connection/status surface instead of adding a
separate login column. Missing or expired auth is a connection failure reason.

```text
zalo-personal/work enabled=true runtime=active connection=active
zalo-personal/work enabled=true runtime=active connection=failed reason=auth-expired
```

Routes and operator sends:

```bash
clisbot pairing approve zalo-personal <code>
clisbot routes add --channel zalo-personal dm:<user-id> --bot work --policy pairing
clisbot routes add --channel zalo-personal group:<group-id> --bot work --require-mention true
clisbot routes add-allow-user --channel zalo-personal group:<group-id> --bot work --user <raw-zalo-user-id>

clisbot message send --channel zalo-personal --bot work --target dm:<user-id> --message "hello"
clisbot message send --channel zalo-personal --bot work --target group:<group-id> --message "hello team"
```

Queues and loops must use the same addressing model:

```bash
clisbot queues create --channel zalo-personal --bot work --target dm:<user-id> --sender zalo-personal:<user-id> "daily check"
clisbot loops create --channel zalo-personal --bot work --target group:<group-id> --sender zalo-personal:<raw-zalo-user-id> "every weekday at 09:00 standup brief"
```

## Implementation Plan

### Guidance Changes

Implementation must update or add operator docs alongside CLI help:

- `README.md`
  - add `zalo-personal` only after alpha is implemented, clearly marked
    unofficial
- `docs/user-guide/README.md`
  - add a channel setup entry
- `docs/user-guide/bots-and-credentials.md`
  - explain `tokenFile` for Zalo Personal auth/session files
- `docs/user-guide/zalo-personal.md`
  - document QR login, `--qr-path`, console QR output, relogin, logout, status,
    risk, single-listener caveat, and recommendation to use a separate phone
    number or Zalo account for automation
- `docs/tests/features/channels/channel-happy-path-matrix.md`
  - add Zalo Personal happy path with append-only streaming expectation
- CLI help for `start`, `init`, `bots`, `message`, `routes`, `queues`, and
  `loops`
  - include concrete `zalo-personal` examples where the command supports the
    channel

Guidance wording must stay honest:

- this is unofficial personal-account automation
- account lock/ban risk remains operator-owned
- recommend a separated phone number or Zalo account instead of the operator's
  primary personal account
- `start` and `bots add` must print this short confirmation warning before QR
  login:
  - English: `Zalo Personal is unofficial automation. Use a separate Zalo account when possible. Continue?`
  - Vietnamese: `Zalo Personal là tự động hóa không chính thức. Nên dùng tài khoản Zalo riêng nếu có thể. Tiếp tục?`
- use raw Zalo ids for routes and authorization, never display names
- if Zalo Web or another listener takes over the account, clisbot may lose the
  listener and should report a truthful status/action

### File Plan

Channel registration and contracts:

- `src/channels/integration/channel-installation-inventory.ts`
  - add `zaloPersonalChannelInstallation`
  - keep QR/session-file credentials out of token credential contracts so token
    channels retain their existing behavior
- `src/channels/catalog/registry.ts`
  - add `zaloPersonalChannelPlugin`
  - ensure bootstrap rendering/listing includes QR-capable channels, not only
    channels with token flags
- `src/channels/integration/channel-plugin.ts`
  - extend bootstrap contract so a channel can have QR login flags without
    token flags
- `src/channels/integration/operator-inventory.ts`
  - add any status/setup descriptor support needed for QR-backed credentials

Config and credential plumbing:

- `src/config/core/schema.ts`
  - add `bots.zaloPersonal`
- `src/config/core/template.ts`
  - add disabled `bots.zaloPersonal` template
- `src/config/core/load-config.ts`
  - load and validate Zalo Personal provider config
- `src/config/channels/channel-credential-contract.ts`
  - preserve existing token semantics for Slack, Telegram, and Zalo Bot
  - expose only path/redaction metadata for Zalo Personal if this remains the
    right home for the `tokenFile` path contract
  - introduce a separate session-file contract if that is cleaner than making
    token fields optional
- `src/config/channels/channel-runtime-credentials.ts`
  - keep token runtime credential helpers token-only
  - add or reuse file helpers that write opaque session content with `0600`
    permissions without staging it as runtime mem credentials
- `src/config/channels/channel-bot-credentials.ts`
  - keep token-backed `set-credentials` behavior unchanged
  - route Zalo Personal setup/login through QR-specific helpers instead of
    forcing literal token parsing
- `src/config/channels/channel-bot-management.ts`
  - let startup bootstrap create `tokenFile` bot shells without a token literal
  - keep existing mem-token expiry behavior unchanged for Slack, Telegram, and
    Zalo Bot

New provider folder:

- `src/channels/zalo-personal/installation.ts`
  - export all provider contracts
- `src/channels/zalo-personal/contract.ts`
  - route syntax, group/topic capabilities, user principal normalization
- `src/channels/zalo-personal/config-schema.ts`
  - provider schema with `groups`, `mode: "listener"`, and append-only defaults
  - bot schema with `credentialType: "tokenFile"` and `tokenFile`
- `src/channels/zalo-personal/config-template-contract.ts`
  - template defaults and example route shell
- `src/channels/zalo-personal/config-bot-contract.ts`
  - bot config ownership metadata
- `src/channels/zalo-personal/config-route-contract.ts`
  - `dm:<id>` and `group:<id>` route parsing
- `src/channels/zalo-personal/config-target.ts`
  - target config mapping for route/message CLI
- `src/channels/zalo-personal/pairing-access.ts`
  - first-DM pairing behavior with raw provider user ids
- `src/channels/zalo-personal/operator-inventory.ts`
  - startup, status, auth-required, and setup guidance
- `src/channels/zalo-personal/plugin.ts`
  - plugin registration, runtime service creation, message command handling,
    health summaries
- `src/channels/zalo-personal/config.ts`
  - resolve provider defaults and bot records
- `src/channels/zalo-personal/login.ts`
  - status, QR login, logout, console QR rendering, QR file writing, timeout
  - validate `--qr-path` parent directory and report file-write failures without
    hiding the console QR
- `src/channels/zalo-personal/zca-js.ts`
  - native `zca-js` wrapper for QR login, stored-session reuse, listener,
    login-state checks, and text send; keep unproven media helpers out of the
    first implementation
- `src/channels/zalo-personal/session-file.ts`
  - opaque auth/session file read/write, validation, redaction, and `0600`
    permissions
- `src/channels/zalo-personal/service.ts`
  - lifecycle, listener start/stop, reconnect, runtime health, single-listener
    failure mapping
- `src/channels/zalo-personal/inbound-message.ts`
  - event normalization, self-message suppression, dedupe ids, and text payload
    extraction
- `src/channels/zalo-personal/route-config.ts`
  - DM/group route admission and group mention gating
- `src/channels/zalo-personal/sender-policy.ts`
  - group allowlist and mention-gate sender decisions
- `src/channels/zalo-personal/session-routing.ts`
  - `AgentSessionTarget` resolution with `dm:` versus `group:` preservation
- `src/channels/zalo-personal/message-actions.ts`
  - outbound text through the shared `message send` action and explicit
    unsupported-media errors
- `src/channels/zalo-personal/surface.ts`
  - DM/group target parsing and prompt surface projection

Operator CLI:

- `src/control/commands/channel-bootstrap-flags.ts`
  - parse `--channel zalo-personal`, optional `--bot <bot-id>`, and `--qr-path`
  - keep `--qr-path` scoped to QR-capable channels so token-backed channel
    bootstrap behavior does not change
  - avoid relying on `tokenFlags.length > 0` as the only definition of a
    bootstrap-capable channel
- `src/control/commands/startup-bootstrap.ts`
  - run confirmation plus QR login before runtime start when needed
  - render "login required" bootstrap guidance for Zalo Personal instead of
    token-missing guidance
- `src/control/commands/init-cli.ts`
  - include first-run help and examples if `init` shares bootstrap parsing
- `src/control/commands/start-cli.ts`
  - ensure `--qr-path` help and validation are visible
- `src/control/commands/bots-cli.ts`
  - add `bots login`, `bots logout`, `bots status`
  - add `--qr-path` for `zalo-personal`
  - require confirmation before `bots add` starts QR login
  - keep token-only credential commands scoped to token-backed channels
  - ensure existing `bots get-credentials-source` does not print session
    content for Zalo Personal
- `src/control/commands/pairing-cli.ts`
  - allow approval for `zalo-personal` pairing codes using raw provider ids
- `src/control/commands/message-cli.ts`
  - allow `--channel zalo-personal`
  - add `--bot` for bot id selection; keep existing shared compatibility
    aliases out of new Zalo Personal examples
- `src/control/commands/routes-cli.ts`
  - render route help/examples for `dm:` and `group:`
- `src/control/commands/queues-cli.ts`
  - ensure `zalo-personal` address parsing works through registered channels
    and docs/help use `--bot` for bot id selection
- `src/control/commands/loops-cli.ts`
  - ensure loop target examples and addressing support the channel using `--bot`

Runtime/status:

- `src/control/runtime/runtime-health-store.ts`
  - add `zalo-personal` health key and session/connection failure details
- `src/control/runtime/runtime-summary.ts`
  - include enabled/running/connection reason in status summaries

Shared channel logic expected to remain reused:

- `src/channels/message/interaction-processing.ts`
  - no provider fork; use existing command, queue, loop, settlement, and
    processing-indicator flow
- `src/channels/message/recent-conversation.ts`
  - reuse slash-command filtering
- `src/agents/routing/*`
  - no new routing model expected
- `src/agents/session/*`
  - no new session model expected
- `src/auth/*`
  - no display-name auth; only raw provider principals

Tests and docs:

- `test/zalo-personal/config-schema.test.ts`
- `test/zalo-personal/login.test.ts`
- `test/zalo-personal/plugin.test.ts`
- `test/zalo-personal/route-config.test.ts`
- `test/zalo-personal/session-routing.test.ts`
- `test/zalo-personal/service.test.ts`
- `test/zalo-personal/control-surface.test.ts`
- `test/bots-cli.test.ts`
- `test/pairing-cli.test.ts`
- `test/startup-bootstrap.test.ts`
- `test/message-cli.test.ts`
- `test/queues-cli.test.ts`
- `test/loops-cli.test.ts`
- `docs/user-guide/zalo-personal.md`
- `docs/tests/features/channels/zalo-personal-alpha.md`
- `docs/tasks/backlog.md`
- `docs/features/feature-tables.md`

## Review And Validation

### Logic Checklist

Login and credential lifecycle:

- QR is always printed in console.
- `--qr-path` writes the QR file without suppressing console QR output.
- login command stays attached until terminal login state or timeout.
- login timeout message includes next action.
- credential file is written atomically enough for restart safety.
- `tokenFile` content is never printed in status, help, errors, or logs.
- QR login never creates or depends on `credentialType=mem`.
- existing token-backed channel credential behavior remains unchanged; do not
  add QR-specific behavior to Slack, Telegram, or Zalo Bot token paths.
- QR artifact files are never reused as auth/session files.
- session-file IO preserves opaque provider content and file permissions; it
  does not coerce the document through token-only runtime credential helpers.
- enabled bot records must not share the same resolved `tokenFile` path.
- logout removes or invalidates the local auth/session file and updates status
  truthfully.
- logout coordinates with a running listener: either stop/reload the affected
  service first, or report that a restart/reload is required.
- expired/missing credential does not silently disable the bot unless the
  existing credential lifecycle requires that behavior.

Connection/status:

- auth readiness is reported through the existing connection/status surface, not
  a separate auth column.
- `bots status` validates stored credentials without starting a second
  long-lived listener when that would conflict.
- runtime health distinguishes auth-required, auth-expired, active listener,
  listener stopped by Zalo Web, and unknown provider error.
- startup failure includes concrete operator actions.
- `bots get-credentials-source` and runtime summaries report only source/path
  hints, never session file content.

Inbound messages:

- direct-message and group events normalize to the same shared interaction
  contract used by other channels.
- `message.isSelf` or equivalent self-message signal is suppressed.
- non-text content is preserved as attachments when supported.
- attachments are bound after slash-command parsing so `/queue` with files
  keeps the files.
- event ids are deduped.
- same-conversation ordering follows the accepted-boundary ingress pattern.
- raw provider ids, not display names or bot labels, drive principals, routes,
  and allowlists.
- `dm:` and `group:` target kinds remain distinct through route/session mapping.

Admission and routing:

- first-DM pairing works with the existing owner/pairing model.
- wildcard DM route does not accidentally open every DM beyond the selected
  policy.
- groups fail closed by default through allowlist plus mention gating.
- owner/admin bypass follows existing shared-surface rules and does not bypass
  disabled surfaces or block lists.
- unrouted Zalo Personal DMs and groups are silent by default. Do not copy the
  Telegram unrouted `/whoami` guidance behavior into Zalo Personal because a
  personal account may have many unrelated friends and groups.
- raw ids learned from admitted inbound messages or a future read-only
  discovery CLI must be displayed in copyable, route-ready form such as
  `dm:<id>` or `group:<id>`.

Outbound and shared surfaces:

- `message send`, queue output, loop output, and agent replies use one provider
  transport path.
- append-only behavior disables live streaming unless edit/update support is
  proven.
- message-tool final settlement remains shared and does not leak duplicate
  `Done` messages.
- processing indicators degrade truthfully if typing/status is unsupported.
- media send follows the provider capabilities listed in the Product Contract
  and clearly errors for unproven file types.

### Regression And Test Checklist

Automated coverage expected before implementation is marked complete:

- schema load/defaults/template tests for `bots.zaloPersonal`
- config redaction and credential skip-path tests for `tokenFile`
- config/schema test proving `credentialType` is accepted on bot records, not
  required in provider defaults
- default credential path test, including `CLISBOT_HOME` override:
  `~/.clisbot/credentials/zalo-personal/<botId>/auth-session`
- test proving QR setup does not require `--bot-token`, env placeholders, or
  runtime mem credentials
- session file parse/validation test with provider-owned opaque content
- session file permission/redaction test for opaque auth/session content
- `--qr-path` parent-directory failure test proving console QR rendering still
  happens when file save fails
- startup bootstrap parsing for `--channel zalo-personal`, `--bot`, and
  `--qr-path`
- bootstrap help/listing test proving QR-capable channels appear even with no
  token flags
- startup bootstrap regression proving token-backed channels still reject
  unrelated QR-only flags and keep existing token behavior
- `clisbot start` QR flow unit test with console QR plus file QR
- `bots add --channel zalo-personal` creates bot/tokenFile config
- `bots add --channel zalo-personal` persists the auth/session file without
  requiring token-style `--persist`
- `bots add --channel zalo-personal` remains create-only for existing bot ids
- `bots login` success, timeout, failed login, and QR file output
- `bots logout` credential cleanup
- `bots status` with connection reason for missing or expired auth
- `bots get-credentials-source` redaction/source-output test for session files
- CLI help snapshots or assertions for start/init/bots/message/routes/queues/loops
- message/queue/loop CLI tests proving Zalo Personal examples use `--bot`
- plugin registration and operator inventory tests
- runtime health mapping for active, auth-required, auth-expired, listener
  conflict, and unknown failure
- route config tests for `dm:<id>`, `dm:*`, `group:<id>`, and `group:*`
- first-DM pairing, `pairing approve`, and allowlist tests using raw Zalo ids
- group mention gating tests
- inbound DM/group normalization tests
- self-message suppression test
- attachment preservation tests, including `/queue` with one or more files
- media tests for send one image, send many images, send from local file, send
  from URL, receive one image, receive many images, send/receive audio or voice,
  and unsupported-media errors when a capability is not proven
- queue and loop target addressing tests
- append-only streaming rejection or forced-off behavior tests
- message-tool final settlement regression for queued and non-queued runs
- processing indicator lifecycle tests if typing/status is implemented

Validation gates:

- targeted tests listed above
- `bunx tsc --noEmit`
- `bun run build`
- `bun run check`
- `git diff --check`
- contract scan for removed or non-goal CLI terms:
  - ``--backend``
  - `zca-cli first`
  - `openzca fallback`

Live validation before alpha release:

- QR shown in console from a terminal-only run
- QR saved to file through `--qr-path`
- QR scan succeeds and writes credential file
- restart reuses stored credential file
- `bots get-credentials-source` reports the credential file source without
  leaking session content
- DM round-trip
- group round-trip with allowlist and mention gate
- `bots status` reports active connection
- logout makes next status/login flow truthful
- opening Zalo Web while listener is active produces the expected status or
  recovery guidance

### Implementation Guardrails

- Do not expose a public backend selector or separate auth-status command in the
  first slice; the contract is `zca-js` plus shared `bots login/logout/status`.
- Do not copy Telegram or Zalo Bot assumptions blindly; Zalo Personal has
  personal-account QR login, unofficial risk, and single-listener behavior.
- Do not turn `bots add` into an upsert just for QR login; preserve existing
  bot-management semantics and put relogin under `bots login`.
- Do not authorize by display name, phone label, or group title; use raw
  provider ids only.
- Do not let wildcard DM config accidentally admit all DMs; preserve pairing
  defaults.
- Do not enable streaming on an append-only channel unless update/delete support
  is proven and tested.
- Do not attach files before slash-command parsing; `/queue` and shortcuts must
  keep attachments.
- Do not split queue/message-tool settlement into provider-specific logic; the
  shared final-marker rules have recent regressions and tests.
- Do not lose `CLISBOT_HOME`/runtime-home truth in live validation; wrapper/home
  mismatch has caused false runtime conclusions before.
- Do not leak QR/session/credential data into docs, status, logs, diffs, or
  review comments.
- Do not leave CLI help, user guide, tests, task docs, and feature tables out of
  sync.

### Definition Of Done

- `zalo-personal` is implemented as an unofficial alpha channel.
- Native `zca-js` works end to end without a paid dependency.
- No public `--backend` option is exposed.
- Config uses `bots.zaloPersonal` and `credentialType: "tokenFile"`.
- `--qr-path` works for `clisbot start`, `clisbot bots add`, and
  `clisbot bots login`.
- QR is always printed in the console.
- `clisbot bots login`, `clisbot bots logout`, and `clisbot bots status` work.
- Status shows auth problems through the existing connection/status surface.
- DM and group routes work with raw Zalo ids.
- Queues and loops work on DM/group targets.
- Setup, troubleshooting, and risk docs are honest.
- All automated and live validation gates in this plan pass.
