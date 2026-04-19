# Bootstrap Trust And Readiness Report

## Status

Draft v0

## Summary

This doc defines the reusable operator report for first-launch bootstrap behavior on a real upstream CLI.

Use it when the operator wants a concrete answer to questions like:

- does first launch still behave correctly on a new workspace?
- how long does trust and startup take?
- how many status probes were needed before settle?
- did workspace trust actually persist on the next launch?
- did the runner classify state truthfully, or only eventually?

The output should be usable for Codex today, and adaptable to Claude, Gemini, and future CLIs.

## Why This Exists

The operator flow used in the Codex trust debugging thread is worth standardizing because it tests the unstable boundary that most often regresses when a new CLI is integrated:

- first launch on a truly new workspace
- trust or setup prompts
- ready-state inference
- session-id capture timing
- same-workspace reinvoke behavior

Without a standard report contract, the result tends to drift into ad hoc screenshots, vague timing claims, or CLI-specific folklore.

## Core Truth Model

Do not collapse these states into one idea.

### `runner ready`

The CLI is interactive enough for the runner to submit the next expected probe or prompt.

Examples:

- prompt is visible
- ready banner is visible
- a status command can be submitted and settled

### `workspace trusted`

The CLI has accepted workspace trust in a way that persists for that workspace and therefore affects local workspace behavior.

For Codex, the current strongest proof is:

- first launch on a fresh workspace shows trust
- a later launch on the exact same workspace path does not show trust again

Do not use a successful status probe alone as proof of workspace trust unless the CLI's semantics actually make that true.

## When To Use This Report

Use this report when:

- integrating a new CLI
- upgrading Codex, Claude, or Gemini after version drift
- investigating first-launch flakes
- checking whether trust logic or ready-state logic is still truthful
- comparing behavior across CLIs using the same operator report shape

## Required Workspace Modes

### Pass 1: `fresh-workspace`

Launch the target CLI in a brand-new workspace path with no prior runner state for that workspace.

Goal:

- observe first-launch trust or setup behavior directly
- measure time to stable probe settlement

### Pass 2: `same-workspace-reinvoke`

Launch the same CLI again on the exact same workspace path after pass 1 completed.

Goal:

- verify whether trust or first-setup state persisted
- distinguish `runner ready` from `workspace trusted`

## Required Measurements

Report timings relative to pass start.

### Pass 1 metrics

- start time
- first trust prompt visible
- first trust action submitted
- first normal prompt or ready banner visible after trust
- first status-probe submission
- first status-probe visible effect
- first settled status result
- total bootstrap complete time
- status retry count before settle
- final stored `sessionId`, if supported

### Pass 2 metrics

- same workspace path confirmation
- whether trust prompt appeared again
- first status-probe submission
- first settled status result
- final stored `sessionId`, if supported

### Classification summary

- `runnerReadyPass1`
- `workspaceTrustedPersisted`
- `statusProbeSettled`
- `statusRetryCount`
- `sameWorkspace`

## Required Artifacts

Every report run should leave these artifacts in one trace root:

- `summary.json`
- `notes.md`
- per-transition pane snapshots
- pass-1 final pane snapshot
- pass-2 final pane snapshot

Minimum artifact claims:

- a human can open one file and see whether trust appeared on pass 1
- a human can open one file and see whether trust did not appear on pass 2
- timings can be read without replaying the whole live session

## Report Template

Use this structure in the user-facing report.

### Header

- CLI name
- workspace modes used
- trace root path

### Pass 1

- workspace path
- trust seen or not
- trust timing
- ready timing
- status timing
- settle timing
- retry count
- stored session id

### Pass 2

- workspace path
- same-workspace confirmation
- trust seen or not
- status timing
- settle timing
- stored session id

### Conclusion

- whether the runner became ready correctly
- whether workspace trust persisted
- whether the result is stable enough to trust operationally
- which artifacts prove the conclusion

## CLI-Specific Notes

### Codex

Current recommended proof model:

- pass 1 on a fresh workspace may show trust
- pass 2 on the same workspace should not show trust again if trust really applied
- `/status` is a runner-ready probe, not proof of workspace trust by itself

### Claude

Claude may use a different trust prompt shape and may also surface planning or approval behavior that should not be confused with workspace trust.

The report should still preserve the same two-pass structure.

### Gemini

Gemini may combine trust, auth, and ready-banner delays.

The report should keep trust/setup timing separate from the ready-pattern timing.

### Future CLIs

If the CLI does not expose a status command, replace the probe with the most truthful minimal-interaction readiness probe available, but keep the report sections and measurement vocabulary consistent.

## Recommended Assistant Ask

The operator should be able to ask for this report in one short instruction.

Recommended wording:

```text
Run a bootstrap trust and readiness report for <cli> on a fresh workspace, then reinvoke on the same workspace. Measure trust timing, first ready timing, first status-probe timing, settle timing, retry count, and whether trust persisted across reinvoke. Save raw artifacts and summarize the result with exact times.
```

## Relationship To Other DX Docs

This report is one reusable validation unit built from the risk slices in:

- [Operator Validation Map](./operator-validation-map.md)

It should stay aligned with:

- [Human Checklist](./human-checklist.md)
- [Real-CLI Smoke Surface](./real-cli-smoke-surface.md)
- [Capability Contract](./capability-contract.md)
