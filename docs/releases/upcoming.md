# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`0.1.54-beta.3` continues the `0.1.54` beta line after `0.1.54-beta.2`.
It focuses on runner recovery truthfulness for stale native resume ids and
Codex state-database startup failures, while preserving the API channel
hardening from earlier betas.

## Operator Impact

- Required action: none.
- Behavior users should notice: runner resume and Codex state-db failures now
  report clearer next actions instead of collapsing into generic startup or
  tmux failures.
- Compatibility notes: API listener default port is now `6868`.
- Compatibility notes: API listener now uses Node's built-in HTTP server in
  the packaged runtime; Bun is no longer required to run API bots.
- Known risks: global runner admission/backpressure is still planned; high-burst
  API traffic across many conversations can still start many runner sessions.

## Functional Changes

### Channels

- Added the first end-to-end API channel MVP follow-up docs for Chatwoot/Jira
  style ingress, result polling, and optional `actions.message.send`.
- Changed API event examples toward URL-friendly event ids and simpler local
  conversation/surface mapping.
- Fixed API message reply routing so explicit `--reply-to` uses that event's
  reply metadata.
- Fixed default API event ids to use a timestamp when mapping omits `eventId`.
- Changed the packaged API listener from `Bun.serve` to Node's built-in HTTP
  server while keeping the API request handler framework-neutral.
- Fixed Slack markdown rendering so nested list hierarchy is preserved better
  when sending native mrkdwn replies.

### Runners

- Fixed stale runner resume handling so rejected or non-resumable native
  session ids are classified more explicitly and do not silently rotate into a
  new conversation.
- Fixed Codex state database startup failures so SQLite lock/open failures are
  reported as Codex state failures with clearer operator recovery guidance.
- Changed tmux session handshake recovery so blocked/rejected startup states
  remain truthful while preserving stored session ids when automatic recovery
  would risk losing conversation context.
- Changed the source-code default interactive runner startup window from 60
  seconds to 120 seconds for Codex, Claude, and Gemini runner families.

## Non-Functional Changes

### Stability

- Fixed detached runtime lifecycle commands so stale monitor and worker pids
  reused by unrelated processes cannot trap container startup in an
  `already running` restart loop or make `stop` signal the wrong process.
- Fixed channel result persistence so concurrent result-store writers do not
  lose records or outputs.
- Increased the shared JSON file lock retry budget so high-contention result
  and JSON-store writes are less likely to fail with transient lock contention.
- Added bounded forced shutdown coverage for the Node HTTP listener so runtime
  stop does not hang behind an open request.
- Added shared JSON storage guidance and a persistence-store inventory to reduce
  unplanned JSON store sprawl.
- Added a planned backlog item for global runner admission and API burst
  backpressure.

### Architecture Conformance

- Documented cross-process runtime state rules and API channel domain wording
  around conversation/surface terminology.

## Update Notes

- Update path: direct from `0.1.53`, `0.1.54-beta.1`, or `0.1.54-beta.2`
  to `0.1.54-beta.3`.
- Manual action: none.
- Risk level: medium for runner recovery / Codex users; medium for API channel
  adopters; low for other users.
- Automatic config update: no new schema migration in this beta.

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

## Validation

- `bun test ./test/agent-service/agent-service-reuse-and-resume.suite.ts ./test/agent-service/agent-service-capture-and-startup-retries.suite.ts ./test/tmux-runner-latency/tmux-runner-latency-bootstrap.suite.ts ./test/tmux-runner-latency/tmux-runner-latency-submit.suite.ts ./test/slack-content.test.ts`
  passed: 50 tests.
- `bun test ./test/agent-service/agent-service-loops-and-queue.suite.ts`
  passed: 7 tests.
- `bun run check` passed: 989 tests across 116 files.
- `bun run build` passed.
- `git diff --check` passed.
- `npm publish --dry-run --access public` passed for
  `clisbot@0.1.54-beta.3`; tarball size 947.8 kB, unpacked size 4.5 MB.

## Links

- Release guide: [docs/updates/releases/v0.1.54-beta.3-release-guide.md](../updates/releases/v0.1.54-beta.3-release-guide.md)
- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
