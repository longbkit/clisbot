# Channel operations

Running, debugging, and live-testing the channel plane. The platform itself is [channels-platform.md](channels-platform.md); user-facing setup is [public-docs/hub/channels](../public-docs/hub/channels/index.md).

## The dev-home live loop

Live channel work runs against one fixed home, reused across runs so offsets, bindings, approval state, and agent threads stay inspectable. **Never `~/.paseo`** (a real daemon owns it and port 6767) and never this checkout's `.dev/paseo-home`.

| Thing  | Value                                                      |
| ------ | ---------------------------------------------------------- |
| Home   | `~/.clisbot-dev` (`CLISBOT_HOME`)                          |
| Hub    | `127.0.0.1:6868`                                           |
| Daemon | `127.0.0.1:6867` — the loop never stops it                 |
| Log    | `~/.clisbot-dev/hub.log`                                   |
| Binary | `node packages/cli/bin/paseo`, never a built `dist/cli.js` |

`scripts/e2e-dev.sh` is the only entry point. Anything it does not do, do by hand and then teach it:

```sh
scripts/e2e-dev.sh build      # hub stop --force, then npm run build:hub
scripts/e2e-dev.sh restart    # stop, source the password, start detached
scripts/e2e-dev.sh foreground # same, but attached and tee'd into hub.log
scripts/e2e-dev.sh status     # paseo channels status
scripts/e2e-dev.sh logs -f
scripts/e2e-dev.sh stop
```

`build` stops the Hub first on purpose: the Vite build is OOM-killed (exit 137) on an 8 GB box with the Hub resident.

**The Hub's daemon link needs no password.** The dev home's daemon pairing is persisted (`~/.clisbot-dev/hub-relationship.json`, `state: "active"`), so a Hub started with no `PASEO_PASSWORD` in its environment connects — `channel daemon connected`, verified 2026-09-07 on a Hub started straight from `~/.clisbot-dev/start-hub.sh`, which exports neither the password nor a password file.

`PASEO_PASSWORD` is still the **daemon WS subprotocol** credential a _trusted client_ opens `/ws` with: `scripts/live-trusted-client.mjs` and the revision writer's provider-catalog check read it from the environment. `scripts/e2e-dev.sh` sources `~/.clisbot-dev/.daemon-password` (`PASEO_PASSWORD=<value>`, mode 0600) when that file exists and warns when it does not; on this box it no longer exists, so export the variable for those two drivers or expect them to fail to authenticate. Nothing about the channel plane depends on it.

**Start the Hub with `~/.clisbot-dev/start-hub.sh`, not `scripts/e2e-dev.sh restart`.** The script's `paseo hub start` path looks for the credential master key as a sibling of the home directory, which is not where it lives (`~/.clisbot-dev-secrets/hub-credential-master-key`); `start-hub.sh` exports `PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE` and runs `packages/hub/bin/paseo-hub.js` directly. The cost is that the local Hub record is not refreshed: `~/.clisbot-dev/hub-local.json` keeps the PID of whichever Hub `paseo hub start` last launched, so `paseo channels status` (and `scripts/e2e-dev.sh status`) refuses with "records PID N, but that process is not running". Read account startup from `hub.log` instead — `telegram account started`, `slack socket mode connected`, `channel daemon connected` — until the record is rewritten by a `hub start`.

**Never `source` the repo `.env` for a Hub process.** `SLACK_APP_TOKEN` without `SLACK_TRANSPORT=socket` throws at boot. The `.env` is for test drivers, not for the Hub.

### Writing a config revision

Live channel configuration lives in the Hub DB's active revision, not on disk. `.hub-revision-write.mjs` is the durable template and `.hub-revision-write12.mjs` is the current-generation copy of it, re-targeted at the organization-scoped store. Keep both; the template is what the next scenario is derived from.

The invariant is **STOP < WRITE < START** — the writer opens the PGlite data directory directly, so the Hub must be down or the data-dir lock is held.

What the template does, and why each step is worth keeping when you fork it:

1. Derives from a captured baseline JSON, never from the drifting active revision. Chaining off "whatever is live" is how a scenario silently inherits a previous run's edits.
2. Pre-compiles the bundle and the channel control plane before writing. A revision that fails to compile after activation takes the plane down.
3. Validates every Route's agent target against the daemon's live provider catalog over a plain trusted `/ws` session. "The binary is installed" is not the same as "the provider is enabled on that daemon".
4. Inserts and activates in one pass; any failure aborts without writing.
5. Rewrites `policy.yml` only through an explicit transform, so grants survive by construction rather than by remembering.

It takes a scenario argument so several non-conflicting scenarios share one stop/write/start cycle, which is about 90 seconds each.

### Asserting a live run

