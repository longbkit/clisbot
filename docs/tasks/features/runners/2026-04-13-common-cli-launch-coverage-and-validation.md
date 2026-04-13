# Common CLI Launch Coverage And Validation

## Summary

Make the first launch gate explicit:

- Claude
- Codex
- Gemini

`clisbot` should treat this trio as the common international CLI package that must be well tested before secondary CLI expansion becomes a priority.

## Status

Ready

## Why

Right now the repo reflects Codex and Claude much more strongly than Gemini.

That is not aligned with the intended launch story.

The product needs one clear answer to:

- which CLIs are first-class launch targets

## Scope

- define the launch-trio support bar for Claude, Codex, and Gemini
- close the biggest Gemini support gaps in setup, runtime, and docs
- define a simple validation matrix across:
  - bootstrap
  - resume or continuity
  - interruption
  - slash-command pass-through
  - Slack interaction
  - Telegram interaction
- document CLI-specific caveats that operators must know
- update status, setup, and troubleshooting docs where behavior differs by CLI

## Non-Goals

- broad secondary CLI coverage
- committing to every niche agentic CLI before launch
- redesigning the whole runner abstraction first

## Exit Criteria

- the launch docs can truthfully say Claude, Codex, and Gemini are first-class supported CLIs
- each CLI has a grounded validation checklist and test evidence
- Gemini is no longer implied as future-only support
- CLI-specific caveats are visible in docs instead of living only in team memory

## Related Docs

- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Runners Feature](../../../features/runners/README.md)
- [AI CLI Structured Streaming And Interrupt Evaluation](2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md)
