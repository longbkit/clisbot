# The channel platform

How a chat platform becomes a channel in this repo: where the code lives, what contract it implements, what the Hub does with it, and what you have to touch to add the next one.

User-facing setup lives in [public-docs/hub/channels](../public-docs/hub/channels/index.md). Day-to-day operation lives in [channels-operations.md](channels-operations.md). This doc is for the person writing or porting a vertical.

## Three owners, and why

| Owner            | Owns                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The **vertical** | Protocol facts: how this platform addresses a conversation, formats a message, chunks, mentions, uploads, and what its API refuses. |
| The **Hub**      | Credentials, accounts, routing, durable admission, the agent seam, operator surfaces.                                               |
| The **daemon**   | Agent lifecycle. A channel never talks to it directly.                                                                              |

Every boundary dispute resolves the same way: if the answer changes when the platform changes, it is the vertical's; if the answer changes when the deployment changes, it is the Hub's. That is why upstream OpenClaw's inbound pipeline — routing, pairing, media policy, dispatch, the reply closure — is _omitted_ from every port and re-entered through `fusion/`.

## Package layout

Ports keep upstream's tree so the next sync is a diff, not a re-read.

| Upstream root                                                                                           | Local root                                        | Package                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `extensions/<channel>/src/`                                                                             | `packages/channels/<channel>/src/`                | `@getpaseo/channels-<channel>`     |
| `packages/markdown-core/src/`                                                                           | `packages/channels/markdown-core/src/`            | `@getpaseo/channels-markdown-core` |
| `src/agents/tools/`, `src/channels/plugins/`, `src/infra/outbound/`, `src/plugin-sdk/` (selected files) | `packages/channels/core/src/<same relative path>` | `@getpaseo/channels-core`          |

Relative paths and file names under a root stay identical to upstream. Only import specifiers are rewritten. Fusion-owned code — anything with no upstream counterpart — lives outside those roots, which in practice means `src/fusion/` and `packages/hub/**`.

Two packages have no upstream root at all: `packages/channels/shared` is the contract this repo invented, and both it and `core` are consumed by every vertical.

**Never run the formatter over a ported file.** The local oxfmt reflows constructs upstream's does not, which breaks byte fidelity and fails the sync check. `.oxfmtrc.json` carries the ignore list; add a file there when the check reports a whitespace-only mismatch.

## The shared contract

`packages/channels/shared/src` is the whole type surface a vertical implements. Four things matter.

**`ChannelPlugin`** (`packages/channels/shared/src/plugin.ts:62`) is the drive surface: `gateway.startAccount`, `outbound.sendText`/`sendMedia`, `messageActions`, `directory`. It has an **open key set** on purpose. `agentTools`, `actions`, and `setup` ride there untyped, and the Hub reads them structurally (`packages/hub/src/channels/channel-agent-tools.ts:58`, `packages/hub/src/channels/supervisor/qr-login.ts:35`). Adding a slot to the typed part of `ChannelPlugin` forces every vertical to know about a feature only one of them has; the open key set is how one channel ships a QR wizard without the other six growing a field.

**`HostRuntime`** (`packages/channels/shared/src/host.ts:186`) is what the Hub injects: `onInboundReply`, keyed state stores, logging, and the optional `inboundLedger` and `inboundQueue`. `packages/hub/src/channels/loader/host.ts:173` declares a structurally identical copy. That duplication is deliberate — a vertical importing Hub code would make the Hub a dependency of its own plugins, so the two files are kept in step by the contract tests rather than by a shared import.

**`InboundQueueSink`** (`host.ts:141`) is the durable seam. `fail` takes a disposition of `retry`, `dead-letter`, or `release` (`host.ts:175`); `release` returns the row unattempted and does **not** spend retry budget, which is what makes back-pressure different from failure.

