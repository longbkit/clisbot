# Start First-Run Bootstrap And Token Gating

## Summary

Reduce first-run friction in `clisbot start` by gating startup on default channel tokens, bootstrapping only the available channels, and auto-creating the first default agent only when the CLI choice is unambiguous.

## Status

Done

## Why

The old startup flow still had too much operator friction:

- it could create config without enough channel credentials to run truthfully
- it did not help first-run users get to a usable default agent automatically
- it could not decide safely between Codex and Claude when both were installed
- token setup guidance lived only in scattered docs

## Scope

- require default Slack or Telegram tokens before `start` bootstraps or launches
- bootstrap fresh config with only the channels that actually have tokens available
- auto-create the first `default` agent when exactly one supported CLI is installed
- stop and require explicit `--cli` choice when both supported CLIs are installed
- add setup docs for default Slack and Telegram tokens
- update feature docs, user guide, README, and tests

## Non-Goals

- adding multi-account channel runtime support
- adding interactive terminal prompts
- auto-creating Slack channels, Telegram groups, or Telegram topics

## Subtasks

- [x] add startup helpers for default-token detection and CLI detection
- [x] gate `start` on default Slack or Telegram tokens
- [x] bootstrap fresh config with only the available channels enabled
- [x] auto-create the first default agent when only one supported CLI exists
- [x] stop with explicit guidance when both supported CLIs exist
- [x] add local channel-account setup docs with official Slack and Telegram links
- [x] update tests, feature docs, task docs, and README

## Related Docs

- [Configuration Feature](../../../features/configuration/README.md)
- [User Guide](../../../user-guide/README.md)
- [Bots And Credentials](../../../user-guide/bots-and-credentials.md)
- [OpenClaw-Style Agent CLI And Bootstrap](2026-04-07-openclaw-style-agent-cli-and-bootstrap.md)
