# Codex Runner Path Drift And Update-Notice Hardening

## Summary

Harden Codex runner startup against version drift between the intended global install and stale wrapper or workaround binaries, and make unattended startup handle the built-in Codex update menu truthfully instead of hanging, failing early, or pretending the session is ready.

## Status

Done

## Why

The current runner can still prefer a stale Codex path such as `/home/sandbox/.clisbot/bin/codex`.

In the reported pod, that path still points to an old workaround binary under `/tmp/codex-global/bin/codex`, which launches `0.123.0` even though a newer global Codex exists.

That creates a bad unattended startup mode:

- the runner launches the wrong Codex binary
- Codex shows an update notice such as `0.123.0 -> 0.124.0`
- the pane is no longer in a truthful ready state for routed prompt submission
- startup can fail, stall, or look flaky depending on how the notice interacts with readiness detection

Latest reported failure on 2026-05-09:

- Codex showed the interactive update menu with default `Update now`
- clisbot later failed the run with `Runner session "<name>" disappeared during startup.`
- expected behavior is to auto-confirm the default Codex-owned update flow, tolerate the temporary runner exit if Codex restarts itself, and relaunch until a real prompt is visible

## Scope

- audit Codex binary resolution order for runner startup and make the precedence explicit
- detect and surface when the chosen Codex path is a stale wrapper or workaround instead of the intended official global install
- define whether clisbot should prefer a verified global Codex binary over repo-local or home-local workaround shims by default
- add startup handling for the interactive Codex update menu:
  - detect the active update prompt separately from workspace-trust prompts
  - auto-confirm the default `Update now` path during unattended startup
  - treat a temporary runner exit during that update path as a bounded recoverable startup transition
- make runner status or diagnostics expose the resolved Codex binary path and version clearly enough for operators to spot drift
- add regression coverage for stale-wrapper selection and upgrade-notice startup gating

## Non-Goals

- inventing a separate package-manager upgrade flow outside Codex's own startup menu
- silently rewriting arbitrary user PATH state without an explicit contract
- treating every banner or welcome screen as a fatal startup blocker

## Exit Criteria

- runner startup resolves Codex through a documented, testable path-selection rule
- stale workaround binaries cannot silently win over the intended official Codex install without explicit operator visibility
- Codex update-menu startup states are detected truthfully and do not get treated as ready
- unattended startup either reaches a real ready prompt after the Codex-owned update path or fails with a concrete remediation path

## Current Observed Failure

- runner preferred `/home/sandbox/.clisbot/bin/codex`
- that path resolved to an older workaround install at `/tmp/codex-global/bin/codex`
- interactive spawn showed a Codex update notice from `0.123.0` to `0.124.0`
- that screen is not appropriate for unattended runner startup and can block normal session bring-up

## Related Docs

- [Runner Interface Standardization And Tmux Runner Hardening](2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [Common CLI Launch Coverage And Validation](2026-04-13-common-cli-launch-coverage-and-validation.md)

## Completion Note

This pass is considered complete for the reported production failure:

- Codex update-menu startup states are now detected separately from workspace-trust prompts
- unattended startup auto-confirms the default Codex-owned update flow
- temporary runner exit during Codex self-update is treated as a recoverable relaunch path
- regression coverage now proves no-prompt, trust-prompt, and `update -> trust -> ready` startup behavior

If a later issue shows that Codex path selection or stale-wrapper visibility still needs a deeper audit, that follow-up should be tracked as a separate task instead of keeping this production-fix task open.
