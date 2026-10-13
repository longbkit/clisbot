---
title: Slack triggers
description: Configure Slack mentions and thread replies in one workflow file.
nav: Slack
order: 68
category: Hub
---

# Slack triggers

For conversations, configure a [Channel Route](/docs/hub/channels) targeting an Agent, Bot or Automation. This page covers the direct-mention event input and legacy Workflow format; it does not describe Channel slash commands.

`slack.mention` fires when the bot is mentioned in a channel where it is present. Direct messages, slash commands, and interactive components do not produce this trigger.

`.clisbot/workflows/slack-help.yml`:

```yaml
name: slack-help
on: slack.mention
max_runtime: 1h
filters:
  workspace: T01234567
  channels: [C01234567]
  from_users: [U01234567]
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
      - { type: slack.reply, max: 1, required: true }
```

Use stable Slack IDs for these filters, not display names. `from_users` matches the author, `workspace` the team, and `channels` the channel. `pattern` is a required prefix after the mention; `contains` is its legacy alias and has the same prefix behavior. All filters must pass.

The reply posts in the triggering thread. A root message gets a thread; a threaded message stays there. `slack.reply` grants `hub.reply`, but does not add reply instructions to the prompt.

Leading declared inputs follow the mention:

```text
@Clisbot repo=project agent=claude investigate the failed sync
```

Hub consumes consecutive declared headers and exposes the remainder as `${{ clisbot.prompt }}`. See [Workflows](/docs/hub/workflows).

## Find your Slack IDs

| Filter       | Where to copy it                                                                            |
| ------------ | ------------------------------------------------------------------------------------------- |
| `workspace`  | Open Slack in a browser. The team ID is the `T…` segment of the URL.                        |
| `from_users` | Your avatar → **Profile** → **⋮** → **Copy member ID**. Member IDs start with `U`.          |
| `channels`   | Channel name → **About**. The channel ID is at the bottom of the panel and starts with `C`. |

Set these filters in the direct-event definition. New Slack Automation inputs use Routes; select the conversation and audience in [Automations](/docs/hub/automations).
