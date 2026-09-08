# CLI Compatibility CLI Profiles

## Summary

This page maps the current launch CLIs to the v0 CLI compatibility contract:

- Codex
- Claude
- Gemini
- OpenCode

The goal is not to restate every runner implementation detail.

The goal is to say which contract capabilities are currently strong, which are best-effort, and where drift risk is concentrated.

## Reading Guide

Use these support levels:

- `Strong`: the current product has an explicit mechanism for this capability
- `Partial`: the capability works, but the current mechanism is still generic, fragile, or under-specified
- `Unsupported`: the current product does not claim this capability

## Comparison Matrix

| CLI      | Start  | Probe Ready / Waiting Input | Session Id Strategy                       | Resume | Recover After Pane Loss | Attach Observe | Interrupt | Main Drift Risk                                                      |
| ----------| --------| -----------------------------| -------------------------------------------| --------| -------------------------| ----------------| -----------| ----------------------------------------------------------------------|
| Codex    | Strong | Partial                     | runner-created + `/status` capture        | Strong | Strong                  | Strong         | Partial   | no explicit ready pattern                                            |
| Claude   | Strong | Partial                     | explicit `--session-id`                   | Strong | Strong                  | Strong         | Partial   | no explicit ready pattern plus Claude-owned plan and auto-mode drift |
| Gemini   | Strong | Strong                      | runner-created + `/stats session` capture | Strong | Strong                  | Strong         | Partial   | auth/setup blockers and upstream screen drift                        |
| OpenCode | Strong | Strong (acp) / Partial (tmux) | acp `session/new`; tmux no capture       | Strong (acp) / Partial (tmux) | Strong (acp) / Partial (tmux) | Strong (tmux) / Partial (acp) | Partial | tmux exposes no session-id status command; opencode auth lives outside clisbot |

## Current Cross-CLI Truth

All four current CLIs share these runtime truths:

- execution is hosted by the tmux runner today
- trust prompts are runner-owned
- observation and transcript capture already exist through the runner
- interrupt is currently a generic `Escape` send, so contract support should be treated as best-effort until confirmation becomes first-class
- pane-loss recovery depends on restoring a runner instance while preserving logical `sessionKey`, then reusing CLI-native `sessionId` when available

## Highest-Value Difference

The most important current difference is startup truth:

- Gemini already has an explicit `startupReadyPattern`
- Codex and Claude do not

That means Gemini currently has the clearest machine-readable readiness contract, while Codex and Claude still rely more on generic startup heuristics after trust-prompt handling.

## Operator Snapshot

- `Codex` is the current most stable recommendation for routed coding work.
- `Claude` is usable, but operators should expect occasional Claude-owned plan approval and auto-mode classifier behavior that is not disabled by the current `clisbot` launch args.
- `Gemini` is usable when auth is already in good shape, but startup and routed delivery remain more environment-sensitive than Codex.
- `OpenCode` is ACP-native and the recommended ACP path; its tmux backend is usable for live chat but cannot auto-resume a session across runner restarts.

## CLI Profiles

- [Codex](./profiles/codex.md)
- [Claude](./profiles/claude.md)
- [Gemini](./profiles/gemini.md)
- [OpenCode](./profiles/opencode.md)
