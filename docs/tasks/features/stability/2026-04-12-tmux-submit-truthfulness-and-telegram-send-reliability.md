# tmux Submit Truthfulness And Telegram Send Reliability

## Summary

Investigate and fix cases where a routed user message appears to reach `clisbot`, but the tmux-backed agent session does not actually submit the prompt successfully on the first try.

The reported symptom is that the human sends a message, nothing gets processed, then asks again once or twice and only then the prompt takes effect. The issue is reported more often on Telegram than on Slack.

Bounded retry rule for this flow:

- startup: one fresh-start retry if the runner times out before ready state
- paste: up to three prompt-delivery attempts before `Enter`
- submit: one retry if `Enter` still does not confirm execution
- post-paste failure before any truthful `Enter`: one runner restart that preserves the stored native session id, then one retry of the first-prompt flow

## Status

In Progress

## Why

This is both a stability and delay problem.

If `clisbot` accepts a message but fails to truthfully complete the tmux submit path, the surface lies about the real system state:

- the channel thinks a prompt was sent
- the runner may still be idle
- the human waits and retries manually
- retries can later create duplicate or ambiguous execution if the first submit actually went through late

The fix must respect the project requirement that stability and speed are both first-class metrics. A naive retry policy that hides uncertainty by blindly re-sending input could make the system less truthful or create duplicate runs.

## Scope

- reproduce the failed-or-lost first-submit symptom on the current Telegram route and compare it against Slack
- trace the full path from channel event acceptance to tmux input injection and post-submit observation
- verify whether the failure comes from:
  - tmux input delivery not actually happening
  - Enter submission not reaching the pane
  - prompt submission succeeding but first-output observation being too weak or too delayed
  - channel-level busy-state or progress feedback masking a still-idle runner
- define a truthful success criterion for "submit completed" instead of assuming that sending keystrokes means the prompt is now running
- improve reliability without regressing visible latency or creating duplicate prompt submission
- add regression coverage for Telegram-heavy cases

## Current Truth

- the product currently treats delay and stability as explicit top-level metrics
- tmux submit latency is already measured in the Slack latency audit, but Telegram-specific submit reliability has not been audited the same way
- there is now a real user report that first-turn submit sometimes does not take effect until one or two extra follow-up messages are sent
- the issue appears more common on Telegram than on Slack, which suggests either different timing pressure, different follow-up behavior, or different visibility of a shared runner weakness
- current implementation work in this slice now uses tmux bracketed paste for literal prompt injection instead of raw `send-keys -l`
- current implementation work now treats prompt delivery and post-`Enter` submit confirmation as separate phases
- current implementation work now applies one bounded retry at each relevant phase:
  - one fresh-start retry if startup times out before ready state
  - one post-`/status` settle window before the first user prompt
  - up to three paste attempts before `Enter`
  - one `Enter` retry if submit confirmation still does not arrive
  - one runner restart with the stored native session id preserved when paste never landed truthfully and `Enter` was never sent
- live Claude tracing on April 13, 2026 confirmed two concrete runner-side gaps:
  - Claude trust prompt startup text had drifted away from the older Codex-style trust prompt detection, so a fresh Claude workspace could still be blocked even when higher layers thought startup had finished
  - multiline prompt paste could become visibly settled only after the fixed `promptSubmitDelayMs`, so the first `Enter` could be sent too early and get ignored
- the key remaining real-world failure is the first user prompt right after `/status` session-id capture:
  - session id becomes visible
  - the runner leaves handshake immediately
  - the pane can still be in a transient post-`/status` state where the first prompt paste does not land
- the implementation in this batch now targets that post-`/status` first-prompt gap directly
- the next validation pass needs to cover cases that may stress the current confirmation heuristic more than the traced Slack Claude slice did:
  - prompts with embedded newlines
  - longer prompt bodies
  - delayed redraw after `/status`
  - broader pane-state inspection to understand what changed, or failed to change, when prompt delivery or submit confirmation still misses reality

## Non-Goals

