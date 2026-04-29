# Surface Policy Shape Standardization And 0.1.43 Compatibility

## Summary

Standardize the bot-scoped surface config model on:

- `directMessages`
- `groups`
- raw provider-local ids plus `*` inside stored bot config

while keeping smooth migration from the released `0.1.43` shape.

## Status

Done

## Source Of Truth

The current operator and persistence contract is:

- inside one bot config, store DM routes under `directMessages`
- inside one bot config, store multi-user surfaces under `groups`
- inside those maps, use raw ids plus `*`
- keep CLI route ids human-facing:
  - `dm:<id>`
  - `dm:*`
  - `group:<id>`
  - `group:*`
  - `topic:<chatId>:<topicId>`

## Decision Log

### 1. Use `directMessages` and `groups`

Reason:

- operators need one obvious split: one person vs many people
- `groups` reads better than `shared`
- the same mental model works across Slack and Telegram

### 2. Store raw ids inside a bot-scoped config

Reason:

- once the config is already under `bots.slack.<botId>` or `bots.telegram.<botId>`, repeating provider-specific prefixes inside every child key adds noise
- raw ids reduce operator error and make large configs easier to scan

Examples:

- Slack public/private shared surfaces:
  - `groups["C1234567890"]`
  - `groups["G1234567890"]`
- Telegram shared chat:
  - `groups["-1001234567890"]`
- Telegram topic:
  - `groups["-1001234567890"].topics["42"]`
- DM-specific override:
  - `directMessages["U1234567890"]`
  - `directMessages["1276408333"]`

### 3. Keep CLI ids prefixed

Reason:

- CLI commands need one compact, memorable addressing syntax
- `dm` and `group` are short and consistent across providers
- compatibility aliases such as `channel:<id>` still work, but they are no longer the preferred contract

### 4. `disabled` means fully disabled

Reason:

- operator trust is more important than convenience here
- if a surface says `disabled`, nobody should get a reply there
- that includes app `owner` and app `admin`

Current runtime behavior:

- `disabled` shared surfaces stay silent
- `disabled` DMs stay silent
- no pairing reply, deny reply, or owner/admin bypass should leak through

### 5. Admitted allowlist groups still auto-admit owner/admin

Reason:

- operators still need safe recovery access after a group has passed admission
- that convenience is acceptable only after `groupPolicy` or Slack `channelPolicy` admits the group

Current runtime behavior:

- app `owner` and app `admin` do not bypass `groupPolicy` or Slack `channelPolicy` admission
- app `owner` and app `admin` bypass sender allowlist checks after the group is admitted
- shared `blockUsers` still wins
- `disabled` still wins over everything

### 6. Deny early on shared allowlist failures

Reason:

- the runner should not receive prompts from disallowed users
- operators need a visible, immediate explanation

Current deny text:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### 7. Keep one human-facing term for many-people surfaces

Reason:

- Slack channels, Slack private groups, Telegram groups, and Telegram topics are different transport shapes
- operators still need one stable mental model
- using `group` consistently in operator wording reduces security mistakes and naming drift

Current contract:

- canonical operator id uses `group:<id>`
- canonical wildcard uses `group:*`
- deny text also says `group`
- provider-specific legacy terms such as Slack `channel:<id>` remain compatibility syntax only

### 8. Treat `group:*` as a real policy node, not a throwaway alias

Reason:

- operators need one obvious default multi-user control point per bot
- if the wildcard route feels optional, intent gets scattered across exact routes and shorthand aliases

Current contract:

- `group:*` is the default multi-user sender policy node for one bot
- `groupPolicy` and Slack `channelPolicy` are the admission controls for whether shared surfaces are admitted
- operators update or disable it rather than removing it
- exact routes refine or override from there

## Released 0.1.43 Shape

### Slack provider defaults

```json
{
  "defaults": {
    "channelPolicy": "allowlist",
    "groupPolicy": "allowlist",
    "directMessages": {
      "dm:*": {
        "enabled": true,
        "policy": "pairing"
      }
    }
  }
}
```

### Slack bot-scoped shape

```json
{
  "default": {
    "directMessages": {},
    "groups": {
      "groups:*": {
        "enabled": true,
        "policy": "open"
      },
      "channel:C1234567890": {
        "enabled": true,
        "policy": "open"
      },
      "group:G1234567890": {
        "enabled": true,
        "policy": "allowlist"
      }
    }
  }
}
```

### Telegram provider defaults

```json
{
  "defaults": {
    "groupPolicy": "allowlist",
    "directMessages": {
      "dm:*": {
        "enabled": true,
        "policy": "pairing"
      }
    }
  }
}
```

### Telegram bot-scoped shape

