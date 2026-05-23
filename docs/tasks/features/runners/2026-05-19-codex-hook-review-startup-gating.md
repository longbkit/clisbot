# Codex Hook Review Startup Gating

## Context

Codex can show a startup prompt when project hooks are new or changed:

```text
Hooks need review
1 hook is new or changed.
Hooks can run outside the sandbox after you trust them.

1. Review hooks
2. Trust all and continue
3. Continue without trusting (hooks won't run)
```

This appears in the same operational class as trust-folder prompts, update prompts, and other runner readiness gates: the runner is alive, but it is not yet ready to receive the user prompt.

## Problem

If clisbot treats this screen as normal runner readiness, it can submit the user prompt into a blocked interactive menu instead of an agent input box. That creates a misleading active run, lost or misdirected input, and poor operator recovery.

The behavior is especially risky because hooks can run outside the sandbox after trust. clisbot should not silently select a trust path unless an explicit operator policy says that is allowed.

## Scope

- Detect the Codex `Hooks need review` screen during startup and resume readiness checks.
- Keep the runner in a blocked or needs-action state until the hook review prompt is handled.
- Do not submit the queued user prompt while the hook review menu is visible.
- Add an explicit policy choice for how clisbot handles this prompt:
  - surface an operator action by default
  - optionally choose `Continue without trusting` for non-interactive safe mode
  - only choose `Trust all and continue` when explicitly configured
- Include the prompt in runner diagnostics so `clisbot runner inspect` and status output explain why the session is blocked.

## Acceptance Criteria

- A live or fixture-backed Codex startup test covers the exact `Hooks need review` prompt shape.
- Prompt submission waits until the Codex input box is ready again.
- The default path does not silently trust changed hooks.
- Operator-facing guidance explains the tradeoff between reviewing hooks, trusting hooks, and continuing with hooks disabled.
- The behavior is documented next to the existing Codex startup/readiness and launch-trio validation docs.

## Related Docs

- [runner interface standardization and tmux runner hardening](2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [common CLI launch coverage and validation](2026-04-13-common-cli-launch-coverage-and-validation.md)
- [Codex runner path drift and update-notice hardening](2026-04-24-codex-runner-path-drift-and-update-notice-hardening.md)