**`ChannelInboundEvent`** (`packages/channels/shared/src/monitor.ts:127`) is the normalized event an L2 transport emits. `kind` (`monitor.ts:34`) is one of `message`, `command`, `callback`, `edit`, `delete`, `reaction`, `member`, `channel`, `pin`, `topic`, `poll_answer`, `interactive`; absent means `message`. `facts` (`monitor.ts:113`) carries exactly one typed member per kind, so a reaction event is not a message with a weird body. The Hub's routing policy is keyed on `kind` (`packages/hub/src/channels/plane/inbound-kinds.ts:95`), and that is what stops a topic-rename event reaching an always-reply agent as plain text.

`kind` and `facts` cross the wire flattened, as `EventKind` and one `EventFacts` key (`monitor.ts:198`), because the ctxPayload the ported host code reads is flat.

## Durable admission

**Nothing acknowledges the platform before the event is durably stored.** This is the invariant the whole reliability story rests on, and each transport family expresses it differently:

| Family      | Channels                                                   | What "before the ACK" means                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Socket**  | Slack Socket Mode, Feishu long connection, Discord gateway | The socket ACK is sent after `enqueue` returns. A gateway `RESUME` redelivery is dropped by message-id dedupe, not replayed.                                                                                                            |
| **Poll**    | Telegram, Zalo                                             | The update watermark advances only after admission. Zalo has no watermark at all — the loop admits, retries in place, and drops loudly rather than asking for the next update on a failed store.                                        |
| **Webhook** | Google Chat, Zalo, Telegram, Feishu, Slack Events API      | The `200` is written after admission. A failed store answers `503`/`500` so the platform redelivers; a malformed envelope answers `400` so it does not. Signature verification runs _before_ the body is read past a pre-auth size cap. |
| **Push**    | Zalo Personal                                              | There is no ack and no cursor. Admission is retried a bounded number of times and then dropped with an error-level line — the only family where a lost message is possible, stated rather than hidden.                                  |

A transport that cannot express the invariant does not ship. If you find yourself acknowledging first "because the provider window is short", the exception has to be written down: Slack slash and interactive callbacks are ACK-first because Slack closes the response window in three seconds, and that is the only one.

## The Hub side, in order

One inbound message walks this path. Each row is the file to open.

| Stage               | File                                                               | What it decides                                                                                                          |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Catalog             | `packages/hub/src/channels/catalog.ts:85`                          | Metadata only: label, auth kind, transports, credentials, claimed capabilities, extra tools.                             |
| Supported names     | `catalog.ts:512`                                                   | `SUPPORTED_CHANNEL_NAMES` — every channel union, zod enum, `Record` key and DB check constraint derives from this tuple. |
| Pins                | `packages/hub/channel-pins.json`, `channels/install/pins.ts:141`   | Which supply serves the channel: `published`, `bundled`, or `in-repo`.                                                   |
| Loader              | `channels/loader/load-channel.ts:213`                              | Imports the entry, calls `setChannelRuntime`, produces the plugin.                                                       |
| Config enums/schema | `channels/config/enums.ts:14`, `config/schema.ts`                  | What an operator may author on an account and a Route.                                                                   |
| Compile             | `channels/config/compile.ts:199`, `compile-support.ts:195`         | Authored YAML → `ChannelControlPlane`. `DRIVABLE_TRANSPORT_MODES` is where a mode the Hub cannot receive on is refused.  |
| Account carriers    | `channels/supervisor/account-carriers.ts:162`                      | The per-account credential projection handed to `startAccount`. See below.                                               |
| Connections         | `db/channel-connections.ts:29`, `credentials/credential-cipher.ts` | One table per channel; AES-256-GCM envelope bound by AAD to its scope.                                                   |
| Supervisor          | `channels/supervisor/index.ts:607`                                 | Starts, stops, reconciles accounts; owns transport state.                                                                |
| Ingress queue       | `db/channels.ts:571`, `channels/ingress/drain.ts:347`              | Durable rows, claim lease, fencing, per-lane exclusion, retry, dead-letter.                                              |
| Plane routing       | `channels/execution.ts:201`, `plane/inbound-kinds.ts:95`           | Route match, access, mention policy, and the per-`kind` disposition.                                                     |
| Message tool        | `channels/channel-reply.ts:92`, `channel-message-tool.ts:128`      | The MCP `message` tool and the per-channel action catalog.                                                               |
| Outbound media      | `channels/media/outbound-stager.ts:183`                            | A send's `media`/`attachments`/`buffer` → one staged local file per attachment. See below.                               |
| Channel agent tools | `channels/channel-agent-tools.ts:70`                               | Mounts `plugin.agentTools` on the reply MCP server, authorized per call.                                                 |
| Streaming producer  | `channels/streaming/producer.ts:88`                                | Turns the turn's accumulating text into an edit-in-place draft.                                                          |

