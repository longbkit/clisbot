# OpenClaw Session Compatibility Expansion

## Goal

Close the remaining gap between muxbot session behavior and OpenClaw's broader routing and session-management model.

## Why This Exists

muxbot now supports the core OpenClaw-compatible split between:

- `agentId`
- `sessionKey`
- `session.mainKey`
- `session.dmScope`
- `session.identityLinks`

That is enough to fix the current Slack session correctness problem.

It is not yet the full OpenClaw session system.

## Remaining Gaps

- bindings-driven agent selection
- persistent session store beyond tmux existence
- session reset and expiry policy
- per-channel session-policy overrides
- native Slack slash-command session prefixes
- parent-session metadata for richer control UX
- AI CLI-native session resume metadata and lifecycle integration
- explicit distinction between conversation reset and tmux runner sunset

## Acceptance Criteria

- muxbot can import or closely mirror the most important OpenClaw session config ideas without renaming them
- bindings and session policy are documented separately from channel transport logic
- control and channel surfaces can inspect session identity without reverse-engineering tmux session names
- docs clearly describe which OpenClaw session features are fully supported versus partially supported

Notes:

- OpenClaw-style `sessionKey` compatibility is still valuable
- but `muxbot` must also account for AI CLI-native `sessionId` resume behavior, because tmux is only the host layer here
