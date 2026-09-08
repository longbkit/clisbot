# OpenCode CLI Guide

## Summary

`OpenCode` is a fully supported, ACP-native CLI in `clisbot`.

It is the recommended ACP path for routed chat-native work: it advertises
`session/load`, so stored conversations resume reliably through the stored
session id without parsing CLI output.

## Current Strengths

- native ACP (`opencode acp`) with verified `session/load` resume
- explicit session ids (`ses_...`) returned by `session/new`
- `/new` rotates to a fresh conversation
- `--auto` auto-approves permissions not explicitly denied, so routed runs do
  not stall on approval prompts

## Current Caveats

- opencode must already be authenticated in a way the runtime can reuse
  (`opencode auth login`), or have API keys configured in its own
  `~/.local/share/opencode/auth.json` / project `.env`
- the tmux backend can drive the opencode TUI for live chat, but opencode's
  TUI exposes no status command that prints the session id, so clisbot cannot
  auto-capture it. tmux conversations therefore do not resume across runner
  restarts; the ACP backend is the recommended path for continuity

## Operator Recommendation

- use `opencode` on its default ACP backend when you want full session
  continuity plus structured streaming, cancel, and permission events
- if you need the live-pane attach/steer surface, switch the agent to `tmux`,
  but accept that tmux runs start fresh after a runner restart
- if you want the safest general coding-first default across all tools,
  `codex` remains the first choice

## Related Docs

- [OpenCode CLI Profile](../features/dx/cli-compatibility/profiles/opencode.md)
- [Runner Backends: tmux And ACP](runner-backends.md)
