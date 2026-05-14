---
title: User Preferences For Research, CLI Docs, And Critical-Path Validation
date: 2026-04-10
area: docs, control, channels, configuration
summary: Research, CLI design, and user-facing docs should optimize for concrete operator clarity, strong source grounding, and explicit critical-path validation instead of abstract or partially documented surfaces.
related:
  - docs/research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md
  - docs/features/channels/agent-progress-reply-wrapper-and-prompt.md
  - docs/tasks/features/channels/2026-04-09-agent-progress-reply-wrapper-and-prompt.md
  - docs/tests/features/channels/README.md
  - docs/user-guide/README.md
  - docs/user-guide/agent-progress-replies.md
  - src/control/commands/channels-cli.ts
  - src/control/commands/agents-cli.ts
  - src/control/commands/message-cli.ts
---

## Context

This lesson comes from repeated human feedback during the OpenClaw research, message CLI, multi-account routing, and `responseMode` rollout work.

The recurring pattern was not that features were missing in a narrow sense. The problem was that a technically correct answer or implementation still failed if it was:

- not grounded enough in the inspected source
- too abstract for direct operator use
- missing concrete command examples
- inconsistent with existing CLI conventions
- undocumented in status, help, and user-guide surfaces
- tested only in code but not called out in written critical-path test cases

## Explicit Preferences

The user repeatedly asked for these preferences directly:

- research local source code first, especially OpenClaw, before concluding behavior
- focus docs on CLI command surfaces, especially `message *`
- put message-related commands first when documenting the feature area
- give every command a full working example, not only parameter descriptions
- explain ambiguous flags such as `--target` with concrete examples
- cover full Slack and Telegram scenarios, including files, images, audio, and thread or topic replies
- include multiple-account behavior in both docs and implementation
- follow repository architecture docs strictly
- update feature docs, task docs, user guide, help text, and status surfaces together
- use one stable name for one concept; in this case `responseMode`, not `responseMethod`
- align new CLI grammar with existing CLI structure instead of inventing a one-off pattern
- support agent-level and surface-level configuration first; avoid premature advanced binding customization
- keep pane capture even when response delivery uses the message tool path
- patch local operator config when the shipped config shape changes
- make critical behavior explicit in written test-case docs, not only in code tests

## Implicit Preferences

The user also showed stable implicit expectations through repeated correction:

- operator docs must be runnable immediately without guesswork
- examples are more important than abstract explanation
- ambiguity is a defect, not a cosmetic issue
- product surfaces should feel intentionally designed and internally consistent
- source compatibility should be studied carefully, but not copied blindly when the product should differ
- runtime behavior matters more than passing unit tests alone
- any implicit fallback or default decision should be surfaced back to the user
- critical-path behavior should be documented as ground truth
- rollout scope should stay disciplined instead of expanding into speculative configurability

## Lesson

For this repository, a feature is not complete when only the code works.

A feature should be treated as complete only when all of the following are true:

- source-driven research exists when the behavior depends on another codebase or convention
- the CLI shape is concrete, consistent, and example-rich
- status and help output reflect the same model as config and docs
- user-facing docs explain the practical operator workflow
- critical-path behavior is called out in written test cases
- tests cover both the implementation and the documented operator expectations

## Practical Rule

When working on new channel or control surfaces:

1. Inspect the relevant source of truth first.
2. Document commands with full examples before considering the surface done.
3. Keep one name per concept across config, status, docs, CLI, and code.
4. Treat missing critical-path test documentation as an incomplete delivery, even when automated tests pass.
5. Surface default, fallback, and precedence behavior explicitly to the user.

## Applied Here

This lesson was applied by:

- expanding OpenClaw-driven research before finalizing CLI and docs
- restructuring `responseMode` CLI around `--channel`, `--target`, and `--topic`
- adding full operator examples for channel and agent response-mode commands
- updating status, help, user guide, feature docs, and task docs together
- adding explicit written test coverage for Slack no-mention follow-up after `message-tool` replies
- patching local operator config to match the final shipped config shape
