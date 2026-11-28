---
title: Slack triggers
description: Start Hub agents from Slack channel and thread mentions and reply in thread.
nav: Slack
order: 67
category: Hub
---

# Slack triggers

For conversations, configure a [Channel Route](/docs/hub/channels) targeting an Agent, Bot or Automation. This page covers the direct-mention event input of an Automation; it does not describe Channel slash commands.

`slack.mention` fires when the bot is mentioned in a channel where it is present. Direct messages, slash commands, and interactive components do not produce this trigger.

First connect a Slack workspace under **Connections** (configure the [Slack app](/docs/hub/self-hosting/slack-app) on your Hub first) and invite the bot to the channels it watches. The Automation's YAML looks like this:

```yaml
name: slack-help
on:
  slack.mention:
    connection: acme-slack
    filters:
      workspace: T01234567
      channels: [C01234567]
      from_users: [U01234567]
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
    slack.reply:
      max: 1
      required: true
```

## Filters and prompt text

Use stable Slack IDs for these filters, not display names. All filters must pass:

- `from_users` matches the sender's Slack member ID.
- `workspace` matches the Slack team ID and `channels` limits which channels can trigger the run.
- `pattern` requires a prefix after the mention (`contains` is its legacy alias with the same prefix behavior).

`${{ clisbot.prompt }}` contains the full message. Hub parses leading `key=value` tokens after the mention for inputs you declare. If you declare `inputs.repo`, use `${{ clisbot.inputs.repo }}` in `run.prompt` to insert its value.

```text
@Clisbot repo=project investigate the failed sync
```

Include `${{ clisbot.context }}` in `run.prompt` to pass the Slack thread history and execution-scoped attachment descriptors as JSON.

## Replies

The reply posts in the triggering thread. A root message gets a thread; a threaded message stays there. `slack.reply` grants `hub.reply`, but does not add reply instructions to the prompt. Declare `max` or `required: true` on the output to bound it. A Slack trigger grants no `gh` credential; add a [`github` block](/docs/hub/github) when the agent needs repository access.

## Find your Slack IDs

| Filter       | Where to copy it                                                                           |
| ------------ | ------------------------------------------------------------------------------------------ |
| `workspace`  | Open Slack in a browser. The team ID is the `T...` segment of the URL.                     |
| `from_users` | Open your avatar, then **Profile**, then **⋮**, then **Copy member ID** (starts with `U`). |
| `channels`   | Open the channel name, then **About**. The channel ID is at the bottom (starts with `C`).  |

Set these filters in the direct-event definition. New Slack Automation inputs use Routes; select the conversation and audience in [Automations](/docs/hub/automations).
