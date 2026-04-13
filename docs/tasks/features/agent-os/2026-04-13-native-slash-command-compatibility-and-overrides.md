# Native Slash Command Compatibility And Overrides

## Summary

Evaluate whether broader launch should include a stronger compatibility layer for native CLI slash commands, plus explicit override and customization surfaces when commands conflict.

## Status

Planned

## Why

`clisbot` already reserves its own control slash commands and forwards unknown slash commands to the agent.

That is a good baseline, but it may not be enough for public launch across multiple CLIs with different native command sets.

## Scope

- document current reserved-command behavior against native CLI pass-through
- identify likely conflicts across Claude, Codex, Gemini, and future CLIs
- define whether launch needs:
  - reserved-command compatibility notes
  - configurable overrides
  - command-prefix customization
  - per-CLI compatibility hints in status or help
- define the minimal UX for conflict resolution without making command routing confusing

## Non-Goals

- reproducing every native CLI command inside clisbot
- building a generic command DSL

## Exit Criteria

- the launch decision is explicit: required before launch, or deferred after launch
- conflict-handling rules are documented
- if customization is required, the next implementation slice is clear

## Related Docs

- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Agent Commands](../../../features/agent-os/commands.md)
