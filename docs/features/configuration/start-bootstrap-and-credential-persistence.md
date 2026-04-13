# Start Bootstrap And Credential Persistence

## Summary

This feature direction makes first-run channel setup extremely fast without normalizing raw secrets inside config files.

Target operator experiences:

```bash
clisbot start \
  --telegram-bot-token 123456:telegram-bot-token \
  --bot-type personal
```

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --bot-type personal
```

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN_WORK \
  --slack-bot-token SLACK_BOT_TOKEN_WORK \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --bot-type personal
```

```bash
clisbot start \
  --telegram-account default \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --telegram-account alerts \
  --telegram-bot-token TELEGRAM_ALERTS_BOT_TOKEN \
  --slack-account default \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --bot-type personal
```

Those commands should be enough to try the requested channels immediately when the CLI choice is already unambiguous.

The inline token is treated as an in-memory bootstrap secret for the current launch only.

After the operator confirms the experience is working, `clisbot` should guide them toward a persisted secret source.

Preferred persistence order:

1. canonical credential file under `~/.clisbot/credentials/...`
2. env variable
3. external secret providers such as Vault or 1Password later

## Scope

- explicit first-run channel bootstrap based on passed flags, not ambient env auto-detection
- one-line `clisbot start` for first-run Slack and Telegram bootstrap
- literal token support on `--telegram-bot-token`, `--slack-app-token`, and `--slack-bot-token`
- in-memory bootstrap credentials that are never written back to config
- canonical credential file discovery for channel accounts
- explicit `tokenFile` override when the operator wants a non-standard path
- explicit config state that tells the operator which credential source is active
- status surfaces that explain which credential source is active
- default credentials-directory `.gitignore` guidance
- `clisbot accounts persist` and `clisbot start --persist`
- repeated account blocks inside one `start` command
- `clisbot accounts add` with the same token-input rules as `start`
- config examples for one default account and multiple accounts

## Why

Current setup guidance still makes the user think about secret persistence too early.

That is backwards for product onboarding.

The better product shape is:

1. let the user prove the system works in one command
2. keep that secret out of long-lived config by default
3. offer a clear upgrade path into durable credential storage
4. do not silently bootstrap channels just because unrelated env vars happen to exist

This keeps first-run UX fast without teaching the wrong long-term habit.

## Bootstrap Intent Rules

Fresh bootstrap should use explicit intent only.

That means:

- if the user passes only Telegram flags, bootstrap only Telegram
- if the user passes only Slack flags, bootstrap only Slack
- if the user passes both Slack and Telegram flags, bootstrap both
- if the user repeats account blocks for a channel, bootstrap each valid requested account for that channel
- if the shell environment happens to contain more tokens than the user passed, `clisbot` should not silently enable extra channels on first run

Examples:

- `clisbot start --telegram-bot-token TELEGRAM_BOT_TOKEN --bot-type personal`
  - bootstrap Telegram only
- `clisbot start --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN --bot-type personal`
  - bootstrap Slack only
- `clisbot start --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN --telegram-bot-token TELEGRAM_BOT_TOKEN --bot-type personal`
  - bootstrap Slack and Telegram

This intentionally changes the current direction from "auto-use any default tokens found in env" to "only bootstrap what the operator asked for".

## Account Block Syntax

`start` should support both shorthand default-account input and explicit multi-account blocks.

### Default-account shorthand

If a token flag appears before any account selector for that channel, it applies to account `default`.

Examples:

```bash
clisbot start \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --bot-type personal
```

```bash
clisbot start \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --bot-type personal
```

### Explicit account blocks

Examples:

```bash
clisbot start \
  --telegram-account alerts \
  --telegram-bot-token TELEGRAM_ALERTS_BOT_TOKEN \
  --telegram-account personal \
  --telegram-bot-token TELEGRAM_BOT_TOKEN \
  --bot-type personal
```

```bash
clisbot start \
  --slack-account ops \
  --slack-app-token SLACK_OPS_APP_TOKEN \
  --slack-bot-token SLACK_OPS_BOT_TOKEN \
  --slack-account default \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN \
  --bot-type personal
```

Parser rule:

- each token flag applies to the nearest open account block for the same channel
- if no account block exists yet for that channel, open implicit account `default`
- Telegram blocks require one bot token
- Slack blocks require both app token and bot token
- duplicate account ids for the same channel in one command should fail with a direct error
- incomplete blocks should fail with a direct error

### Fastest first-run path

`clisbot start --telegram-bot-token <literal-token>` means:

- accept the literal token as a one-shot bootstrap secret
- use it for the current launch only
- never print it back
- never persist it into `~/.clisbot/clisbot.json`
- never echo it in status, logs, or operator remediation output

This mode is intentionally convenience-first and should carry a short warning that command-line literals can leak through shell history or process inspection.

When this mode is active, config should still make the source visible:

