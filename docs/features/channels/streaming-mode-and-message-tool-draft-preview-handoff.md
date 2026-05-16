# Streaming Mode And Message-Tool Draft Preview Handoff

## Summary

`streaming` now controls live surface preview visibility for both `capture-pane` and `message-tool`.

When `responseMode: "message-tool"` is active, `clisbot` may still show one live draft preview so users can see progress before the agent sends replies with `clisbot message send ...`. That draft requires channel support for updating a live reply. Append-only channels such as current Zalo Bot do not render pane preview streaming, because attempting to reconcile a live draft there would post duplicate progress messages instead of replacing the draft.

## Scope

- keep `streaming: off | latest | all` as the route-level live-preview policy
- make `streaming` affect both `capture-pane` and `message-tool`
- keep preview delivery to one active draft message at a time, using edit/delete only where the channel supports it
- add route-level `/streaming ...` slash control for status and quick updates
- prefer `message-tool` final ownership when the tool sends a final reply, with pane settlement as the no-tool-final fallback
- clean up or retain the disposable draft preview according to `response` after tool-final delivery

## Product Rules

- `responseMode` decides who owns canonical user-facing reply delivery
- `streaming` decides whether the channel shows live preview while a run is active
- delayed work such as queued turns and loop ticks must follow the same `streaming` rule as immediate turns
- `message-tool` allows one live draft preview when `streaming` is enabled and the channel can update a live reply
- draft preview is never a second canonical final reply
- if a tool-owned message lands in the thread during streaming, the current draft is handed off and preview updates stop for that run
- a progress-only tool reply is not settlement; only a fresh tool final marker suppresses pane-derived final fallback
- only one draft may be active at once
- once a tool final is seen, draft preview must stop updating
- when the run completes with a tool final and `response: "final"`, the disposable draft should be removed where the channel supports deleting or clearing it
- when the run completes without a tool final, settlement falls back to the normal pane-derived final path; this keeps silent or broken tool delivery from dropping the result
- queued-start notifications are standalone lifecycle messages; streaming drafts and final settlement must not edit or replace those notifications
- append-only channels should keep queue/loop start notifications and final/fallback settlement, but skip live pane preview streaming

## Current Runtime Note

`latest` and `all` are both first-class config values and slash-command values today, but the runtime preview shaping is still intentionally the same for now.

That means:

- `/streaming on` persists as `all`
- `/streaming latest` is accepted and reported truthfully
- a later slice can refine the visible difference between `latest` and `all` without renaming the config surface again

Current running-preview shaping rule:

- normal append-like pane growth is still accumulated into one live preview
- if the pane rewrites hard enough that overlap cannot be trusted, clisbot replaces the running preview instead of freezing it
- that replacement is intentionally bounded to only the latest changed lines plus a short `...[N more changed lines]` marker when the rewrite is large
- the goal is stable chat readability, not full in-chat transcript reconstruction during a noisy rewrite

## Dependencies

- [Channels](README.md)
- [Agent Progress Reply Wrapper And Prompt](agent-progress-reply-wrapper-and-prompt.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)
