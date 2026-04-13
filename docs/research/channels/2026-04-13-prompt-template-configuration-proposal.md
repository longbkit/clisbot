# Proposal: Prompt Template Configuration

## Goal

Define a prompt-template system that is flexible enough to control behavior and wording, but bounded enough to stay reviewable and testable.

The proposal covers three origins:

- `user-message`
- `steering-message`
- `loop-message`

## Core Recommendation

Split the problem into two layers:

1. behavior policy
2. template source

This is the key change.

The product should not treat "configurable" as only a boolean.

It should expose:

- how the prompt template is applied
- which wording file is used
- where overrides are allowed

## Why This Is Better

If the feature only exposes `enabled: true|false`, it is still too rigid.

Product needs to control:

- strict envelope versus light note
- quiet steering versus explicit steering
- scheduled loop wording versus regular user-message wording

Engineering needs to control:

- bounded render modes
- narrow resolution order
- safe fallback
- easy debugging

## Proposed Behavior Modes

Use a small bounded set:

- `off`
- `prepend-system`
- `wrap-user`
- `append-note`

Meaning:

- `off`
  - no prompt template is applied for that origin
- `prepend-system`
  - template is rendered as a system block before the original message body
- `wrap-user`
  - template owns the full wrapper and receives the message body as a variable
- `append-note`
  - original body stays primary and a lighter template note is appended

This gives real control without creating an unbounded mini-language.

## Proposed Override Scopes

Recommended reviewable override chain:

1. agent explicit override in config
2. agent workspace file
3. provider override in config
4. app-level file
5. bundled default

Why this chain works:

- app-level edits are easy for one-machine operators
- agent-level overrides are easy for specialized agents
- provider-level override stays available when Slack and Telegram should differ
- bundled defaults keep the system safe when local files are missing

## Proposed File Layout

Bundled:

```text
templates/system/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

App-level editable:

```text
~/.clisbot/templates/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Agent-level editable:

```text
<workspace>/.clisbot/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

## Proposed Config Model

```json
{
  "control": {
    "promptTemplates": {
      "templateDir": "~/.clisbot/templates/prompt-templates",
      "kinds": {
        "userMessage": {
          "enabled": true,
          "mode": "wrap-user",
          "template": "user-message"
        },
        "steeringMessage": {
          "enabled": false,
          "mode": "prepend-system",
          "template": "steering-message"
        },
        "loopMessage": {
          "enabled": true,
          "mode": "prepend-system",
          "template": "loop-message"
        }
      }
    }
  },
  "channels": {
    "telegram": {
      "promptTemplates": {
        "kinds": {
          "steeringMessage": {
            "enabled": true
          }
        }
      }
    }
  },
  "agents": {
    "defaults": {
      "promptTemplates": {
        "templateDir": "{workspace}/.clisbot/prompt-templates"
      }
    },
    "list": [
      {
        "id": "ops-agent",
        "promptTemplates": {
          "kinds": {
            "loopMessage": {
              "mode": "wrap-user"
            }
          }
        }
      }
    ]
  }
}
```

## Template Variable Contract

Common:

- `timestamp`
- `platform`
- `conversation_summary`
- `sender_summary`
- `reply_command`
- `response_mode`
- `additional_message_mode`
- `max_progress_messages`
- `final_response_requirement`

Origin-specific:

- `user-message`
  - `message_body`
- `steering-message`
  - `message_body`
  - `active_run_state`
- `loop-message`
  - `message_body`
  - `loop_id`
  - `loop_prompt_source`
  - `loop_schedule_summary`

Recommendation:

- keep the contract small
- version it deliberately if it changes
- avoid passing a giant opaque runtime object into templates

## Review Convenience

### For Product Lead

The proposal is easy to review because it answers:

- what can be controlled
- at which scope
- what the shipped defaults are
- where operators actually edit wording

### For Tech Lead

The proposal is easy to review because it answers:

- render modes
- resolution order
- template variable contract
- code touch points
- fallback behavior

## Code Touch Points

Expected primary touch points:

- [agent-prompt.ts](/home/node/projects/clisbot/src/channels/agent-prompt.ts)
- [interaction-processing.ts](/home/node/projects/clisbot/src/channels/interaction-processing.ts)

The implementation should avoid spreading template logic everywhere else.

## Recommended Defaults

- `user-message`
  - `enabled: true`
  - `mode: "wrap-user"`
- `steering-message`
  - `enabled: false`
  - `mode: "prepend-system"`
- `loop-message`
  - `enabled: true`
  - `mode: "prepend-system"`

This default set is strong enough for normal message delivery, conservative for steering, and explicit for scheduled work.

## Recommendation

Implement this as one channels feature with:

- one feature doc
- one delivery task
- one bounded behavior model
- one file-based template system
- one truthful status surface

That is the smallest design that is flexible enough for product control and still clean enough for tech review.
