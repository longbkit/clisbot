# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`0.1.54-beta.5` continues the `0.1.54` beta line after `0.1.54-beta.4`.

It fixes ACP-backed agents (OpenCode) wedging a session forever when the
underlying provider fails without reporting: a turn that produces no activity
for `runner.acp.turnStallTimeoutMs` (default 5 minutes) is now cancelled and
fails with a visible error notice, and the next message recovers on a fresh
adapter while resuming the stored conversation.

The beta line ships the flexible runner backend architecture: a shared
`RunnerBackend` contract with `tmux` and `acp` implementations, a one-file
provider catalog, and a generated capability matrix. It adds the OpenCode
provider on the ACP backend, `/steer` via interrupt-and-redirect for backends
that cannot inject mid-turn, and the first session event feed plus built-in web
view/demo surface.

## Operator Impact

- Required action: none.
- Behavior users should notice: an ACP run that used to hang silently (for
  example on model-provider quota or auth failures) now posts a truthful
  failure notice within minutes and accepts new messages immediately after.
- Compatibility notes: `runner.acp.turnStallTimeoutMs` is additive and
  optional; unset configs keep tmux behavior unchanged.
- Known risks: ACP is opt-in; Claude-over-ACP remains `not-recommended` until
  Anthropic's subscription/SDK billing split settles. `runner.env` values are
  plain text in `clisbot.json` today.

## Functional Changes

### Runners

- Added a `RunnerBackend` contract with two implementations: `tmux` (existing)
  and `acp` (Agent Client Protocol through a pinned adapter process).
- Added the ACP backend with structured events, first-class session id plus
  `session/load` resume, `authenticate` with a configured auth method,
  `session/cancel`, surfaced JSON-RPC error detail, and truthful capability
  degradation for backends that cannot steer mid-turn.
- Added a provider catalog (`src/runners/catalog/`): adding a new CLI is one
  provider definition plus one registry line, with a per-provider default
  backend and launch preset.
- Added a generated capability matrix with a drift-guard test so per-backend
  capability claims (steer, interrupt, resume, attach, native slash
  pass-through) and degradation rules stay in sync with code.
- Added `/steer` on ACP as interrupt-and-redirect: when mid-turn steering is
  unsupported, clisbot cancels the turn and applies the message as the next
  prompt in the same conversation, with a truthful notice.
- Added the OpenCode CLI provider, defaulting to the `acp` backend, with
  validated `session/load` resume.
- Fixed ACP turns wedging a session forever when the agent never settles a
  prompt (provider quota/auth failures it never reports): turns with no
  activity for `runner.acp.turnStallTimeoutMs` (default 5 minutes) are
  cancelled and fail with a visible error notice; when the adapter ignores the
  cancel it is stopped, and the next message starts a fresh adapter that
  resumes the stored conversation.
- Changed the default interactive runner startup window from `60` to `120`
  seconds for the Codex, Claude, and Gemini runner families (and OpenCode).
- Refactored the tmux session handshake into focused modules while preserving
  behavior.

### Channels

- Added a session event feed and web view endpoints with a built-in demo page
  on the API channel.
- Fixed Slack startup cleanup so it is bounded instead of unbounded.

### Configuration

- Added optional runner fields: `backend`, `env`, `newSessionCommand`, and
  `acp` (`permissionPolicy`, `authMethodId`, `turnStallTimeoutMs`).
- Added the `opencode` provider default to the schema and template.
- Changed the runner `startupDelayMs` default to `120000` and prunes stale
  `60000` overrides for Codex, Gemini, and OpenCode so upgraded installs inherit
  the new default.

### Agents

- Ported the architecture and naming skills into clisbot
  (`.agents/skills/architect`, `.agents/skills/naming-expert`).

### Session

- Fixed runtime-stopping prompt rejections so they produce actionable guidance
  instead of a generic failure.

## Non-Functional Changes

### Architecture Conformance

- Documented the runner backend contract and capability matrix as the source of
  truth for per-backend behavior.
- Added architecture decisions for the unified distribution boundary and for
  treating naming as architecture, plus a canonical naming-conventions doc.

### DX

- Added Playwright end-to-end coverage for the web demo with screenshot
  evidence, a scenario-driven ACP simulator, and a generated capability and
  failure-mode matrix.

## Update Notes

- Update path: direct from `0.1.53`, `0.1.54-beta.1`, `0.1.54-beta.2`,
  `0.1.54-beta.3`, or `0.1.54-beta.4` to `0.1.54-beta.5`.
- Manual action: none.
- Risk level: low; the only behavior change bounds previously unbounded ACP
  turns and is configurable.
- Automatic config update: no new schema migration in this beta; new runner
  fields are additive and optional.

## Beta History

- `0.1.54-beta.1`: API channel MVP hardening, result persistence concurrency
  fix, API listener default port `6868`, API docs, and backlog item for global
  runner admission/backpressure.
- `0.1.54-beta.2`: API listener runs on Node's built-in HTTP server in the
  packaged CLI, so API bots no longer require Bun at runtime. Also adds
  bounded force-stop coverage for open listener requests and a higher JSON file
  lock retry budget under contention.
- `0.1.54-beta.3`: runner recovery now classifies rejected resume ids and Codex
  state database startup failures more truthfully, preserves stored session ids
  when automatic rotation would be unsafe, and fixes Slack nested markdown list
  rendering.
- `0.1.54-beta.4`: flexible runner backend architecture (RunnerBackend contract,
  tmux + ACP, provider catalog, capability matrix), OpenCode provider on ACP,
  ACP `/steer` via interrupt-and-redirect, session event feed plus web
  view/demo, and a `60s` to `120s` default startup window.
- `0.1.54-beta.5`: stalled ACP turns are bounded — no-activity turns fail with
  a visible notice after `runner.acp.turnStallTimeoutMs` (default 5 minutes),
  ignored cancels stop the adapter, and the next message recovers on a fresh
  adapter that resumes the stored conversation.

## Validation

- `bun run check` ran 1034 tests across 122 files: 1031 pass, the same 3
  pre-existing failures already documented for this line (agent prompt
  envelope heredoc edge case, tmux Gemini trust-prompt latency suite, and the
  zalo-personal zca-js session-refresh wrapper); all three fail without this
  change too.
- `bun run build` passed.
- `git diff --check` passed.
- `npm publish --dry-run --access public` passed for `clisbot@0.1.54-beta.5`.

## Links

- Release guide: [docs/updates/releases/v0.1.54-beta.4-release-guide.md](../updates/releases/v0.1.54-beta.4-release-guide.md)
- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