```json
{
  "default": {
    "directMessages": {},
    "groups": {
      "groups:*": {
        "enabled": true,
        "policy": "open",
        "topics": {}
      },
      "-1001234567890": {
        "enabled": true,
        "policy": "open",
        "topics": {
          "42": {
            "enabled": true,
            "policy": "open"
          }
        }
      }
    }
  }
}
```

## Target Shape

### Provider defaults

```json
{
  "defaults": {
    "dmPolicy": "pairing",
    "groupPolicy": "allowlist",
    "channelPolicy": "allowlist",
    "directMessages": {
      "*": {
        "enabled": true,
        "policy": "pairing"
      }
    },
    "groups": {
      "*": {
        "enabled": true,
        "policy": "open"
      }
    }
  }
}
```

Notes:

- Slack keeps both `channelPolicy` and `groupPolicy` as shared-surface admission controls
- Telegram keeps `groupPolicy` as shared-surface admission control
- both providers now also expose `dmPolicy`

### Slack bot-scoped target shape

```json
{
  "default": {
    "dmPolicy": "pairing",
    "channelPolicy": "allowlist",
    "groupPolicy": "allowlist",
    "directMessages": {
      "*": {
        "enabled": true,
        "policy": "pairing"
      },
      "U1234567890": {
        "enabled": true,
        "policy": "allowlist",
        "allowUsers": ["U1234567890"]
      }
    },
    "groups": {
      "*": {
        "enabled": true,
        "policy": "open"
      },
      "C1234567890": {
        "enabled": true,
        "policy": "allowlist",
        "allowUsers": ["U_OWNER"]
      },
      "G1234567890": {
        "enabled": true,
        "policy": "open"
      }
    }
  }
}
```

### Telegram bot-scoped target shape

```json
{
  "default": {
    "dmPolicy": "pairing",
    "groupPolicy": "allowlist",
    "directMessages": {
      "*": {
        "enabled": true,
        "policy": "pairing"
      },
      "1276408333": {
        "enabled": true,
        "policy": "allowlist",
        "allowUsers": ["1276408333"]
      }
    },
    "groups": {
      "*": {
        "enabled": true,
        "policy": "open",
        "topics": {}
      },
      "-1001234567890": {
        "enabled": true,
        "policy": "allowlist",
        "allowUsers": ["1276408333"],
        "topics": {
          "42": {
            "enabled": true,
            "policy": "open"
          }
        }
      }
    }
  }
}
```

## Compatibility Rules

### Stored config migration

On first read of released `0.1.43` config, clisbot backs up the original file and writes the canonical `0.1.45` shape automatically. The backup lives next to the config under `backups/`, for example `~/.clisbot/backups/clisbot.json.0.1.43.<timestamp>`.

The upgrade emits stage logs so operators can see exactly where it is:

- original config backed up and backup path printed
- migration preparation started
- new config dry-run validation started
- new config apply started
- apply succeeded with backup path printed again

When the config already has the current schema version, the upgrade path returns immediately and none of these upgrade logs are printed.

The upgrade normalizes these legacy keys into the canonical stored shape:

- `dm:*` -> `directMessages["*"]`
- `groups:*` -> `groups["*"]`
- `group:*` -> `groups["*"]`
- Slack `channel:C123` -> `groups["C123"]`
- Slack `group:G123` -> `groups["G123"]`
- Telegram `groups["-100..."]` stays the same, but wildcard `groups:*` becomes `groups["*"]`

### Policy sync

- `dmPolicy: "disabled"` is synced to:
  - `directMessages["*"].enabled = false`
  - `directMessages["*"].policy = "disabled"`
- shared `groupPolicy` / Slack `channelPolicy` / Slack `groupPolicy` control admission
- `groups["*"].policy` controls sender policy after admission and defaults to `open`
- released `0.1.43` wildcard `groups:*` with disabled policy migrates to admission `allowlist` plus sender default `open`, preserving "explicit groups only" without making a newly added group unusable
- current-schema `groups["*"].policy: "disabled"` stays disabled and makes admitted groups silent unless an exact route overrides it

### CLI compatibility

Accepted old CLI ids still include:

- `channel:<id>`
- `group:<id>`
- `dm:*`
- `groups:*`

Preferred current CLI ids are:

- `group:<id>`
- `group:*`
- `dm:<id>`
- `dm:*`
- `topic:<chatId>:<topicId>`

## Done When

- stored config uses `directMessages` / `groups` with raw ids plus `*`
- docs front-load the simple mental model instead of the migration story
- `0.1.43` installs auto-upgrade with a backup and without operator hand migration
- disabled surfaces are silent
- shared allowlist failures are denied before runner ingress
