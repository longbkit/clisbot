---
title: Operator Help Must Be Concrete And DRY
date: 2026-04-08
area: docs, control, channels
summary: Operator-facing help and setup docs should use concrete copy-pasteable commands, avoid placeholder ambiguity, and avoid repeating the same guidance in multiple places.
related:
  - docs/user-guide/README.md
  - docs/user-guide/channels.md
  - README.md
  - src/control/commands/channels-cli.ts
  - src/control/commands/startup-bootstrap.ts
  - src/control/commands/channel-privilege-cli.ts
---

## Context

This lesson comes from the conversation history in this `clisbot` project with Codex on April 7-8, 2026.

It was confirmed against local Codex session history captured during project work, including repeated user corrections about duplicated README guidance, DM privilege-command wording, and setup instructions that were still too abstract.

The feedback pattern was consistent across startup flow, channel setup, privilege commands, Telegram and Slack route help, status output, and README setup guidance.

Several rounds of human feedback focused on setup and operator-help output rather than on core runtime behavior.

The repeated issues were:

- duplicated setup guidance in `README.md`
- ambiguous placeholder wording such as telling users to use `slack-dm` or `telegram-dm` without showing the full command
- help output that repeated the same privilege-command section twice
- setup instructions that said "set env vars" without telling users to put them in a shell startup file and reload the shell
- status and startup output that did not tell the operator the next concrete action clearly enough
- route help that was technically correct but still too abstract for fast operator use
- setup flow ordering that was correct but not in the order the operator actually wanted to follow

## Lesson

Operator-facing docs and CLI help need a higher bar than normal internal notes.

Preferred rules:

- show the exact command the operator should run
- prefer literal examples over abstract placeholder explanations
- if a special target such as `slack-dm` is required, show it inside the full command
- avoid "what this means" wording when a copy-pasteable example is possible
- keep one canonical help block for shared guidance and reuse it without duplication
- when setup depends on shell env vars, say where to put them and that the shell must be reloaded

## Practical Rule

Before considering operator help done, check:

1. Can the user copy the command directly without guessing where each token goes?
2. Does the same guidance appear only once in the rendered output?
3. Does the README tell the user where to put env vars and how to reload them?
4. Do routed and unrouted help surfaces use the same terminology for the same concept?

## Applied Here

This lesson was applied by:

- rewriting DM privilege help to show full commands such as `clisbot channels privilege enable slack-dm`
- removing duplicated setup wording from `README.md`
- removing duplicated privilege-help output from `clisbot channels --help`
- moving packaged CLI setup earlier in the README quick start
- making shell startup file guidance explicit in quick start steps