- papering over uncertainty by sending duplicate prompt submissions automatically
- optimizing only Slack while leaving Telegram reliability behind
- redesigning the whole runner architecture in this slice

## Subtasks

- [ ] capture a reproducible Telegram case with timing notes and runtime logs
- [ ] compare Telegram and Slack timing around `tmux-submit-start`, `tmux-submit-complete`, and first meaningful output
- [ ] add explicit validation cases for prompts with embedded newlines and longer prompt bodies
- [x] widen submit-confirmation inspection enough to explain which pane signals make the current heuristic fail in the new reported case
- [x] verify whether tmux key injection and final Enter submission are actually reaching the pane in the failure case
- [x] define a truthful post-submit observation rule that distinguishes "submitted and running" from "keystrokes attempted"
- [x] fix the reliability gap without increasing duplicate-submit risk
- [x] add automated coverage for the failing path and for no-duplicate guarantees
- [x] document any new latency or reliability instrumentation needed for future audits

## Implementation Notes

- prompt text injection now uses tmux buffer paste with bracketed paste mode so multiline and long prompt delivery is less fragile than raw literal key injection
- after `capture.mode: "status-command"` finds a session id, the runner now gives the pane one short settle window before the first user prompt flow continues
- after the configured minimum `promptSubmitDelayMs`, clisbot now waits for visible paste settlement before locking the pre-submit pane baseline
- if paste confirmation never arrives, the runner retries prompt delivery up to three times before any `Enter` is sent
- clisbot sends `Enter` only after paste truth is confirmed, then waits only a short confirmation window for pane state to change
- if pane state still does not change, clisbot retries only `Enter` once
- if paste never lands truthfully, clisbot throws an explicit paste-unconfirmed error without sending `Enter`
- if that paste-unconfirmed failure happens on the first routed prompt, clisbot kills the tmux session, preserves session-id continuity, and retries once by restarting the runner against the same stored native session id
- if pane state remains unchanged after the second `Enter`, clisbot throws an explicit submit-unconfirmed error instead of pretending the prompt was submitted
- if startup times out under a configured ready-pattern gate, clisbot does one fresh-start retry before surfacing the startup failure
- latency instrumentation now emits:
  - `tmux-paste-retry`
  - `tmux-paste-unconfirmed`
  - `tmux-submit-enter-retry`
  - `tmux-submit-unconfirmed`
- this keeps the retry truthful and narrow:
  - no `Enter` before paste truth
  - at most three paste attempts in the same pane
  - one fresh retry only when no truthful `Enter` has happened yet
  - no open-ended polling
  - only one extra `Enter`
- this strategy is still provisional:
  - it has reduced the traced failure modes
  - but it has not yet proven stable across all real prompt shapes, especially multiline or longer prompt bodies
- Claude-specific hardening now also:
  - recognizes the current Claude trust prompt shape such as `Quick safety check:` and `Enter to confirm · Esc to cancel`
  - waits for visible multiline paste settlement before sending the final `Enter`, so `Enter` is not fired while Claude is still folding the bracketed paste block into its UI
- `capture.mode: "status-command"` time budgets now start after the status command submit completes, not before, so the capture timeout still measures post-submit observation instead of being partially consumed by submit latency itself

## Exit Criteria

- a normal routed Telegram message reliably causes prompt execution on the first try under the tested failure scenarios, including multiline and longer prompt cases that currently still need deeper validation
- the same fix does not regress Slack behavior
- `clisbot` does not silently double-submit prompts just to look responsive
- timing and status signals remain truthful enough for operators to debug real failures

## Related Docs

- [Stability](../../../features/non-functionals/stability/README.md)
- [Runner Interface Standardization And tmux Runner Hardening](../runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [Slack Latency And Stability Audit](../../../research/channels/2026-04-10-slack-latency-and-stability-audit.md)
- [Telegram Topics Channel MVP](../channels/2026-04-05-telegram-topics-channel-mvp.md)
- [tmux Submit State Model And Input Path Separation](2026-04-13-tmux-submit-state-model-and-input-path-separation.md)
