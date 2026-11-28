---
title: Linear triggers
description: Start Hub agents from Linear issue comments, assignments, and project scope changes.
nav: Linear
order: 66
category: Hub
---

# Linear triggers

Start agents on your Clisbot daemons from Linear issue activity and post replies back to the issue. First connect a Linear workspace under **Connections** (configure the [Linear app](/docs/hub/self-hosting/linear-app) on your Hub first).

## Supported events

| `on`                         | Fires when                                                                |
| ---------------------------- | ------------------------------------------------------------------------- |
| `linear.comment_created`     | A new comment matches the allowed author and text filters.                |
| `linear.issue_assigned`      | An update assigns or reassigns the issue to a user.                       |
| `linear.issue_entered_scope` | An issue is created in scope or transitions from outside to inside scope. |

Each matching event starts a new agent run. Linear events do not continue an earlier agent; see [Continue the same agent](/docs/hub/triggers#continue-the-same-agent).

## Respond to issue comments

Replace the connection slug and user UUID, and set `run.target` to a [connected daemon](/docs/hub/daemons). The Automation’s YAML looks like this:

```yaml
name: linear-help
on:
  linear.comment_created:
    connection: acme-linear
    filters:
      from_users: ["11111111-1111-4111-8111-111111111111"]
      pattern: "/clisbot "
run:
  target:
    daemon: devbox
    cwd: /workspace/project
  agent:
    provider: codex
    mode: full-access
  max_runtime: 30m
  idle_timeout: 10m
  prompt: |
    Summarize the request and suggest a next step.
    Post one reply using hub.reply, then call hub.finish_execution.

    <user-prompt>
    ${{ clisbot.prompt }}
    </user-prompt>
  outputs:
    linear.reply:
      max: 1
      required: true
```

Save it in [Automations](/docs/hub/automations). From an allowed Linear account, post an issue comment such as `/clisbot summarize this request`. Hub matches the prefix, runs the agent on `devbox`, and posts the reply as a comment on that Linear issue. Check [Activity](/docs/hub/activity) to inspect the run.

## Start work when an issue enters scope

`linear.issue_entered_scope` runs once when an issue enters the configured filter scope, either at creation or when an update moves it into scope. Later edits to an issue that is already in scope do not trigger another run.

This event requires `filters.project` and can omit `from_users` for an automated project workflow:

```yaml
name: linear-project-worker
on:
  linear.issue_entered_scope:
    connection: acme-linear
    filters:
      project: "22222222-2222-4222-8222-222222222222"
      states: ["33333333-3333-4333-8333-333333333333"]
      labels: ["44444444-4444-4444-8444-444444444444"]
      exclude_labels: ["55555555-5555-4555-8555-555555555555"]
run:
  target:
    daemon: devbox
    cwd: /workspace/project
    worktree:
      mode: branch-off
      newBranch: trigger-${{ clisbot.execution.id }}
      base: origin/main
  agent:
    provider: codex
    mode: full-access
  max_runtime: 90m
  idle_timeout: 10m
  github:
    connection: acme-github
    repositories: [acme/project]
    permissions:
      contents: write
      pull_requests: write
  prompt: |
    Implement the Linear issue, open a pull request with gh, and post the PR URL using hub.reply.
    Issue context:
    ${{ clisbot.context }}
    Call hub.finish_execution when done.
```

To trigger on assignments instead, use `linear.issue_assigned` with `from_users` naming the allowed assigners and `assignees` naming the target Linear user UUIDs.

## Filters and Linear UUIDs

All Linear filters compose with AND and use Linear UUIDs rather than display names:

| Filter           | Required for                                      | Matches                                                  |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `from_users`     | `linear.comment_created`, `linear.issue_assigned` | User UUIDs of allowed comment authors or assigners.      |
| `project`        | `linear.issue_entered_scope`                      | Linear project UUID.                                     |
| `states`         | Optional                                          | Issue workflow state UUIDs (any listed state matches).   |
| `assignees`      | Optional                                          | Issue assignee user UUIDs (any listed assignee matches). |
| `labels`         | Optional                                          | Every listed label UUID must be present on the issue.    |
| `exclude_labels` | Optional                                          | Any listed label UUID prevents a match.                  |
| `pattern`        | Optional (`linear.comment_created`)               | Required prefix at the start of the comment body.        |
| `contains`       | Optional (`linear.comment_created`)               | Required substring anywhere in the comment body.         |

To find a UUID in Linear, open the command menu (`Cmd+K` or `Ctrl+K`) on an issue, project, or label and choose **Copy model UUID**, or query the [Linear GraphQL API](https://linear.app/developers/graphql).

## Context and replies

Include `${{ clisbot.context }}` in `run.prompt` to pass the issue details (identifier, title, description, URL, project, state, assignee, labels) and up to 49 preceding issue comments as JSON.

Linear triggers automatically grant `hub.reply` (`linear.reply`) to post comments on the triggering issue. Declare `run.outputs.linear.reply` to enforce `max` or `required: true`. A Linear trigger grants no `gh` credential; add a [`github` block](/docs/hub/github) when the agent needs repository access.