One script per surface, each ending in a single `VERDICT` line:

| Surface           | Script                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Slack             | `scripts/slack-live-assert.mjs post --text … [--thread-ts] [--expect]` / `check --since HH:MM` |
| Telegram          | `scripts/tg-live-assert.mjs` — same verbs plus `--drain`                                       |
| Paseo permissions | `scripts/live-trusted-client.mjs list \| answer \| watch`                                      |

Telegram's asserter combines the driver bot's `getUpdates` stream with the Hub's content-free `relay post completed` line, because Telegram does not reliably deliver bot-authored group messages to another bot.

**Match on content, order, and time — never on ids across observers.** A simulated or bot-side observer gets its own id sequence; comparing one observer's message id to another's produces confident nonsense.

The driver and the bot under test are always different accounts. A direct `sendText` from the account under test is an outbound smoke test and is not evidence of anything else.

### The stop rule

> If three consecutive live restarts each surface one new seam bug and no message has crossed the channel, stop restarting and write the integration test instead. Serial discovery does not converge.

The test to write is a real-both-sides boot test asserting every account reaches `started`. This rule has fired and paid: the fast tier it forced found a production bug (a hello watchdog left armed on the success path) that the live loop had been reading as flake.

Two companions:

- Probe the LLM layer cheap-to-expensive **before** burning a revision cycle: `command -v`, then read-only provider RPCs on a trusted `/ws`, then one minimal agent turn. Only then stop, write, and start.
- Gate re-drives on code change. A scenario that passed and whose code path did not change is not re-driven just because the plane restarted.

## Turning the channel plane off

`CLISBOT_HUB_CHANNELS_ENABLED=0` on the Hub process is the operator kill switch (`0`, `false`, `no` and `off` all disable; anything else, including absent, leaves it on). It is read at process entry and resolved to the internal `PASEO_HUB_CHANNELS_ENABLED` name the fork code uses.

Off means the plane never exists, not that it is idle: no supervisor is composed, no account starts, no vertical is loaded, no channel agent tool is registered, no reply MCP endpoint is mounted, and the retention sweep never arms. The channel catalog, the activity page and all four queue verbs answer `404 channels_disabled` — `404` rather than `403`, because the resource does not exist on this Hub.

Two resources are not gated yet and still answer with the plane off: `channel-configuration` (read, validate, deploy, revision list) and the per-account `conversations`, `test-preview`, `retry` and `test` operations. Deploying a revision on a flag-off Hub therefore succeeds and reconciles nothing; the accounts start when the flag comes back on. Tracked as open on slice 26 of the goal ledger.

Nothing is destroyed. Connections, thread bindings, delivery-ledger rows, queue rows and the active configuration revision all sit untouched, and turning the flag back on resumes from them. The switch is a boot-time decision — restart the Hub after changing it.

## Queue operations

All four verbs are organization-scoped on the management API under `/api/management/v1/organizations/{orgId}/`, behind the `manageChannels` capability — owner and admin hold it by default. It is separate from `manageResources` because a channel account is a live credential to an outside workspace and its backlog holds message content: an organization can grant Project and daemon administration without granting the channel plane. Writing or deleting a channel bot Connection (`POST`/`DELETE /connections` with an `accountId`) is on the same capability, for the same reason; every other Connection stays on `manageResources`.

| Verb     | Route                           | Notes                                                                                                                                                                                                            |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status   | `GET channel-ingress`           | Depth per account plus an organization total.                                                                                                                                                                    |
| list     | `GET channel-ingress/events`    | `channel`, `accountId` (rejected without `channel`), `status`, `limit` 1–200, `offset`.                                                                                                                          |
| resubmit | `POST channel-ingress/resubmit` | Body `{ ids: [...] }`, 1–200 rows.                                                                                                                                                                               |
| prune    | `POST channel-ingress/prune`    | Body `{ completedOlderThanMs?, deadLetteredOlderThanMs? }`; absent falls back to the retention TTL. `completedOlderThanMs` is refused under an hour: a completed row is the replay guard for its provider event. |

The app renders all four under **Channels → Operations**.

**Payloads never leave the queue.** A listed row carries ids, status, attempts, lane key, external ids, timestamps, and the last error — no message body. Do not add one; the queue is not an inspection surface for user content.

Per-account depth is also merged into `channel-accounts/status`, because the queue outlives a transport: a stopped account still reports its backlog.

### What the statuses mean

`pending → claimed → completed`, or `failed` (retry scheduled), or `dead_letter`.

Resubmitting a dead-lettered row restarts its retry budget and its retention age, not its place in the lane: `created_at` is arrival order, so a recovered event is answered before the messages that arrived while it sat in the dead letter.

