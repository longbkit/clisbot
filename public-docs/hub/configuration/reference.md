---
title: Trigger YAML reference
description: Complete field reference for Hub self-contained trigger documents in .clisbot/triggers/*.yml.
nav: Trigger YAML reference
order: 74
category: Hub
---

# Trigger YAML reference

Start with [Automations](/docs/hub/automations) in the app. **Edit YAML** shows the Automation as one self-contained document: either the single-`run` form below or a [Workflow document](#workflow-documents) with `environments` and ordered `steps`. `POST /api/v1/triggers/install` and `.clisbot/triggers/<name>.yml` files (legacy CLI path) accept the same format. The [legacy repository bundle](#legacy-repository-bundles) format remains supported.

## Top-level fields

| Field         | Required | Default           | Notes                                                                                             |
| ------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `name`        | yes      | none              | Unique trigger identifier (`^[a-z][a-z0-9_-]*$`). Redeploying updates by `name`.                  |
| `enabled`     | no       | `true`            | Disabled triggers keep their configuration and stop accepting new runs.                           |
| `on`          | yes      | none              | Non-empty map of event names to event definitions (`connection`, `filters`).                      |
| `inputs`      | no       | none              | Typed invocation headers (`type: string \| number \| boolean`, `required`, `default`, `choices`). |
| `max_runtime` | no       | `run.max_runtime` | Hard limit for the whole trigger run, up to `24h`.                                                |
| `run`         | yes      | none              | Target daemon, agent configuration, reuse, prompt, limits, GitHub authority, env, and outputs.    |

## Event definitions (`on`)

Each key under `on` is an event name:

- Provider events (`github.*`, `linear.*`, `slack.mention`, `discord.mention`) accept optional `connection` (integration slug) and `filters`. See [Triggers](/docs/hub/triggers#events) for the full event and filter tables.
- `manual.run` accepts `{}` or `filters.from_users` for API dispatch. See [Hub public API](/docs/hub/api#manual-run-dispatch).

One trigger document can list more than one event under `on`. The dashboard visual form edits single-event triggers, and multi-event triggers stay editable in YAML view.

## Target and worktree

`run.target` selects the daemon and directory where the agent executes:

| Field      | Required | Notes                                                                          |
| ---------- | -------- | ------------------------------------------------------------------------------ |
| `daemon`   | yes      | Connected daemon slug with `hub.execute` permission.                           |
| `cwd`      | yes      | Existing directory on that daemon, with an absolute path that starts with `/`. |
| `worktree` | no       | Optional git worktree mode: `branch-off`, `checkout-branch`, or `checkout-pr`. |

For example, `/home/me/project` uses the required path format. Hub rejects Windows drive paths such as `C:\work\project`.

Worktree modes:

- `branch-off`: requires `newBranch` and optional `base`. Embed `${{ clisbot.execution.id }}` in `newBranch` (for example `trigger-${{ clisbot.execution.id }}`) so each execution gets a unique branch that survives retries. `${{ clisbot.execution.id }}` is the only expression accepted in `newBranch`.
- `checkout-branch`: requires literal `branch`.
- `checkout-pr`: requires positive integer `prNumber`.

## Agent selection

`run.agent` defines either one static agent configuration or a finite choice selected from an input:

| Field              | Required | Notes                                                                                                                        |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `provider`         | yes      | Any provider configured on the target daemon (for example `codex`, `claude`, `opencode`, `pi`, or a custom/plugin provider). |
| `model`            | no       | Provider model ID.                                                                                                           |
| `mode`             | no       | Provider execution mode ID. Required in the dashboard form when the provider offers modes.                                   |
| `thinkingOptionId` | no       | Provider thinking option ID.                                                                                                 |
| `options`          | no       | JSON-safe provider-native options object, passed through without renaming.                                                   |
| `featureValues`    | no       | Provider feature values offered by the Host.                                                                                 |

Hub passes these fields to the daemon without renaming or flattening provider fields. Legacy bundle validation checks named agents against the selected daemon. App Automation saves check resources and delegation, not live provider availability; use controls the Host offers and verify an actual run.

To let an invocation input choose between complete predefined agent configurations, use `select` and `choices`:

```yaml
name: choose-agent
on:
  manual.run: {}
inputs:
  agent:
    type: string
    required: true
    choices: [codex-read, claude-work]
run:
  target:
    daemon: devbox
    cwd: /workspace/project
  agent:
    select: ${{ clisbot.inputs.agent }}
    choices:
      codex-read:
        provider: codex
        mode: read-only
      claude-work:
        provider: claude
        mode: bypassPermissions
  prompt: Handle this request and call hub.finish_execution.
```

Dynamic fields inside an inline agent object are rejected. Every possible `select` result must match a key in `choices`.

## Agent continuation

**Continue the same Agent** applies to Automation runs invoked by a Route on a Connection. Each request still creates a run. Other events start a new Agent.

Use `run.reuse: binding` in single-`run` YAML, or `reuse: binding` on a Workflow step, to reuse a compatible Agent in that Channel conversation. Omit `reuse` to start a new Agent. A later step can use `reuse: steps.<earlier-id>` to reuse that step's Agent.

Reuse needs matching target, Agent controls, environment variables and output authority. Incompatible settings or a worktree target start a new Agent. Runs for the same Channel binding wait behind earlier running work.

`run.continuation` and `startup_timeout` are not accepted configuration fields. Use the editor's current YAML rather than copying an older definition.

## Prompt and limits

| Field          | Required | Default | Notes                                            |
| -------------- | -------- | ------- | ------------------------------------------------ |
| `prompt`       | yes      | none    | Instruction text sent to the agent.              |
| `max_runtime`  | no       | `2h`    | Hard runtime limit, up to `24h`.                 |
| `idle_timeout` | no       | `10m`   | Idle timeout, no longer than `max_runtime`.      |
| `auto_archive` | no       | `true`  | Archives the workspace after execution finishes. |

Prompt expressions:

- `${{ clisbot.prompt }}` inserts the received request text after the mention and declared input headers.
- `${{ clisbot.context }}` opts the run into provider context materialization (thread history, issue metadata, or attachment descriptors) rendered as JSON. Hub does not inject ambient context unless you author `${{ clisbot.context }}`.
- `${{ clisbot.inputs.<name> }}` inserts a declared input value.

Wrap untrusted external text in a clear delimiter such as `<user-prompt>...</user-prompt>`.

## Output capabilities

Hub attaches its execution MCP server to every run and always exposes `hub.finish_execution`.

An output grant exposes `hub.reply`. Single-`run` direct-event documents supply an optional native reply when no explicit grant is authored; define a budget when needed.

A `github.push` event has no reply destination. If you set `run.outputs.github.reply.required: true` for a push, Hub fails the run before it starts the agent.

Set `run.outputs` to cap replies with `max` or require a reply before `finish_execution`.

```yaml
run:
  outputs:
    slack.reply:
      max: 1
      required: true
```

Use the reply capability that matches the input: `slack.reply`, `telegram.reply`, `discord.reply`, `github.reply` (issue/PR targets only), or `linear.reply`. Hub does not rewrite your prompt, so tell the agent when to call `hub.reply` and `hub.finish_execution`. A [`github` block](/docs/hub/github) separately grants `gh` authority.

To require structured JSON output on `hub.finish_execution`, set `run.output.schema` to a JSON Schema object.

## GitHub and environment

- `run.github` mints a scoped `GH_TOKEN` and isolated git configuration. See [GitHub access](/docs/hub/github).
- `run.env` injects environment variables, including `${{ clisbot.connections.<slug>.token }}`.

## Workflow documents

A Workflow runs ordered Agent steps instead of one `run`. It sets a workflow `max_runtime`, lists named `environments`, and optionally names `agents`. Each step is one Agent execution on a named environment:

```yaml
name: classify-request
on:
  discord.mention:
    filters:
      guild: "123456789012345678"
      from_users: ["345678901234567890"]
max_runtime: 2h
environments:
  - name: project
    kind: daemon
    daemon: devbox
    cwd: /workspace/project
steps:
  - id: classify
    environment: project
    max_runtime: 5m
    idle_timeout: 1m
    agent: { provider: claude }
    prompt:
      - text: |
          Classify the request without acting on it.
          ${{ clisbot.prompt }}
    output:
      schema:
        type: object
        required: [needs_work]
        properties:
          needs_work: { type: boolean }
        additionalProperties: false
  - id: work
    if: ${{ steps.classify.outputs.needs_work == true }}
    environment: project
    max_runtime: 1h
    idle_timeout: 10m
    agent: { provider: codex }
    prompt:
      - text: |
          Complete the request. Call hub.reply once, then call hub.finish_execution.
          ${{ clisbot.prompt }}
    allow_outputs:
      - { type: discord.reply, max: 1, required: true }
```

| Step field      | Required | Notes                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------------- |
| `id`            | yes      | Unique within the workflow.                                                              |
| `environment`   | yes      | Literal environment name or finite expression resolving to one.                          |
| `max_runtime`   | yes      | Step hard limit.                                                                         |
| `idle_timeout`  | yes      | Idle limit no longer than `max_runtime`.                                                 |
| `agent`         | yes      | Named agent, finite expression selecting a named agent, or complete static inline agent. |
| `prompt`        | yes      | Ordered `text` and `include` blocks.                                                     |
| `if`            | no       | Expression deciding whether the step runs.                                               |
| `reuse`         | no       | `binding` or `steps.<earlier-id>`; see [Agent continuation](#agent-continuation).        |
| `env`           | no       | Environment variables from connection values.                                            |
| `output.schema` | no       | JSON Schema for structured step output.                                                  |
| `allow_outputs` | no       | Provider output capabilities with optional `max` and `required`.                         |
| `auto_archive`  | no       | Archive the agent after the step ends.                                                   |
| `github`        | no       | Explicit GitHub authority for this step.                                                 |

Steps run in order. `if` may read inputs, values and earlier step output; a step cannot read a later one. Authority chosen from an earlier step's output must be bounded by `enum` or `const` in that output schema, so every possible environment and agent result is checked before the run. The workflow `max_runtime` limits the complete run, and remaining workflow time caps each step.

### Tell the agent which tool to call

`allow_outputs` grants a capability; it does not rewrite the prompt. Name the required action, for example "Send the final answer with hub.reply, then call hub.finish_execution." `max` defaults to `1` for an explicit grant, and `required: true` prevents successful completion until that output has been emitted. Grant only the reply type available to the input: Slack, Telegram, Discord, GitHub issue/PR, or Linear.

## Legacy repository bundles

The supported legacy repository bundle keeps named resources in `.clisbot/hub.yml` and one trigger with its ordered steps in each direct `.clisbot/workflows/*.yml` file. Prompt partials live below `.clisbot/workflows/partials/`.

```text
.clisbot/
├── hub.yml
└── workflows/
    ├── <workflow>.yml
    └── partials/
        └── <partial>.md
```

`hub.yml` has only two top-level keys, `environments` and `agents`; names are map keys. A `triggers` key is rejected with a migration error. Environments are `kind: daemon` with `daemon`, `cwd` and an optional `worktree`; agents are complete provider configurations with the fields in [Agent selection](#agent-selection). Named objects are never inherited, merged, or partially overridden. In bundles, `on` is an event name with `filters` beside it, and connections are pinned with `filters.connection`.

Bundles are installed with `clisbot hub deploy --project <slug>` (available with `CLISBOT_ONBOARDING_ENABLED=0`) or synced from a GitHub repository. See [Repository bundles](/docs/hub/configuration#repository-bundles) and protect the repository: a change can select connections, daemons, working directories, agents, and outputs.
