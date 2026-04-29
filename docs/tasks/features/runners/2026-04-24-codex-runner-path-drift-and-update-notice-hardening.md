# Codex Runner Path Drift And Update-Notice Hardening

## Summary

Harden Codex runner startup against version drift between the intended global install and stale wrapper or workaround binaries, and make unattended startup reject upgrade-notice states instead of hanging or pretending the session is ready.

## Status

Planned

## Why

The current runner can still prefer a stale Codex path such as `/home/sandbox/.clisbot/bin/codex`.

In the reported pod, that path still points to an old workaround binary under `/tmp/codex-global/bin/codex`, which launches `0.123.0` even though a newer global Codex exists.

That creates a bad unattended startup mode:

- the runner launches the wrong Codex binary
- Codex shows an update notice such as `0.123.0 -> 0.124.0`
- the pane is no longer in a truthful ready state for routed prompt submission
- startup can fail, stall, or look flaky depending on how the notice interacts with readiness detection

## Scope

- audit Codex binary resolution order for runner startup and make the precedence explicit
- detect and surface when the chosen Codex path is a stale wrapper or workaround instead of the intended official global install
- define whether clisbot should prefer a verified global Codex binary over repo-local or home-local workaround shims by default
- add readiness blocking for update-notice or upgrade-required startup states so unattended sessions do not continue as if ready
- make runner status or diagnostics expose the resolved Codex binary path and version clearly enough for operators to spot drift
- add regression coverage for stale-wrapper selection and upgrade-notice startup gating

## Non-Goals

- auto-upgrading Codex for the operator
- silently rewriting arbitrary user PATH state without an explicit contract
- treating every banner or welcome screen as a fatal startup blocker

## Exit Criteria

- runner startup resolves Codex through a documented, testable path-selection rule
- stale workaround binaries cannot silently win over the intended official Codex install without explicit operator visibility
- update-notice startup states are detected and reported truthfully instead of being treated as ready
- unattended startup either reaches a real ready prompt or fails with a concrete remediation path

## Current Observed Failure

- runner preferred `/home/sandbox/.clisbot/bin/codex`
- that path resolved to an older workaround install at `/tmp/codex-global/bin/codex`
- interactive spawn showed a Codex update notice from `0.123.0` to `0.124.0`
- that screen is not appropriate for unattended runner startup and can block normal session bring-up

## Related Docs

- [Runner Interface Standardization And Tmux Runner Hardening](2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [Common CLI Launch Coverage And Validation](2026-04-13-common-cli-launch-coverage-and-validation.md)