Dead-lettering needs **both** conditions: the attempt ceiling reached _and_ the row at least 24 hours old. A row that fails eight times in a minute keeps retrying — the minimum age is what stops a transient outage from burning the whole budget.

A **deferral** is not a failure. Route concurrency and rate ceilings release the row unattempted, due again after a backoff, without spending retry budget.

Because a release gives the attempt back, the retry ceiling can never end a row the plane keeps deferring — so releases have their own budget: 50 releases, or 24 hours since admission, and the row dead-letters with `failed_reason: release-budget-exhausted` and a `channel inbound event released past its budget` error line. Back-pressure that never clears is a stuck lane, and the operator has to be able to see it and resubmit.

Some failures skip retry entirely and dead-letter on the first attempt: an unparseable payload, a missing agent or workflow target, an invalid account configuration, and channels being disabled. Retrying those changes nothing.

### Retention

One hourly sweep per supervisor, across every organization with queued rows. Completed and dead-lettered rows are kept 30 days. A sweep fault does not kill the timer; the next tick retries.

The sweep also deletes `pending` and `failed` rows admitted (or resubmitted) more than 30 days ago. The release budget already ends anything a drain can still claim, so what is left at that age is a row no drain reaches: an account deleted with a backlog behind it, or a lane whose head was lost. A `claimed` row is never swept — lease recovery owns it.

Fusion exposes TTL cutoffs only. Upstream also caps completed and failed rows per queue by count; until an operator hits that shape, the TTLs are the whole policy.

### Resubmitting

`resubmit` resets a dead-lettered row to pending with `attempts: 0`, a fresh `availableAt`, and a `resubmittedAt` stamp. The budget genuinely restarts — the retention sweep and the dead-letter minimum age both read `resubmittedAt` when it is set — while `createdAt` keeps the row's arrival order, which is what its lane is answered in. Rows that are not dead-lettered are left alone and do not appear in the result.

## Service-account files

Google Chat's credential is the service-account JSON document. The FILE form stores only a path, which the Hub reads with its own privileges — so the path must resolve inside an allowlisted secrets directory: `PASEO_HUB_CHANNEL_SECRETS_DIR` (colon-separated, `CLISBOT_HUB_CHANNEL_SECRETS_DIR` aliases onto it), defaulting to `/run/secrets`. Symlinks are resolved before the check, so a link planted inside the mount cannot point out of it.

Every refusal — outside the allowlist, absent, a directory, over 64 KiB, unreadable — is the same sentence. That is deliberate: distinct messages would turn a management-API call into a filesystem oracle. If a mount that should work is refused, check the allowlist and the file mode; the Hub will not tell you which one it was.

## `needs-login` and QR relink

`needs-login` is a transport state, reachable only by a channel whose catalog entry declares `auth: qr` (today, Zalo Personal). It is set when the account's own start fails with a not-linked or not-authenticated detail, and it is **terminal for reconcile** — restarting just re-runs the same failed session probe.

Clearing it takes two steps:

1. Complete the QR login: `POST channel-accounts/{channel}/{accountId}/qr/start` (or `/relink` for a dead session), then `POST .../qr/poll` until it reports `linked`. A `linked` answer means the session is already durable: the vertical writes it through the synchronous keyed store, and the Hub awaits that store's encrypted backing before it answers. Every verb is a POST, `poll` included, because polling advances the vertical's state machine. `profile` comes from the Hub's own account carrier — a request never names one, and responses are rebuilt field by field so session bytes cannot travel back out.
2. Restart the account: `POST channel-accounts/{channel}/{accountId}/retry`, or deploy a new configuration revision. Reconciling the _same_ revision will not clear it.

`logout` clears the stored session and leaves a revocation marker; `cancel` only abandons a pending code and refuses to touch a healthy session.

A first start landing in `needs-login` is the designed path for a QR channel, not an error. Treat relink as routine: personal-account sessions die for ordinary reasons.

## The credential master key

Channel credentials and encrypted channel state are sealed with AES-256-GCM under one key, supplied as `PASEO_HUB_CREDENTIAL_MASTER_KEY` (base64 of exactly 32 bytes) or `PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE` (an absolute path, outside the Hub data directory). The Clisbot-prefixed names alias onto these. Exactly one must be set or the Hub fails closed at startup.

A local `paseo hub start` reads a mode-0600 key file that sits as a sibling of the home — for `~/.clisbot-dev`, that is `~/.clisbot-dev-hub-credential-master-key` — and hands the child the **path**, never the key material, so the key never appears in the process table or in a log that dumps the environment. If that file is missing the start fails; `paseo hub start --init-master-key` mints one, and is the first run only. A missing key is never regenerated silently: a fresh key next to a populated database means every stored credential is unreadable with no error anywhere. Explicit environment always wins, and hosted Hubs do not auto-provision.

