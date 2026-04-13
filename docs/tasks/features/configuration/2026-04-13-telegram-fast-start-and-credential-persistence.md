# Channel Fast Start And Credential Persistence

## Summary

Let operators try `clisbot` immediately with:

```bash
clisbot start \
  --telegram-bot-token 123456:telegram-bot-token \
  --bootstrap personal-assistant
```

while keeping any literal token input in memory only for the current launch.

After first-run success, steer the operator toward persistent credential storage with canonical credential files first, env variables second, and external secret providers later.

## Status

Done

## Why

Current startup is still too biased toward credential setup before product proof.

The user should be able to answer this question first:

- does the bot actually work for me

Only after that should `clisbot` require a durable secret-storage decision.

The task should preserve two principles at the same time:

- first-run must be very fast
- long-term guidance must not normalize raw secrets in config

## Scope

### Phase 1: ready now

- accept literal token values on `clisbot start --telegram-bot-token ...`, `--slack-app-token ...`, and `--slack-bot-token ...`
- treat literal CLI token values as in-memory bootstrap credentials only
- bootstrap only the channels the operator explicitly requested on fresh config
- keep generated config free of raw channel token literals
- make config explicitly show the active credential-source mode for file-backed and in-memory accounts
- support canonical credential-file resolution at:
  - `~/.clisbot/credentials/telegram/<accountId>/bot-token`
  - `~/.clisbot/credentials/slack/<accountId>/app-token`
  - `~/.clisbot/credentials/slack/<accountId>/bot-token`
- keep explicit `tokenFile` support for custom paths
- make startup and status surfaces explain the active credential source
- create a default credentials-directory `.gitignore`
- support repeated account blocks inside one `start` command
- treat missing account selectors as shorthand for provider account `default`
- add `clisbot accounts add`
- add `clisbot accounts persist`
- add `clisbot start --persist`
- document single-account and multi-account config examples
- update tests and user docs

### Phase 2: likely next, but can slip if risky

- support named-account env conventions such as `TELEGRAM_BOT_TOKEN_ALERTS`
- optionally add a helper command or flag that appends export lines to compatible shell rc files such as `.bashrc` or `.zshrc`
- keep that helper explicit and opt-in

### Backlog only

- Vault
- 1Password
- cloud secret managers

## Non-Goals

- building a full secret-manager abstraction in phase 1
- interactive prompting UX
- automatic encryption of Telegram token files
- persisting literal CLI secrets into `clisbot.json`

## Product Decisions

- literal `--telegram-bot-token` values are allowed for convenience
- literal CLI tokens are treated as ephemeral and process-local
- `clisbot` must print a short warning that CLI literals can leak through shell history or `ps`
- canonical credential-file discovery is the preferred persistence model
- canonical discovery must be visible in startup and status output
- canonical discovery must also be visible in config through `credentialType: "tokenFile"`
- in-memory bootstrap state must be visible in config through `credentialType: "mem"`
- explicit `tokenFile` remains available for operators who need non-standard paths
- env support remains valid, but shell-rc automation can be deferred to phase 2
- raw channel token literals in `clisbot.json` are not supported
- fresh bootstrap must not auto-enable channels from ambient env alone
- repeated multi-account start syntax is supported and validated strictly

## Detailed Behavior

### 1. Token input parsing

`--telegram-bot-token`, `--slack-app-token`, and `--slack-bot-token` should accept three forms:

- env var name such as `TELEGRAM_BOT_TOKEN`
- placeholder string such as `${TELEGRAM_BOT_TOKEN}`
- literal token value such as `123456:abc` or `xoxb-...`

Suggested parse rule:

- if the value matches `${NAME}`, resolve as env reference
- else if the value matches a plain env-var identifier, resolve as env reference
- otherwise treat it as a literal token

### 2. First-run config bootstrap

When `~/.clisbot/clisbot.json` does not exist:

- bootstrap only the channels explicitly requested by start flags
- create account structures for those channels only
- support repeated account blocks for a channel in one command
- do not persist literal token values into config
- set `credentialType: "mem"` on any account created from literal token input
- preserve env-backed accounts as env-backed
- store enough bootstrap metadata to explain that the current run is using an ephemeral credential source

Account-block rule:

- token flags apply to the nearest current account block for the same channel
- if the command has no prior account selector for that channel, the target account id is `default`
- duplicate account ids in one command are invalid
- incomplete account blocks are invalid

### 3. Runtime resolution

Phase-1 target precedence:

1. in-memory bootstrap token from the current CLI invocation
2. account-level `tokenFile`
3. canonical credential file for that provider account
4. account-level env reference

Current implementation note:

- cold `start` should pass raw mem credentials into the spawned runtime process environment instead of writing a runtime bridge file
- raw-token `start` should be treated as a cold-start-only surface unless `--persist` is also present
- `credentialType: "mem"` must stay explicit in config, but missing mem secrets should not cause permanent startup dead-ends
- on `stop`, and again on the next cold `start`, clisbot should disable expired mem accounts and reconcile channel/default-account state
- `accounts add` raw-token support for an already-running runtime may continue to use the current bridge path until a dedicated cross-platform control plane exists

If a configured `tokenFile` is missing, fail closed.

If the canonical credential path is missing, continue to later allowed sources.

Raw channel token literals inside config should be rejected by schema or startup validation.

### 4. Startup and status messaging

Examples of the kind of output we want:

