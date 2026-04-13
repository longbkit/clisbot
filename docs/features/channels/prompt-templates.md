# Prompt Templates

## Summary

`clisbot` should treat prompt templates as a first-class channels feature, not as a few hardcoded strings.

The feature must let the product control both:

- behavior: how the prompt template is applied
- wording: which template text is rendered

across three message origins:

- `user-message`
- `steering-message`
- `loop-message`

It should ship with editable defaults, support per-agent overrides, and stay easy to review for both product and engineering.

## Outcome

After install:

- operators can open one obvious folder and edit prompt templates directly
- developers can find the active prompt files quickly
- product can tune how noisy or strict the prompt template should be per origin
- the runtime can explain which behavior mode and template source are active

## Review Lenses

### Product Lead Review

Review these questions first:

- which origins should have prompt templates enabled by default
- how strong should each attachment be
- which default mode fits each origin best
- how much wording should be editable without code changes
- whether agent-level overrides are sufficient, or whether provider-level overrides should also be first-class

### Tech Lead Review

Review these questions first:

- whether behavior control and template text are separated cleanly
- whether resolution order is explicit and debuggable
- whether the renderer contract is bounded enough to test well
- whether missing-file fallback is safe and observable
- whether the code touch points stay narrow and channel-owned

## Message Origins

### `user-message`

Used when a normal routed user message becomes an agent prompt.

### `steering-message`

Used when a later user message is injected into an already-running session as steering input.

### `loop-message`

Used when `/loop` injects a loop-triggered prompt into the session.

## Control Model

The product needs two separate layers:

### 1. Behavior Policy

Behavior answers:

- whether prompt-template behavior runs at all
- how strongly it reshapes the final prompt

Suggested per-origin control:

```json
{
  "enabled": true,
  "mode": "wrap-user",
  "template": "user-message"
}
```

Recommended bounded modes:

- `off`
  - no prompt template is applied for that origin
- `prepend-system`
  - render the template as a system block before the original message body
- `wrap-user`
  - template owns the full wrapper and receives the message body as a variable
- `append-note`
  - keep the original message shape mostly intact and append a lighter note after it

This is flexible enough for product tuning without turning prompt rendering into an open-ended DSL.

### 2. Template Source

Template source answers:

- which file provides the wording
- whether the wording comes from bundled defaults, app-level edits, or agent overrides

## Resolution Order

For one origin kind, behavior and template source should resolve in this order:

1. agent explicit override in config
2. agent workspace template file
3. provider override in config
4. app-level template file
5. bundled default

This gives:

- safe shipped defaults
- operator-editable defaults
- channel-specific product tuning if needed
- per-agent customization without duplication everywhere

## Default File Layout

Bundled defaults in the repo:

```text
templates/system/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Editable app-level defaults:

```text
~/.clisbot/templates/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Optional per-agent overrides:

```text
<workspace>/.clisbot/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Rules:

- materialize app-level files when missing
- never overwrite an existing edited file silently
- agent-level files override only the kinds they provide

## Suggested Config Shape

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

Common variables:

- `timestamp`
- `platform`
- `conversation_summary`
- `sender_summary`
- `reply_command`
- `response_mode`
- `additional_message_mode`
- `max_progress_messages`
- `final_response_requirement`

Origin-specific variables:

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

The contract should stay small and documented. The runtime should not expose a large free-form object by default.

## Status And Debugging

`clisbot status` should show, per origin kind:

- `enabled`
- `mode`
- `template`
- winning source:
  - `agent-config`
  - `agent-file`
  - `provider-config`
  - `app-file`
  - `bundled-default`

That is what makes both product review and operator debugging practical.

## Code Touch Points

Main expected implementation touch points:

- [agent-prompt.ts](/home/node/projects/clisbot/src/channels/agent-prompt.ts)
- [interaction-processing.ts](/home/node/projects/clisbot/src/channels/interaction-processing.ts)

The runtime should concentrate most changes into:

- origin classification
- template resolution
- variable collection
- bounded render modes

## Defaults Recommendation

Recommended starting defaults:

- `user-message`
  - `enabled: true`
  - `mode: "wrap-user"`
- `steering-message`
  - `enabled: false`
  - `mode: "prepend-system"`
- `loop-message`
  - `enabled: true`
  - `mode: "prepend-system"`

This keeps the normal prompt envelope strong, steering conservative, and loop behavior explicit.

## Related Docs

- [Channels](README.md)
- [Agent Progress Reply Wrapper And Prompt](agent-progress-reply-wrapper-and-prompt.md)
- [Task Doc](../../tasks/features/channels/2026-04-13-prompt-templates-and-overrides.md)
- [Proposal](../../research/channels/2026-04-13-prompt-template-configuration-proposal.md)
