# Per-Agent Runner Env And CODEX_HOME Isolation

## Status

Planned

## Priority

P1

## Why

Concurrent codex processes sharing one `CODEX_HOME` contend on
`state_5.sqlite` / `logs_2.sqlite`, and codex has no SQLITE_BUSY retry on some
write paths (openai/codex#20213). Observed in multi-agent sandboxes as
`codex resume` exiting nonzero and TUI stalls.

clisbot now classifies state-db contention and retries with the preserved
session id (see `src/runners/runner-state-failures.ts`), which heals transient
collisions. The root fix is isolation: give each agent its own runner state
home so runners never share a state database.

## Scope

- add a per-runner `env` map to runner config (schema + resolved target +
  launch command rendering) so an agent can launch with `CODEX_HOME=<dir>`
- document the auth sharing pattern (shared `auth.json` via symlink or copy,
  with the refresh-token caveat) per CLI family
- document the migration caveat: enabling isolation means previously stored
  session ids (rollouts in the old home) cannot resume; threads need one `/new`
- decide default: isolation stays opt-in; shared home remains the default

## Manual Mitigation Today (no code change)

Run the busiest agent with its own home by overriding the runner command, for
example a small wrapper script:

```bash
#!/usr/bin/env bash
export CODEX_HOME="$HOME/.codex-sale"
mkdir -p "$CODEX_HOME"
[ -e "$CODEX_HOME/auth.json" ] || ln -s "$HOME/.codex/auth.json" "$CODEX_HOME/auth.json"
exec codex "$@"
```

and point that agent's `runner.codex.command` at the wrapper. Note the resume
caveat above applies from the moment of the switch.

## Source Anchors

- contention/corruption classification: `src/runners/runner-state-failures.ts`
- wrapper exit linger + sentinel: `src/control/runner/runner-exit-diagnostics.ts`
- upstream: https://github.com/openai/codex/issues/20213
