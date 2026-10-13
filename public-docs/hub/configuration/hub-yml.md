---
title: Hub configuration reference
description: Canonical Hub resource, workflow, agent, expression, and prompt fields.
nav: Configuration reference
order: 71
category: Hub
---

# Hub configuration reference

Start with [Automations](/docs/hub/automations) in the app. The YAML editor accepts a self-contained Workflow: `on` is an event map, `environments` is a list of named targets, and `steps` contains ordered Agent executions. A single-`run` shorthand is shown in [Configuration](/docs/hub/configuration).

The following layout is the supported **legacy repository bundle** format:

```text
.clisbot/
├── hub.yml
└── workflows/
    ├── <workflow>.yml
    └── partials/
        └── <partial>.md
```

Only direct `.yml` children of `.clisbot/workflows/` are workflows. Each file contains one trigger and its ordered steps. There is no manifest, `includes`, `uses`, reusable step, workflow call, or inheritance.

## `hub.yml`

`.clisbot/hub.yml` contains named project resources. Names are map keys and are not repeated inside each object.

```yaml
environments:
  clisbot:
    kind: daemon
    daemon: laptop
    cwd: /Users/you/code/clisbot
  hub:
    kind: daemon
    daemon: devbox
    cwd: /workspace/hub

agents:
  codex-safe:
    provider: codex
    model: gpt-5.5
    thinkingOptionId: xhigh
    options:
      sandbox_workspace_write:
        writable_roots: [/var/cache/npm]
        network_access: false
  claude:
    provider: claude
    mode: bypassPermissions
```

The only top-level keys are `environments` and `agents`. A `triggers` key is rejected with a migration error.

### Environments

| Field      | Required    | Notes                                                                          |
| ---------- | ----------- | ------------------------------------------------------------------------------ |
| `kind`     | yes         | `daemon`, `fly`, or `docker`; workflow steps must select a daemon environment. |
| `daemon`   | daemon only | Registered daemon slug, resolved when the revision activates.                  |
| `cwd`      | daemon only | Absolute working directory on the daemon.                                      |
| `image`    | fly/docker  | Image name.                                                                    |
| `worktree` | no          | `branch-off`, `checkout-branch`, or `checkout-pr` target.                      |

For `worktree`, use `newBranch` and optional `base` with `branch-off`, `branch` with `checkout-branch`, or positive `prNumber` with `checkout-pr`.

```yaml
environments:
  review:
    kind: daemon
    daemon: build-server
    cwd: /workspace/project
    worktree:
      mode: branch-off
      newBranch: trigger-${{ clisbot.execution.id }}
      base: origin/main
```

`newBranch` is a branch-name string. Embed `${{ clisbot.execution.id }}`, which renders the execution's UUID, so every execution branches off `base` on its own branch and keeps it when Hub retries or recovers that execution.

One execution is one step run, so two steps selecting the same environment get separate branches.

`${{ clisbot.execution.id }}` is the only expression `newBranch` accepts. `clisbot.prompt`, `clisbot.context`, `clisbot.inputs.*`, `values.*`, `steps.<id>.outputs.*`, and provider event fields are unavailable here, and each one fails bundle activation at the authored field, such as `.clisbot/hub.yml.environments.review.worktree.newBranch`.

`${{ clisbot.execution.id }}` fails activation the same way anywhere else in a bundle. `branch` and `prNumber` take literal values.

An environment is a complete named object. A step selects its name; objects are not inherited, merged, or partially overridden.

### Named agents

Each agent is one complete provider configuration:

| Field              | Required | Notes                                                                          |
| ------------------ | -------- | ------------------------------------------------------------------------------ |
| `provider`         | yes      | Provider ID offered by the target Host; capabilities remain Provider-specific. |
| `model`            | no       | Provider model ID.                                                             |
| `mode`             | no       | Clisbot mode ID.                                                               |
| `thinkingOptionId` | no       | Provider thinking option.                                                      |
| `options`          | no       | JSON-safe provider-native options, preserving names and nesting.               |
| `featureValues`    | no       | Provider feature values offered by the Host.                                   |

A named selection preserves the complete object, including structured options. Named agents have no parent, patch, or per-step override.

