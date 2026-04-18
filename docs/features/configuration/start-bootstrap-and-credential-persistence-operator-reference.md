# Start Bootstrap And Credential Persistence Operator Reference

This companion reference keeps the concrete command examples and operator guardrails that support the main feature contract.

## Multi-Channel Start Cases

### Case A: Telegram only

Command:

```bash
clisbot start \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --bot-type personal
```

Result:

- bootstrap Telegram only
- Slack remains disabled

### Case B: Slack only

Command:

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --bot-type personal
```

Result:

- bootstrap Slack only
- Telegram remains disabled

### Case C: Slack and Telegram together

Command:

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --bot-type personal
```

Result:

- bootstrap both channels
- each default account records its own credential-source state

### Case D: Add a second channel later

Starting point:

- `clisbot` is already configured and running with Telegram only

Then the operator later gets Slack tokens and runs:

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
```

Target result:

- preserve the existing Telegram setup
- enable and configure Slack
- do not disable Telegram
- do not silently rebind unrelated routes

### Case E: Add a named account to an existing channel

Starting point:

- `clisbot` already has Telegram `default` configured and running

Command:

```bash
clisbot start \
  --telegram-account alerts \
  --telegram-bot-token TELEGRAM_ALERTS_BOT_TOKEN
```

Target result:

- preserve the existing `telegram/default` account
- add `telegram/alerts`
- if runtime is already running, reconcile Telegram provider state and start the new account immediately when valid

## Persistence Commands

### `clisbot bots add --persist` and `clisbot bots set-credentials --persist`

Use the bot credential commands themselves to promote working in-memory credentials into durable storage.

Examples:

```bash
clisbot bots add --channel telegram --bot default --bot-token TELEGRAM_BOT_TOKEN --persist
clisbot bots add --channel slack --bot default --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
clisbot bots set-credentials --channel telegram --bot default --bot-token "$TELEGRAM_BOT_TOKEN" --persist
```

Target behavior:

- write the secret to the canonical credential file location
- update config so the bot becomes file-backed
- print a brief success summary without printing secret detail

Example summary:

- `Added telegram/default, persisted=tokenFile, runtime=not-running`

### `clisbot start --persist`

For convenience, `start --persist` should perform the same promotion automatically for any account bootstrapped from literal CLI input in that invocation.

Example:

```bash
clisbot start \
  --telegram-bot-token "$TELEGRAM_BOT_TOKEN" \
  --bot-type personal \
  --persist
```

Target behavior:

- use the token immediately for startup
- persist it to the canonical credential file before exit from bootstrap
- update config from `credentialType: "mem"` to `credentialType: "tokenFile"`
- print only a brief storage summary

If persistence fails:

- startup should report the persistence failure clearly
- the runtime should still be allowed to use the in-memory credential for that current process if startup already succeeded and the user did not request fail-hard behavior

### `clisbot bots add`

Add a separate command surface for proactive bot management:

```bash
clisbot bots add --channel telegram --bot alerts --bot-token TELEGRAM_ALERTS_BOT_TOKEN
clisbot bots add --channel slack --bot ops --app-token SLACK_OPS_APP_TOKEN --bot-token SLACK_OPS_BOT_TOKEN
```

Rules:

- token parsing rules match `start`
- raw token input becomes `mem` unless `--persist` is also passed
- env name or `${ENV_NAME}` input stays env-backed
- if `--persist` is passed with raw input, write canonical credential files and convert config to `credentialType: "tokenFile"`
- if `--persist` is passed with env-backed input, keep it env-backed and do not copy secret values into files
- if the runtime is not already running, raw input currently requires `--persist`; otherwise `bots add` rejects instead of parking an orphan mem credential outside an active runtime

If the runtime is already running:

- add the bot to config
- reload or reconcile the affected provider
- start the new bot immediately if validation succeeds
- print a brief status summary

Example summary:

- `Added telegram/alerts, persisted=tokenFile, runtime=started`
- `Added slack/ops, persisted=env, runtime=started`
- `Added telegram/alerts, persisted=mem, runtime=failed (missing route binding)`

## UX Guardrails

- never write inline literal tokens into generated config
- never support raw channel token literals inside `clisbot.json`
- never reflect token values back to the terminal
- startup output should tell the operator which source was used
- first-run success output should suggest the preferred persistence path next
- if the operator launched with a literal token, `status` should report that the credential is ephemeral and will be lost on restart
- if an ephemeral mem account expires, `stop` and the next cold `start` should disable it automatically instead of leaving an enabled-but-unusable account behind
- if canonical credential-file discovery is used, `status` should show the resolved path explicitly
- canonical credential-file discovery must also be visible in config through `credentialType: "tokenFile"`
- do not auto-bootstrap channels from ambient env without explicit user intent
- account-add and account-persist flows should print short result summaries that are easy to understand without exposing secret detail

## Non-Goals

- general secret-provider support in phase 1
- encrypting Telegram token files by default
- interactive secret prompts
- auto-writing secrets into config as a convenience shortcut

## Related Docs

- [Start Bootstrap And Credential Persistence](start-bootstrap-and-credential-persistence.md)
- [Configuration](README.md)
- [Bots And Credentials](../../user-guide/bots-and-credentials.md)
- [Start First-Run Bootstrap And Token Gating](../../tasks/features/configuration/2026-04-07-start-first-run-bootstrap-and-token-gating.md)
- [Telegram credential security research](../../research/security/2026-04-12-openclaw-telegram-credential-security-and-setup.md)
