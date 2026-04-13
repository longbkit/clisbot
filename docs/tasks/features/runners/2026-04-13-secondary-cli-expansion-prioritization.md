# Secondary CLI Expansion Prioritization

## Summary

After the common launch trio is solid, expand to additional agentic CLIs based on real demand instead of intuition alone.

Current candidate list:

- Cursor
- Amp
- OpenCode
- Qwen
- Kilo
- Minimax

## Status

Planned

## Why

The product should not treat every CLI as equal-priority launch work.

Secondary CLI support should follow a demand snapshot plus a compatibility estimate.

## Scope

- gather a simple userbase or demand snapshot for secondary CLIs
- rank the next CLI wave by expected user value
- define a lightweight compatibility checklist for each candidate
- identify which candidates can reuse the current runner model with low friction
- split high-priority candidates into follow-up implementation tasks

## Non-Goals

- implementing all candidate CLIs in one batch
- pretending that all unsupported CLIs belong in the same milestone as Claude, Codex, and Gemini

## Exit Criteria

- one prioritized list exists for the next CLI wave
- each candidate has a brief compatibility note
- the backlog order for secondary CLIs is no longer arbitrary

## Related Docs

- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Common CLI Launch Coverage And Validation](2026-04-13-common-cli-launch-coverage-and-validation.md)
