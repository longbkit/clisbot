---
title: Discord triggers
description: Start Hub agents from Discord mentions and reply in the channel or thread.
nav: Discord
order: 68
category: Hub
---

# Discord triggers

For conversations, configure a [Channel Route](/docs/hub/channels) targeting an Agent, Bot or Automation. This page covers the direct-mention event input of an Automation; it does not describe Channel slash commands.

`discord.mention` fires when the bot or a managed role is mentioned in a guild channel or thread.

First connect a Discord server under **Connections** (configure the [Discord app](/docs/hub/self-hosting/discord-app) on your Hub first). The Automation's YAML looks like this:

```yaml
name: discord-help
on:
  discord.mention:
    connection: acme-discord
    filters:
      guild: "123456789012345678"
      channels: ["234567890123456789"]
      from_users: ["345678901234567890"]
run:
  target:
    daemon: devbox
    cwd: /workspace/project
  agent:
    provider: codex
    mode: full-access
  max_runtime: 30m
  idle_timeout: 5m
  prompt: |
    Answer the request using hub.reply, then call hub.finish_execution.

    <user-prompt>
    ${{ clisbot.prompt }}
    </user-prompt>
  outputs:
    discord.reply:
      max: 1
      required: true
```

## Filters and prompt text

Use stable Discord IDs for these filters, not server or display names. They are numeric snowflakes; quote each one so YAML keeps it as a string. `from_users` matches the author; `guild` and `channels` constrain where the mention arrived. `pattern` is a required prefix after the mention; `contains` is its legacy alias and has the same prefix behavior. All filters must pass.

Leading declared inputs follow the mention. Hub exposes the remaining text as `${{ clisbot.prompt }}`; if you declare `inputs.repo`, use `${{ clisbot.inputs.repo }}` in the prompt. Include `${{ clisbot.context }}` in the prompt to pass provider context such as thread history as JSON.

## Replies

The reply posts in the triggering thread or channel. `discord.reply` grants `hub.reply`, but does not rewrite the prompt. A Discord trigger grants no `gh` credential; add a [`github` block](/docs/hub/github) to the step that needs one.

## Find your Discord IDs

In Discord, turn on **Settings → Advanced → Developer Mode**. Right-click a server and choose **Copy Server ID** for `guild`, right-click a channel and choose **Copy Channel ID** for `channels`, and right-click a user and choose **Copy User ID** for `from_users`.

Set these filters in the direct-event definition; use [Automations](/docs/hub/automations) for setup.