### What a carrier is

`startAccount` gets two views of the same account (`account-carriers.ts:24`): a **flat** `ctx.account` and a **nested** `cfg.channels.<ch>.accounts.<id>`. Upstream code reads one or the other depending on which module it came from, so both are built, from the same source, every time. Connection credentials always beat authored config — an operator cannot override a stored token from a config file.

This is also the seam that once broke every non-token channel at a stroke: an earlier version forwarded only `botToken`/`appToken`, which silently disabled Feishu, Google Chat, and Zalo starts. Build the carrier for the fields the vertical actually reads, and add a case to `account-carriers.test.ts`.

### Outbound files

One tool sends text and files: `message` `send` with upstream's `media`,
`attachments[]`, `buffer`, `caption` and `asVoice`. There is no separate file
tool — the earlier `send_file` is deleted, not aliased.

Authority for a local path is the reply capability's Project root, never the
model's argument, and containment is checked after `realpath` on both sides so a
symlink inside the Project cannot point out of it. A remote `http(s)` source is
the one URL Hub code dereferences on a model's word, so it goes through
`channels-shared`'s guarded read: public hosts only, no redirect followed, and
the channel's own outbound cap enforced on `Content-Length` and again on the
bytes.

Two things about the staging seam are not visible from either side alone:

- **Core stages `buffer` itself.** `message-action-params.ts` decodes inline
  bytes through the same media host adapter the Hub backs, then rewrites the
  send to the staged _path_. So the stager is handed a file it just created,
  under the staging root rather than the Project, and has to recognize its own
  output — otherwise every `buffer` send is refused as an escape.
- **A stager is per call, not per process.** It is installed in an
  `AsyncLocalStorage` scope next to the outbound sender, because one Hub serves
  many organizations and each call stages under its own Project root and its own
  channel cap.

One `send` becomes several platform messages: the body, then one per attachment,
each with its own delivery-ledger row under one `eventTurnId`. A failure part
way through reports `sentBeforeError` with the per-message receipts, so the
agent can tell "nothing posted" from "the text posted, the file did not".

### Why the queue exists at all

Upstream's `ingress-queue.ts` / `ingress-drain.ts` are not portable: they are written against a single-process SQLite file with `pid@boot-id` claim ownership and `blockedLaneKeys` computed in memory. The Hub serializes lanes inside the claim statement instead (`db/channels.ts:647`). What _is_ shared is the policy — `ingress-retry-policy.ts` is ported verbatim into `@getpaseo/channels-core`, so Fusion and OpenClaw agree on the backoff schedule, attempt ceiling, and dead-letter minimum age. The Hub only supplies its own non-retryable classes (`channels/ingress/non-retryable.ts:23`).

One consequence worth knowing before you read the drain: a Fusion claim consumes its attempt at claim time, so the stored count is shifted back by one before upstream's policy sees it (`drain.ts:259`).

## The `fusion/*` pattern

Every vertical has a `src/fusion/` directory, and the split inside a package is the same everywhere:

- **Outside `fusion/`** — the port. Upstream's file names, upstream's code, only specifiers rewritten. Do not rename, reorganize, or "clean up" these files; every edit is paid for again at the next sync.
- **Inside `fusion/`** — Fusion-owned replacement code at the exact boundary where upstream depended on an OpenClaw host that does not exist here.

The recurring members, and what each replaces:

