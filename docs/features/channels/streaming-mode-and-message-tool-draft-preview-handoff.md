# Streaming Mode And Message-Tool Draft Preview Handoff

## Summary

`streaming` now controls live surface preview visibility for both `capture-pane` and `message-tool`.

When `responseMode: "message-tool"` is active, `clisbot` may still show one disposable live draft preview so users can see progress before the agent sends canonical replies with `clisbot message send ...`.

## Scope

- keep `streaming: off | latest | all` as the route-level live-preview policy
- make `streaming` affect both `capture-pane` and `message-tool`
- keep preview delivery to one edited draft message at a time
- add route-level `/streaming ...` slash control for status and quick updates
- keep `message-tool` final ownership on the tool path instead of pane auto-settlement
- clean up or retain the disposable draft preview according to `response` after tool-final delivery

## Product Rules

- `responseMode` decides who owns canonical user-facing reply delivery
- `streaming` decides whether the channel shows live preview while a run is active
- `message-tool` still allows one live draft preview when `streaming` is enabled
- draft preview is never a second canonical final reply
- if a tool-owned message lands in the thread during streaming, the current draft freezes
- if later preview-worthy output appears, `clisbot` opens one new draft below that boundary
- only one draft may be active at once
- once a tool final is seen, draft preview must stop updating
- when the run completes with a tool final and `response: "final"`, the disposable draft should be removed
- when the run completes without a tool final, `clisbot` must not auto-settle from pane output; `message-tool` keeps the tool path as the only canonical reply source because final-state handoff here is subtle and easy to make duplicate

## Current Runtime Note

`latest` and `all` are both first-class config values and slash-command values today, but the runtime preview shaping is still intentionally the same for now.

That means:

- `/streaming on` persists as `all`
- `/streaming latest` is accepted and reported truthfully
- a later slice can refine the visible difference between `latest` and `all` without renaming the config surface again

## Dependencies

- [Channels](README.md)
- [Agent Progress Reply Wrapper And Prompt](agent-progress-reply-wrapper-and-prompt.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)
