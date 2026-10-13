---
title: Hub triggers
description: How Hub matches an inbound event to a trigger: events, filters, and the allowlist that gates every execution.
nav: Triggers
order: 68
category: Hub
---

# Triggers

A trigger says which provider event can start an Automation. Conversation Routes are a separate way in; see [Channels](/docs/hub/channels) and [Automations](/docs/hub/automations). The [Hub workflows](/docs/hub/workflows) page covers the steps, inputs, routing, prompts, and deadlines that run after a match.

Example in the legacy [repository bundle](/docs/hub/configuration#repository-bundles) format, with a named `dev` environment and `codex` Agent:

```yaml
name: triage-issue
on: github.issue_created
filters:
  repo: acme/api
  from_users: [alice]
max_runtime: 2h
steps:
  - id: work
    environment: dev
    max_runtime: 90m
    idle_timeout: 10m
    agent: codex
    prompt:
      - text: Call hub.finish_execution when the step is complete.
      - text: ${{ clisbot.prompt }}
```

Field-by-field detail is in the [configuration reference](/docs/hub/configuration/hub-yml).

## Choose the agent in Hub

When you create or edit a trigger in the Hub dashboard, choose the daemon and enter its working directory first. Hub does not prefill the directory: it is a path on that machine, it has to exist, and only you know which repository the agent should work in. Hub then asks that daemon for its available providers, models, execution modes, and thinking options. The suggested model and mode are the daemon's defaults.

Use a Host enrolled with `hub.execute` and Agent controls it offers. Managed access further restricts the Hosts, Projects and Agent configurations a Member can delegate. Modes and tool support depend on the Provider; saving a definition does not make unsupported controls available.

Changing the daemon or working directory reloads the choices. If an existing trigger names a model, mode, or thinking option that the daemon no longer reports, Hub marks that value unavailable without replacing it. You can keep the authored value, choose a current value, or switch to YAML editing.

If the daemon is offline or needs a newer Clisbot version, the agent selectors show an error and a retry action. The rest of the trigger and its YAML remain editable.

## Saving checks the agent against the daemon

The app's Agent selectors read the selected Host's current provider configuration. Automation saves compile the YAML, resolve resources, and check your authority to delegate them. A saved revision does not prove provider startup or tool execution; send a real request and check its run and reply.

Legacy repository bundles validate named Agent configurations against the connected daemon during validation and activation. Keep the Host current and use its offered model, mode, thinking and provider options. See [Configuration](/docs/hub/configuration).

## Continue the same agent

For Automation requests through a Channel Route, enable **Continue the same Agent** to reuse a compatible Agent for that conversation. Each request still creates a run. Other events start new Agents; changes to targets or authority can also require a new Agent.

The [continuation reference](/docs/hub/configuration/hub-yml#agent-continuation) documents `reuse: binding` and earlier-step reuse. The former `run.continuation` field is unsupported.

## Events

| `on`                                  | Fires when                                           |
| ------------------------------------- | ---------------------------------------------------- |
| `github.issue_created`                | An issue is opened.                                  |
| `github.pull_request_created`         | A pull request is opened.                            |
| `github.issue_comment_created`        | A comment is created on an issue.                    |
| `github.pull_request_comment_created` | A conversation comment is created on a pull request. |
| `github.issue_label_added`            | A label is added to an issue.                        |
| `github.pull_request_label_added`     | A label is added to a pull request.                  |
| `slack.mention`                       | The bot is mentioned in a channel.                   |
| `discord.mention`                     | The bot is mentioned in a guild.                     |
| `manual.run`                          | A run started from the API.                          |

New GitHub workflows should use a semantic event. The five legacy events remain compatible: `github.issues`, `github.issue_comment`, `github.pull_request_review`, `github.pull_request_review_comment`, and `github.push`. See [GitHub triggers](/docs/hub/triggers/github) for complete workflows and when to use each event.

Each provider page documents its events and the data they expose:

- [GitHub triggers](/docs/hub/triggers/github)
- [Slack triggers](/docs/hub/triggers/slack)
- [Discord triggers](/docs/hub/triggers/discord)

## Filters

Direct external events require non-empty `filters.from_users`. `manual.run` is exempt; self-contained documents default its actor filter to `*`. Linear project-scout events require a Project filter instead. Channel Routes use Rules for their audience.

The allowlist is what keeps a stranger's comment on a public issue from starting an agent on your machine. Use specific trusted senders; `*` admits any sender.

An allowlist is one layer of defense. It does not make a permitted account trustworthy after compromise or make prompt injection harmless. See [Hub security](/docs/hub/security) before choosing the daemon, working directory, provider policy, and outputs for an external trigger.

| Filter       | Applies to                | Matches                                                              |
| ------------ | ------------------------- | -------------------------------------------------------------------- |
| `from_users` | all                       | GitHub: login. Slack/Discord: prefer stable **user ID**              |
| `repo`       | GitHub                    | `owner/name`                                                         |
| `workspace`  | Slack                     | Team id, `T01234567`                                                 |
| `guild`      | Discord                   | Guild id                                                             |
| `channels`   | Slack, Discord            | Channel ids                                                          |
| `contains`   | all                       | GitHub substring; Slack and Discord invocation prefix                |
| `pattern`    | all                       | Prefix of invocation text                                            |
| `connection` | all                       | A connection slug, when the organization has several                 |
| `label`      | GitHub label-added events | The label added by this delivery, case-insensitively                 |
| `labels`     | GitHub                    | Every listed current issue or pull-request label, case-insensitively |

All conditions must pass. There is no `any` mode.

## Which connection an event comes from

`repo`, `workspace`, and `guild` are resolved to immutable ids when the configuration activates, along with the connection that owns them. Naming a resource the organization has no connection for fails activation, so you find out on push rather than when someone comments.

Omit the resource filter and the trigger listens to every connection of that provider in the organization. Pin a self-contained document with `on.<event>.connection`; legacy Workflow files use `filters.connection`.

See [How Hub works](/docs/hub/concepts) for what activation compiles.

## When two triggers match

Both run. Triggers are not ordered and do not shadow each other, in one configuration or across projects.

## Replying

Put `allow_outputs` on the step that should reply. Use the input’s reply capability: `slack.reply`, `telegram.reply`, `discord.reply`, `github.reply`, or `linear.reply`.

- Set `max` when a step needs more than one update.
- Set `required: true` when the step must emit at least one reply before it can finish. A required type must be registered and available for the execution context.

GitHub replies post a comment on the triggering issue/PR; push events have no reply target. A [`github` block](/docs/hub/github) separately grants `gh` authority. Single-`run` direct-event documents add an optional native reply unless you author an explicit grant. The [output capability reference](/docs/hub/configuration/hub-yml#output-capabilities) has the contract.

The declaration grants the `hub.reply` tool; the prompt has to tell the agent to call it. See [Tell the agent which tool to call](/docs/hub/workflows#tell-the-agent-which-tool-to-call).
