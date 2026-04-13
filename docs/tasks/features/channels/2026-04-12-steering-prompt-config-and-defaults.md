# Steering Prompt Config And Defaults

## Summary

Make the auto-injected steering prompt configurable, simplify its format, and revisit the shipped defaults so steering-mode follow-up does not add extra system prompt chrome unless the operator explicitly wants it.

## Status

Dropped

## Why

Current steering mode auto-injects a prompt wrapper whenever a later user message is steered into an already-running session.

That behavior is useful in some cases, but it also adds prompt noise and hides an important product choice inside a hardcoded default:

- users may want steering without extra wrapper text
- the current wrapper format is more verbose than needed
- the shipped default may be too opinionated for normal chat use

This should become an explicit configuration surface instead of a fixed runtime assumption.

## Scope

- add config for whether auto-steered messages get an injected system wrapper at all
- simplify the default steering wrapper format to the minimal useful structure, for example a plain `<system>...</system>` block without `[clisbot steering message]`
- revisit the default product behavior so steering prompt injection is off by default unless explicitly enabled
- keep explicit `/steer <message>` semantics clear and documented even when auto-wrapper injection is disabled
- update tests and docs to match the new config and defaults

## Current Truth

- `additionalMessageMode: "steer"` is currently the shipped default
- auto-steered follow-up currently injects extra prompt text including `[clisbot steering message]`
- there is now product feedback that this default is too noisy and should likely be disabled unless needed

## Non-Goals

- removing steer mode itself
- removing explicit `/steer` commands
- redesigning all agent prompt envelope formatting in this slice

## Subtasks

- [ ] define config shape for steering prompt injection enablement and optional format control
- [ ] change the default so auto-steered follow-up does not inject the steering prompt unless enabled
- [ ] simplify the steering prompt format when it is enabled
- [ ] verify explicit `/steer` remains understandable and useful after the default changes
- [ ] update docs and regression tests for the new config and default behavior

## Exit Criteria

- operators can choose whether steering mode injects a prompt wrapper
- the wrapper format is shorter and cleaner when enabled
- the shipped default no longer adds steering prompt noise unless explicitly configured

## Replacement

This narrower steering-only task is now folded into the broader prompt-template task:

- [Prompt Templates And Overrides](2026-04-13-prompt-templates-and-overrides.md)

## Related Docs

- [Agent Progress Reply Wrapper And Prompt](2026-04-09-agent-progress-reply-wrapper-and-prompt.md)
- [Prompt Templates](../../../features/channels/prompt-templates.md)
- [Conversation Follow-Up Policy And Runtime Control API](../agent-os/2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md)
- [Channels Feature](../../../features/channels/README.md)