```json
{
  "channels": {
    "telegram": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "mem",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

Meaning:

- the account is currently bootstrapped from in-memory CLI input
- restart will require another in-memory token or a persisted source
- the config stays explicit about state without storing the token itself

### Preferred persisted path

Persist Telegram bot tokens in the canonical credential store:

```text
~/.clisbot/credentials/telegram/<accountId>/bot-token
```

Rules:

- file content is raw token text
- one token per file
- file should be owned by the service user
- file should use tight permissions such as `600`
- config should record `credentialType: "tokenFile"` even when the path is the canonical implicit default

Example with canonical default path:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

Meaning:

- secret source is file-backed
- because no explicit `tokenFile` is set, runtime resolves the canonical default:
  - `~/.clisbot/credentials/telegram/default/bot-token`
- user can inspect config and know immediately that the account is not env-backed or memory-only

### Env path

Env variables remain supported because they fit local shells, systemd environments, containers, and existing operator habits.

Recommended naming direction, only when the operator explicitly chooses env-backed setup:

- default account: `TELEGRAM_BOT_TOKEN`
- named account: `TELEGRAM_BOT_TOKEN_<ACCOUNT_ID_UPPER_SNAKE>`

Example:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN_ALERTS`
- `TELEGRAM_BOT_TOKEN_SUPPORT_BOT`

Example config:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "botToken": "${TELEGRAM_BOT_TOKEN}",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

Meaning:

- env remains explicit enough because the placeholder already tells the operator which variable is active
- phase 1 does not need an extra `credentialType: "env"` field unless implementation later benefits from one

Phase 1 does not need to automate shell rc updates if that adds too much implementation risk.

## CLI Input Semantics

`clisbot` only receives what the shell passes in `argv`.

So these forms do not mean the same thing:

- `--telegram-bot-token "$TELEGRAM_BOT_TOKEN"`
  - the shell expands first
  - if the variable has a value, `clisbot` receives the token value itself
  - target behavior: treat it as a literal token, so credential source becomes in-memory `mem`
- `--telegram-bot-token $TELEGRAM_BOT_TOKEN`
  - same expansion behavior as above when the variable is set
  - if the variable is unset, shell behavior can collapse the argument and likely break the command shape
  - target guidance: do not recommend this unquoted form in docs
- `--telegram-bot-token "TELEGRAM_BOT_TOKEN"`
  - `clisbot` receives the exact string `TELEGRAM_BOT_TOKEN`
  - target behavior: treat it as an env reference name
- `--telegram-bot-token TELEGRAM_BOT_TOKEN`
  - same as above
  - target behavior: treat it as an env reference name
- `--telegram-bot-token '${TELEGRAM_BOT_TOKEN}'`
  - single quotes stop shell expansion
  - `clisbot` receives the exact placeholder string
  - target behavior: treat it as an env reference placeholder

Current `clisbot` behavior today:

- supports env-name input such as `TELEGRAM_BOT_TOKEN`
- supports placeholder input such as `${TELEGRAM_BOT_TOKEN}`
- normalizes both into config placeholders
- does not yet support literal token mode on these flags
- does not yet support repeated multi-account blocks inside one `start` command

Target behavior after this feature:

- plain env names and `${ENV_NAME}` stay env-backed
- expanded values like `"$TELEGRAM_BOT_TOKEN"` become in-memory `mem`
- raw literal tokens typed directly become in-memory `mem`

OpenClaw does not add any special shell-expansion magic here.

Like normal CLIs, it receives the final argument values after shell expansion and then applies its own config or env resolution rules from there.

### External secret backends

Later, `clisbot` can support secret providers such as:

- Vault
- 1Password
- cloud secret managers

That should stay out of phase 1.

## Resolution Rules

Target account precedence should be:

1. in-memory bootstrap token from current CLI invocation
2. account-level explicit `tokenFile`
3. canonical credential file for the account id
4. account-level explicit env reference

Implementation note:

- `credentialType: "mem"` keeps the secret out of `clisbot.json`
- cold `clisbot start` injects raw mem credentials into the spawned runtime process environment instead of writing them to disk
- mem credentials are process-scoped and do not survive `stop`, `restart`, or a fresh runtime launch without new explicit input
- `clisbot stop` and the next cold `clisbot start` both sanitize expired mem accounts by disabling them in config so stale mem state does not fail startup
- hot raw-token account updates for an already-running runtime remain a separate control-plane problem; phase 1 keeps `accounts add` raw-token support tied to the active runtime only

Important behavior:

- the in-memory bootstrap token only lives for the current process
- raw-token `clisbot start` is for cold start; if the runtime is already running, phase 1 requires `--persist` or a prior stop before another literal-token start
- `credentialType: "mem"` remains in config so operator intent and routing stay explicit, but missing mem secrets should degrade into disabled accounts rather than hard startup failure
- startup must clearly say when a token came from `cli`, `tokenFile`, canonical credential store, or `env`
- missing configured credential files should fail closed
- canonical-file discovery should be visible in startup and status output so it never feels like hidden magic
- raw channel token literals in `clisbot.json` are not supported

