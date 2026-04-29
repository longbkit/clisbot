# Codex Model Continuity And Release-Drift Compatibility

## Summary

Handle upstream Codex model release changes and per-session model mismatches as a first-class compatibility risk instead of treating them as harmless UI warnings.

## Status

Planned

## Observed Warning

Codex can warn during resume:

```text
This session was recorded with model gpt-5.4 but is resuming with gpt-5.5.
Consider switching back to gpt-5.4 as it may affect Codex performance.
```

That warning matters for `clisbot` because routed sessions rely on durable session continuity. A model change can alter performance, tool behavior, prompt-following, response style, or compatibility with the old transcript.

## Best Compatibility Policy

Use session affinity by default:

- store the model recorded for each durable session when it can be observed
- when resuming a session, prefer the recorded model over the CLI's current default
- treat model mismatch as a compatibility state that should be surfaced in `runner list`, `runner inspect`, and status surfaces
- allow an explicit operator action to upgrade or switch a session model
- use new model releases for new sessions only after smoke validation, not silently for existing sessions

This keeps old sessions stable while still letting operators test and adopt new model releases deliberately.

## Scope

- audit whether Codex exposes the recorded model and active model through `/status`, resume output, or another stable surface
- define where `clisbot` should store observed `recordedModel` and `activeModel` for runner sessions
- detect and classify model mismatch warnings during startup or resume
- surface model mismatch in runner debug views and runtime health summaries
- define an explicit upgrade path for existing sessions, such as a reset, recreate, or operator-confirmed model switch
- add real-CLI compatibility coverage for a model-mismatch resume warning when reproducible
- update Codex CLI compatibility profile with model release drift as a tracked risk

## Non-Goals

- forcing every operator to pin a model manually on first run
- assuming all future Codex model upgrades are regressions
- silently rewriting historical session metadata after a resume warning

## Exit Criteria

- existing sessions do not silently switch model without operator visibility
- model mismatch warnings are captured as compatibility signals, not ignored as plain pane text
- operators can tell which sessions are pinned, mismatched, or using the current default
- new model adoption has a clear validation-first path

## Related Docs

- [CLI Compatibility](../../../features/dx/cli-compatibility/README.md)
- [Codex CLI Profile](../../../features/dx/cli-compatibility/profiles/codex.md)
- [Real-CLI Smoke Surface](2026-04-17-real-cli-smoke-surface-and-launch-trio-compatibility-summary.md)