| File                                                                                  | Replaces                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `account-config.ts`                                                                   | Upstream's config-file account resolution → the Hub carrier. |
| `inbound-adapter.ts`                                                                  | Upstream's monitor normalization → `ChannelInboundEvent`.    |
| `admission.ts`                                                                        | Upstream's dispatch → the durable queue.                     |
| `polling-session.ts` / `webhook-session.ts` / `ws-session.ts` / `listener-session.ts` | Upstream's `monitor.ts` transport loop.                      |
| `runtime.ts`, `runtime-api.ts`, `runtime-env.ts`                                      | Upstream's global runtime closure → `HostRuntime`.           |
| `tools.ts`                                                                            | Upstream's plugin-SDK tool registration → the Hub registrar. |
| `ssrf-fetch.ts`, `proxy-fetch.ts`, `secret-file.ts`                                   | Upstream's pinned dispatcher stack → an explicit guard.      |

A boundary that is not on this list is a signal: either the vertical is doing something the Hub should own, or the Hub is missing a capability the vertical genuinely needs. Widen the seam; do not narrow the native behaviour to fit an old interface.

## The deviation ledger

Every package carries `upstream-sync.json`: `{ upstreamRepo, baselineCommit, roots[], files[], omitted[], deviations[] }`.

- A `files[]` entry is `{ local, status, upstream?, deviation?[] }` with status `verbatim | adapted | reimplemented | fusion-owned`.
- `fusion-owned` must carry **no** upstream path. `adapted` and `reimplemented` must cite at least one deviation id.
- A `deviations[]` entry is `{ id, file?, reason, tests?[] }` with ids shaped `D-<CH>-NNN`.
- `omitted[]` names an upstream file deliberately not ported, with a reason.

`npm run channels:sync:check` (`scripts/channel-upstream-sync.mjs:274`) enforces all of it: every local production file has an entry, every `verbatim` file byte-matches `git show <baseline>:<upstream>` after normalizing away only the `// upstream:` header line, module specifiers, and trailing whitespace, every deviation id is unique and referenced, and unmapped upstream files warn (fail under `--strict`).

Prose descriptions of deviations do not count. The ledger is the record, `DEVIATIONS.md` in the two oldest packages is history, and the reason field is where the "why" goes.