There should be no ambient "default env auto-bootstrap" fallback for fresh config creation.

If the user wants env-backed bootstrap, they should pass the env name or placeholder explicitly on the command line.

## Config Shape

The config should continue to describe accounts, routing, and credential-source state, not store raw secrets.

### Fresh config with Telegram only

```json
{
  "channels": {
    "slack": {
      "enabled": false
    },
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "mem",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

### Fresh config with Slack only

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "mem"
        }
      }
    },
    "telegram": {
      "enabled": false
    }
  }
}
```

### Fresh config with Slack and Telegram together

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "mem"
        }
      }
    },
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

### Fresh config with repeated account blocks

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "appToken": "${SLACK_APP_TOKEN}",
          "botToken": "${SLACK_BOT_TOKEN}"
        },
        "ops": {
          "enabled": true,
          "credentialType": "mem"
        }
      }
    },
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "botToken": "${TELEGRAM_BOT_TOKEN}",
          "dmPolicy": "pairing"
        },
        "alerts": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "allowlist"
        }
      }
    }
  }
}
```

### Single default account with canonical credential file

Credential file:

```text
~/.clisbot/credentials/telegram/default/bot-token
```

Config:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "pairing"
        }
      }
    }
  }
}
```

Interpretation:

- config names the account
- config explicitly says the account is file-backed
- secret resolution uses the canonical file path for account `default`
- no explicit credential path is required in config for the common case

### Multiple accounts with canonical credential files

Credential files:

```text
~/.clisbot/credentials/telegram/personal/bot-token
~/.clisbot/credentials/telegram/alerts/bot-token
```

Config:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "personal",
      "accounts": {
        "personal": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "pairing"
        },
        "alerts": {
          "enabled": true,
          "credentialType": "tokenFile",
          "dmPolicy": "allowlist"
        }
      }
    }
  },
  "bindings": [
    { "match": "telegram", "agentId": "default" },
    { "match": "telegram:alerts", "agentId": "alerts-agent" }
  ]
}
```

Interpretation:

- `telegram` uses `defaultAccount: "personal"`
- `telegram:alerts` resolves account `alerts`
- both accounts can use the same canonical directory convention without cluttering config

### Non-standard credential path

If the operator needs a custom path, config can still be explicit:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "credentialType": "tokenFile",
          "tokenFile": "/run/secrets/clisbot-telegram-default"
        }
      }
    }
  }
}
```

### Credentials directory safety file

The canonical credentials directory should include a default `.gitignore` so accidental commits are harder:

Path:

```text
~/.clisbot/credentials/.gitignore
```

Suggested content:

```gitignore
*
!*/
!.gitignore
```

Meaning:

- ignore credential files by default
- keep subdirectories possible
- keep the ignore rule itself visible

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

### `clisbot accounts persist`

Add an explicit persistence command so the operator can promote working in-memory credentials into durable storage.

Examples:

```bash
clisbot accounts persist --channel telegram --account default
clisbot accounts persist --channel slack --account default
clisbot accounts persist --all
```

Target behavior:

- resolve currently active in-memory credentials for the requested account
- write them to the canonical credential file location
- update config so the account becomes file-backed
- print a brief success summary without printing secret detail

Example summary:

- `Persisted telegram/default to credential file and updated config to credentialType=tokenFile.`

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

### `clisbot accounts add`

Add a separate command surface for proactive account management:

```bash
clisbot accounts add telegram --account alerts --token TELEGRAM_ALERTS_BOT_TOKEN
clisbot accounts add slack --account ops --app-token SLACK_OPS_APP_TOKEN --bot-token SLACK_OPS_BOT_TOKEN
```

Rules:

- token parsing rules match `start`
- raw token input becomes `mem` unless `--persist` is also passed
- env name or `${ENV_NAME}` input stays env-backed
- if `--persist` is passed with raw input, write canonical credential files and convert config to `credentialType: "tokenFile"`
- if `--persist` is passed with env-backed input, keep it env-backed and do not copy secret values into files
- if the runtime is not already running, raw input currently requires `--persist`; otherwise `accounts add` rejects instead of parking an orphan mem credential outside an active runtime

If the runtime is already running:

- add the account to config
- reload or reconcile the affected provider
- start the new account immediately if validation succeeds
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

- [Configuration](README.md)
- [Channel Accounts](../../user-guide/channel-accounts.md)
- [Start First-Run Bootstrap And Token Gating](../../tasks/features/configuration/2026-04-07-start-first-run-bootstrap-and-token-gating.md)
- [Telegram credential security research](../../research/security/2026-04-12-openclaw-telegram-credential-security-and-setup.md)
