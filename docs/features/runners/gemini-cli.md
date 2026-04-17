# Gemini CLI Runner Support

## Summary

`clisbot` now has first-class runner wiring for Gemini CLI at the same architecture boundary as Codex and Claude:

- tool preset and bootstrap support
- tmux startup readiness gating
- runner-owned session-id capture and resume
- Gemini-specific transcript normalization
- explicit startup blocker handling for authentication waits

## Current Truth

Gemini support is real, but it has one important operational prerequisite:

- Gemini must already be authenticated in a way the runtime can reuse, or
- the environment must provide a headless-compatible auth path such as `GEMINI_API_KEY` or Vertex AI credentials

Without that prerequisite, `clisbot` now fails fast and truthfully instead of pretending the tmux session is ready.

Gemini also has one current routed-delivery limitation:

- Gemini `message-tool` behavior still needs prompt-side hardening and live validation for Slack or Telegram routed replies

## Why This Exists

Gemini is part of the intended launch CLI trio with Claude and Codex.

That only makes sense if Gemini support is not treated as a vague future promise.

The runner needs an explicit contract for:

- when Gemini is actually ready for prompt submission
- how Gemini session continuity is captured and resumed
- how Gemini-specific startup blockers surface to operators

## Runner Contract

Current Gemini preset:

- command: `gemini`
- startup args: `--approval-mode=yolo --sandbox=false`
- trust prompt automation: on for the current Gemini untrusted-folder screen when `trustWorkspace` is enabled
- startup ready pattern: `Type your message or @path/to/file`
- session-id create mode: runner-generated
- session-id capture mode: `status-command` via `/stats session`
- session-id resume mode: `command` via `--resume {sessionId}`

## Startup Behavior

Gemini startup now follows two explicit rules:

1. If the configured ready pattern appears, the session is considered ready.
2. If a runner-managed trust prompt appears first and `trustWorkspace` is enabled, the runner dismisses it and continues waiting for readiness.
3. If a configured startup blocker appears first, the runner fails startup immediately and kills the half-ready tmux session.
4. If the ready pattern still does not appear before the startup budget expires, the runner uses its bounded fresh-start retry policy before finally failing startup.

Current built-in blocker:

- Gemini OAuth code-flow prompt:
  - `Please visit the following URL to authorize the application`
  - `Enter the authorization code:`
- Gemini auth-setup or sign-in recovery screen:
  - `How would you like to authenticate for this project?`
  - `Failed to sign in.`
  - `Manual authorization is required but the current session is non-interactive`

This prevents stale half-ready Gemini sessions from being reused by later prompts.

## Trust Flow Note

Gemini runner support originally shipped with `trustWorkspace: false` because the earlier validated Gemini path did not show a runner-managed trust screen.

Live validation later showed a different first-start behavior:

- Gemini can stop at an untrusted-folder screen before the ready prompt
- that screen blocks the normal startup ready pattern
- a post-start trust-dismiss step is too late for that shape

Current rule:

- Gemini now uses the same runner-owned trust-flow handling model as the other supported CLIs
- startup polling dismisses the current Gemini trust screen before continuing toward the ready banner

One operational consequence matters for upgrades:

- changing the preset default does not rewrite existing agent configs
- if an existing Gemini agent already persisted `runner.trustWorkspace: false`, that override must be updated in config before the live runtime will use the new behavior

## Routed Reply Delivery

Gemini was also validated against the channel `message-tool` path.

Current observed behavior is not strong enough to make that the default:

- Gemini can print the `clisbot message send ...` reply command instead of executing it
- stronger instruction can move Gemini into an extra execution-approval prompt for the local shell command

Current delivery rule:

- routed Gemini conversations continue to use the configured channel or agent `responseMode`
- Gemini-specific prompt wording adds extra clarity that the user-facing message should be sent using the provided `clisbot message send ...` command
- the prompt should clarify the intended send workflow without relying on overly forceful wording

## Session Continuity

Current continuity rule:

- `agents` owns `sessionKey`
- `agents` persists Gemini `sessionId`
- the tmux runner owns how Gemini `sessionId` is captured and reused

Current implementation uses Gemini-native UUID sessions:

- capture with `/stats session`
- resume with `gemini --resume <sessionId>`

This avoids fake continuity heuristics such as `--resume latest`.

## Non-Goals

- automating Google OAuth inside `clisbot`
- hiding Gemini authentication requirements behind implicit fallback logic
- declaring authenticated Slack or Telegram Gemini routes "proven" without real auth-backed end-to-end validation

## Validation State

Covered now:

- config and CLI wiring
- bootstrap templates
- readiness and blocker gating
- session-id capture and resume strategy
- normalization coverage

Still environment-dependent:

- full success-path end-to-end validation through a live authenticated Gemini runtime

## Related Docs

- [tmux Runner](tmux-runner.md)
- [Runner Tests](../../tests/features/runners/README.md)
- [New CLI Test Suites](../../tests/new-cli-tests-suites.md)
- [CLI Trust-Flow Drift Must Update Runner Defaults And Existing Agent Config](../../lessons/2026-04-13-cli-trust-flow-drift-must-update-runner-defaults-and-existing-agent-config.md)
