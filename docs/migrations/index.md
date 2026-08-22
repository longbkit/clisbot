# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: 0.1.53, 0.1.54-beta.1, 0.1.54-beta.2, 0.1.54-beta.3, or 0.1.54-beta.4 -> 0.1.54-beta.5
Update path: direct
Manual action: none
Risk: low; only behavior change bounds previously unbounded ACP turns and is configurable
Automatic config update: no new schema migration in this beta
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/upcoming.md
```

`0.1.54-beta.5` does not require manual config edits. It adds one optional
runner field (`acp.turnStallTimeoutMs`) that existing configs do not need to
set: ACP turns with no activity for 5 minutes (default) are cancelled and fail
with a visible error notice instead of hanging the session forever.

The previous `0.1.54-beta.4` added optional runner fields (`backend`, `env`,
`newSessionCommand`, `acp`) that existing configs do not need to set: an unset
`backend` resolves to `tmux`, so current tmux behavior is unchanged unless an
agent opts into `acp`.

The default interactive runner startup window moved from `60` to `120`
seconds in `0.1.54-beta.4`. Installs that pinned a stale
`startupDelayMs: 60000` override on Codex, Gemini, or OpenCode have it pruned
on first read so they inherit the new default, as with the earlier `0.1.52`
startup-delay pruning.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