Hub passes `model`, `mode`, `thinkingOptionId`, and `options` to the Clisbot daemon without renaming or flattening provider fields. Legacy bundle validation checks named agents against the selected daemon. App Automation saves check resources and delegation; use controls available on the Host and verify an actual run. Hub does not translate provider-native options. See [Saving checks the agent against the daemon](/docs/hub/triggers#saving-checks-the-agent-against-the-daemon).

## Workflow files

`.clisbot/workflows/review.yml`:

```yaml
name: review
on: manual.run
max_runtime: 2h
filters:
  from_users: [automation]
inputs:
  repo:
    type: string
    required: true
    choices: [clisbot, hub]
steps:
  - id: inspect
    environment: ${{ clisbot.inputs.repo }}
    max_runtime: 30m
    idle_timeout: 5m
    agent: codex-safe
    prompt:
      - text: ${{ clisbot.prompt }}
```

| Field         | Required | Notes                                                     |
| ------------- | -------- | --------------------------------------------------------- |
| `name`        | yes      | Workflow name, unique across the bundle.                  |
| `on`          | yes      | Provider event such as `manual.run` or `discord.mention`. |
| `max_runtime` | yes      | Hard limit for the complete run, up to 24h.               |
| `filters`     | yes      | Provider resource filters and the sender allowlist.       |
| `inputs`      | no       | Typed invocation headers.                                 |
| `values`      | no       | Named expressions.                                        |
| `steps`       | yes      | One or more ordered inline steps.                         |

### GitHub events and filters

Use one of these semantic event names for new GitHub workflows:

| `on`                                  | Matches                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `github.issue_created`                | An `issues` delivery whose action is `opened`.                            |
| `github.pull_request_created`         | A `pull_request` delivery whose action is `opened`.                       |
| `github.issue_comment_created`        | An `issue_comment` delivery whose action is `created`, on an issue.       |
| `github.pull_request_comment_created` | An `issue_comment` delivery whose action is `created`, on a pull request. |
| `github.issue_label_added`            | An `issues` delivery whose action is `labeled`.                           |
| `github.pull_request_label_added`     | A `pull_request` delivery whose action is `labeled`.                      |

Existing configurations may continue to use `github.issues`, `github.issue_comment`, `github.pull_request_review`, `github.pull_request_review_comment`, and `github.push`. These legacy events retain their existing behavior.

`filters` supports these GitHub fields. `from_users` must be non-empty for every externally sourced workflow. All supplied filters compose with AND.

| Field        | Type                                | Applies to                                                    | Meaning                                                                         |
| ------------ | ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `from_users` | non-empty list of strings           | all GitHub events                                             | GitHub logins allowed to start the workflow.                                    |
| `repo`       | non-empty string                    | all GitHub events                                             | Repository in `owner/name` form.                                                |
| `connection` | string                              | all GitHub events                                             | GitHub connection slug.                                                         |
| `contains`   | string                              | issue, pull-request, and comment events                       | Substring in the issue or pull-request title plus body, or in the comment body. |
| `pattern`    | string                              | issue, pull-request, and comment events                       | Start of that same text.                                                        |
| `label`      | non-empty string                    | `github.issue_label_added`, `github.pull_request_label_added` | The label added by the delivery.                                                |
| `labels`     | non-empty list of non-empty strings | issue, pull-request, and comment events                       | Every listed label must be currently present on the issue or pull request.      |

`label` and `labels` match GitHub labels case-insensitively. `label` checks the one changed label; `labels` checks the full current label set and requires every entry. For example, `labels: [bug, backend]` requires both `bug` and `backend`.

Use `label` only with a label-added event. It has no match on other events. Use `labels` to require the item state, including when a comment starts the workflow.

See [GitHub triggers](/docs/hub/triggers/github) for complete triage, pull-request review, and ready-for-agent workflows.

### Inputs and values

Inputs have `type: string | number | boolean`, plus optional `required`, `default`, and `choices`. `required` and `default` cannot be combined. Finite `choices` are required when an input can choose authority such as an environment or named agent.

Values bind expressions:

```yaml
values:
  selected_environment: ${{ steps.classify.outputs.environment }}
  selected_agent: ${{ steps.classify.outputs.agent }}
```

Expressions may read declared `clisbot.inputs`, earlier `steps.<id>.outputs`, and `values`. The grammar supports paths, JSON literals, parentheses, `!`, `==`, `!=`, `&&`, `||`, and `??`.

An environment or dynamic named-agent expression must have a finite set of possible string results at activation. Every result must name a configured resource. Runtime selection never falls back to another environment or agent.

### Steps

| Field           | Required | Notes                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------------- |
| `id`            | yes      | Unique within the workflow.                                                              |
| `environment`   | yes      | Literal environment name or finite expression resolving to one.                          |
| `max_runtime`   | yes      | Step hard limit.                                                                         |
| `idle_timeout`  | yes      | Idle limit no longer than `max_runtime`.                                                 |
| `agent`         | yes      | Named agent, finite expression selecting a named agent, or complete static inline agent. |
| `prompt`        | yes      | Ordered `text` and `include` blocks.                                                     |
| `if`            | no       | Expression deciding whether the step runs.                                               |
| `env`           | no       | Environment variables from connection values.                                            |
| `output.schema` | no       | JSON Schema for structured step output.                                                  |
| `allow_outputs` | no       | Provider output capabilities with optional `max` and `required`.                         |
| `auto_archive`  | no       | Archive the agent after the step ends.                                                   |
| `github`        | no       | Explicit GitHub authority for this step.                                                 |

An inline agent is static and complete:

```yaml
agent:
  provider: codex
  model: gpt-5.5
  options:
    approval_policy: never
    sandbox_mode: read-only
```

An expression-valued `agent` selects a named agent. Dynamic provider fields inside an inline object are rejected.

### Prompt semantics

```yaml
prompt:
  - include: partials/review.md
  - text: |
      <user-prompt>
      ${{ clisbot.prompt }}
      </user-prompt>
```

`${{ clisbot.prompt }}` is the normalized request after the provider marker and declared leading `key=value` inputs are removed. It is not rewritten or augmented with event context.

`${{ clisbot.context }}` opts that step into provider context materialization and renders the result as JSON in the prompt. It is available only in prompt text. Hub does not inject it unless the workflow authors that expression.

Includes resolve relative to `.clisbot/workflows/`, so shared partials use `partials/<name>.md`. Missing files, absolute or traversing paths, symlinks, content mismatches, and files outside the partial tree are rejected.

### Output capabilities

Authority stays on the step that uses it:

```yaml
allow_outputs:
  - type: discord.reply
    max: 1
    required: true
```

Use `slack.reply`, `telegram.reply`, `discord.reply`, or `github.reply` for the matching input. GitHub replies require an issue/PR target. The declaration grants `hub.reply`; tell the Agent to call it. A [`github` block](/docs/hub/github) separately grants `gh` authority.

Every step receives `hub.finish_execution`. The prompt must tell the agent when to call it; Hub does not append completion or reply instructions. If `output.schema` is present, `hub.finish_execution` requires an `output` value that matches the schema. If an `allow_outputs` entry is `required: true`, the agent must emit that output before finishing. `max` defaults to `1`.

## Migrating a monolithic file

Keep `environments` in `hub.yml`, convert the environment list to a named map, and move each former trigger into its own `.clisbot/workflows/<name>.yml` file. Move shared prompt files to `.clisbot/workflows/partials/`. Define complete named agent configurations under `agents` and replace dynamic provider fields with finite named-agent selection.

Hub does not read TOML or a monolithic `triggers` section, and the CLI does not rewrite either format.

See [Workflows](/docs/hub/workflows) for complete routing examples.

## Agent continuation

**Continue the same Agent** applies to Automation runs invoked by a Route on a Connection. Each request still creates a run. Other events start a new Agent.

Use `run.reuse: binding` in single-`run` YAML, or `reuse: binding` on a Workflow step, to reuse a compatible Agent in that Channel conversation. Omit `reuse` to start a new Agent. A later step can use `reuse: steps.<earlier-id>` to reuse that step's Agent.

Reuse needs matching target, Agent controls, environment variables and output authority. Incompatible settings or a worktree target start a new Agent. Runs for the same Channel binding wait behind earlier running work.

`run.continuation` and `startup_timeout` are not accepted configuration fields. Use the editor's current YAML rather than copying an older definition. See [Automations](/docs/hub/automations) for the user flow.
