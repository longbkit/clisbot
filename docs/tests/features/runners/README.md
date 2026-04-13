# Runner Tests

## Purpose

These test cases define the contract for execution backends and the tmux runner behavior that exists today.

They are the ground truth for validating how concrete backends expose input, output, and streaming to the rest of the system.

## Current Coverage Truth

- session-id persistence and resume after tmux-session loss are implemented behaviors
- a killed tmux session can be recreated on a later prompt for the same `sessionKey`
- Codex and Claude interactive CLI routes are both proven on the current tmux runner
- stale tmux cleanup is implemented without losing resumable state
- reset policy is not implemented yet

## Test Case 1: tmux Runner Creates A Dedicated Server And Session

### Preconditions

- no existing `default` session exists on the configured tmux socket

### Steps

1. Start `clisbot`
2. Trigger a prompt for agent `default`
3. Run `tmux -S ~/.clisbot/state/clisbot.sock list-sessions`

### Expected Results

- a dedicated tmux server exists at `~/.clisbot/state/clisbot.sock`
- session `default` is created automatically on that socket
- the tmux runner exposes enough metadata for the rest of the system to reference the live backend session

## Test Case 2: Runner Clears The Codex Trust Prompt And Redraws Cleanly

### Preconditions

- the workspace is new or not yet trusted by Codex

### Steps

1. Trigger the first prompt in a fresh workspace
2. Inspect the tmux pane through direct attach
3. Observe the first streamed updates exposed to the rest of the system

### Expected Results

- the trust prompt is accepted automatically when configured
- the pane redraws so the live Codex prompt becomes visible
- the first user prompt still executes successfully after trust handling

## Test Case 3: Runner Streaming Emits Ordered Deltas

### Preconditions

- the runner adapter supports streaming snapshots or deltas

### Steps

1. Send a prompt that produces multiple intermediate updates
2. Capture the sequence of runner streaming events

### Expected Results

- output arrives in order
- each streamed update can be interpreted without guessing backend-specific terminal state
- repeated full-screen frames are either normalized or explicitly marked so higher layers can process them correctly

## Test Case 4: tmux Runner Separates Static Chrome From Meaningful Content

### Preconditions

- the tmux runner is attached to a Codex session that emits banners, prompts, progress lines, and a final answer

### Steps

1. Trigger one prompt that causes at least two visible tmux redraws
2. Capture the normalized runner output across those redraws
3. Compare the normalized output with the raw pane captures

### Expected Results

- repeated Codex banner or frame content is not treated as fresh meaningful output on every redraw
- newly added progress or answer content remains visible in the normalized output
- the normalization is strong enough for channel code to avoid parsing tmux dumps directly

## Test Case 4A: tmux Runner Separates Claude Dashboard Chrome From Meaningful Content

### Status

Implemented

### Preconditions

- the tmux runner is attached to a Claude Code session
- the pane includes the Claude startup dashboard, prompt marker, answer marker, and footer status bar

### Steps

1. Trigger a first prompt in a fresh Claude thread
2. Capture the raw tmux pane before and after the answer appears
3. Compare the normalized interaction output with the raw pane

### Expected Results

- dashboard content such as `Claude Code v`, `Tips for getting started`, and `Recent activity` is not surfaced as user-visible interaction output
- prompt echo lines beginning with `❯` are removed from the normalized interaction
- answer markers such as `⏺` are not preserved in the final user-visible answer
- footer lines containing model, usage, permission, or effort chrome are not treated as fresh meaningful output

## Test Case 5: Runner Exposes A Stable Final Settled State

### Preconditions

- the runner adapter supports in-progress and final states

### Steps

1. Send one prompt that produces intermediate updates and then completes
2. Observe the final normalized runner state after completion

### Expected Results

- the runner exposes one final settled state for the interaction
- higher layers can derive the clean final answer without waiting for another tmux redraw
- the final state is stable enough to support Slack thread settlement

## Test Case 6: Runner Contract Is Backend-Neutral

### Preconditions

- at least one runner type is implemented and another runner type is planned or stubbed

### Steps

1. Inspect the runner interface used by the agents layer and channels
2. Compare the required fields for input, lifecycle, snapshots, and streaming

### Expected Results

- the contract does not require tmux-specific concepts outside the runner boundary
- future ACP or SDK runners can implement the same contract without changing channel or Agents semantics
- backend-specific quirks stay inside the runner implementation

## Test Case 7: tmux Runner Can Resume A Tool Session After Runner Recreation

### Status

Implemented

### Preconditions

- the tmux runner is backed by an AI CLI that supports session resume by id
- one conversation already has a known active tool `sessionId`

### Steps

1. Kill the live tmux session
2. Trigger a new prompt for the same `sessionKey`
3. Inspect the runner bootstrap path

### Expected Results

- the runner detects that the live tmux session is missing
- the runner creates a new tmux session for the same `sessionKey`
- the runner uses the stored tool `sessionId` to resume the prior conversation instead of starting from scratch
- if the backend rejects or loses that stored `sessionId`, the runner clears it and starts a fresh session for the same `sessionKey`

## Test Case 7A: tmux Runner Can Capture A Runner-Generated Session Id

### Status

Implemented

### Preconditions

- the backend creates its own session id
- runner config enables `capture.mode: "status-command"`

### Steps

1. launch a new session through the tmux runner
2. let the runner send the configured status command
3. inspect the stored session metadata

### Expected Results

- the tmux runner captures the returned session id from backend output
- the captured value is persisted under the current `sessionKey`
- later restart can use that stored session id for resume

## Test Case 7B: tmux Runner Can Reuse An Explicit Session Id

### Status

Implemented

### Preconditions

- the backend accepts an explicit session id argument
- runner config enables `create.mode: "explicit"`

### Steps

1. launch a new session through the tmux runner
2. inspect the spawned runner command
3. kill the tmux session
4. trigger a restart for the same `sessionKey`

### Expected Results

- the first launch includes `--session-id` or equivalent with a generated id
- the same session id is stored for that `sessionKey`
- restart reuses that exact same session id instead of minting a new one

## Test Case 7C: New CLI Integration Checklist Is Completed Before A Route Is Declared Stable

### Status

Implemented As Process Rule

### Preconditions

- a new interactive AI CLI is being onboarded through the tmux runner

### Steps

1. Walk the runner checklist in [Codex Vs Claude CLI Integration Checklist](../../../research/runners/2026-04-05-codex-vs-claude-cli-integration-checklist.md)
2. Validate launch, prompt submission, chrome normalization, session continuity, interrupt, and channel safety
3. Record any backend-specific deltas before expanding usage to more routes

### Expected Results

- new CLI onboarding does not assume Codex-specific terminal behavior
- session-id create, capture, and resume strategy is chosen explicitly for that CLI
- static chrome and footer behavior is tested before Slack routing is considered stable

## Test Case 8: tmux Runner Supports Idle Sunset Without Losing Resumable State

### Status

Implemented

### Preconditions

- the tmux runner has an idle-sunset policy enabled
- one conversation already has a stored active tool `sessionId`

### Steps

1. Let the live tmux session go idle past the configured sunset window
2. Verify that the tmux session is removed
3. Send another prompt for the same `sessionKey`

### Expected Results

- the runner removes idle tmux sessions instead of retaining them forever
- session continuity metadata remains available after sunset
- the next prompt recreates the tmux runner and resumes the existing tool session when supported
- reclaiming tmux resources does not itself force a logical session reset
