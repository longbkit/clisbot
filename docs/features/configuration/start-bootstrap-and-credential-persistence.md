# Start Bootstrap And Credential Persistence

## Historical Note

This feature doc captures the design and rollout slice that led to the current bootstrap behavior.

The live product contract now uses `bots`, `routes`, and `bots-and-credentials.md`.

When concrete command syntax in this document differs from current CLI help, follow the current CLI and user guide.

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
- canonical credential file discovery for configured bots
- explicit `tokenFile` override when the operator wants a non-standard path
- explicit config state that tells the operator which credential source is active
- status surfaces that explain which credential source is active
- default credentials-directory `.gitignore` guidance
- `clisbot bots add ... --persist`, `clisbot bots set-credentials ... --persist`, and `clisbot start --persist`
- repeated account blocks inside one `start` command
- `clisbot bots add` with the same token-input rules as `start`
- config examples for one default bot and multiple bots

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

This mode is intentionally convenience-first. The runtime accepts the literal only as launch-scoped input and does not repeat the token or persist it into config.

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
- hot raw-token bot updates for an already-running runtime remain a separate control-plane problem; phase 1 keeps `bots add` raw-token support tied to the active runtime only

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

## Operator Reference

Keep the concrete command cookbook and operator-side guardrails in the companion reference:

- [Start Bootstrap And Credential Persistence Operator Reference](start-bootstrap-and-credential-persistence-operator-reference.md)