- `telegram default account: source=cli-ephemeral`
- `telegram default account: source=credential-file path=~/.clisbot/credentials/telegram/default/bot-token`
- `telegram alerts account: source=env name=TELEGRAM_BOT_TOKEN_ALERTS`

Never print the token itself.

When the source is `cli-ephemeral`, output should also say:

- restart will require a persisted credential source

### 5. Incremental channel adoption

If the operator already started with one channel and later passes token flags for another channel:

- keep the existing channel config and account state
- enable the newly requested channel
- add only the requested new default account unless the command targets another account explicitly
- do not auto-remove or downgrade earlier channels

If the operator adds a new named account for an already-enabled channel:

- preserve existing accounts
- add only the requested account
- if the runtime is already running, reconcile provider state and start that account immediately when valid

### 6. Persistence commands

`clisbot accounts persist` should:

- persist in-memory credentials for one account or all requested accounts into canonical credential files
- update config to `credentialType: "tokenFile"`
- print only brief success or failure summaries

`clisbot start --persist` should:

- do the same promotion automatically for any in-memory credentials from that invocation
- never print token values

### 7. Accounts command

`clisbot accounts add` should:

- accept the same raw token / env name / placeholder semantics as `start`
- accept provider-specific required tokens
- support `--persist`
- if the app is already running, apply the new account without waiting for a manual restart
- print a brief summary of config persistence and runtime status
- if the app is not running, raw token input currently requires `--persist`; otherwise the command rejects instead of leaving an orphan mem credential outside an active runtime

Suggested examples:

```bash
clisbot accounts add telegram --account alerts --token TELEGRAM_ALERTS_BOT_TOKEN
clisbot accounts add telegram --account alerts --token "$TELEGRAM_BOT_TOKEN" --persist
clisbot accounts add slack --account ops --app-token SLACK_OPS_APP_TOKEN --bot-token SLACK_OPS_BOT_TOKEN
```

### 8. First-run next-step guidance

After a successful first launch with a literal token, `clisbot` should suggest:

1. preferred: write the token to `~/.clisbot/credentials/telegram/default/bot-token`
2. optional: move to `TELEGRAM_BOT_TOKEN`
3. later: external secret backends if needed

### 9. Credentials directory initialization

When `clisbot` first needs the canonical credentials directory, it should ensure:

- `~/.clisbot/credentials/` exists
- `~/.clisbot/credentials/.gitignore` exists

Suggested file content:

```gitignore
*
!*/
!.gitignore
```

## Validation Notes

- CLI parsing tests should prove:
  - env name form still works
  - `${ENV_NAME}` form still works
  - literal token form is accepted
  - quoted shell-expanded values behave as literal in-memory token input
  - repeated account blocks parse deterministically
  - omitted account selectors target `default`
  - duplicate account ids fail directly
  - incomplete Slack and Telegram blocks fail directly
  - startup summaries never echo the token value
- bootstrap tests should prove:
  - literal-token first run creates config without persisting the secret
  - literal-token first run writes `credentialType: "mem"` on the active account
  - fresh config enables only explicitly requested channels
  - existing config is not silently rewritten with raw secrets
- credential resolution tests should prove:
  - canonical credential file resolves for `default`
  - canonical credential file resolves for named accounts
  - explicit `tokenFile` overrides canonical path
  - missing explicit `tokenFile` fails closed
  - missing canonical file falls through to later supported sources
  - raw channel token literals in config are rejected
- status tests should prove:
  - source reporting distinguishes `cli-ephemeral`, `credential-file`, and `env`
  - ephemeral mode warns that restart will need persistence
  - file-backed canonical accounts surface `credentialType: "tokenFile"` in config
- bootstrap filesystem tests should prove:
  - credentials directory `.gitignore` is created with the expected content
- persistence-command tests should prove:
  - `clisbot accounts persist` writes canonical credential files and updates config
  - `clisbot start --persist` performs the same promotion for current invocation credentials
  - summaries stay brief and never reveal token values
- accounts-command tests should prove:
- `clisbot accounts add` accepts env-backed input without copying secret values into files
- `clisbot accounts add --persist` with raw input writes canonical credential files
- `clisbot accounts add` updates runtime immediately when the app is already running
- cold `clisbot start` with raw tokens does not write those secrets to `runtime-credentials.json`
- `clisbot stop` disables mem accounts in config so a later cold start does not fail on stale `credentialType: "mem"` entries
  - summaries show `runtime=started` or `runtime=failed` truthfully

## Exit Criteria

- a first-run operator can bring up requested channels with one command using literal or env-backed token references
- that token is not persisted into config, logs, or status output
- config still clearly shows `mem` versus `tokenFile` state for channel accounts
- the preferred canonical credential-file path works for default and named accounts
- startup and status truthfully explain where each active credential came from
- raw channel token literals inside `clisbot.json` are unsupported and rejected
- fresh bootstrap never auto-enables extra channels just because ambient env vars exist
- repeated multi-account `start` input works with strict validation and clear errors
- `accounts add` and `accounts persist` provide a clear non-restart path for account management
- the docs make the quick-start path and the preferred persistence path equally clear

## Related Docs

- [Feature Doc](../../../features/configuration/start-bootstrap-and-credential-persistence.md)
- [Configuration](../../../features/configuration/README.md)
- [Channel Accounts](../../../user-guide/channel-accounts.md)
- [Telegram credential security research](../../../research/security/2026-04-12-openclaw-telegram-credential-security-and-setup.md)