The envelope's AAD binds each row to its scope (`<channel>-connection:<org>:<connectionId>`, `channel-state:<channel>:<org>:<account>:<namespace>`), so a row lifted into another organization or account fails authentication instead of decrypting into someone else's account. Connection envelopes sealed before 2026-09-07 carry `version: 1` and an owner without the organization; reads accept them and the next write to that Connection re-seals it as `version: 2`.

### Rotation

Reads try the current key, then the retired one; writes always use the current key. So rotation is a rolling re-seal, not an outage:

1. Back up the database **and** the current key file. Either alone is useless.
2. Write the new key (base64 of exactly 32 bytes) to a new file outside the Hub data directory, mode 0600.
3. Restart the Hub with `PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE` pointing at the new key and `PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE` at the old one. Every stored credential still reads; every write from now on seals under the new key.
4. Rewrite each row once. A Connection is re-sealed by reconfiguring it (`paseo channels add <channel> --account <id> --secret-file <path>`, or the app's Add-connection form); channel state secrets re-seal on their own next write. Track this per account — nothing sweeps for you.
5. Drop `PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE` and restart. Any row nobody rewrote stops decrypting at this point, which is why step 4 is a checklist and not a hope.

Give the keys distinct ids (`PASEO_HUB_CREDENTIAL_KEY_ID`, `PASEO_HUB_CREDENTIAL_KEY_ID_PREVIOUS`) when you want the envelope to say which key sealed it; with neither set both keys carry the default id and are tried in order. If you name the current key, name the retired one too — a read only tries keys whose id matches the envelope, so the Hub refuses to start with a named current key and no `PASEO_HUB_CREDENTIAL_KEY_ID_PREVIOUS` instead of silently never trying the retired material.

If the old key is lost before step 4 finishes there is no recovery for the rows still under it: those accounts must be re-credentialed by hand, and every QR channel re-linked, which lands it in `needs-login`.

## Reading `hub.log`

`<home>/hub.log`, holding both stdout and stderr of the detached Hub. `--foreground` inherits stdio instead, which is why the foreground helper tees.

`OPENCLAW_LOG_LEVEL=debug` additionally lights up the verticals' native drop gates — in OpenClaw's own file log, a different file.

What to grep for, by question:

**Did the account start?** There is no success line. `started` is observed through `paseo channels status`, not the log. Failure says `channel account start failed`; a QR channel says `channel account needs a QR login`.

**Is the transport alive?** `channel daemon connected` / `channel daemon disconnected`.

**Did the message get in?** One line per inbound decision, all carrying `dispatched`:

- `channel inbound bound a conversation` — new session
- `channel inbound steered an existing session`
- `channel inbound answered an approval command`
- `channel inbound ignored` (warn) — carries the reason: route miss, kill switch, mention policy, permissions

**Is the queue healthy?** `channel inbound queue drained`, `channel inbound drain failed; retry scheduled`, `channel inbound event deferred by the plane` (routine back-pressure), `channel inbound claim abandoned; another worker owns it`, and `channel inbound event dead-lettered` (error). Retention says `channel ingress queue pruned`.

**Did the reply go out?** `relay post started` then `relay post completed` with `externalMessageId`. A failure is `relay post failed; the ledger row stays recoverable`, and the transport-level warnings are `channel post failed`, `channel media post failed`, `channel in-place update failed`.

**Did streaming work?** `channel streaming draft failed`, `channel streaming finalize failed`, `channel streaming draft reached the channel text cap`, `channel streaming progress failed`.

A silent `hub.log` around an inbound message that never got an answer means the event did not reach the plane at all — check the transport and the queue depth before reading anything else.

## Following upstream

`npm run channels:sync:check` verifies every package against its manifest; `npm run channels:sync:report` lists what moved upstream since the pinned baseline. The upstream checkout comes from `$OPENCLAW_UPSTREAM_DIR`, defaulting to `~/projects/openclaw-private`, and is read through `git` at explicit commits, so the checkout may sit on any branch.

The full procedure — when to bump a baseline, how to walk the deviation ledger, and the gate a sync has to pass — is [upstream-sync-and-contribution.md](guides/developer-guide/upstream-sync-and-contribution.md#openclaw-channel-source-manifests).

## Full gate

`scripts/channel-goal-gate.sh` runs the whole channel-platform gate sequentially (builds, Hub/CLI typecheck, manifest + fixture + format checks, the targeted vitest set, native loader/contract tests) and writes one log per step to `$GATE_OUT` (default `/tmp/channel-goal-gate`). Run it before a live wave and before any commit that touches `packages/channels` or the Hub channel plane.
