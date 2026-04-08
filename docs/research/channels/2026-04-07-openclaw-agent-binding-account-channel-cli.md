# OpenClaw Agent, Binding, Account, And Channel CLI Research

## Summary

This note captures the current OpenClaw CLI and config model for:

- agents
- agent bindings
- channel accounts
- channel setup

Main conclusions:

- OpenClaw separates agent creation from channel-account setup, then connects them through `bindings`
- `channel` and `accountId` are different routing dimensions
- when `accountId` is omitted, OpenClaw routes to the channel default account, not to all accounts
- multi-account channel setups are first-class in both config and CLI
- `openclaw channels add` and `openclaw agents bind` overlap on routing setup, but the core ownership model is still `bindings[].match -> agentId`

## Scope

This note focuses on:

- CLI commands for `agents`
- CLI commands for `channels`
- binding syntax such as `telegram:ops`
- how account ids map to config
- how multi-account routing is represented in `openclaw.json`

This note does not define final `muxbot` implementation behavior.

## Source Baseline

This note is based on current public OpenClaw docs as checked on `2026-04-07`.

Important constraint:

- OpenClaw CLI and config docs have been changing quickly
- if strict parity matters before implementation or migration work, the docs should be re-checked against the exact OpenClaw version in use

## Key Sources

- [OpenClaw CLI Reference](https://openclawlab.com/en/docs/cli/)
- [OpenClaw `agents` CLI page](https://docs.openclaw.ai/cli/agents)
- [OpenClaw `channels` CLI page](https://docs.openclaw.ai/cli/channels)
- [OpenClaw Configuration](https://openclawlab.com/en/docs/gateway/configuration/)
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)
- [OpenClaw Channel Routing](https://docs.openclaw.ai/provider-routing)
- [OpenClaw Session Management](https://openclawlab.com/en/docs/concepts/session/)

## Core Terms

OpenClaw routing depends on four separate ideas:

- `channel`: provider family such as `telegram`, `slack`, or `discord`
- `accountId`: one configured account instance for that channel
- `agentId`: one durable workspace and session-store boundary
- `binding`: a routing rule that maps inbound channel traffic to one `agentId`

Important distinction:

- channel setup answers "which provider accounts exist?"
- agent setup answers "which durable brains exist?"
- bindings answer "which account or channel routes to which brain?"

## Agent Commands

Current `agents` command surface:

- `openclaw agents`
- `openclaw agents list`
- `openclaw agents add [name]`
- `openclaw agents delete <id>`
- `openclaw agents bindings`
- `openclaw agents bind`
- `openclaw agents unbind`

Important documented options:

- `openclaw agents list --bindings`
- `openclaw agents add <name> --workspace <dir> --model <id> --agent-dir <dir> --bind <channel[:accountId]> --non-interactive`
- `openclaw agents bindings --agent work --json`
- `openclaw agents bind --agent work --bind telegram:ops`
- `openclaw agents unbind --agent work --bind telegram:ops`
- `openclaw agents unbind --agent work --all`

What this means structurally:

- agent creation is explicit
- binding can happen during `agents add` or later
- bindings are not implicit side effects of agent existence

## Binding Syntax

The main documented binding shape is:

- `--bind <channel[:accountId]>`

Examples:

- `telegram`
- `telegram:default`
- `telegram:ops`
- `discord:guild-a`

Documented binding behavior:

- if `accountId` is omitted, the binding matches the default account only
- `accountId: "*"` is the channel-wide fallback for all accounts and is less specific than an explicit account binding
- if an existing channel-only binding is later rebound with an explicit account id, OpenClaw upgrades that binding in place

Example from the docs:

```bash
# initial channel-only binding
openclaw agents bind --agent work --bind telegram

# later upgrade to account-scoped binding
openclaw agents bind --agent work --bind telegram:ops
```

Important consequence:

- `telegram` does not mean "all Telegram accounts"
- `telegram` means "default Telegram account"
- `telegram:*` is the broad fallback
- `telegram:ops` is one explicit Telegram account binding

## What `telegram:ops` Means

In:

```bash
openclaw agents bind --agent work --bind telegram:ops
```

the parts mean:

- `work`: target `agentId`
- `telegram`: channel family
- `ops`: `accountId`

`ops` is not a Telegram-native concept.

It is a local OpenClaw account identifier inside:

- `channels.telegram.accounts.ops`

So `telegram:ops` means:

- route traffic from the Telegram account named `ops` to the agent `work`

The name is arbitrary. It could have been:

- `default`
- `alerts`
- `support`
- `personal`

## Channel Commands

Current `channels` command surface in the reviewed docs:

- `openclaw channels list`
- `openclaw channels status`
- `openclaw channels capabilities`
- `openclaw channels add`
- `openclaw channels remove`

Documented examples:

```bash
openclaw channels list
openclaw channels status
openclaw channels capabilities
openclaw channels capabilities --channel discord --target channel:123

openclaw channels add --channel telegram --token <bot-token>
openclaw channels remove --channel telegram --delete
```

Important `channels add` behavior:

- interactive setup can ask for account ids and display names
- interactive setup can optionally bind configured channel accounts to agents immediately
- non-interactive `channels add` does not auto-create bindings

This matters because channel provisioning and route ownership are related but still conceptually separate.

## Multi-Account Channel Model

The documented multi-account config shape is:

```json5
{
  channels: {
    telegram: {
      accounts: {
        default: {
          name: "Primary bot",
          botToken: "123456:ABC..."
        },
        alerts: {
          name: "Alerts bot",
          botToken: "987654:XYZ..."
        }
      }
    }
  }
}
```

Documented rules:

- `default` is used when `accountId` is omitted in CLI or routing
- environment tokens apply only to the default account
- base channel settings apply to all accounts unless overridden
- bindings use `match.accountId` to route accounts to different agents

Important migration behavior from the docs:

- if a channel still uses older single-account top-level fields and a non-default account is added later, OpenClaw promotes the original single-account values into `accounts.default` first
- existing channel-only bindings continue to match the default account after this promotion

This is a compatibility-preserving migration path, not a second routing model.

## Binding Shape In Config

The effective routing model is still config-driven.

Example shape:

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace"
    },
    list: [
      {
        id: "work",
        workspace: "~/.openclaw/workspace-work"
      },
      {
        id: "ops",
        workspace: "~/.openclaw/workspace-ops"
      }
    ]
  },
  channels: {
    telegram: {
      defaultAccount: "default",
      accounts: {
        default: {
          name: "Primary bot",
          botToken: "123456:AAA..."
        },
        ops: {
          name: "Ops bot",
          botToken: "123456:BBB..."
        }
      }
    }
  },
  bindings: [
    {
      match: {
        channel: "telegram",
        accountId: "default"
      },
      agentId: "work"
    },
    {
      match: {
        channel: "telegram",
        accountId: "ops"
      },
      agentId: "ops"
    }
  ]
}
```

This is the cleanest mental model to carry into `muxbot`:

- accounts live under channels
- agents live under agents
- routing lives under bindings

## Practical Command Examples

### 1. Add two agents

```bash
openclaw agents add work --workspace ~/.openclaw/workspace-work --non-interactive
openclaw agents add ops --workspace ~/.openclaw/workspace-ops --non-interactive
```

### 2. Add one Telegram default account

```bash
openclaw channels add --channel telegram --token <primary-bot-token>
```

### 3. Add another Telegram account

The current docs describe this through the `channels add` wizard and the promoted `accounts` config shape.

The important outcome is:

- the new account gets an `accountId` such as `ops`
- the config moves to `channels.telegram.accounts.*`

### 4. Bind accounts to agents

```bash
openclaw agents bind --agent work --bind telegram:default
openclaw agents bind --agent ops --bind telegram:ops
```

### 5. Inspect current routing

```bash
openclaw agents bindings
openclaw agents bindings --agent work
openclaw agents bindings --json
openclaw agents list --bindings
openclaw channels list --json
```

## Slack Multi-Account Example

OpenClaw uses the same account-oriented shape for Slack.

Example:

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace"
    },
    list: [
      {
        id: "work",
        workspace: "~/.openclaw/workspace-work"
      },
      {
        id: "ops",
        workspace: "~/.openclaw/workspace-ops"
      }
    ]
  },
  channels: {
    slack: {
      enabled: true,
      defaultAccount: "default",
      mode: "socket",
      requireMention: true,
      accounts: {
        default: {
          name: "Main workspace",
          botToken: "xoxb-main...",
          appToken: "xapp-main..."
        },
        ops: {
          name: "Ops workspace",
          botToken: "xoxb-ops...",
          appToken: "xapp-ops..."
        },
        support: {
          name: "Support workspace",
          mode: "http",
          botToken: "xoxb-support...",
          signingSecret: "support-signing-secret",
          webhookPath: "/slack/support/events"
        }
      }
    }
  },
  bindings: [
    {
      match: {
        channel: "slack",
        accountId: "default"
      },
      agentId: "work"
    },
    {
      match: {
        channel: "slack",
        accountId: "ops"
      },
      agentId: "ops"
    },
    {
      match: {
        channel: "slack",
        accountId: "support"
      },
      agentId: "work"
    }
  ]
}
```

Key points:

- `channels.slack.accounts.<id>` defines one Slack app or workspace connection
- `defaultAccount` controls what `slack` means when no explicit `accountId` is given
- `slack:ops` means the Slack account id `ops`, not a Slack-native workspace type
- per-account transport settings can differ
- multi-account Slack HTTP mode needs distinct webhook paths per account

## Routing Specificity

The reviewed docs imply this specificity order:

1. explicit account binding such as `telegram:ops`
2. channel default-account binding such as `telegram` or `telegram:default`
3. channel-wide fallback binding such as `telegram:*`

This is important because it avoids one ambiguous global rule swallowing more specific routes.

## Session Implications

OpenClaw session docs and routing docs show that account identity can affect session shape.

Relevant consequence:

- `agentId` remains the main isolation boundary
- account-aware routing determines which agent gets the message before session state is resolved
- per-account channel peer modes can include account identity inside the session key

This means account routing is not just cosmetic. It can change which workspace and session store are selected.

## Implications For `muxbot`

The OpenClaw-compatible target model is:

- one stable `agentId` concept
- one stable `channel` concept
- explicit per-channel `accountId` support where providers need it
- one shared binding table that maps `{channel, accountId?}` to `agentId`

The key behaviors worth copying are:

- omitted `accountId` means default account only
- multi-account channels are first-class
- channel setup may help create bindings, but bindings remain explicit data
- config migration from single-account to multi-account should preserve old default-account routes

## Recommendation

For `muxbot`, prefer this interpretation of OpenClaw:

1. keep agents as the durable workspace and session boundary
2. treat channel accounts as channel-owned provider instances
3. keep bindings as the only routing authority between accounts and agents
4. reserve wildcard account routing for explicit fallback, not as the default meaning of channel-only bindings
