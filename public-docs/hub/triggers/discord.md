---
title: Discord triggers
description: Configure Discord mentions and replies in one workflow file.
nav: Discord
order: 69
category: Hub
---

# Discord triggers

For conversations, configure a [Channel Route](/docs/hub/channels) targeting an Agent, Bot or Automation. This page covers the direct-mention event input and legacy Workflow format; it does not describe Channel slash commands.

`discord.mention` fires when the bot or a managed role is mentioned in a guild channel or thread.

`.clisbot/workflows/discord-help.yml`:

```yaml
name: discord-help
on: discord.mention
max_runtime: 1h
filters:
  guild: "123456789012345678"
  channels: ["234567890123456789"]
  from_users: ["345678901234567890"]
steps:
  - id: answer
    environment: dev
    max_runtime: 30m
    idle_timeout: 5m
    agent: codex
    prompt:
      - text: |
          Answer with hub.reply, then call hub.finish_execution.
          ${{ clisbot.prompt }}
    allow_outputs:
      - { type: discord.reply, max: 1, required: true }
```

Use stable Discord IDs for these filters, not server or display names. `from_users` matches the author; `guild` and `channels` constrain where the mention arrived. `pattern` is a required prefix after the mention; `contains` is its legacy alias and has the same prefix behavior. All filters must pass.

The reply posts in the triggering thread or channel. `discord.reply` grants `hub.reply`, but does not rewrite the prompt. A Discord trigger grants no `gh` credential; add a [`github` block](/docs/hub/github) to the step that needs one.

Leading declared inputs follow the mention. Hub exposes the remaining text as `${{ clisbot.prompt }}`. See [Workflows](/docs/hub/workflows).

## Find your Discord IDs

Turn on **Settings → Advanced → Developer Mode**, then right-click to **Copy Server ID** for `guild`, **Copy Channel ID** for `channels`, and **Copy User ID** for `from_users`. All three are numeric snowflakes; quote them so YAML keeps them as strings.

Set these filters in the direct-event definition; use [Automations](/docs/hub/automations) for setup.
