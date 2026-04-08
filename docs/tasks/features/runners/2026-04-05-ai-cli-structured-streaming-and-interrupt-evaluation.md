# AI CLI Structured Streaming And Interrupt Evaluation

## Summary

Evaluate whether Codex CLI and Claude CLI JSON output or JSON streaming modes should become a first-class runner path alongside tmux for better structured UX, without giving up immediate steering and interrupt control.

## Status

Planned

## Why

Both CLIs now expose structured JSON streaming and native session or resume identifiers.

That may reduce the need to scrape tmux panes for normal chat rendering, but the current tmux method still has an important strength: it supports interruption and on-the-go steering by sending more prompt input or terminal control keys such as `Esc`.

## Scope

- evaluate Codex and Claude CLI JSON output or JSON streaming as runner inputs
- confirm returned session or resume identifiers and how they map to `sessionKey`
- compare whether structured output improves chat rendering quality versus latest-view tmux normalization
- check whether interruption and steering are possible during streaming
- compare that behavior with the current tmux-driven prompt injection and `Esc` control path
- research whether ACP adds meaningful control power beyond vendor CLI JSON streams

## Related Docs

- [Runners Feature](../../../features/runners/README.md)
- [Transcript Presentation And Streaming](../../../architecture/transcript-presentation-and-streaming.md)
- [Runner Interface Standardization And tmux Runner Hardening](2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
