# Prompt Templates And Overrides

## Summary

Implement a file-based prompt-template system that controls both behavior mode and template wording for:

- `user-message`
- `steering-message`
- `loop-message`

The system must ship editable defaults, support per-agent overrides, and expose enough runtime truth for product and engineering review.

## Status

Ready

## Delivery Goal

After this task:

- product can tune prompt-template behavior per origin without code changes for most wording edits
- operators can edit default templates under `~/.clisbot/templates/prompt-templates/`
- one agent can override the defaults from its own workspace
- status tells reviewers which mode and template source are active

## Scope

- add three origin kinds:
  - `user-message`
  - `steering-message`
  - `loop-message`
- add bounded behavior modes:
  - `off`
  - `prepend-system`
  - `wrap-user`
  - `append-note`
- add bundled defaults plus app-level editable copies
- add optional provider and agent overrides
- add per-agent workspace template override directory
- add status visibility for winning source and mode
- update docs and tests

## Non-Goals

- WYSIWYG template editing
- arbitrary scripting inside templates
- replacing channel ownership of prompt rendering
- redesigning unrelated response or queue behavior

## Product Decisions To Implement

- behavior control and wording control are separate concerns
- prompt-template behavior stays channel-owned
- template files are the main content-edit surface
- `steering-message` is not a one-off special case anymore
- loop-origin prompts get their own first-class template kind

## Config Target

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

## Resolution Rules

Per origin kind:

1. agent explicit override in config
2. agent workspace file
3. provider override in config
4. app-level file
5. bundled default

Behavior mode and template source should resolve through the same order so status remains understandable.

## Template Layout

Bundled defaults:

```text
templates/system/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

App-level editable copies:

```text
~/.clisbot/templates/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Per-agent overrides:

```text
<workspace>/.clisbot/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

## Implementation Slices

### 1. Template assets and filesystem bootstrap

- add bundled template files
- materialize app-level editable copies when missing
- do not overwrite existing local edits silently

### 2. Config and schema

- add prompt-template config under app defaults
- add optional provider override layer
- add agent default and agent-specific override support

### 3. Render engine

- implement bounded render modes
- implement template resolution
- collect common and origin-specific variables

### 4. Runtime integration

- route normal messages through `user-message`
- route steering follow-up through `steering-message`
- route `/loop` prompt injection through `loop-message`

### 5. Status and docs

- show active mode and winning source in `clisbot status`
- update docs for operator and developer workflow

## Review Checklist

### Product Lead

- defaults by origin are acceptable
- `steering-message` default remains conservative
- loop-origin wording can be tuned independently
- editable app-level files are the right operator surface

### Tech Lead

- behavior modes are bounded enough to test
- resolution order is explicit
- code touch points stay narrow
- fallback rules are safe
- status truth is sufficient for debugging

## Validation Notes

- config tests:
  - app default config shape loads correctly
  - provider overrides work
  - agent overrides work
- resolution tests:
  - bundled fallback works
  - app-level file wins over bundled
  - agent file wins over app-level file
  - provider config can change mode without replacing template file
- behavior tests:
  - normal message uses `user-message`
  - steering follow-up uses `steering-message`
  - loop-triggered prompt uses `loop-message`
  - each mode changes render shape as expected
- filesystem tests:
  - template directory is created when needed
  - missing files are copied
  - existing files are not overwritten
- status tests:
  - winning source and mode are shown truthfully

## Exit Criteria

- prompt-template behavior is configurable beyond simple on or off
- wording is file-editable after install
- per-agent overrides work
- user, steering, and loop origins each have their own behavior and template path
- both product and engineering can review active behavior from docs and status without reading code first

## Related Docs

- [Feature Doc](../../../features/channels/prompt-templates.md)
- [Proposal](../../../research/channels/2026-04-13-prompt-template-configuration-proposal.md)
- [Agent Progress Reply Wrapper And Prompt](2026-04-09-agent-progress-reply-wrapper-and-prompt.md)