At every sync, walk the ledger: an entry upstream has since fixed gets deleted and the local deviation reverted; an entry upstream will not fix keeps its row with an updated status. That walk is the mechanism that keeps "we deviate when we must" from turning into permanent unexplained drift. The procedure lives in [upstream-sync-and-contribution.md](guides/developer-guide/upstream-sync-and-contribution.md#openclaw-channel-source-manifests).

## Adding a channel

Ordered, and each step names the file. Derived from how Zalo and Feishu were wired; each vertical's own `HUB-WIRING.md` is the handoff document its author wrote for this step, and it is the first thing to read.

**In the vertical package:**

1. Port the upstream extension into `packages/channels/<channel>/src/`, keeping paths and file names. Depend on the same third-party SDKs at upstream's versions.
2. Write `src/fusion/` for each boundary: account config, inbound adapter, admission, transport session, runtime shim.
3. Publish `ChannelPlugin` from `src/plugin.ts` and a `createChannelEntry` default export from `src/entry.ts`.
4. Fill `upstream-sync.json` and get `npm run channels:sync:check` to PASS.
5. Write `HUB-WIRING.md`: catalog shape, transports and required config, the pin, config keys, carrier field names, connection credentials, tool entry points, and what you did **not** wire.

**In the Hub:**

6. `packages/hub/src/channels/catalog.ts` — the entry, and its name in `SUPPORTED_CHANNEL_NAMES`. Claim a capability only when a test on the production path proves it.
7. `packages/hub/channel-pins.json` — `loadMode: "in-repo"`, `inRepoPackage`, `entry`, `plugin.{specifier,exportName}`.
8. `channels/loader/vertical-contract.native.ts:67` — add to `LATER_IN_REPO_CHANNELS`.
9. `channels/config/compile-support.ts` — a transport schema, the one drivable mode, and the account's drive-path config keys.
10. `channels/config/schema.ts` — only if the account needs new authored leaves.
11. `db/schema.ts` + a drizzle migration — the per-channel connection table. Check constraints regenerate from the catalog tuple.
12. `db/channel-connections.ts` and `db/types.ts` — register the table and its credential field names.
13. `channels/connections/<channel>.ts` — probe then configure, with a differential test pinning the probe to the vertical's own `probe.ts`. **Probe before storing**, so a wrong credential fails at setup rather than at the first message.
14. `channels/supervisor/account-carriers.ts` — the builder, both views.
15. `channels/http/operations.ts` and `management-api/index.ts` — the configure input schema and the default transport.
16. `channels/channel-message-tool.ts:128` — the advertised message actions.
17. `channels/streaming/driver.ts:35` — the channel's draft limits.
18. `channels/plane/inbound-kinds.ts` — only if the vertical emits a `kind` the table does not cover.
19. `packages/cli/src/commands/channels/secret-file.ts` — the credential file shape, if it is a new one.
20. Tests: `catalog.test.ts`, `config/compile.test.ts`, `supervisor/account-carriers.test.ts`, `connections/<channel>.test.ts`, and a live-boot case that drives the real built `startAccount`.

`channel-agent-tools.ts` needs no edit. The Hub reads `plugin.agentTools` off the loaded vertical; Hub production code never imports a channel package, which is why Feishu's tools reach the agent without a Hub-side import despite what its `HUB-WIRING.md` §7 originally proposed.

## Access policy

Two gates decide whether an inbound message may start a turn, and both have to
allow. Operator-facing behaviour is documented once, in
[`public-docs/hub/channels/index.md`](../public-docs/hub/channels/index.md); this
is why it is shaped the way it is.

The **sender gate** is upstream's. `resolveDmGroupAccessWithLists` is ported
verbatim into `@getpaseo/channels-core/security/dm-policy-shared`, and
`policy/access.ts` supplies only the three things upstream reads from its own
config and its own SQLite store: the folded `access:` block, the operator-approved
pairing list, and whether the conversation is a group. Nothing about `dmPolicy`,
`groupPolicy`, `allowFrom` or `groupAllowFrom` is re-derived here, so an upstream
change to the matrix arrives as a sync, not as a rewrite.

The **role gate** is the Hub's, because upstream has no role vocabulary — it has
an allowlist and a command-owner check. `policy/roles.ts` is a projection of the
privilege model in `channels/policy.ts`, not a second RBAC: an `approval.*`
holder is an `admin`, a linked identity with `bot.interact` is a `member`, and
the bound session's initiator is its `owner`.

Three shapes are worth knowing:

- **`access:` absent means the gate does not run.** Upstream's own defaults
  (`dmPolicy: pairing`, `groupPolicy: allowlist`) are fail-closed, and adopting
  them as an org floor would have silently denied every conversation on every
  already-deployed revision. So the compiler omits the key unless a layer
  authored a leaf — the same trick `sync.streaming` uses — and a revision
  written before the knob existed admits exactly what it always did.
- **An access-gate `allow` is itself a grant.** `mayUseChannelRoute`
  (`policy/gate.ts`) is the one implementation both `execution.ts` and the
  bindings engine call, and a sender the `access:` block admits passes it even
  with no Hub identity. Without that, pairing would be theatre: an
  operator-approved stranger has no linked identity and no role, so approval
  has to be the grant.
- **The `/agent` and `/model` choice is conversation-scoped, not
  binding-scoped.** It cannot live on `thread_bindings`: a choice is made before
  the first turn as often as after one, and `/new` deletes that row.
  `channel_conversation_selections` outlives every session in the conversation
  and is read in `bindings/index.ts` at the one place a session is minted.
  Switching ends the running session because a Paseo agent's model is fixed at
  create time — there is no set-model RPC, and pretending otherwise would report
  a model the agent is not running.

## What is still open

Claimed nowhere else, so it belongs here rather than in a stale audit: secret redaction, callback authority, and SSRF limits are partial; delivery receipts and a diagnostics command have no operator surface. The goal ledger `docs/audits/2026-09-07-openclaw-channel-port-goal.md` tracks them slice by slice and is the current source of truth for what is done.
