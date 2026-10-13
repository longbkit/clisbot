---
title: Hub configuration
description: Write, edit, and install the YAML behind a Hub Automation.
nav: Configuration
order: 70
category: Hub
---

# Hub configuration

Each Automation is one trigger document in YAML. Create one in the app under **Automations → New Automation**, and open **Edit YAML** to see or change the full document. Scripts install the same YAML through the [Hub API](/docs/hub/api#trigger-validation-and-installation).

Saving validates YAML, resolves Hub resources, and checks your authority to delegate the target. Select Agent controls that the Host actually offers; a saved definition does not prove the provider can start. A failed save keeps the active revision. Channel Routes are configured under **Channels** instead; see [Channels](/docs/hub/channels).

## Example

A trigger that answers Slack mentions in a Slack connection named `my-team`:

```yaml
name: slack-help
enabled: true
on:
  slack.mention:
    connection: my-team
    filters:
      from_users: [U01234567]
max_runtime: 2h
run:
  target:
    daemon: my-macbook
    cwd: /Users/you/code/your-repo
  agent:
    provider: codex
  max_runtime: 90m
  idle_timeout: 10m
  prompt: |
    Answer with hub.reply, then complete this request and call hub.finish_execution when done.

    <user-prompt>
    ${{ clisbot.prompt }}
    </user-prompt>
  outputs:
    slack.reply:
      max: 1
      required: true
```

`connection` is the app connection's slug in your organization. `target.daemon` is the connected daemon's slug and `target.cwd` is an absolute directory on it. `agent` contains the provider, model, and execution mode the daemon offers. Omit model or mode to use the Provider default; Pi has no selectable Modes.

For Route-driven reuse, enable **Continue the same Agent**; see [Agent continuation](/docs/hub/configuration/hub-yml#agent-continuation). The prompt asks the agent to reply and then call `hub.finish_execution`; replying alone does not finish the execution.

A Discord trigger uses `discord.mention`, a Discord user ID, and `discord.reply`. A GitHub trigger uses `github.issue_comment` with a repository filter and `github.reply` for issue/PR comments. A [`github` block](/docs/hub/github) separately grants `gh` authority. Read [Hub security](/docs/hub/security) before widening `from_users` or the agent's authority.

## Repository bundles

Earlier Hub versions kept configuration in a repository: `.clisbot/triggers/*.yml`, or a project bundle with `.clisbot/hub.yml` and `.clisbot/workflows/`, installed with `clisbot hub deploy` or synced from GitHub. The `hub deploy` and `hub projects` commands are available only with `CLISBOT_ONBOARDING_ENABLED=0`. A repository that holds such a bundle can choose connections, daemons, working directories, agents, and outputs, so protect it.

Next: the [configuration reference](/docs/hub/configuration/hub-yml) and [workflow examples](/docs/hub/workflows).
