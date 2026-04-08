# Control Tests

## Purpose

These test cases define the operator-facing control surface for inspecting and recovering the system.

They should stay separate from end-user channel behavior.

## Test Case 1: Operator Can Inspect And Attach To A Live Session

### Preconditions

- a runner-backed session for agent `default` is active

### Steps

1. Run `tmux -S ~/.muxbot/state/muxbot.sock list-sessions`
2. Run `tmux -S ~/.muxbot/state/muxbot.sock attach -t default`

### Expected Results

- the operator can discover the active session using the documented socket
- attach connects to the live backend session
- the operator sees the current prompt and transcript state needed for debugging

## Test Case 2: Operator Can Restart A Broken Session Safely

### Preconditions

- a session is stuck, unhealthy, or no longer responding to prompts

### Steps

1. invoke the documented operator restart path for the affected agent
2. send a new prompt after the restart completes

### Expected Results

- the restart path targets only the intended agent session
- stale runner state is cleared
- the agent returns to a usable state without requiring undocumented manual cleanup

## Test Case 3: Health View Distinguishes Channel, Agent, And Runner Failure

### Preconditions

- observability or status output is available

### Steps

1. inspect health for a working session
2. inspect health for a case where the channel is disconnected
3. inspect health for a case where the runner is present but the agent is blocked

### Expected Results

- health output distinguishes channel connectivity, agent state, and runner state
- operators can identify the failing layer without attaching blindly
- the control surface exposes actionable state instead of forcing log forensics first
