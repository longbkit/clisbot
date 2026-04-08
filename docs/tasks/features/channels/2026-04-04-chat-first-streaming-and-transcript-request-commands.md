# Chat-First Streaming And Transcript Request Commands

## Summary

Make chat-first streaming the default interaction model and support whole-session visibility only through explicit transcript request commands.

## Status

Ready

## Why

Normal interaction should feel like a clean conversation, not a tmux dump.

This must hold whether the backend session is:

- a tmux-hosted coding agent such as Codex
- another agent CLI
- a plain bash shell running inside tmux

Users may still need full session visibility, but that should be an explicit request path, not the default streaming behavior.

## Scope

- default chat-first rendering for normal channel interaction
- meaningful-only incremental streaming
- suppression of repeated tmux or CLI chrome
- clean final-answer settlement per interaction
- explicit transcript request commands for whole-session visibility
- Slack-first execution on `SLACK_TEST_CHANNEL`

## Non-Goals

- backend-specific output capture mechanics inside channel code
- runner or Agent-OS ownership changes
- making whole-session dumps the default interaction model

## Immediate Execution Slice

The next implementation slice should target Slack first.

Definition:

- every normal Slack interaction streams only meaningful new content
- repeated Codex header, footer, and frame chrome are suppressed by default
- each interaction settles to a clean final thread answer
- final settled answers suppress intermediate search or tool-progress logs when a cleaner final answer is available
- if a settled answer must be truncated, Slack preserves the beginning of the final answer instead of tail-cutting from the middle
- whole-session visibility is available only when the user invokes an explicit transcript request command

## Deliverables

- one explicit default rendering policy for normal interaction
- one explicit transcript request command pattern for Slack
- one explicit configuration surface for `streaming: off | latest | all`
- one explicit configuration surface for `response: all | final`
- one explicit rule that Slack uses one live edited reply for streaming because the channel supports edits
- one documented rule for when intermediate progress is shown versus suppressed
- one documented rule for how transcript requests differ from normal interaction responses

## Subtasks

- [ ] define the Slack default rendering contract from normalized runner output
- [ ] define the minimum normalized runner fields required for meaningful-only Slack streaming
- [ ] define how top and bottom Codex or shell chrome is recognized and stripped during normal interaction
- [ ] define how unchanged full-screen frames are suppressed between updates
- [ ] define how meaningful new content is detected for Slack streaming updates
- [ ] define that Slack uses message edits for in-progress updates and final settlement
- [ ] define how `streaming: off | latest | all` changes the content kept in the live Slack reply
- [ ] define how `response: all | final` changes whether completion keeps accumulated streamed content or settles to the final answer only
- [ ] define how the final Slack-visible answer is produced from the last normalized runner state
- [ ] define how settled answers discard progress-only blocks when a cleaner final answer block exists
- [ ] define truncation rules so long settled answers preserve the start of the final answer
- [ ] define the explicit transcript request command pattern and response shape
- [ ] define the configuration fields for default chat rendering and transcript request commands
- [ ] add ground-truth Slack tests for default interaction streaming and transcript requests

## Exit Criteria

- a Slack interaction does not resend unchanged Codex or shell chrome on every update
- Slack users see incremental progress only when it adds meaning
- each Slack interaction settles to a clean final answer in-thread
- long settled answers do not start mid-sentence because of tail truncation
- the configured `streaming` and `response` policy is reflected truthfully in Slack thread behavior
- Slack streaming uses one live edited reply instead of posting one new progress reply per update
- full session visibility is available only through explicit transcript request commands

## Dependencies Or Blockers

- stable Slack channel MVP
- tmux runner snapshot and stream contract that exposes meaningful deltas or enough structured snapshots to derive them

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [tmux Runner](../../../features/runners/tmux-runner.md)
- [Transcript Presentation And Streaming](../../../architecture/transcript-presentation-and-streaming.md)
- [Channels Tests](../../../tests/features/channels/README.md)
- [Runner Tests](../../../tests/features/runners/README.md)
- [Configuration Feature](../../../features/configuration/README.md)
